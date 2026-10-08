// ============================================================================
// Gantt types
//
// Models the parsed and positioned representations of a Mermaid `gantt`
// diagram: a list of sections, each holding time-bounded tasks, plus a
// generated time axis.
//
// All timestamps are UTC epoch milliseconds (see ./dates.ts).
// ============================================================================

import type { WeekendStart } from './dates.ts'

/** Status tag attached to a task via its metadata (`:done, 2024-01-01, 30d`). */
export type GanttTaskTag = 'done' | 'active' | 'crit' | 'milestone' | 'vert'

/** Visual status a bar is rendered with — the dominant tag of a task. */
export type GanttTaskStatus = 'default' | 'done' | 'active' | 'crit'

// ============================================================================
// Parsed gantt — logical structure from mermaid text
// ============================================================================

/** Parsed gantt diagram. */
export interface GanttDiagram {
  /** Optional diagram title */
  title?: string
  /** Declared `dateFormat` pattern (defaults to YYYY-MM-DD) */
  dateFormat: string
  /** Declared `axisFormat` pattern, if any — otherwise chosen from the span */
  axisFormat?: string
  /** Declared `tickInterval` (`1day`, `2week`) — otherwise ticks are automatic */
  tickInterval?: string
  /** `todayMarker` declaration: 'off' hides it, otherwise an inline style string */
  todayMarker?: string
  /** Non-working days declared via `excludes` */
  excludes: string[]
  /** Dates that override an exclusion, via `includes` */
  includes: string[]
  /** First day of the week, from `weekday <name>` (0 = Sunday, default Monday) */
  weekStart: number
  /** Which two days `excludes weekends` means, from `weekend <day>` */
  weekend: WeekendStart
  /** True for `displayMode compact` — overlapping tasks share a row */
  compact: boolean
  /** True for `inclusiveEndDates` — an explicit end date counts as a full day */
  inclusiveEndDates: boolean
  /** True for `topAxis` — also draw the time axis above the plot */
  topAxis: boolean
  /** Sections in source order. Tasks written before any `section` land in an unnamed section. */
  sections: GanttSection[]
  /** All tasks in source order, flattened across sections */
  tasks: GanttTask[]
}

/** A named group of tasks. */
export interface GanttSection {
  /** Section label — empty string for tasks declared before the first `section` */
  title: string
  /** Tasks belonging to this section, in source order */
  tasks: GanttTask[]
}

/** A single task (or milestone) with resolved absolute start/end. */
export interface GanttTask {
  /** Task id — the explicit one from the metadata, or a generated `task<N>` */
  id: string
  /** Display label (text before the `:`) */
  label: string
  /** Title of the owning section ('' when none) */
  section: string
  /** All status tags found in the metadata */
  tags: GanttTaskTag[]
  /** Dominant status used for coloring */
  status: GanttTaskStatus
  /** True for `:milestone` tasks — rendered as a diamond, zero-width in time */
  milestone: boolean
  /** Resolved start, epoch ms */
  start: number
  /** Resolved end, epoch ms (equals `start` for milestones) */
  end: number
  /** Task ids this task was declared to start after (`after id1 id2`) */
  after: string[]
  /** Task ids this task was declared to run until (`until id1 id2`) */
  until: string[]
  /** Completed fraction 0..1 from a `60%` metadata token, when given */
  progress?: number
  /** True for a `:vert` task — drawn as a vertical marker line, not a bar */
  vertical: boolean
  /** Row this task occupies — tasks may share a row in compact mode */
  row: number
}

// ============================================================================
// Positioned gantt — ready for SVG rendering
// ============================================================================

export interface PositionedGantt {
  width: number
  height: number
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** Time axis across the top of the plot */
  axis: PositionedGanttAxis
  /**
   * Second time axis below the plot, present only with `topAxis`.
   *
   * This library already draws the main axis above the chart, so `topAxis`
   * means "axis on both edges" here — the same end result as upstream, which
   * defaults to a bottom axis and adds a top one.
   */
  bottomAxis?: PositionedGanttAxis
  /** Vertical grid lines, one per axis tick */
  gridLines: GanttGridLine[]
  /** Section bands and their labels in the left gutter */
  sections: PositionedGanttSection[]
  /** Task bars (non-milestone tasks) */
  bars: PositionedGanttBar[]
  /** Milestone diamonds */
  milestones: PositionedMilestone[]
  /** Vertical marker lines from `:vert` tasks */
  verticals: PositionedGanttVertical[]
  /** Today marker line, when the current date falls inside the plot */
  todayMarker?: { x: number; y1: number; y2: number; style?: string }
  /** Plot bounds — the time-mapped area excluding gutter and axis */
  plotArea: { x: number; y: number; width: number; height: number }
}

export interface PositionedGanttAxis {
  /** Tick marks with their formatted labels */
  ticks: GanttAxisTick[]
  /** Baseline of the axis, drawn between labels and the first row */
  line: { x1: number; y1: number; x2: number; y2: number }
}

export interface GanttAxisTick {
  /** Formatted label (via `axisFormat`) */
  label: string
  /** X position of the tick on the axis */
  x: number
  /** Y position of the label baseline anchor */
  labelY: number
  /** Timestamp this tick represents */
  time: number
}

export interface GanttGridLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PositionedGanttSection {
  /** Section label ('' when unnamed — then no label is drawn) */
  title: string
  /** Label anchor position in the left gutter */
  labelX: number
  labelY: number
  /** Background band covering all rows of this section */
  band: { x: number; y: number; width: number; height: number }
  /** Alternating tint flag so adjacent sections stay distinguishable */
  alternate: boolean
}

export interface PositionedGanttBar {
  /** Owning task id */
  id: string
  /** Display label */
  label: string
  /** Bar rectangle */
  x: number
  y: number
  width: number
  height: number
  /** Visual status (drives the fill class) */
  status: GanttTaskStatus
  /** Where the label is drawn and how it is anchored */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
  /** True when the label sits outside the bar (bar too narrow to hold it) */
  labelOutside: boolean
  /** Completed fraction 0..1, when the task declared progress */
  progress?: number
  /** Width of the progress overlay, 0 when there is no progress */
  progressWidth: number
  /** Original timestamps, emitted as data attributes */
  start: number
  end: number
}

export interface PositionedMilestone {
  /** Owning task id */
  id: string
  /** Display label */
  label: string
  /** Diamond center */
  cx: number
  cy: number
  /** Half-diagonal of the diamond */
  radius: number
  /** Visual status (drives the fill class) */
  status: GanttTaskStatus
  /** Label anchor — milestones always label outside, to the right */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
  /** Milestone timestamp */
  time: number
}

/**
 * A `:vert` task, drawn as a labelled vertical line across the whole plot
 * rather than as a bar — used to mark a moment that cuts across sections.
 */
export interface PositionedGanttVertical {
  /** Owning task id */
  id: string
  /** Display label, drawn alongside the line */
  label: string
  x: number
  y1: number
  y2: number
  /** Visual status (drives the stroke class) */
  status: GanttTaskStatus
  /** Label anchor at the top of the line */
  labelX: number
  labelY: number
  /** Marker timestamp */
  time: number
}
