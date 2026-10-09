import type { GanttDiagram, GanttSection, GanttTask, GanttTaskStatus, GanttTaskTag } from './types.ts'
import type { ExcludeCalendar, WeekendStart } from './dates.ts'
import {
  DAY_MS, DEFAULT_DATE_FORMAT, addDuration, applyExcludes, isDateLike, isDurationLike,
  parseDuration, parseGanttDate, startOfDay, weekdayIndex,
} from './dates.ts'

// ============================================================================
// Gantt parser
//
// Parses the practical subset of Mermaid `gantt` syntax into a GanttDiagram.
//
// Directives:
//   gantt
//   title              Project plan
//   dateFormat         YYYY-MM-DD
//   axisFormat         %b %Y
//   tickInterval       1week
//   excludes           weekends, monday, 2024-01-01
//   includes           2024-01-06
//   weekday            monday            — first day of the week
//   weekend            friday            — weekends means Fri+Sat
//   todayMarker        off | stroke:red,stroke-width:2px
//   displayMode        compact
//   inclusiveEndDates
//   topAxis
//   section            Phase one
//
// Tasks — `label : metadata` where metadata is a comma-separated list:
//   Design        :done, des1, 2024-01-01, 2024-02-15     (explicit end)
//   Build         :active, dev1, after des1, 30d           (dependency + duration)
//   Review        :crit, 2024-03-01, 2w
//   Launch        :milestone, 2024-04-01, 0d
//   Wrap up       :task1, after des1, until dev1           (ends when dev1 starts)
//   Half done     :active, 2024-01-01, 30d, 60%            (progress)
//   Cutover       :vert, 2024-03-01                        (vertical marker)
//   Bare task     :2024-01-01, 10d                         (no tags, no id)
//
// Metadata grammar, in the order Mermaid itself resolves it:
//   [tag...] [id] [start] [end|duration] [progress]
//   - tag      — done | active | crit | milestone | vert
//   - id       — any bare word that is not a tag, date, duration or keyword
//   - start    — a date, or `after <id> [<id>...]`
//   - end      — a date, a duration (`30d`, `2w`, `6mo`), or `until <id>...`
//   - progress — `60%`
//
// Unresolvable tasks (no start, no dependency) chain after the previous task,
// which is what Mermaid does and what keeps a sloppy diagram renderable.
// ============================================================================

const TAGS = new Set<GanttTaskTag>(['done', 'active', 'crit', 'milestone', 'vert'])

/** Default length for a task whose metadata gives no end and no duration. */
const DEFAULT_TASK_DURATION = { amount: 1, unit: 'd' as const }

/** Mermaid's default first day of the week. */
const DEFAULT_WEEK_START = 1 // Monday

/**
 * Parse a Mermaid gantt diagram from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 */
