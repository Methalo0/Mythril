import { ProviderV4 } from "@ai-sdk/provider";
import { createGateway, generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LlmModelConfig, LlmProvider } from "@x/shared/dist/models.js";
import z from "zod";
import { allKeys, makeRotatingFetch } from "./key-rotation.js";
import { getGatewayProvider } from "./gateway.js";
import { getCodexProvider } from "./codex.js";
import { getDefaultModelAndProvider, resolveProviderConfig } from "./defaults.js";
import { getChatModelIds } from "./models-dev.js";
import { withUseCase } from "../analytics/use_case.js";
import {
    applyLocalModelSettings,
    makeOllamaThinkFetch,
    DEFAULT_OLLAMA_CONTEXT_LENGTH,
    DEFAULT_OLLAMA_REASONING_EFFORT,
} from "./local.js";

export const Provider = LlmProvider;
export const ModelConfig = LlmModelConfig;

export const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

// Cloudflare Workers AI speaks a REDUCED OpenAI dialect at
// .../accounts/{accountId}/ai/v1: message content must be a plain string
// (no parts arrays), never null, and tool-call fields are not accepted.
// Rewrite every chat/completions body into that dialect on the way out.
function flattenContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text);
                return "";
            })
            .filter(Boolean)
            .join("\n");
    }
    return "";
}

function makeCloudflareFetch(base: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (!init?.body || typeof init.body !== "string") return base(input, init);
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(init.body);
        } catch {
            return base(input, init);
        }
        if (!Array.isArray(parsed.messages)) return base(input, init);

        const messages = (parsed.messages as Record<string, unknown>[])
            .map((m) => {
                const role = m.role;
                // tool results → plain user text; assistant tool_calls → text
                const content = flattenContent(m.content)
                    || (Array.isArray(m.tool_calls) ? "(called a tool)" : "");
                if (role === "tool") return { role: "user", content: `[tool result] ${content}` };
                if (role === "assistant" || role === "user" || role === "system" || role === "developer") {
                    return { role, content };
                }
                return { role: "user", content };
            })
            .filter((m) => m.content !== "");
        // Cloudflare requires a non-empty messages array.
        if (!messages.length) messages.push({ role: "user", content: "…" });

        const { tools, tool_choice, parallel_tool_calls, ...rest } = parsed;
        void tools; void tool_choice; void parallel_tool_calls;
        return base(input, { ...init, body: JSON.stringify({ ...rest, messages }) });
    }) as typeof fetch;
}

// ---- Cloudflare Workers AI listing --------------------------------------
// The search endpoint is NOT OpenAI-shaped: { success, result: [...],
// result_info: { page, per_page, total_count } }, paginated at ~100/page
// (the catalog is ~300+ models, so a single page silently drops most of it).
// Each entry carries task.name ("Text Generation", "Text-to-Image", …) and
// a properties array with e.g. require_workers_paid=true.

interface CloudflareModelEntry {
    name: string;
    task?: { name?: string };
    properties?: { property_id: string; value: unknown }[];
}

async function fetchCloudflareCatalog(
    providerConfig: z.infer<typeof Provider>,
): Promise<CloudflareModelEntry[]> {
    const account = providerConfig.accountId ?? "";
    if (!account) throw new Error("Cloudflare needs your Account ID (from the Workers & Pages dashboard URL)");
    const out: CloudflareModelEntry[] = [];
    let page = 1;
    for (;;) {
        const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/models/search?per_page=100&page=${page}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${providerConfig.apiKey ?? ""}` },
            signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Failed to list models (${res.status}): ${body.slice(0, 200)}`);
        }
        const data = await res.json() as {
            result?: CloudflareModelEntry[];
            result_info?: { page: number; per_page: number; total_count: number };
        };
        const batch = data.result ?? [];
        out.push(...batch);
        const total = data.result_info?.total_count ?? out.length;
        if (out.length >= total || batch.length === 0) break;
        page++;
    }
    return out;
}

function cloudflareModelIsPaid(m: CloudflareModelEntry): boolean {
    return (m.properties ?? []).some(
        (p) => p.property_id === "require_workers_paid" && (p.value === "true" || p.value === true),
    );
}

/** Chat-capable models = task "Text Generation". Paid models excluded unless the provider opted in. */
async function listCloudflareModels(providerConfig: z.infer<typeof Provider>): Promise<string[]> {
    const catalog = await fetchCloudflareCatalog(providerConfig);
    return catalog
        .filter((m) => m.task?.name === "Text Generation")
        .filter((m) => providerConfig.includePaid || !cloudflareModelIsPaid(m))
        .map((m) => m.name)
        .filter(Boolean);
}

