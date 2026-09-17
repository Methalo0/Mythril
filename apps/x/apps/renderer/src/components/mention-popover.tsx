import { useMemo, useEffect, useState, useCallback } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Bot, FileTextIcon, Hash, PenTool } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  buildMentionEntries,
  type MentionEntry,
  type MentionGroup,
  type MentionSources,
  type MentionTarget,
} from '@/lib/mention-targets'
import { MemberAvatar } from '@/components/spaces/atoms'

// The assistant composer's @ menu: the agent, knowledge files, the shared
// spaces the user is in, the whiteboards in them, and the people they can DM
// — one flat keyboard list, grouped visually. Ordering and filtering live in
// mention-targets.ts; this component only positions, renders, and routes keys.
//
// Placement is Slack's: the menu opens UPWARD from the composer box, at the
// box's width, so the text being typed is never covered. (A caret-anchored
// menu that opened downward sat right on top of the line below the caret.)
// When there is no room above — the hover bar at the top of a screen — Radix
// flips it below.

/** Anything with a live rect: the composer box, measured on every reposition. */
export type MentionAnchor = { getBoundingClientRect(): DOMRect }

interface MentionPopoverProps {
  sources: MentionSources
  query: string
  anchorRef: React.RefObject<MentionAnchor>
  onSelect: (target: MentionTarget) => void
  onClose: () => void
  open: boolean
}

const GROUP_HEADINGS: Record<MentionGroup, string | null> = {
  agent: null,
  files: 'Files',
  spaces: 'Spaces',
  boards: 'Boards',
  people: 'People',
}

export function MentionPopover({
  sources,
  query,
  anchorRef,
  onSelect,
  onClose,
  open,
}: MentionPopoverProps) {
  const entries = useMemo(() => buildMentionEntries(query, sources), [query, sources])

  // The highlighted row, scoped to the list it was chosen in: a new query or
  // a list of a different length starts back at the top — derived, not reset
  // in an effect, so the first paint of a new list is already right.
  const listKey = `${query}\u0000${entries.length}`
  const [selection, setSelection] = useState({ listKey, index: 0 })
  const selectedIndex = selection.listKey === listKey ? selection.index : 0
  const setSelectedIndex = useCallback(
    (update: number | ((prev: number) => number)) => {
      setSelection((prev) => {
        const prevIndex = prev.listKey === listKey ? prev.index : 0
        return { listKey, index: typeof update === 'function' ? update(prevIndex) : update }
      })
    },
    [listKey]
  )

  // Headings only earn their space once the menu mixes kinds: a files-only
  // menu (no org signed in) keeps the plain list it always had.
  const showHeadings = useMemo(
    () => entries.some((e) => e.group === 'spaces' || e.group === 'boards' || e.group === 'people'),
    [entries],
  )

  // With several orgs, a space or a person is ambiguous without its org.
  const multiOrg = useMemo(() => {
    const orgIds = new Set<string>()
    for (const s of sources.spaces) orgIds.add(s.orgId)
    for (const b of sources.boards ?? []) orgIds.add(b.orgId)
    for (const m of sources.members) orgIds.add(m.orgId)
    return orgIds.size > 1
  }, [sources.spaces, sources.boards, sources.members])

  // Consecutive runs of one group, in list order — the flat index survives.
  const runs = useMemo(() => {
    const out: Array<{ group: MentionGroup; entries: Array<{ entry: MentionEntry; index: number }> }> = []
    entries.forEach((entry, index) => {
      const last = out.at(-1)
      if (last && last.group === entry.group) last.entries.push({ entry, index })
      else out.push({ group: entry.group, entries: [{ entry, index }] })
    })
    return out
  }, [entries])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev + 1) % entries.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setSelectedIndex((prev) => (prev - 1 + entries.length) % entries.length)
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          e.stopPropagation()
          if (entries[selectedIndex]) onSelect(entries[selectedIndex].target)
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
      }
    },
    [open, entries, selectedIndex, onSelect, onClose]
  )

  // Attach keyboard listener
  useEffect(() => {
    if (!open) return

    // Use capture phase to intercept before textarea handles it
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, handleKeyDown])

  if (!open || entries.length === 0) {
    return null
  }

  const renderRow = ({ entry, index }: { entry: MentionEntry; index: number }) => {
    const { target } = entry
    return (
      <CommandItem
        key={entry.key}
        value={entry.key}
        onSelect={() => onSelect(target)}
        className={index === selectedIndex ? 'bg-accent' : ''}
        onMouseMove={() => setSelectedIndex(index)}
      >
        {target.kind === 'mythril' ? (
          <>
            <Bot className="mr-2 h-4 w-4 shrink-0 text-primary" />
            <span className="truncate font-medium">mythril</span>
            <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">hand off a task</span>
          </>
        ) : target.kind === 'file' ? (
          <>
            <FileTextIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.label}</span>
          </>
        ) : target.kind === 'space' ? (
          <>
            <Hash className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.label}</span>
            {multiOrg && (
              <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{target.orgName}</span>
            )}
          </>
        ) : target.kind === 'board' ? (
          <>
            <PenTool className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.label}</span>
            {/* A board is named by its space: two spaces can each have a "roadmap". */}
            <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
              {multiOrg ? `${target.spaceName} · ${target.orgName}` : target.spaceName}
            </span>
          </>
        ) : (
          <>
            <MemberAvatar id={target.memberId} name={target.displayName} size="sm" className="mr-2" />
            <span className="truncate">{entry.label}</span>
            <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
              {multiOrg ? `DM · ${target.orgName}` : 'DM'}
            </span>
          </>
        )}
      </CommandItem>
    )
  }

  return (
    <Popover open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        // As wide as the composer box it sits on (Radix exposes the anchor's width).
        className={cn('w-(--radix-popover-trigger-width) max-w-none', showHeadings ? 'p-0' : 'p-1')}
        align="start"
        side="top"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false} value={entries[selectedIndex]?.key ?? ''}>
          {/* A bare "@" browses three groups of three; the list is tall enough
              that People is never below the fold, and never taller than the
              room above the composer. */}
          <CommandList
            className={
              showHeadings
                ? 'max-h-[min(27rem,var(--radix-popover-content-available-height))]'
                : 'max-h-[min(300px,var(--radix-popover-content-available-height))]'
            }
          >
            {showHeadings
              ? runs.map((run, runIndex) => {
                  const heading = GROUP_HEADINGS[run.group]
                  return heading ? (
                    <CommandGroup key={`${run.group}-${runIndex}`} heading={heading}>
                      {run.entries.map(renderRow)}
                    </CommandGroup>
                  ) : (
                    <CommandGroup key={`${run.group}-${runIndex}`}>{run.entries.map(renderRow)}</CommandGroup>
                  )
                })
              : entries.map((entry, index) => renderRow({ entry, index }))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
