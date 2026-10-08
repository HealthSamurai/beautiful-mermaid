import type { GanttDiagram, GanttSection, GanttTask, GanttTaskStatus, GanttTaskTag } from './types.ts'
import {
  DEFAULT_DATE_FORMAT, addDuration, isDateLike, isDurationLike,
  parseDuration, parseGanttDate,
} from './dates.ts'

// ============================================================================
// Gantt parser
//
// Parses the practical subset of Mermaid `gantt` syntax into a GanttDiagram.
//
// Directives:
//   gantt
//   title        Project plan
//   dateFormat   YYYY-MM-DD
//   axisFormat   %b %Y
//   excludes / todayMarker / tickInterval / weekday  — accepted and ignored
//   section      Phase one
//
// Tasks — `label : metadata` where metadata is a comma-separated list:
//   Design        :done, des1, 2024-01-01, 2024-02-15     (explicit end)
//   Build         :active, dev1, after des1, 30d           (dependency + duration)
//   Review        :crit, 2024-03-01, 2w
//   Launch        :milestone, 2024-04-01, 0d
//   Bare task     :2024-01-01, 10d                        (no tags, no id)
//
// Metadata grammar, in the order Mermaid itself resolves it:
//   [tag...] [id] [start] [end|duration]
//   - tag      — done | active | crit | milestone
//   - id       — any bare word that is not a tag, date, duration or `after`
//   - start    — a date, or `after <id> [<id>...]`
//   - end      — a date, or a duration (`30d`, `2w`, `6mo`)
//
// Unresolvable tasks (no start, no dependency) chain after the previous task,
// which is what Mermaid does and what keeps a sloppy diagram renderable.
// ============================================================================

const TAGS = new Set<GanttTaskTag>(['done', 'active', 'crit', 'milestone'])

/** Default length for a task whose metadata gives no end and no duration. */
const DEFAULT_TASK_DURATION = { amount: 1, unit: 'd' as const }

/**
 * Parse a Mermaid gantt diagram from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 */
export function parseGanttDiagram(lines: string[]): GanttDiagram {
  let title: string | undefined
  let dateFormat = DEFAULT_DATE_FORMAT
  let axisFormat: string | undefined

  const sections: GanttSection[] = []
  const tasks: GanttTask[] = []
  const byId = new Map<string, GanttTask>()

  let current: GanttSection | undefined
  let autoId = 0

  /** Append to the active section, opening an unnamed one on demand. */
  const push = (task: GanttTask) => {
    if (!current) {
      current = { title: '', tasks: [] }
      sections.push(current)
    }
    task.section = current.title
    current.tasks.push(task)
    tasks.push(task)
    byId.set(task.id, task)
  }

  for (const raw of lines) {
    const line = stripInlineComment(raw)
    if (!line) continue

    // Header
    if (/^gantt\b/i.test(line)) continue

    // Directives — `keyword value`
    const directive = line.match(/^(title|dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday|section)\b\s*(.*)$/i)
    if (directive) {
      const key = directive[1]!.toLowerCase()
      const value = directive[2]!.trim()

      if (key === 'title') { title = unquote(value); continue }
      if (key === 'dateformat') { if (value) dateFormat = value; continue }
      if (key === 'axisformat') { if (value) axisFormat = value; continue }
      if (key === 'section') {
        current = { title: unquote(value), tasks: [] }
        sections.push(current)
        continue
      }
      // excludes / includes / todayMarker / tickInterval / weekday: accepted, not modelled
      continue
    }

    // Task — everything up to the first ':' is the label
    const colon = line.indexOf(':')
    if (colon === -1) continue

    const label = line.slice(0, colon).trim()
    const meta = line.slice(colon + 1).trim()
    if (!label) continue

    const parsed = parseTaskMeta(meta, dateFormat)
    const id = parsed.id ?? `task${++autoId}`
    const previous = tasks[tasks.length - 1]

    const { start, end } = resolveSchedule(parsed, byId, previous, dateFormat)

    push({
      id,
      label,
      section: '',
      tags: parsed.tags,
      status: dominantStatus(parsed.tags),
      milestone: parsed.tags.includes('milestone'),
      start,
      end: parsed.tags.includes('milestone') ? start : end,
      after: parsed.after,
    })
  }

  return { title, dateFormat, axisFormat, sections, tasks }
}