export function parseGanttDiagram(lines: string[]): GanttDiagram {
  let title: string | undefined
  let dateFormat = DEFAULT_DATE_FORMAT
  let axisFormat: string | undefined
  let tickInterval: string | undefined
  let todayMarker: string | undefined
  let weekStart = DEFAULT_WEEK_START
  let weekend: WeekendStart = 'saturday'
  let compact = false
  let inclusiveEndDates = false
  let topAxis = false

  const excludes: string[] = []
  const includes: string[] = []
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
    // First binding wins, matching upstream: a later task reusing an id must
    // not silently steal the `after`/`until` references aimed at the first.
    if (!byId.has(task.id)) byId.set(task.id, task)
  }

  for (const raw of lines) {
    const line = stripInlineComment(raw)
    if (!line) continue

    // Header
    if (/^gantt\b/i.test(line)) continue

    // Flag directives — no value, so they are matched before the keyed ones
    if (/^inclusiveEndDates\s*$/i.test(line)) { inclusiveEndDates = true; continue }
    if (/^topAxis\s*$/i.test(line)) { topAxis = true; continue }

    // Directives — `keyword value`
    const directive = line.match(
      /^(title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|weekend|displayMode|section)\b\s*(.*)$/i
    )
    if (directive) {
      const key = directive[1]!.toLowerCase()
      const value = directive[2]!.trim()

      switch (key) {
        case 'title':
          title = unquote(value)
          continue
        case 'dateformat':
          if (value) dateFormat = value
          continue
        case 'axisformat':
          if (value) axisFormat = value
          continue
        case 'tickinterval':
          if (value) tickInterval = value
          continue
        case 'excludes':
          excludes.push(...splitTokens(value))
          continue
        case 'includes':
          includes.push(...splitTokens(value))
          continue
        case 'todaymarker':
          // An empty `todayMarker` keeps the default marker, so only a
          // non-empty declaration is recorded
          if (value) todayMarker = value
          continue
        case 'weekday': {
          const index = weekdayIndex(value)
          if (index !== null) weekStart = index
          continue
        }
        case 'weekend': {
          const day = value.trim().toLowerCase()
          if (day === 'friday' || day === 'saturday') weekend = day
          continue
        }
        case 'displaymode':
          compact = value.trim().toLowerCase() === 'compact'
          continue
        case 'section':
          current = { title: unquote(value), tasks: [] }
          sections.push(current)
          continue
      }
    }

    // `click <id> href "..."` / `click <id> call fn()` attach interactivity.
    // We render a static SVG and have nothing to bind, but parsing the line as
    // a TASK drew a bar labelled `click a1 href "https` on the chart, so it is
    // recognised and skipped.
    if (/^click\s+\S+/i.test(line)) continue

    // Task — `label : metadata`.
    //
    // Upstream's lexer splits on the FIRST colon, but a label frequently
    // contains a clock time ("Standup at 10:30 :a1, ..."), and splitting there
    // produces a task named "Standup at 10" with id "30 standup" — a silently
    // wrong chart. So the split is the LAST colon whose right-hand side still
    // parses as task metadata, falling back to the first colon.
    const colon = taskMetaColon(line, dateFormat)
    if (colon === -1) continue

    const label = line.slice(0, colon).trim()
    const meta = line.slice(colon + 1).trim()
    if (!label || !meta) continue

    const parsed = parseTaskMeta(meta, dateFormat)
    const id = parsed.id ?? `task${++autoId}`
    const previous = tasks[tasks.length - 1]

    const calendar: ExcludeCalendar = { excludes, includes, weekend, dateFormat }
    const { start, end } = resolveSchedule(parsed, byId, previous, calendar, inclusiveEndDates)

    const vertical = parsed.tags.includes('vert')
    const milestone = parsed.tags.includes('milestone')

    push({
      id,
      label,
      section: '',
      tags: parsed.tags,
      status: dominantStatus(parsed.tags),
      milestone,
      start,
      end: milestone || vertical ? start : end,
      after: parsed.after,
      until: parsed.until,
      progress: parsed.progress,
      vertical,
      // Row assignment needs every task's dates, so it runs as a second pass
      row: 0,
    })
  }

  assignRows(sections, compact)

  return {
    title, dateFormat, axisFormat, tickInterval, todayMarker,
    excludes, includes, weekStart, weekend,
    compact, inclusiveEndDates, topAxis,
    sections, tasks,
  }
}

// ---------------------------------------------------------------------------
// Row assignment
// ---------------------------------------------------------------------------

/**
 * Assign each task the row it is drawn on.
 *
 * Normally that is one row per task, in source order. In `displayMode compact`
 * tasks within a section share a row whenever their time spans do not overlap,
 * which is the whole point of the mode: a wide, shallow chart instead of a
 * tall one.
 */
function assignRows(sections: GanttSection[], compact: boolean): void {
  let nextRow = 0

  for (const section of sections) {
    if (!compact) {
      for (const task of section.tasks) task.row = nextRow++
      continue
    }

    // First-fit: drop each task on the first row whose last task has ended
    const rowEnds: number[] = []

    for (const task of section.tasks) {
      let row = rowEnds.findIndex(end => end <= task.start)
      if (row === -1) {
        row = rowEnds.length
        rowEnds.push(task.end)
      } else {
        rowEnds[row] = task.end
      }
      task.row = nextRow + row
    }

    nextRow += Math.max(1, rowEnds.length)
  }
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
  /** Task ids this task runs until */
  until: string[]
  /** Explicit end date, epoch ms */
  endDate?: number
  /** Duration token (`30d`) when the end is relative */
  duration?: string
  /** Completed fraction 0..1 from a `60%` token */
  progress?: number
}

/**
 * Split and classify the comma-separated metadata after a task's `:`.
 * Exported for tests — the classification is the subtle part of gantt syntax.
 */
