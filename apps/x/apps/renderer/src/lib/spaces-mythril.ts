import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { containsMythrilAddress } from '@/lib/spaces-mentions'
import { toast } from '@/lib/toast'

// ---------------------------------------------------------------------------
// @mythril trigger (spec §8): a posted message that genuinely addresses
// @mythril routes into the THREAD's session — the anchor is the posted
// message's thread root (the message itself when it went to the stream), so
// the agent's receipt lands as a reply right under the ask.
// ---------------------------------------------------------------------------

/** Per-turn agent options from the composer's agent strip. */
export interface MythrilTurnOptions {
    model?: { provider: string; model: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'ultrahigh' }
    permissionMode?: 'auto' | 'manual'
    searchEnabled?: boolean
    codeMode?: 'claude' | 'codex'
}

export function maybeInvokeMythril(
    org: OrgWithSpaces,
    space: spaces.Space,
    thread: { rootMessageId: string; label: string },
    messageId: string,
    body: string,
    options?: MythrilTurnOptions,
): void {
    if (!containsMythrilAddress(body)) return
    void window.ipc
        .invoke('spaces:invokeMythril', {
            orgId: org.id,
            spaceId: space.id,
            threadRootId: thread.rootMessageId,
            threadLabel: thread.label,
            spaceName: space.name,
            messageId,
            body,
            ...(options ? { options } : {}),
        })
        .catch((err) => {
            toast(err instanceof Error ? err.message : 'Mythril could not be invoked', 'error')
        })
}

