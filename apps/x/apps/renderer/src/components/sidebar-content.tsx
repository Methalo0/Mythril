"use client"

import { SidebarChatContextMenu } from "./sidebar-chat-context-menu"
import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AppWindow,
  ArrowUpRight,
  Bot,
  ChevronRight,
  FileText,
  Folder,
  Globe,
  AlertTriangle,
  LayoutGrid,
  MoreVertical,
  PanelLeftClose,
  Pencil,
  Pin,
  Trash2,
  Plug,
  LoaderIcon,
  MessageSquare,
  Settings,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { getPinnedApps, onPinnedAppsChanged, unpinApp } from "@/lib/pinned-apps"
import { SettingsDialog } from "@/components/settings-dialog"
import { SpacesSidebarSection } from "@/components/spaces-sidebar-section"
import { SPACES_ENABLED } from "@/lib/feature-flags"
import type { SpaceSelection } from "@/components/spaces-view"
import { MascotFaceIcon } from "@/components/talking-head"
import { toast } from "@/lib/toast"
import { ServiceEvent } from "@x/shared/src/service-events.js"
import z from "zod"

interface TreeNode {
  path: string
  name: string
  kind: "file" | "dir"
  children?: TreeNode[]
  loaded?: boolean
  stat?: { size: number; mtimeMs: number }
}

type KnowledgeActions = {
  createNote: (parentPath?: string) => void
  createFolder: (parentPath?: string) => Promise<string>
  openGraph: () => void
  openBases: () => void
  openKnowledgeView: () => void
  openWorkspaceAt: (path?: string) => void
  createWorkspace: (name: string) => Promise<string>
  expandAll: () => void
  collapseAll: () => void
  rename: (path: string, newName: string, isDir: boolean) => Promise<void>
  remove: (path: string) => Promise<void>
  copyPath: (path: string) => void
  revealInFileManager: (path: string, isDir: boolean) => void
  onOpenInNewTab?: (path: string) => void
}

function formatAgo(ms: number): string {
  const diffMs = Math.max(0, Date.now() - ms)
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 4) return `${wk}w ago`
  const mo = Math.max(1, Math.floor(day / 30))
  return `${mo}mo ago`
}

type TaskSummary = {
  slug: string
  name: string
  active: boolean
  createdAt: string
  lastAttemptAt?: string
  lastRunAt?: string
  lastRunError?: string
}

type ServiceEventType = z.infer<typeof ServiceEvent>

const MAX_SYNC_EVENTS = 1000
const RUN_STALE_MS = 2 * 60 * 60 * 1000
const PINNED_CHATS_STORAGE_KEY = 'x:pinned-chats'
const MAX_PINNED_CHATS = 3

const SERVICE_LABELS: Record<string, string> = {
  gmail: "Syncing Gmail",
  outlook: "Syncing Outlook",
  calendar: "Syncing Calendar",
  fireflies: "Syncing Fireflies",
  granola: "Syncing Granola",
  graph: "Updating knowledge",
  voice_memo: "Processing voice memo",
  email_labeling: "Labeling emails",
  note_tagging: "Tagging notes",
  agent_notes: "Updating agent notes",
}

function summarizeServiceError(error: string): string {
  const firstLine = error.split("\n").find((line) => line.trim().length > 0)
  return firstLine?.trim() || error.trim()
}

function collectServiceErrors(events: ServiceEventType[]): Map<string, string> {
  const errors = new Map<string, string>()
  for (const event of events) {
    if (event.type === "error") {
      errors.set(event.service, summarizeServiceError(event.error))
      continue
    }
    if (event.type === "run_complete" && event.outcome !== "error") {
      errors.delete(event.service)
    }
  }
  return errors
}