/** Image models = task "Text-to-Image". Same paid filter. */
export async function listCloudflareImageModels(providerConfig: z.infer<typeof Provider>): Promise<string[]> {
    const catalog = await fetchCloudflareCatalog(providerConfig);
    return catalog
        .filter((m) => m.task?.name === "Text-to-Image")
        .filter((m) => providerConfig.includePaid || !cloudflareModelIsPaid(m))
        .map((m) => m.name)
        .filter(Boolean);
}

// Cloudflare Workers AI speaks OpenAI at .../accounts/{accountId}/ai/v1.
// baseURL (if set) wins so a custom gateway/AI-Gateway route keeps working.
export function cloudflareBaseURL(config: { baseURL?: string; accountId?: string }): string {
    if (config.baseURL) return config.baseURL;
    const account = config.accountId ?? "";
    return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
}

// Which auth header each flavor authenticates with — used by key rotation
// to swap credentials per request.
function authHeaderFor(flavor: string): (key: string) => Record<string, string> {
    switch (flavor) {
        case "anthropic": return (key) => ({ "x-api-key": key });
        case "google": return (key) => ({ "x-goog-api-key": key });
        default: return (key) => ({ Authorization: `Bearer ${key}` });
    }
}

export function createProvider(config: z.infer<typeof Provider>): ProviderV4 {
    const { apiKey, baseURL, headers } = config;
    const keys = allKeys(config);
    // Multi-key rotation: more than one key → every request picks the
    // least-loaded key and retries on 429/401 with the next one.
    const rotatingFetch = keys.length > 1
        ? makeRotatingFetch(config.flavor, keys, authHeaderFor(config.flavor))
        : undefined;
    switch (config.flavor) {
        case "openai":
            return createOpenAI({
                apiKey,
                baseURL,
                headers,
                ...(rotatingFetch ? { fetch: rotatingFetch } : {}),
            });
        case "aigateway":
            return createGateway({
                apiKey,
                baseURL,
                headers,
                ...(rotatingFetch ? { fetch: rotatingFetch } : {}),
            });
        case "anthropic":
            return createAnthropic({
                apiKey,
                baseURL,
                headers,
                ...(rotatingFetch ? { fetch: rotatingFetch } : {}),
            });
        case "google":
            return createGoogleGenerativeAI({
                apiKey,
                baseURL,
                headers,
                ...(rotatingFetch ? { fetch: rotatingFetch } : {}),
            });
        case "nvidia":
            return createOpenAICompatible({
                name: "nvidia",
                apiKey,
                baseURL: baseURL || NVIDIA_NIM_BASE_URL,
                headers,
                ...(rotatingFetch ? { fetch: rotatingFetch } : {}),
            });
        case "cloudflare":
            return createOpenAICompatible({
                name: "cloudflare",
                apiKey,
                baseURL: cloudflareBaseURL(config),
                headers,
                // Workers AI rejects OpenAI multipart content arrays and null
                // content — flatten every message to plain string content
                // before the request leaves (see sanitizeCloudflareFetch).
                fetch: makeCloudflareFetch(rotatingFetch ?? fetch),
            });
        case "ollama": {
            // ollama-ai-provider-v2 expects baseURL to include /api
            let ollamaURL = baseURL;
            if (ollamaURL && !ollamaURL.replace(/\/+$/, '').endsWith('/api')) {
                ollamaURL = ollamaURL.replace(/\/+$/, '') + '/api';
            }
            return createOllama({
                baseURL: ollamaURL,
                headers,
                // Rewrites `think` on the wire: the provider itself can only
                // send think:false, which thinking models ignore — leaving
                // e.g. gpt-oss at medium effort. See makeOllamaThinkFetch.
                fetch: makeOllamaThinkFetch(
                    config.reasoningEffort ?? DEFAULT_OLLAMA_REASONING_EFFORT,
                ),
            });
        }
        case "openai-compatible":
            return createOpenAICompatible({
                name: "openai-compatible",
                apiKey,
                baseURL: baseURL || "",
                headers,
                ...(rotatingFetch ? { fetch: rotatingFetch } : {}),
            });
        case "openrouter":
            return createOpenRouter({
                apiKey,
                baseURL,
                headers,
                ...(rotatingFetch ? { fetch: rotatingFetch } : {}),
            }) as unknown as ProviderV4;
        case "mythril":
            return getGatewayProvider();
        case "codex":
            return getCodexProvider();
        default:
            throw new Error(`Unsupported provider flavor: ${config.flavor}`);
    }
}

