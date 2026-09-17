import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import * as analytics from "@/lib/analytics"
import { ArrowLeft, CheckCircle2, Loader2, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { providerDisplayNames, type ModelRef } from "@/components/model-selector"
import { selectInitialModel, selectInitialTaskModels } from "@x/shared/dist/initial-selection.js"
import { normalizeModelRecommendation, type ModelRecommendations } from "@x/shared/dist/mythril-account.js"
import { useModels } from "@/hooks/use-models"
import { useMythrilConfig } from "@/hooks/use-mythril-config"
import { useChatGPT } from "@/hooks/useChatGPT"
import {
  AnthropicIcon,
  GenericApiIcon,
  GoogleIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  VercelIcon,
} from "@/components/onboarding/provider-icons"

// Provider lifecycle: connected-provider cards (status + model counts), the
// add-provider flow, per-provider manage (replace key / endpoint / refresh
// models / used-by), and disconnect with its consequences spelled out.
// Providers manage CREDENTIALS only — model choices live in
// ModelSelectionSection above this section.

type ByokFlavor = "openai" | "anthropic" | "google" | "openrouter" | "aigateway" | "ollama" | "openai-compatible" | "nvidia" | "cloudflare"

interface ProviderMeta {
  id: string
  flavor: string
  baseURL?: string
  hasApiKey: boolean
  keyCount?: number
}

interface Selections {
  assistantModel: ModelRef | null
  taskModels: Record<string, ModelRef | null>
}

const TASK_LABELS: Record<string, string> = {
  backgroundTask: "Background agents",
  subagent: "Subagents",
  knowledgeGraph: "Knowledge graph",
  meetingNotes: "Meeting notes",
  liveNoteAgent: "Live notes",
  autoPermissionDecision: "Permission checks",
  chatTitle: "Chat titles",
}

const BYOK_CATALOG: Array<{ flavor: ByokFlavor; name: string; tagline: string; icon: React.ElementType; needsKey: boolean; needsEndpoint: boolean; optionalKey?: boolean; manualModel?: boolean; needsAccountId?: boolean }> = [
  { flavor: "nvidia", name: "NVIDIA NIM", tagline: "Kimi, Llama, DeepSeek & more — multi-key rotation", icon: GenericApiIcon, needsKey: true, needsEndpoint: false },
  { flavor: "cloudflare", name: "Cloudflare Workers AI", tagline: "Llama, Qwen & more on Cloudflare", icon: GenericApiIcon, needsKey: true, needsEndpoint: false, needsAccountId: true },
  { flavor: "openai", name: "OpenAI", tagline: "GPT models", icon: OpenAIIcon, needsKey: true, needsEndpoint: false },
  { flavor: "anthropic", name: "Anthropic", tagline: "Claude models", icon: AnthropicIcon, needsKey: true, needsEndpoint: false },
  { flavor: "google", name: "Gemini", tagline: "Google AI Studio", icon: GoogleIcon, needsKey: true, needsEndpoint: false },
  { flavor: "ollama", name: "Ollama", tagline: "Run models locally", icon: OllamaIcon, needsKey: false, needsEndpoint: true },
  { flavor: "openrouter", name: "OpenRouter", tagline: "One key, many models", icon: OpenRouterIcon, needsKey: true, needsEndpoint: false },
  { flavor: "aigateway", name: "AI Gateway (Vercel)", tagline: "Vercel's AI Gateway", icon: VercelIcon, needsKey: true, needsEndpoint: false },
  { flavor: "openai-compatible", name: "OpenAI-Compatible", tagline: "Custom OpenAI-compatible endpoint", icon: GenericApiIcon, needsKey: true, optionalKey: true, needsEndpoint: true, manualModel: true },
]

const DEFAULT_BASE_URLS: Partial<Record<ByokFlavor, string>> = {
  ollama: "http://localhost:11434",
  "openai-compatible": "http://localhost:1234/v1",
  aigateway: "https://ai-gateway.vercel.sh/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
}

function flavorMeta(flavor: string) {
  return BYOK_CATALOG.find((c) => c.flavor === flavor)
}

export function ProvidersSection({ dialogOpen, variant = "settings" }: {
  dialogOpen: boolean
  /**
   * "onboarding" renders the same connected-provider list + add flow but
   * without the settings-only chrome (Manage buttons, defer toggle) — the
   * onboarding step supplies its own framing and navigation.
   */
  variant?: "settings" | "onboarding"
}) {
  const { groups, isMythrilConnected, refresh } = useModels()
  const chatgpt = useChatGPT()
  const modelRecommendations = useMythrilConfig()?.modelRecommendations

  const [providersMeta, setProvidersMeta] = useState<ProviderMeta[]>([])
  const [selections, setSelections] = useState<Selections>({ assistantModel: null, taskModels: {} })
  const [deferBackgroundTasks, setDeferBackgroundTasks] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [manageId, setManageId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const cfg = await window.ipc.invoke("models:getConfig", null)
      setProvidersMeta(cfg.providers)
      setSelections({ assistantModel: cfg.assistantModel, taskModels: cfg.taskModels })
      setDeferBackgroundTasks(cfg.deferBackgroundTasks)
    } catch { /* fresh install */ }
  }, [])

  useEffect(() => {
    if (dialogOpen) void load()
  }, [dialogOpen, load])
  useEffect(() => {
    const handler = () => void load()
    window.addEventListener("models-config-changed", handler)
    // Main-side config writes (Mythril sign-in seeding the assistant,
    // sign-out clearing selections, ChatGPT state) announce themselves on
    // the auth broadcasts, not the window event — reload on those too.
    const cleanups = [
      window.ipc.on("oauth:didConnect", handler),
      window.ipc.on("chatgpt:statusChanged", handler),
    ]
    return () => {
      window.removeEventListener("models-config-changed", handler)
      for (const cleanup of cleanups) cleanup()
    }
  }, [load])

  // One card per connected provider, in catalog order (assistant's first).
  const cards = useMemo(() => {
    return groups.map((g) => {
      const meta = providersMeta.find((p) => p.id === g.id)
      return {
        id: g.id,
        flavor: g.flavor,
        name: providerDisplayNames[g.flavor] || g.flavor,
        status: g.status,
        error: g.error,
        modelCount: g.models.length,
        meta,
      }
    })
  }, [groups, providersMeta])

  const usedBy = useCallback((providerId: string): Array<{ label: string; model: string }> => {
    const rows: Array<{ label: string; model: string }> = []
    if (selections.assistantModel?.provider === providerId) {
      rows.push({ label: "Assistant model", model: selections.assistantModel.model })
    }
    for (const [key, ref] of Object.entries(selections.taskModels)) {
      if (ref?.provider === providerId) {
        rows.push({ label: TASK_LABELS[key] ?? key, model: ref.model })
      }
    }
    return rows
  }, [selections])

  const handleDeferToggle = useCallback(async (value: boolean) => {
    setDeferBackgroundTasks(value)
    try {
      await window.ipc.invoke("models:updateConfig", { deferBackgroundTasks: value })
      window.dispatchEvent(new Event("models-config-changed"))
    } catch {
      toast.error("Failed to save setting")
    }
  }, [])

  const manageCard = manageId ? cards.find((c) => c.id === manageId) ?? null : null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {cards.length === 0 && (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Add an API key (NVIDIA NIM, OpenAI, Anthropic, …) or a local provider to start using the Assistant.
          </div>
        )}
        {cards.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-md border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{c.name}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                <span
                  className={cn(
                    "size-2 rounded-full shrink-0",
                    c.status === "ok" ? "bg-[var(--mythril-success)]" : "bg-destructive",
                  )}
                />
                {c.status === "ok"
                  ? `Connected · ${c.modelCount} model${c.modelCount === 1 ? "" : "s"} available`
                  : (c.error || "Could not load models")}
              </div>
            </div>
            {c.status === "error" && (
              <Button variant="ghost" size="sm" onClick={() => refresh(c.id)}>
                Retry
              </Button>
            )}
            {variant === "settings" && (
              <Button variant="outline" size="sm" onClick={() => setManageId(c.id)}>
                Manage
              </Button>
            )}
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
        <Plus className="size-4 mr-1" />
        Add provider
      </Button>

      {/* Defer background tasks while chatting */}
      {variant === "settings" && (
        <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">Defer background tasks while chatting</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Background agents wait until no chat is running. Recommended for local models.
            </div>
          </div>
          <Switch checked={deferBackgroundTasks} onCheckedChange={handleDeferToggle} />
        </div>
      )}

      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        connectedIds={cards.map((c) => c.id)}
        isMythrilConnected={isMythrilConnected}
        chatgptSignedIn={chatgpt.status.signedIn}
        onChatGPTSignIn={chatgpt.signIn}
        hadAssistant={selections.assistantModel !== null}
        modelRecommendations={modelRecommendations}
        analyticsSource={variant === "onboarding" ? "onboarding" : "connect"}
      />

      {manageCard && (
        <ManageProviderDialog
          card={manageCard}
          usedBy={usedBy(manageCard.id)}
          onClose={() => setManageId(null)}
          onRefreshModels={async () => { await refresh(manageCard.id) }}
        />
      )}
    </div>
  )
}