// ---------------------------------------------------------------------------
// Task metadata
// ---------------------------------------------------------------------------

/** Classified metadata extracted from the comma-separated part after a task's `:`. */
export interface TaskMeta {
  /** Status tags found in the metadata */
  tags: GanttTaskTag[]
  /** Explicit task id from the metadata, when one was written */
  id?: string
  /** Explicit start date, epoch ms */
  startDate?: number
  /** Task ids this task starts after */
  after: string[]
  /** Explicit end date, epoch ms */
  endDate?: number
  /** Duration token (`30d`) when the end is relative */
  duration?: string
}

/**
 * Split and classify the comma-separated metadata after a task's `:`.
 * Exported for tests — the classification is the subtle part of gantt syntax.
 */
export function parseTaskMeta(meta: string, dateFormat: string = DEFAULT_DATE_FORMAT): TaskMeta {
  const parts = meta.split(',').map(p => p.trim()).filter(p => p.length > 0)
  const result: TaskMeta = { tags: [], after: [] }

  for (const part of parts) {
    const lower = part.toLowerCase()

    // Status tag
    if (TAGS.has(lower as GanttTaskTag)) {
      const tag = lower as GanttTaskTag
      if (!result.tags.includes(tag)) result.tags.push(tag)
      continue
    }

    // Dependency: `after id1 id2`
    const after = part.match(/^after\s+(.+)$/i)
    if (after) {
      result.after.push(...after[1]!.trim().split(/\s+/))
      continue
    }

    // Absolute date — first one is the start, second the end
    if (isDateLike(part, dateFormat)) {
      const epoch = parseGanttDate(part, dateFormat)!
      if (result.startDate === undefined && result.after.length === 0) result.startDate = epoch
      else result.endDate = epoch
      continue
    }

    // Duration — only meaningful once a start (or dependency) is known
    if (isDurationLike(part)) {
      result.duration = part
      continue
    }

    // Anything else is the task id (first one wins)
    if (result.id === undefined) result.id = part
  }

  return result
}

/**
 * Resolve absolute start/end for a task from its metadata.
 *
 * Priority for the start: explicit date → end of the latest `after` dependency
 * → end of the previous task → epoch of "today" normalized to a stable value.
 */
function resolveSchedule(
  meta: TaskMeta,
  byId: Map<string, GanttTask>,
  previous: GanttTask | undefined,
  dateFormat: string,
): { start: number; end: number } {
  let start: number | undefined = meta.startDate

  if (start === undefined && meta.after.length > 0) {
    // Start when the last of the referenced dependencies finishes
    const ends = meta.after
      .map(id => byId.get(id))
      .filter((t): t is GanttTask => t !== undefined)
      .map(t => t.end)
    if (ends.length > 0) start = Math.max(...ends)
  }

  if (start === undefined && previous) start = previous.end

  // Nothing to anchor to: fall back to the start of today (UTC), so a
  // date-less diagram still lays out instead of throwing.
  if (start === undefined) {
    const now = new Date()
    start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  }

  if (meta.tags.includes('milestone')) return { start, end: start }

  let end: number | undefined = meta.endDate
  if (end === undefined && meta.duration) {
    const duration = parseDuration(meta.duration)
    if (duration) end = addDuration(start, duration)
  }
  if (end === undefined) end = addDuration(start, DEFAULT_TASK_DURATION)

  // Guard against reversed ranges (typo in the source)
  if (end < start) [start, end] = [end, start]

  // Keep the compiler honest about the unused parameter in this branch
  void dateFormat

  return { start, end }
}

/** Dominant status for coloring: crit beats active beats done. */
function dominantStatus(tags: GanttTaskTag[]): GanttTaskStatus {
  if (tags.includes('crit')) return 'crit'
  if (tags.includes('active')) return 'active'
  if (tags.includes('done')) return 'done'
  return 'default'
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Remove a trailing `%% comment` from a line. */
function stripInlineComment(line: string): string {
  const idx = line.indexOf('%%')
  return (idx === -1 ? line : line.slice(0, idx)).trim()
}

/** Strip matching surrounding quotes from a directive value. */
function unquote(value: string): string {
  const m = value.match(/^"(.*)"$/) ?? value.match(/^'(.*)'$/)
  return m ? m[1]! : value
}