/**
 * The one place model instances are created. Applies local-runtime settings
 * (explicit Ollama context window) on top of the raw provider model.
 */
export function createLanguageModel(
    providerConfig: z.infer<typeof Provider>,
    modelId: string,
): LanguageModel {
    const model = createProvider(providerConfig).languageModel(modelId);
    return applyLocalModelSettings(model, providerConfig);
}

export interface ModelCapabilities {
    /** undefined = could not be determined (endpoint missing, non-local provider). */
    supportsTools?: boolean;
    maxContextLength?: number;
}

/**
 * Best-effort capability probe for local runtimes. Ollama reports a
 * `capabilities` list and the model's trained context window via /api/show;
 * LM Studio exposes the same through its /api/v0/models REST endpoint.
 * Failures are swallowed — an unknown capability is not an error.
 */
export async function probeModelCapabilities(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    timeoutMs = 5000,
): Promise<ModelCapabilities> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        if (providerConfig.flavor === "ollama") {
            const base = (providerConfig.baseURL ?? "http://localhost:11434")
                .replace(/\/+$/, "")
                .replace(/\/api$/, "");
            const res = await fetch(`${base}/api/show`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(providerConfig.headers ?? {}) },
                body: JSON.stringify({ model }),
                signal: controller.signal,
            });
            if (!res.ok) return {};
            const data = await res.json() as {
                capabilities?: string[];
                model_info?: Record<string, unknown>;
            };
            const result: ModelCapabilities = {};
            if (Array.isArray(data.capabilities)) {
                result.supportsTools = data.capabilities.includes("tools");
            }
            for (const [key, value] of Object.entries(data.model_info ?? {})) {
                if (key.endsWith(".context_length") && typeof value === "number") {
                    result.maxContextLength = value;
                    break;
                }
            }
            return result;
        }
        if (providerConfig.flavor === "openai-compatible") {
            // LM Studio's enhanced REST API lives at /api/v0 on the same
            // origin as the OpenAI-compatible /v1 endpoint. Non-LM Studio
            // endpoints just 404 here, which reports as "unknown".
            const origin = new URL(providerConfig.baseURL ?? "").origin;
            const res = await fetch(`${origin}/api/v0/models`, {
                headers: providerConfig.headers ?? {},
                signal: controller.signal,
            });
            if (!res.ok) return {};
            const data = await res.json() as { data?: Array<Record<string, unknown>> };
            const entry = (data.data ?? []).find((m) => m.id === model);
            if (!entry) return {};
            const result: ModelCapabilities = {};
            if (Array.isArray(entry.capabilities)) {
                result.supportsTools = (entry.capabilities as string[]).includes("tool_use");
            }
            const max = entry.loaded_context_length ?? entry.max_context_length;
            if (typeof max === "number") {
                result.maxContextLength = max;
            }
            return result;
        }
        return {};
    } catch {
        return {};
    } finally {
        clearTimeout(timeout);
    }
}

function capabilityWarnings(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    capabilities: ModelCapabilities,
): string[] {
    const warnings: string[] = [];
    if (capabilities.supportsTools === false) {
        warnings.push(
            `${model} does not support tool calling. Mythril's assistant and background agents rely on tools; pick a tool-capable model (e.g. qwen3, gpt-oss, llama3.3).`,
        );
    }
    const configured = providerConfig.contextLength
        ?? (providerConfig.flavor === "ollama" ? DEFAULT_OLLAMA_CONTEXT_LENGTH : undefined);
    if (capabilities.maxContextLength !== undefined) {
        if (capabilities.maxContextLength < 16384) {
            warnings.push(
                `${model} has a ${capabilities.maxContextLength}-token context window. Mythril's assistant needs ~16k+ tokens; expect truncated or confused responses.`,
            );
        } else if (configured !== undefined && capabilities.maxContextLength < configured) {
            warnings.push(
                `${model} supports at most ${capabilities.maxContextLength} context tokens, below the configured ${configured}. Set "contextLength" for this provider in models.json to ${capabilities.maxContextLength} or less.`,
            );
        }
    }
    return warnings;
}

