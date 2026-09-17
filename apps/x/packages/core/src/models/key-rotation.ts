/**
 * Multi-key rotation for BYOK providers.
 *
 * A provider config can carry `apiKeys` (extra keys) alongside `apiKey`.
 * When more than one key exists, every outbound request goes through a
 * rotating fetch: keys are picked least-recently-used, each key is limited
 * by a per-key sliding-window request cap (NVIDIA NIM: 35 req/min, below
 * their hard 40), and a 429/401 response marks that key saturated and
 * retries the request with the next key. Single-key providers pass through
 * unchanged.
 */

interface KeyState {
    key: string;
    timestamps: number[];
}

interface PoolOptions {
    windowMs: number;
    cap: number; // requests per window per key
}

const pools = new Map<string, { keys: KeyState[]; opts: PoolOptions }>();

const DEFAULT_OPTS: PoolOptions = { windowMs: 60_000, cap: Number.MAX_SAFE_INTEGER };
const NVIDIA_OPTS: PoolOptions = { windowMs: 60_000, cap: 35 };

function poolFor(flavor: string, keys: string[]): { keys: KeyState[]; opts: PoolOptions } {
    const opts = flavor === "nvidia" ? NVIDIA_OPTS : DEFAULT_OPTS;
    let pool = pools.get(flavor);
    if (!pool || pool.keys.map(k => k.key).join("") !== keys.join("")) {
        pool = { keys: keys.map(key => ({ key, timestamps: [] })), opts };
        pools.set(flavor, pool);
    }
    pool.opts = opts;
    return pool;
}

function prune(pool: { keys: KeyState[]; opts: PoolOptions }, now: number): void {
    for (const k of pool.keys) {
        k.timestamps = k.timestamps.filter(t => now - t < pool.opts.windowMs);
    }
}

function pickKey(pool: { keys: KeyState[]; opts: PoolOptions }, exclude: Set<string>): KeyState | null {
    const now = Date.now();
    prune(pool, now);
    let best: KeyState | null = null;
    for (const k of pool.keys) {
        if (exclude.has(k.key)) continue;
        if (k.timestamps.length >= pool.opts.cap) continue;
        if (!best) { best = k; continue; }
        if (k.timestamps.length < best.timestamps.length) best = k;
        else if (k.timestamps.length === best.timestamps.length) {
            if ((k.timestamps.at(-1) ?? 0) < (best.timestamps.at(-1) ?? 0)) best = k;
        }
    }
    return best;
}

function markSaturated(pool: { keys: KeyState[]; opts: PoolOptions }, key: string): void {
    const k = pool.keys.find(x => x.key === key);
    if (!k) return;
    while (k.timestamps.length < pool.opts.cap) k.timestamps.push(Date.now());
}

/**
 * Returns a fetch implementation that rotates across the provider's keys.
 * The AI SDK providers all accept a custom `fetch`; we swap the
 * Authorization/x-api-key header per attempt and retry on 429/401 with the
 * next key in the pool.
 */
export function makeRotatingFetch(
    flavor: string,
    keys: string[],
    authHeader: (key: string) => Record<string, string>,
    baseFetch: typeof fetch = fetch,
): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const pool = poolFor(flavor, keys);
        const tried = new Set<string>();
        let lastResponse: Response | null = null;

        while (true) {
            const slot = pickKey(pool, tried);
            if (!slot) {
                // Every key is saturated or failed — return the last error
                // response rather than hanging; the caller surfaces it.
                if (lastResponse) return lastResponse;
                return new Response("All API keys are rate-limited; try again in a minute.", { status: 429 });
            }
            slot.timestamps.push(Date.now());

            const headers = new Headers(init?.headers ?? {});
            for (const [k, v] of Object.entries(authHeader(slot.key))) headers.set(k, v);

            let res: Response;
            try {
                res = await baseFetch(input, { ...init, headers });
            } catch (err) {
                tried.add(slot.key);
                if (tried.size >= pool.keys.length) throw err;
                continue;
            }

            if (res.status === 429 || res.status === 401 || res.status === 403) {
                markSaturated(pool, slot.key);
                tried.add(slot.key);
                lastResponse = res;
                if (tried.size >= pool.keys.length) return res;
                continue;
            }
            return res;
        }
    }) as typeof fetch;
}

/** All keys for a provider config: primary first, then extras. */
export function allKeys(config: { apiKey?: string; apiKeys?: string[] }): string[] {
    return [config.apiKey, ...(config.apiKeys ?? [])].filter((k): k is string => !!k && k.length > 0);
}

/** Live per-key usage for the settings/usage UI. */
export function keyPoolUsage(flavor: string, keys: string[]): { used: number; cap: number; total: number; keyCount: number } {
    const pool = poolFor(flavor, keys);
    prune(pool, Date.now());
    const used = pool.keys.reduce((s, k) => s + k.timestamps.length, 0);
    return { used, cap: pool.opts.cap, total: pool.keys.length * pool.opts.cap, keyCount: pool.keys.length };
}