export function parseTaskMeta(meta: string, dateFormat: string = DEFAULT_DATE_FORMAT): TaskMeta {
  const parts = meta.split(',').map(p => p.trim()).filter(p => p.length > 0)
  const result: TaskMeta = { tags: [], after: [], until: [] }

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

    // Reverse dependency: `until id1 id2` — ends when the earliest starts
    const until = part.match(/^until\s+(.+)$/i)
    if (until) {
      result.until.push(...until[1]!.trim().split(/\s+/))
      continue
    }

    // Progress: `60%`
    const progress = part.match(/^(\d+(?:\.\d+)?)\s*%$/)
    if (progress) {
      // Clamp to 0..1 so a typo cannot overflow the bar
      result.progress = Math.max(0, Math.min(1, Number(progress[1]) / 100))
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
 *
 * Priority for the end: explicit date → earliest start among `until` targets
 * → duration → one day.
 */
function resolveSchedule(
  meta: TaskMeta,
  byId: Map<string, GanttTask>,
  previous: GanttTask | undefined,
  calendar: ExcludeCalendar,
  inclusiveEndDates: boolean,
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
  if (start === undefined) start = startOfDay(Date.now())

  if (meta.tags.includes('milestone') || meta.tags.includes('vert')) {
    return { start, end: start }
  }

  let end: number | undefined = meta.endDate

  // An explicit end date is a stated deadline, so excludes must not move it.
  // Only a duration-derived end is stretched past non-working days.
  let endWasExplicit = end !== undefined

  if (end !== undefined && inclusiveEndDates) {
    // `inclusiveEndDates` makes the written end date a full working day
    end += DAY_MS
  }

  if (end === undefined && meta.until.length > 0) {
    // Run until the earliest of the referenced tasks begins
    const starts = meta.until
      .map(id => byId.get(id))
      .filter((t): t is GanttTask => t !== undefined)
      .map(t => t.start)
    if (starts.length > 0) {
      end = Math.min(...starts)
      endWasExplicit = true
    }
  }

  if (end === undefined && meta.duration) {
    const duration = parseDuration(meta.duration)
    if (duration) end = addDuration(start, duration)
  }

  if (end === undefined) end = addDuration(start, DEFAULT_TASK_DURATION)

  // Guard against reversed ranges (typo in the source)
  if (end < start) [start, end] = [end, start]

  if (!endWasExplicit) end = applyExcludes(start, end, calendar)

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

/**
 * Split a directive value on commas and whitespace.
 *
 * `excludes weekends, 2024-01-01` and `excludes weekends 2024-01-01` are both
 * accepted, because both appear in the wild.
 */
function splitTokens(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0)
}

/**
 * Find the colon that separates a task's label from its metadata.
 *
 * Gantt labels routinely contain a colon — a clock time ("Standup at 10:30"),
 * a ratio, a namespaced name. Splitting on the first colon the way upstream's
 * lexer does turns those into a task with a mangled label and a nonsense id,
 * and because the result still renders, the author sees a wrong chart rather
 * than an error.
 *
 * So candidates are tried from the right: the chosen colon is the last one
 * whose right-hand side is recognisable task metadata (a date, duration, tag,
 * dependency or progress value). A line with no metadata-looking tail falls
 * back to the first colon, preserving the old behaviour for genuinely
 * malformed input.
 *
 * @returns the index of the separating colon, or -1 when the line has none
 */
function taskMetaColon(line: string, dateFormat: string): number {
  const first = line.indexOf(':')
  if (first === -1) return -1

  for (let i = line.lastIndexOf(':'); i >= first; i = line.lastIndexOf(':', i - 1)) {
    if (looksLikeTaskMeta(line.slice(i + 1), dateFormat)) return i
    if (i === 0) break
  }
  return first
}

/**
 * True when a metadata tail carries at least one token gantt understands.
 *
 * A bare id alone does not count: "10:30 standup" would otherwise look like
 * valid metadata and defeat the whole purpose of scanning from the right.
 */
function looksLikeTaskMeta(tail: string, dateFormat: string): boolean {
  const parts = tail.split(',').map(p => p.trim()).filter(p => p.length > 0)
  if (parts.length === 0) return false

  return parts.some(part => {
    const lower = part.toLowerCase()
    if (TAGS.has(lower as GanttTaskTag)) return true
    if (/^(after|until)\s+\S/i.test(part)) return true
    if (/^\d+(?:\.\d+)?\s*%$/.test(part)) return true
    if (isDateLike(part, dateFormat)) return true
    return isDurationLike(part)
  })
}

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