export async function testModelConnection(
    providerConfig: z.infer<typeof Provider>,
    model: string,
    timeoutMs?: number,
): Promise<{ success: boolean; error?: string; warnings?: string[]; capabilities?: ModelCapabilities }> {
    const isLocal = providerConfig.flavor === "ollama" || providerConfig.flavor === "openai-compatible" || providerConfig.flavor === "nvidia";
    const effectiveTimeout = timeoutMs ?? (isLocal ? 60000 : 8000);
    // NIM reasoning models (e.g. kimi-k3) can "think" for minutes even on a
    // 1-token ping — reasoning tokens don't count against max_tokens — so
    // probing the SELECTED model can hang forever. Validate the KEY instead
    // with a tiny non-reasoning model: a fast 200 proves the credential works,
    // and model-specific failures surface in chat, not here.
    if (providerConfig.flavor === "nvidia") {
        // Validate the KEY, not the model: NIM answers 401/403 for bad keys
        // and 404 "function not found" when the probe model isn't enabled on
        // the account — a 404 (or a 429 rate limit) still proves the key
        // works, so accept it with a warning instead of failing the connect.
        // Small non-reasoning probe model: reasoning models can think for
        // minutes past any max_tokens cap.
        const PROBE_MODEL = "moonshotai/kimi-k3";
        try {
            const res = await fetch(`${(providerConfig.baseURL ?? NVIDIA_NIM_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${providerConfig.apiKey ?? ""}`,
                },
                body: JSON.stringify({
                    model: PROBE_MODEL,
                    messages: [{ role: "user", content: "hi" }],
                    max_tokens: 1,
                    stream: false,
                    chat_template_kwargs: { thinking: false },
                }),
                signal: AbortSignal.timeout(45_000),
            });
            if (res.ok) return { success: true };
            const body = await res.text().catch(() => "");
            if (res.status === 401 || res.status === 403) {
                return { success: false, error: `NIM rejected the key (HTTP ${res.status}) — check that it's copied correctly` };
            }
            return {
                success: true,
                warnings: [`Key accepted (NIM answered HTTP ${res.status} on the probe). If chat fails for a model, that model may not be enabled on your NIM account.`],
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Connection test failed";
            // A timeout with a real key is ambiguous — the request reached
            // NIM but the model didn't answer in time. Let the user in with a
            // warning rather than blocking the connect entirely.
            return { success: true, warnings: [`Could not verify the key live (${msg}). It was saved anyway — watch the first chat response for errors.`] };
        }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
        const languageModel = createLanguageModel(providerConfig, model);
        await generateText({
            model: languageModel,
            prompt: "ping",
            abortSignal: controller.signal,
        });
        const capabilities = await probeModelCapabilities(providerConfig, model);
        const warnings = capabilityWarnings(providerConfig, model, capabilities);
        return {
            success: true,
            ...(warnings.length > 0 ? { warnings } : {}),
            capabilities,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Connection test failed";
        return { success: false, error: message };
    } finally {
        clearTimeout(timeout);
    }
}