// ---------- Add provider ----------

type AddStep =
  | { kind: "choose" }
  | { kind: "creds"; flavor: ByokFlavor }
  | { kind: "authwait"; which: "mythril" | "chatgpt" }
  | { kind: "loading"; flavor: ByokFlavor }
  | { kind: "result"; name: string; first: boolean; pickedModel: string | null; modelCount: number | null }
  | { kind: "error"; flavor: ByokFlavor; message: string }

function AddProviderDialog({ open, onOpenChange, connectedIds, hadAssistant, modelRecommendations, analyticsSource }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectedIds: string[]
  isMythrilConnected: boolean
  chatgptSignedIn: boolean
  onChatGPTSignIn: () => Promise<unknown> | void
  hadAssistant: boolean
  modelRecommendations: ModelRecommendations | undefined
  analyticsSource: 'connect' | 'onboarding'
}) {
  const [step, setStep] = useState<AddStep>({ kind: "choose" })
  const [keyList, setKeyList] = useState<string[]>([""])
  const [baseURL, setBaseURL] = useState("")
  const [accountId, setAccountId] = useState("")
  const [includePaid, setIncludePaid] = useState(false)
  const [manualModel, setManualModel] = useState("")

  useEffect(() => {
    if (open) {
      setStep({ kind: "choose" })
      setKeyList([""])
      setBaseURL("")
      setAccountId("")
      setIncludePaid(false)
      setManualModel("")
    }
  }, [open])

  // Mythril / ChatGPT sign-in completes out-of-band (browser); the shared
  // store refreshes on the auth broadcasts, so the provider appearing in
  // connectedIds is the completion signal.
  useEffect(() => {
    if (step.kind !== "authwait") return
    const id = step.which === "mythril" ? "mythril" : "codex"
    if (connectedIds.includes(id)) {
      setStep({
        kind: "result",
        name: providerDisplayNames[id] || id,
        // Both sign-ins seed the assistant when none was set (main-side
        // initial selection) — first-provider copy applies to either.
        first: !hadAssistant,
        pickedModel: null,
        modelCount: null,
      })
    }
  }, [step, connectedIds, hadAssistant])

  const chooseEntries = useMemo(() => {
    const entries: Array<{ id: string; name: string; tagline: string; icon: React.ElementType | null; onChoose: () => void }> = []
    for (const c of BYOK_CATALOG) {
      if (connectedIds.includes(c.flavor)) continue
      entries.push({
        id: c.flavor,
        name: c.name,
        tagline: c.tagline,
        icon: c.icon,
        onChoose: () => {
          setKeyList([""])
          setBaseURL(DEFAULT_BASE_URLS[c.flavor] ?? "")
          setManualModel("")
          setStep({ kind: "creds", flavor: c.flavor })
        },
      })
    }
    return entries
  }, [connectedIds])

  const connect = useCallback(async (flavor: ByokFlavor) => {
    const meta = flavorMeta(flavor)
    if (!meta) return
    // Multi-key: every non-empty box joins the rotation pool
    // (first is the primary; the rest ride in apiKeys).
    const keys = keyList.map((k) => k.trim()).filter(Boolean)
    const key = keys[0] ?? ""
    const url = baseURL.trim()
    if (meta.needsKey && !meta.optionalKey && !key) {
      toast.error("Enter an API key")
      return
    }
    if (meta.needsEndpoint && !url) {
      toast.error("Enter the endpoint URL")
      return
    }
    if (meta.needsAccountId && !accountId.trim()) {
      toast.error("Enter your Cloudflare Account ID")
      return
    }
    setStep({ kind: "loading", flavor })
    const providerEntry = {
      flavor,
      apiKey: key || undefined,
      apiKeys: keys.length > 1 ? keys.slice(1) : undefined,
      baseURL: url || undefined,
      accountId: meta.needsAccountId ? accountId.trim() : undefined,
      includePaid: flavor === "cloudflare" ? includePaid : undefined,
    }
    try {
      const listRes = await window.ipc.invoke("models:listForProvider", { provider: providerEntry })
      const list = listRes.success ? listRes.models ?? [] : []
      const typed = manualModel.trim()
      // A hand-typed id is a bare choice (effort Auto); the recommendation
      // path may carry a recommended effort alongside the model.
      const choice = typed ? { model: typed } : selectInitialModel(flavor, list, modelRecommendations)
      const model = choice?.model ?? ""
      if (!listRes.success && !model) {
        setStep({ kind: "error", flavor, message: listRes.error || "Could not load the provider's model list." })
        return
      }
      if (!model) {
        setStep({ kind: "error", flavor, message: "The provider reported no models. Enter a model id manually and retry." })
        return
      }
      const testRes = await window.ipc.invoke("models:test", { provider: providerEntry, model })
      if (!testRes.success) {
        setStep({ kind: "error", flavor, message: testRes.error || "Connection test failed" })
        return
      }
      await window.ipc.invoke("models:setProvider", { id: flavor, provider: providerEntry })
      // Initial selection only — a saved assistant is never replaced. The
      // prop can be stale (a Mythril sign-in moments ago seeds the
      // assistant MAIN-side), so re-read the authoritative config at the
      // moment of decision instead of trusting render-time state.
      const cfgNow = await window.ipc.invoke("models:getConfig", null).catch(() => null)
      const hasAssistantNow = cfgNow ? cfgNow.assistantModel !== null : hadAssistant
      if (!hasAssistantNow) {
        // Task recommendations ride along the seeding moment as visible
        // overrides (validated against the live list; only differences).
        const taskModels = selectInitialTaskModels(flavor, flavor, list, modelRecommendations, choice ?? { model })
        await window.ipc.invoke("models:updateConfig", {
          assistantModel: {
            provider: flavor,
            model,
            ...(choice?.effort ? { effort: choice.effort } : {}),
          },
          ...(Object.keys(taskModels).length > 0 ? { taskModels } : {}),
        })
        analytics.llmInitialModelSelected({
          flavor,
          model,
          recommended: model === normalizeModelRecommendation(modelRecommendations, flavor)?.assistantModel.model,
          taskOverridesSeeded: Object.keys(taskModels).length,
          source: analyticsSource,
        })
        // The user has now been offered this version of the recommendation:
        // the update prompt waits for the next one. Awaited BEFORE the
        // config-changed event so a re-check can't race ahead of the marker.
        await window.ipc.invoke("models:markRecommendationSeen", { flavor }).catch(() => {})
      }
      for (const warning of testRes.warnings ?? []) {
        toast.warning(warning, { duration: 12000 })
      }
      window.dispatchEvent(new Event("models-config-changed"))
      setStep({
        kind: "result",
        name: meta.name,
        first: !hasAssistantNow,
        pickedModel: !hasAssistantNow ? model : null,
        modelCount: list.length > 0 ? list.length : null,
      })
    } catch {
      setStep({ kind: "error", flavor, message: "Connection failed" })
    }
  }, [keyList, baseURL, accountId, includePaid, manualModel, modelRecommendations, hadAssistant])

  const credsMeta = step.kind === "creds" || step.kind === "error" ? flavorMeta(step.flavor) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step.kind === "creds" && credsMeta ? `Connect ${credsMeta.name}` : "Add provider"}
          </DialogTitle>
        </DialogHeader>

        {step.kind === "choose" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Add your own API keys or run models locally. Paste multiple keys separated by commas to rotate across them. Each provider&apos;s models appear alongside the others in every picker.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {chooseEntries.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={e.onChoose}
                  className="rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    {e.icon && <e.icon className="size-4 shrink-0" />}
                    <span className="text-sm font-medium">{e.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{e.tagline}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step.kind === "creds" && credsMeta && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setStep({ kind: "choose" })}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              All providers
            </button>
            {credsMeta.needsKey && (
              <div className="space-y-1.5">
                <span className="text-[13px] text-muted-foreground">
                  API key{credsMeta.optionalKey ? " (optional)" : ""} — use Add key to rotate across several
                </span>
                {keyList.map((k, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      type="password"
                      value={k}
                      onChange={(e) => setKeyList((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                      placeholder={i === 0 ? "Paste your API key" : "Key " + (i + 1)}
                    />
                    {keyList.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => setKeyList((prev) => prev.filter((_, j) => j !== i))}>
                        ✕
                      </Button>
                    )}
                  </div>
                ))}
                {credsMeta.flavor !== "cloudflare" && (
                  <Button variant="outline" size="sm" onClick={() => setKeyList((prev) => [...prev, ""])}>
                    <Plus className="size-3.5 mr-1" />
                    Add key
                  </Button>
                )}
              </div>
            )}
            {credsMeta.needsEndpoint && (
              <div className="space-y-1.5">
                <span className="text-[13px] text-muted-foreground">Endpoint URL</span>
                <Input
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder={DEFAULT_BASE_URLS[credsMeta.flavor] ?? "https://api.example.com/v1"}
                />
              </div>
            )}
            {credsMeta.needsAccountId && (
              <div className="space-y-1.5">
                <span className="text-[13px] text-muted-foreground">Account ID</span>
                <Input
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="From your Cloudflare dashboard URL"
                />
              </div>
            )}
            {credsMeta.needsAccountId && (
              <div className="flex items-center gap-2">
                <Switch checked={includePaid} onCheckedChange={setIncludePaid} />
                <span className="text-[13px] text-muted-foreground">Include paid models (requires a paid Workers plan)</span>
              </div>
            )}
            {credsMeta.manualModel && (
              <div className="space-y-1.5">
                <span className="text-[13px] text-muted-foreground">Model id (optional)</span>
                <Input
                  value={manualModel}
                  onChange={(e) => setManualModel(e.target.value)}
                  placeholder="Leave empty to auto-select"
                />
              </div>
            )}
            <Button className="w-full" onClick={() => void connect(credsMeta.flavor)}>
              Connect
            </Button>
          </div>
        )}

        {step.kind === "authwait" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <div className="text-sm font-medium">Complete sign-in in your browser…</div>
            <Button variant="ghost" size="sm" onClick={() => setStep({ kind: "choose" })}>
              Cancel
            </Button>
          </div>
        )}

        {step.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <div className="text-sm font-medium">Loading available models…</div>
            <div className="text-xs text-muted-foreground">Validating the connection and fetching the model list.</div>
          </div>
        )}

        {step.kind === "result" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--mythril-success)]">
              <CheckCircle2 className="size-4" />
              {step.name} connected
            </div>
            {step.first && step.pickedModel && (
              <p className="text-xs text-muted-foreground">
                We selected <span className="font-medium text-foreground">{step.pickedModel}</span> as your Assistant model to get you started. You can change it any time above.
              </p>
            )}
            {step.first && !step.pickedModel && (
              <p className="text-xs text-muted-foreground">Your Assistant model has been set. You can change it any time above.</p>
            )}
            {!step.first && (
              <p className="text-xs text-muted-foreground">
                {step.modelCount ? `${step.modelCount} models are now available. ` : ""}Your Assistant model is unchanged — pick a model from {step.name} for any task whenever you like.
              </p>
            )}
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}

        {step.kind === "error" && credsMeta && (
          <div className="space-y-3">
            <div className="text-sm font-medium text-destructive">Couldn&apos;t connect</div>
            <p className="text-xs text-muted-foreground break-words">{step.message}</p>
            {credsMeta.manualModel && (
              <div className="space-y-1.5">
                <span className="text-[13px] text-muted-foreground">Model id</span>
                <Input
                  value={manualModel}
                  onChange={(e) => setManualModel(e.target.value)}
                  placeholder="Enter a model id to connect anyway"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep({ kind: "creds", flavor: step.flavor })}>
                Review connection
              </Button>
              <Button onClick={() => void connect(step.flavor)}>Retry</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------- Manage provider ----------

function ManageProviderDialog({ card, usedBy, onClose, onRefreshModels }: {
  card: { id: string; flavor: string; name: string; status: "ok" | "error"; error?: string; modelCount: number; meta?: ProviderMeta }
  usedBy: Array<{ label: string; model: string }>
  onClose: () => void
  onRefreshModels: () => Promise<void>
}) {
  const isAuthDerived = card.flavor === "mythril" || card.flavor === "codex"
  const meta = flavorMeta(card.flavor)
  const chatgpt = useChatGPT()
  const [replacingKey, setReplacingKey] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [keyCount, setKeyCount] = useState(card.meta?.keyCount ?? (card.meta?.hasApiKey ? 1 : 0))

  const addKey = useCallback(async () => {
    const key = newKey.trim()
    if (!key) return
    try {
      const res = await window.ipc.invoke("models:addProviderKey", { id: card.id, apiKey: key })
      setKeyCount(res.keyCount)
      setNewKey("")
      setReplacingKey(false)
      window.dispatchEvent(new Event("models-config-changed"))
      toast.success("Key added to rotation")
    } catch {
      toast.error("Failed to add key")
    }
  }, [newKey, card.id])

  const removeKeyAt = useCallback(async (index: number) => {
    try {
      const res = await window.ipc.invoke("models:removeProviderKey", { id: card.id, index })
      setKeyCount(res.keyCount)
      window.dispatchEvent(new Event("models-config-changed"))
      toast.success("Key removed")
    } catch {
      toast.error("Failed to remove key")
    }
  }, [card.id])
  const [endpoint, setEndpoint] = useState(card.meta?.baseURL ?? "")
  const [manageIncludePaid, setManageIncludePaid] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefreshModels = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefreshModels()
      toast.success("Models refreshed")
    } finally {
      setRefreshing(false)
    }
  }, [onRefreshModels])

  const saveCredentials = useCallback(async (updates: { apiKey?: string; baseURL?: string; includePaid?: boolean }) => {
    try {
      await window.ipc.invoke("models:setProvider", {
        id: card.id,
        provider: {
          flavor: card.flavor as ByokFlavor,
          ...(updates.apiKey !== undefined ? { apiKey: updates.apiKey } : {}),
          ...(updates.baseURL !== undefined ? { baseURL: updates.baseURL } : {}),
          ...(updates.includePaid !== undefined ? { includePaid: updates.includePaid } : {}),
        },
      })
      window.dispatchEvent(new Event("models-config-changed"))
      toast.success("Provider updated")
      setReplacingKey(false)
      setNewKey("")
    } catch {
      toast.error("Failed to update provider")
    }
  }, [card.id, card.flavor])

  const disconnect = useCallback(async () => {
    try {
      if (card.flavor === "mythril") {
        await window.ipc.invoke("oauth:disconnect", { provider: "mythril" })
      } else if (card.flavor === "codex") {
        await chatgpt.signOut()
      } else {
        await window.ipc.invoke("models:removeProvider", { id: card.id })
      }
      window.dispatchEvent(new Event("models-config-changed"))
      toast.success(`${card.name} disconnected`)
      onClose()
    } catch {
      toast.error("Failed to disconnect")
    }
  }, [card, chatgpt, onClose])

  const assistantAffected = usedBy.some((u) => u.label === "Assistant model")

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{card.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full shrink-0", card.status === "ok" ? "bg-[var(--mythril-success)]" : "bg-destructive")} />
            {card.status === "ok"
              ? `Connected · ${card.modelCount} model${card.modelCount === 1 ? "" : "s"} available`
              : (card.error || "Could not load models")}
          </div>

          {!isAuthDerived && meta?.needsKey && (
            <div className="space-y-1.5">
              <span className="text-[13px] text-muted-foreground">
                API keys {keyCount > 1 ? `· ${keyCount} in rotation` : ""}
              </span>
              {Array.from({ length: Math.max(keyCount, 1) }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input readOnly value={card.meta?.hasApiKey ? `Key ${i + 1} · ••••••••••••••••` : "No key saved"} className="font-mono text-xs" />
                  {keyCount > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeKeyAt(i)}
                      title="Remove this key from rotation"
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              {replacingKey ? (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="Paste the new API key"
                  />
                  <Button size="sm" disabled={!newKey.trim()} onClick={() => void addKey()}>
                    Add
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setReplacingKey(false); setNewKey("") }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setReplacingKey(true)}>
                  <Plus className="size-3.5 mr-1" />
                  Add key
                </Button>
              )}
            </div>
          )}

          {!isAuthDerived && meta?.needsEndpoint && (
            <div className="space-y-1.5">
              <span className="text-[13px] text-muted-foreground">Endpoint URL</span>
              <div className="flex gap-2">
                <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!endpoint.trim() || endpoint.trim() === (card.meta?.baseURL ?? "")}
                  onClick={() => void saveCredentials({ baseURL: endpoint.trim() })}
                >
                  Save
                </Button>
              </div>
            </div>
          )}

          {card.flavor === "cloudflare" && (
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <div className="text-xs text-muted-foreground">Include paid models (require a paid Workers plan)</div>
              <Switch
                checked={manageIncludePaid}
                onCheckedChange={(v) => { setManageIncludePaid(v); void saveCredentials({ includePaid: v }) }}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <div className="text-xs text-muted-foreground">Refresh to pull the latest models from {card.name}.</div>
            <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void handleRefreshModels()}>
              <RefreshCw className={cn("size-3.5 mr-1", refreshing && "animate-spin")} />
              {refreshing ? "Refreshing…" : "Refresh models"}
            </Button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[13px] text-muted-foreground">Used by</span>
            {usedBy.length === 0 ? (
              <div className="text-xs text-muted-foreground">No model selections currently use this provider.</div>
            ) : (
              <div className="space-y-1">
                {usedBy.map((u) => (
                  <div key={u.label} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{u.label}</span>
                    <span className="text-muted-foreground truncate ml-3">{u.model}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-3">
            {!confirmDisconnect ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {`Remove ${card.name} and its models from Mythril.`}
                </span>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDisconnect(true)}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-medium">Disconnect {card.name}?</div>
                <p className="text-xs text-muted-foreground">
                  {usedBy.length > 0
                    ? `${usedBy.length} model selection${usedBy.length === 1 ? "" : "s"} use${usedBy.length === 1 ? "s" : ""} this provider. Task overrides will reset to the Assistant model${assistantAffected ? ", and you'll need to pick a new Assistant model" : ""}.`
                    : "Its models will no longer be available in Mythril."}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void disconnect()}>
                    Disconnect
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
