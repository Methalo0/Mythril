import { z } from 'zod'
import { useSyncExternalStore } from 'react'
import { MythrilApiConfig } from '@x/shared/dist/mythril-account.js'

export type MythrilConfig = z.infer<typeof MythrilApiConfig>

// The single renderer-side reader of the /v1/config bootstrap (service URLs,
// billing catalog, model recommendations) via mythril:getConfig. The config
// is static for the lifetime of the app run (main caches the fetch), so one
// module-level store serves every consumer: the first subscriber triggers
// the fetch, everyone shares the result, and a failed fetch retries on the
// next consumer instead of caching null forever.
let cached: MythrilConfig | null = null
let pending: Promise<MythrilConfig | null> | null = null
const subscribers = new Set<() => void>()

/**
 * Imperative access for non-hook call paths (e.g. useMythrilAccount's
 * refresh) — same shared cache as the hook.
 */
export function fetchMythrilConfig(): Promise<MythrilConfig | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = window.ipc
      .invoke('mythril:getConfig', null)
      .then((config) => {
        if (config) {
          cached = config
          for (const notify of subscribers) notify()
        } else {
          // Main returned null (API unreachable) — leave the cache empty so
          // a later consumer retries.
          pending = null
        }
        return config
      })
      .catch(() => {
        pending = null
        return null
      })
  }
  return pending
}

function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange)
  void fetchMythrilConfig()
  return () => {
    subscribers.delete(onStoreChange)
  }
}

function getSnapshot(): MythrilConfig | null {
  return cached
}

/** The Mythril bootstrap config, or null while loading / when unreachable. */
export function useMythrilConfig(): MythrilConfig | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// Test-only: drop the shared cache so each test starts cold.
export function __resetMythrilConfigForTests(): void {
  cached = null
  pending = null
  subscribers.clear()
}