type SidebarContentPanelProps = {
  tree: TreeNode[]
  onSelectFile: (path: string, kind: "file" | "dir") => void
  knowledgeActions: KnowledgeActions
  bgTaskSummaries?: TaskSummary[]
  onOpenMeetings?: () => void
  onOpenCode?: () => void
  onOpenBgTasks?: () => void
  onOpenApps?: () => void
  /** Open a specific app (pinned in the sidebar) inside the Apps view. */
  onOpenApp?: (folder: string) => void
  /** Open one space (org + space) in the Spaces view. */
  onOpenSpace?: (orgId: string, spaceId: string) => void
  onOpenSpaces?: () => void
  /** The space currently open, for highlighting its sidebar row. */
  activeSpace?: SpaceSelection
  onOpenAgent?: (slug: string) => void
  recentRuns?: { id: string; title?: string; createdAt: string; modifiedAt?: string }[]
  onOpenAssistant?: () => void
  onOpenRun?: (runId: string) => void
  /** Persist a custom chat title (sessions:setTitle) and refresh the runs list. */
  onRenameRun?: (runId: string, title: string) => void
  /** Delete the chat's session (sessions:delete) and refresh the runs list. */
  onDeleteRun?: (runId: string) => void
  onOpenChatHistory?: () => void
  onOpenEmail?: (threadId?: string) => void
  onOpenHome?: () => void
  onNewChat?: () => void
  onToggleBrowser?: () => void
  onVoiceNoteCreated?: (path: string) => void
  /** Starts the mascot-guided product tour. */
  onStartTour?: () => void
  /** Which primary destination is currently active, for nav highlighting. */
  activeNav?: 'assistant' | 'home' | 'email' | 'meetings' | 'code' | 'knowledge' | 'agents' | 'apps' | 'spaces' | 'workspaces' | null
  /** Live meeting recording state, so the recording row can show its indicator/stop. */
  meetingRecordingState?: 'idle' | 'connecting' | 'recording' | 'stopping'
  recordingMeetingSource?: string | null
  onToggleMeetingRecording?: () => void
} & React.ComponentProps<typeof Sidebar>