export async function listModelsForProvider(
    providerConfig: z.infer<typeof Provider>,
    timeoutMs?: number,
): Promise<string[]> {
    // NIM's /models catalog is large and slow; give it room.
    if (timeoutMs === undefined) {
        timeoutMs = providerConfig.flavor === "nvidia" ? 60000 : 8000;
    }
    const { flavor, apiKey, baseURL } = providerConfig;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let url = "";
        const headers: Record<string, string> = {};

        switch (flavor) {
            case "openai":
                url = "https://api.openai.com/v1/models";
                headers["Authorization"] = `Bearer ${apiKey}`;
                break;
            case "anthropic":
                url = "https://api.anthropic.com/v1/models";
                headers["x-api-key"] = apiKey ?? "";
                headers["anthropic-version"] = "2023-06-01";
                break;
            case "google":
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey ?? ""}`;
                break;
            case "openrouter":
                // /api/v1/models is a public catalog — it returns the full
                // list even with an invalid/absent key, so listing it can't
                // tell a bad key from a good one (a false "Connected"). When
                // a key is given, hit the account-scoped /models/user behind
                // Bearer auth instead: a bad key 401s here and the shared
                // throw below surfaces it. Same OpenAI-shaped { data:[{id}] }
                // response, so the parse path is unchanged. No key → keep the
                // public catalog so an unconfigured provider can still preview.
                if (apiKey) {
                    url = "https://openrouter.ai/api/v1/models/user";
                    headers["Authorization"] = `Bearer ${apiKey}`;
                } else {
                    url = "https://openrouter.ai/api/v1/models";
                }
                break;
            case "ollama":
                url = `${(baseURL ?? "http://localhost:11434").replace(/\/$/, "")}/api/tags`;
                break;
            case "nvidia":
                url = `${(baseURL ?? NVIDIA_NIM_BASE_URL).replace(/\/$/, "")}/models`;
                if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
                break;
            case "cloudflare": {
                // Handled below — paginated, envelope-shaped, task-tagged.
                const models = await listCloudflareModels(providerConfig);
                return models;
            }
            case "openai-compatible":
            case "aigateway":
                url = `${(baseURL ?? "").replace(/\/$/, "")}/models`;
                if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
                break;
            default:
                throw new Error(`Unsupported provider flavor: ${flavor}`);
        }

        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Failed to list models (${res.status}): ${body.slice(0, 200)}`);
        }
        const data = await res.json();

        // Normalize each provider's response shape into a flat list of model id strings.
        let ids: string[] = [];
        if (flavor === "google") {
            // { models: [{ name: "models/gemini-..." }] }
            ids = (data.models ?? []).map((m: { name: string }) => m.name.replace(/^models\//, ""));
        } else if (flavor === "ollama") {
            // { models: [{ name: "llama3:latest" }] }
            ids = (data.models ?? []).map((m: { name: string }) => m.name);
        } else {
            // OpenAI-shaped: { data: [{ id: "..." }] }
            ids = (data.data ?? []).map((m: { id: string }) => m.id);
        }
        const cleaned = ids.filter((id: string) => typeof id === "string" && id.length > 0);
        if (flavor === "openai" || flavor === "anthropic" || flavor === "google") {
            const chatIds = await getChatModelIds(flavor);
            // Only filter when models.dev returned data; if it's empty (offline/no
            // cache/unknown provider) keep the full list rather than showing none.
            if (chatIds.size > 0) {
                return cleaned.filter((id) => chatIds.has(id));
            }
        }
        return cleaned;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Image-capable model ids for a BYOK provider. OpenRouter is the one flavor
 * whose own catalog can be filtered by output modality (the public
 * endpoint, no auth needed); the other image flavors get their lists
 * elsewhere — models.dev for openai/google, the plain model list for
 * ollama/openai-compatible (see getImageModelCatalog in catalog.ts).
 */
export async function listImageModelsForProvider(
    providerConfig: z.infer<typeof Provider>,
    timeoutMs = 8000,
): Promise<string[]> {
    if (providerConfig.flavor !== "openrouter") {
        throw new Error(`Provider flavor '${providerConfig.flavor}' has no image model listing`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("https://openrouter.ai/api/v1/models?output_modalities=image", {
            signal: controller.signal,
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Failed to list image models (${res.status}): ${body.slice(0, 200)}`);
        }
        const data = await res.json() as { data?: Array<{ id?: unknown }> };
        return (data.data ?? [])
            .map((m) => m?.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
    } finally {
        clearTimeout(timeout);
    }
}

export interface GenerateTextOptions {
    prompt: string;
    system?: string;
    /** Model id. Falls back to the active default when omitted. */
    model?: string;
    /** Provider name (e.g. "mythril", "openai"). Falls back to the active default. */
    provider?: string;
}

export interface GenerateTextResult {
    text?: string;
    /** The model/provider actually used (after resolving defaults). */
    model?: string;
    provider?: string;
    error?: string;
}

/**
 * One-shot text generation for lightweight UI features (e.g. the email
 * composer's "write with AI"). Resolves the requested model+provider, falling
 * back to the active default, and returns the generated text. Never throws —
 * errors are returned in the result so the renderer can surface them.
 */
export async function generateOneShot(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    try {
        const def = await getDefaultModelAndProvider();
        const modelId = opts.model || def.model;
        const providerName = opts.provider || def.provider;
        const providerConfig = await resolveProviderConfig(providerName);
        const languageModel = createLanguageModel(providerConfig, modelId);
        const result = await withUseCase(
            { useCase: "copilot_chat", subUseCase: "email_compose" },
            () => generateText({
                model: languageModel,
                ...(opts.system ? { instructions: opts.system } : {}),
                prompt: opts.prompt,
            }),
        );
        return { text: result.text.trim(), model: modelId, provider: providerName };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