function formatEventTime(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function SyncStatusBar() {
  const { state } = useSidebar()
  const [activeServices, setActiveServices] = useState<Map<string, string>>(new Map())
  const [serviceErrors, setServiceErrors] = useState<Map<string, string>>(new Map())
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [logEvents, setLogEvents] = useState<ServiceEventType[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const runTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Track active runs from real-time events
  useEffect(() => {
    const cleanup = window.ipc.on('services:events', (event) => {
      const nextEvent = event as ServiceEventType
      if (nextEvent.type === 'run_start') {
        setActiveServices((prev) => {
          const next = new Map(prev)
          next.set(nextEvent.runId, nextEvent.service)
          return next
        })
        const existingTimeout = runTimeoutsRef.current.get(nextEvent.runId)
        if (existingTimeout) clearTimeout(existingTimeout)
        const timeout = setTimeout(() => {
          setActiveServices((prev) => {
            if (!prev.has(nextEvent.runId)) return prev
            const next = new Map(prev)
            next.delete(nextEvent.runId)
            return next
          })
          runTimeoutsRef.current.delete(nextEvent.runId)
        }, RUN_STALE_MS)
        runTimeoutsRef.current.set(nextEvent.runId, timeout)
      } else if (nextEvent.type === 'run_complete') {
        setActiveServices((prev) => {
          const next = new Map(prev)
          next.delete(nextEvent.runId)
          return next
        })
        if (nextEvent.outcome !== 'error') {
          setServiceErrors((prev) => {
            if (!prev.has(nextEvent.service)) return prev
            const next = new Map(prev)
            next.delete(nextEvent.service)
            return next
          })
        }
        const existingTimeout = runTimeoutsRef.current.get(nextEvent.runId)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          runTimeoutsRef.current.delete(nextEvent.runId)
        }
      } else if (nextEvent.type === 'error') {
        setServiceErrors((prev) => {
          const next = new Map(prev)
          next.set(nextEvent.service, summarizeServiceError(nextEvent.error))
          return next
        })
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    return () => {
      runTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      runTimeoutsRef.current.clear()
    }
  }, [])

  // Load logs from JSONL file when popover opens
  useEffect(() => {
    if (!popoverOpen) return
    let cancelled = false
    async function loadLogs() {
      setLogLoading(true)
      try {
        const result = await window.ipc.invoke('workspace:readFile', {
          path: 'logs/services.jsonl',
          encoding: 'utf8',
        })
        if (cancelled) return
        const lines = result.data.trim().split('\n').filter(Boolean)
        const parsed: ServiceEventType[] = []
        for (const line of lines) {
          try {
            parsed.push(JSON.parse(line))
          } catch {
            // skip malformed lines
          }
        }
        setServiceErrors(collectServiceErrors(parsed))
        // Newest first, limit to 1000
        setLogEvents(parsed.reverse().slice(0, MAX_SYNC_EVENTS))
      } catch {
        if (!cancelled) {
          setLogEvents([])
          setServiceErrors(new Map())
        }
      } finally {
        if (!cancelled) setLogLoading(false)
      }
    }
    loadLogs()
    return () => { cancelled = true }
  }, [popoverOpen])

  const isSyncing = activeServices.size > 0
  const isCollapsed = state === "collapsed"
  const errorEntries = Array.from(serviceErrors.entries())
  const primaryErrorService = errorEntries[0]?.[0] ?? null
  const hasServiceErrors = errorEntries.length > 0

  // Build status label from active services
  const activeServiceNames = [...new Set(activeServices.values())]
  const statusLabel = isSyncing
    ? activeServiceNames.map((s) => SERVICE_LABELS[s] || s).join(", ")
    : hasServiceErrors
      ? errorEntries.length === 1
        ? `${SERVICE_LABELS[primaryErrorService ?? ""] || primaryErrorService} failed`
        : "Recent sync issues"
      : "All caught up"

  return (
    <>
      {isCollapsed && isSyncing && (
        <div
          className="fixed bottom-4 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-sm"
          style={{ left: "0.5rem" }}
          aria-label="Syncing"
        >
          <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <SidebarFooter className="border-t border-border px-2 py-2">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-sidebar-accent",
                hasServiceErrors && !isSyncing ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                {isSyncing ? (
                  <LoaderIcon className="h-3 w-3 shrink-0 animate-spin" />
                ) : hasServiceErrors ? (
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                ) : (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                )}
                <span className="truncate">{statusLabel}</span>
              </span>
              <ChevronRight className="h-3 w-3 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="end"
            sideOffset={4}
            className="w-96 p-0"
          >
            <div className="p-3 border-b">
              <h4 className="font-semibold text-sm">Sync Activity</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isSyncing || hasServiceErrors ? statusLabel : "All services up to date"}
              </p>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {logLoading ? (
                <div className="flex items-center justify-center py-4">
                  <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : logEvents.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No recent activity.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {logEvents.map((event, idx) => (
                    <div
                      key={`${event.runId}-${event.ts}-${idx}`}
                      className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
                    >
                      <span className="shrink-0 text-[10px] leading-4 text-muted-foreground/70">
                        {formatEventTime(event.ts)}
                      </span>
                      <span className="shrink-0">
                        <span className={cn(
                          "inline-block rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                          event.level === 'error' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                          event.level === 'warn' ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {SERVICE_LABELS[event.service]?.split(" ").slice(-1)[0] || event.service}
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="leading-4 text-foreground/80">{event.message}</p>
                        {event.type === 'error' && (
                          <p
                            className="truncate text-[11px] leading-4 text-red-600/90 dark:text-red-400/90"
                            title={event.error}
                          >
                            {summarizeServiceError(event.error)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </SidebarFooter>
    </>
  )
}

export function SidebarContentPanel({
  tree,
  knowledgeActions,
  bgTaskSummaries = [],
  onOpenMeetings,
  onOpenCode,
  onOpenBgTasks,
  onOpenApps,
  onOpenApp,
  onOpenSpaces,
  onOpenSpace,
  activeSpace = null,
  recentRuns = [],
  onOpenRun,
  onOpenAssistant,
  onRenameRun,
  onDeleteRun,
  onOpenChatHistory,
  onOpenEmail,
  onOpenHome,
  onNewChat,
  onToggleBrowser,
  onVoiceNoteCreated,
  onStartTour,
  activeNav,
  meetingRecordingState = 'idle',
  recordingMeetingSource = null,
  onToggleMeetingRecording,
  ...props
}: SidebarContentPanelProps) {
  const [hasOauthError, setHasOauthError] = useState(false)
  const [showOauthAlert, setShowOauthAlert] = useState(true)
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false)
  const [openConnectionsAfterClose, setOpenConnectionsAfterClose] = useState(false)
  const connectorsButtonRef = useRef<HTMLButtonElement | null>(null)

  const [chatsExpanded, setChatsExpanded] = useState(true)


  const recentNotes = React.useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.path === 'knowledge/Meetings' || n.path === 'knowledge/Workspace' || n.path === 'knowledge/Agent Notes') continue
        if (n.kind === 'file') out.push(n)
        else if (n.children?.length) walk(n.children)
      }
    }
    walk(tree)
    return out
      .filter((n) => n.stat?.mtimeMs)
      .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
      .slice(0, 10)
  }, [tree])

  // The most recently touched chat, for the Assistant row (recency only —
  // pinning shouldn't hijack "continue where I left off"). Mirrors the dock.
  const lastChat = useMemo(() => {
    const recency = (r: { createdAt: string; modifiedAt?: string }) => {
      const ms = new Date(r.modifiedAt ?? r.createdAt).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    return [...recentRuns].sort((a, b) => recency(b) - recency(a))[0] ?? null
  }, [recentRuns])

  // Pinned chats: a per-machine UI preference, persisted in localStorage.
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_CHATS_STORAGE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const toggleChatPin = useCallback((chatId: string) => {
    const isPinned = pinnedChatIds.includes(chatId)
    // Count only pins that still resolve to a chat — deleted chats leave
    // stale ids in localStorage and must not eat pin slots.
    const activePinCount = pinnedChatIds.filter((id) => recentRuns.some((r) => r.id === id)).length
    if (!isPinned && activePinCount >= MAX_PINNED_CHATS) {
      toast(`You can pin up to ${MAX_PINNED_CHATS} chats`, 'error')
      return
    }
    const next = isPinned ? pinnedChatIds.filter((id) => id !== chatId) : [...pinnedChatIds, chatId]
    try {
      window.localStorage.setItem(PINNED_CHATS_STORAGE_KEY, JSON.stringify(next))
    } catch { /* ignore */ }
    setPinnedChatIds(next)
  }, [pinnedChatIds, recentRuns])

  // Chats: pinned first, then the most recently modified, 10 rows total.
  const recentChats = React.useMemo(() => {
    const chatRecency = (r: { createdAt: string; modifiedAt?: string }) => {
      const ms = new Date(r.modifiedAt ?? r.createdAt).getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    const sorted = [...recentRuns].sort((a, b) => chatRecency(b) - chatRecency(a))
    const pinned = sorted.filter((r) => pinnedChatIds.includes(r.id))
    const rest = sorted.filter((r) => !pinnedChatIds.includes(r.id))
    return [...pinned, ...rest.slice(0, Math.max(0, 10 - pinned.length))]
  }, [recentRuns, pinnedChatIds])

  // Apps pinned to the sidebar (right-click an app card in the Apps view).
  // Names resolve via apps:list; until then rows show the folder slug, and
  // pins whose app no longer exists are hidden (but kept in storage).
  const [pinnedAppFolders, setPinnedAppFolders] = useState<string[]>(() => getPinnedApps())
  const [pinnedAppNames, setPinnedAppNames] = useState<Map<string, string> | null>(null)
  useEffect(() => onPinnedAppsChanged(setPinnedAppFolders), [])
  useEffect(() => {
    if (pinnedAppFolders.length === 0) return
    let cancelled = false
    void window.ipc.invoke('apps:list', {})
      .then((r) => {
        if (cancelled) return
        setPinnedAppNames(new Map(r.apps.map((a) => [a.folder, a.manifest?.name ?? a.folder])))
      })
      .catch(() => { /* fall back to folder names */ })
    return () => { cancelled = true }
  }, [pinnedAppFolders])
  const pinnedApps = pinnedAppFolders
    .filter((f) => pinnedAppNames === null || pinnedAppNames.has(f))
    .map((f) => ({ folder: f, name: pinnedAppNames?.get(f) ?? f }))

  // Chat pending delete confirmation, if any.
  const [deleteChatTarget, setDeleteChatTarget] = useState<{ id: string; title: string } | null>(null)

  // Inline chat rename: which row is editing and its draft text.
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const commitChatRename = useCallback((chatId: string) => {
    const title = renameDraft.trim()
    const current = recentChats.find((c) => c.id === chatId)
    setRenamingChatId(null)
    if (!title || title === (current?.title ?? '')) return
    onRenameRun?.(chatId, title)
  }, [renameDraft, recentChats, onRenameRun])

  // Workspace count for the Projects sublabel — top-level dir children of
  // knowledge/Workspace (matches the Projects rail).
  const workspaceCount = React.useMemo(() => {
    const find = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.path === 'knowledge/Workspace') return n
        if (n.kind === 'dir' && n.children?.length) {
          const found = find(n.children)
          if (found) return found
        }
      }
      return null
    }
    const node = find(tree)
    return node?.children?.filter((c) => c.kind === 'dir').length ?? 0
  }, [tree])

  // "Updated 4m ago" sublabel under Knowledge, based on the most recently
  // modified note. Recomputed in an effect (not during render) and ticked so
  // the relative time stays fresh.
  const latestNoteMtime = recentNotes[0]?.stat?.mtimeMs ?? null
  const [knowledgeUpdatedLabel, setKnowledgeUpdatedLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!latestNoteMtime) { setKnowledgeUpdatedLabel(null); return }
    const update = () => setKnowledgeUpdatedLabel(`Updated ${formatAgo(latestNoteMtime)}`)
    update()
    const tick = setInterval(update, 60 * 1000)
    return () => clearInterval(tick)
  }, [latestNoteMtime])

  // "2 active · Last run 3m ago" sublabel under Background agents, overridden by
  // "N failed · Needs review" when any task's last run errored.
  const [bgAgentsLabel, setBgAgentsLabel] = useState<string | null>(null)
  useEffect(() => {
    const update = () => {
      const failed = bgTaskSummaries.filter((t) => t.lastRunError).length
      if (failed > 0) {
        setBgAgentsLabel(`${failed} failed · Needs review`)
        return
      }
      const active = bgTaskSummaries.filter((t) => t.active).length
      const lastRunMs = bgTaskSummaries.reduce((max, t) => {
        const ms = t.lastRunAt ? new Date(t.lastRunAt).getTime() : 0
        return Number.isFinite(ms) && ms > max ? ms : max
      }, 0)
      const parts: string[] = [active > 0 ? `${active} active` : 'No active agents']
      if (lastRunMs > 0) parts.push(`Last run ${formatAgo(lastRunMs)}`)
      setBgAgentsLabel(parts.join(' · '))
    }
    update()
    const tick = setInterval(update, 60 * 1000)
    return () => clearInterval(tick)
  }, [bgTaskSummaries])


  useEffect(() => {
    let mounted = true

    const refreshOauthError = async () => {
      try {
        const result = await window.ipc.invoke('oauth:getState', null)
        const config = result.config || {}
        const hasError = Object.values(config).some((entry) => Boolean(entry?.error))
        if (mounted) {
          setHasOauthError(hasError)
          if (!hasError) {
            setShowOauthAlert(true)
          }
        }
      } catch (error) {
        console.error('Failed to fetch OAuth state:', error)
        if (mounted) {
          setHasOauthError(false)
          setShowOauthAlert(true)
        }
      }
    }

    refreshOauthError()
    const cleanup = window.ipc.on('oauth:didConnect', () => {
      refreshOauthError()
    })

    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  return (
    <Sidebar className="mythril-sidebar border-r-0" {...props}>
      <SidebarHeader className="titlebar-drag-region gap-0 pb-0">
        {/* Just clears the traffic lights + fixed toggle row (voice note and
            compose live up there now); nav starts right below. */}
        <div className="h-8" />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {/* Ordered to mirror the dock: Assistant, Spaces, then the
            destinations, then Chats. Same glyphs as the dock tiles. */}
        <SidebarGroup className="flex flex-col pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === 'assistant'}
                  onClick={() => {
                    if (onOpenAssistant) onOpenAssistant()
                    else if (lastChat && onOpenRun) onOpenRun(lastChat.id)
                    else onNewChat?.()
                  }}
                >
                  <MascotFaceIcon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">Assistant</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Spaces returns to the last active server and space. */}
        {SPACES_ENABLED && (
          <>
            <SpacesSidebarSection active={activeNav === 'spaces'} activeSpace={activeSpace} onOpenSpaces={() => onOpenSpaces?.()} onOpenSpace={(orgId, spaceId) => onOpenSpace?.(orgId, spaceId)} />
            <div className="mx-3 my-2 border-t border-border" />
          </>
        )}

        {/* Primary navigation */}
        <SidebarGroup className="flex flex-col">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-tour-id="nav-knowledge"
                  isActive={activeNav === 'knowledge'}
                  onClick={() => knowledgeActions.openKnowledgeView()}
                  className={knowledgeUpdatedLabel ? 'h-auto items-start py-1' : undefined}
                >
                  <FileText className={cn('size-4 shrink-0', knowledgeUpdatedLabel && 'mt-0.5')} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Brain</span>
                    {knowledgeUpdatedLabel && (
                      <span className="truncate text-[11px] text-muted-foreground">{knowledgeUpdatedLabel}</span>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <div className="mx-3 my-2 border-t border-border" />

            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-tour-id="nav-workspaces"
                  isActive={activeNav === 'workspaces'}
                  onClick={() => knowledgeActions.openWorkspaceAt()}
                  className="h-auto items-start py-1"
                >
                  <Folder className="mt-0.5 size-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Projects</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {workspaceCount === 0 ? 'No projects' : `${workspaceCount} project${workspaceCount === 1 ? '' : 's'}`}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-tour-id="nav-agents"
                  isActive={activeNav === 'agents'}
                  onClick={onOpenBgTasks}
                  className={bgAgentsLabel ? 'h-auto items-start py-1' : undefined}
                >
                  <Bot className={cn('size-4 shrink-0', bgAgentsLabel && 'mt-0.5')} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Background agents</span>
                    {bgAgentsLabel && (
                      <span className={cn(
                        'truncate text-[11px]',
                        bgTaskSummaries.some((t) => t.lastRunError) ? 'text-destructive' : 'text-muted-foreground',
                      )}>
                        {bgAgentsLabel}
                      </span>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {onToggleBrowser && (
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={onToggleBrowser}>
                    <Globe className="size-4 shrink-0" />
                    <span className="flex-1 truncate">Browser</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-tour-id="nav-apps"
                  isActive={activeNav === 'apps'}
                  onClick={onOpenApps}
                >
                  <LayoutGrid className="size-4 shrink-0" />
                  <span className="flex-1 truncate">Apps</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {pinnedApps.map(({ folder, name }) => (
                <SidebarMenuItem key={folder}>
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <SidebarMenuButton onClick={() => onOpenApp?.(folder)} className="pl-7">
                        <AppWindow className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{name}</span>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => unpinApp(folder)}>
                        <PanelLeftClose className="mr-2 size-3.5" />
                        Remove from sidebar
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 my-2 border-t border-border" />

        {/* Chats */}
        <SidebarGroup className="flex flex-col">
          <SidebarGroupContent>
            <button
              type="button"
              data-tour-id="nav-chats"
              onClick={() => setChatsExpanded((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-[13px] text-muted-foreground"
            >
              <ChevronRight className={cn('size-3 transition-transform', chatsExpanded && 'rotate-90')} />
              <span className="flex-1 text-left">Chats</span>
            </button>
            {chatsExpanded && (
              recentChats.length === 0 ? (
                <div className="px-4 pb-2 text-[11.5px] italic text-muted-foreground">
                  Your recent chats show up here.
                </div>
              ) : (
                <SidebarMenu>
                  {recentChats.map((chat) => (
                    <SidebarMenuItem key={chat.id}>
                      {renamingChatId === chat.id ? (
                        <div className="flex h-8 items-center gap-2 rounded-md px-2">
                          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitChatRename(chat.id)
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                setRenamingChatId(null)
                              }
                            }}
                            onBlur={() => commitChatRename(chat.id)}
                            className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                          />
                        </div>
                      ) : (
                        <>
                          <SidebarChatContextMenu
                            pinned={pinnedChatIds.includes(chat.id)}
                            onOpen={onOpenRun ? () => onOpenRun(chat.id) : undefined}
                            onTogglePin={() => toggleChatPin(chat.id)}
                            onRename={onRenameRun ? () => { setRenameDraft(chat.title || ''); setRenamingChatId(chat.id) } : undefined}
                            onRequestDelete={onDeleteRun ? () => setDeleteChatTarget({ id: chat.id, title: chat.title || '(Untitled chat)' }) : undefined}
                          >
                            <SidebarMenuButton onClick={() => onOpenRun?.(chat.id)} className={onRenameRun ? 'pr-7' : undefined}>
                              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                              <span className="flex-1 truncate">{chat.title || '(Untitled chat)'}</span>
                              {pinnedChatIds.includes(chat.id) && (
                                <Pin className="size-3 shrink-0 text-muted-foreground/70 transition-opacity group-hover/menu-item:opacity-0" />
                              )}
                            </SidebarMenuButton>
                          </SidebarChatContextMenu>
                          {onRenameRun && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Chat options"
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/menu-item:opacity-100 data-[state=open]:opacity-100"
                                >
                                  <MoreVertical className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent side="right" align="start">
                                <DropdownMenuItem onClick={() => toggleChatPin(chat.id)}>
                                  <Pin className="mr-2 size-3.5" />
                                  {pinnedChatIds.includes(chat.id) ? 'Unpin' : 'Pin'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setRenameDraft(chat.title || '')
                                    setRenamingChatId(chat.id)
                                  }}
                                >
                                  <Pencil className="mr-2 size-3.5" />
                                  Rename
                                </DropdownMenuItem>
                                {onDeleteRun && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteChatTarget({ id: chat.id, title: chat.title || '(Untitled chat)' })}
                                  >
                                    <Trash2 className="mr-2 size-3.5" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </>
                      )}
                    </SidebarMenuItem>
                  ))}
                  {onOpenChatHistory && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={() => onOpenChatHistory()}
                        className="text-muted-foreground"
                      >
                        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">View all</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              )
            )}
          </SidebarGroupContent>
        </SidebarGroup>
        <AlertDialog open={!!deleteChatTarget} onOpenChange={(open) => { if (!open) setDeleteChatTarget(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete chat?</AlertDialogTitle>
              <AlertDialogDescription>
                &ldquo;{deleteChatTarget?.title}&rdquo; and its full history will be permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  if (deleteChatTarget) onDeleteRun?.(deleteChatTarget.id)
                  setDeleteChatTarget(null)
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarContent>

      {/* Mythril: no hosted sign-in — all providers are user keys. */}
      {/* Bottom actions */}
      <div className="border-t border-border px-2 py-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              ref={connectorsButtonRef}
              onClick={() => setConnectionsSettingsOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Plug className="size-4" />
              <span>Connect Accounts</span>
            </button>
            {hasOauthError && (
              <AlertDialog
                open={showOauthAlert}
                onOpenChange={setShowOauthAlert}
              >
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center"
                    aria-label="OAuth connection issues"
                  >
                    <AlertTriangle className="size-3 text-amber-500/90 animate-pulse" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (openConnectionsAfterClose) {
                      setOpenConnectionsAfterClose(false)
                      setConnectionsSettingsOpen(true)
                    }
                    connectorsButtonRef.current?.focus()
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reconnect your accounts</AlertDialogTitle>
                    <AlertDialogDescription>
                      One or more connected accounts need attention. Open Connected accounts
                      to review the status and reconnect if needed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      onClick={() => {
                        setOpenConnectionsAfterClose(false)
                        setShowOauthAlert(false)
                      }}
                    >
                      Dismiss
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setOpenConnectionsAfterClose(true)
                        setShowOauthAlert(false)
                      }}
                    >
                      View connected accounts
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <SettingsDialog>
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
              <Settings className="size-4" />
              <span>Settings</span>
            </button>
          </SettingsDialog>
        </div>
      </div>
      <SettingsDialog
        defaultTab="connections"
        open={connectionsSettingsOpen}
        onOpenChange={setConnectionsSettingsOpen}
      />
      <SyncStatusBar />
      <SidebarRail />
    </Sidebar>
  )
}

