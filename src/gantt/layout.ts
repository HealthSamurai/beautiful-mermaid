import type {
  GanttDiagram, GanttAxisTick, GanttGridLine, PositionedGantt,
  PositionedGanttAxis, PositionedGanttBar, PositionedGanttSection, PositionedGanttVertical,
  PositionedMilestone,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'
import {
  DAY_MS, addDuration, advanceTick, floorToTickUnit, formatGanttDate, parseTickInterval,
  startOfDay, startOfMonth, startOfQuarter, startOfWeekOn, startOfYear,
} from './dates.ts'

// ============================================================================
// Gantt layout engine
//
// Direct coordinate mapping, no graph layout needed:
//   - one row per task, grouped into section bands
//   - a left gutter holds section labels
//   - the time domain [min start .. max end] maps linearly onto the plot width
//   - axis granularity (day → week → month → quarter → year) is chosen from
//     the span so the labels never collide
//
// Task labels sit inside their bar when it is wide enough, otherwise just to
// the right of it — measured with the DOM-free text metrics.
// ============================================================================

/** Layout constants — tuned to match the visual weight of the xychart module. */
const G = {
  /** Target width of the time-mapped plot area */
  plotWidth: 680,
  /** Outer canvas padding */
  padding: 22,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  /** Height of one task row, bar included */
  rowHeight: 30,
  /** Vertical gap between the bar and the row edge (so bars don't touch) */
  barInset: 5,
  /** Extra vertical space above the first row of a section */
  sectionPadTop: 6,
  /** Extra vertical space below the last row of a section */
  sectionPadBottom: 6,
  /** Width of the left gutter holding section labels */
  gutterMin: 90,
  gutterMax: 220,
  gutterPad: 14,
  sectionFontSize: 13,
  sectionFontWeight: 600,
  taskFontSize: 12,
  taskFontWeight: 500,
  axisFontSize: 12,
  axisFontWeight: 400,
  /** Height reserved for the axis labels above the plot */
  axisHeight: 30,
  /** Minimum rendered width of a bar, so a 1-day task stays visible */
  minBarWidth: 4,
  /** Horizontal padding inside a bar before its label */
  barLabelPad: 8,
  /** Gap between a bar and a label placed outside it */
  outsideLabelGap: 7,
  /** Half-diagonal of a milestone diamond */
  milestoneRadius: 9,
  /** Minimum pixels between two axis labels */
  minTickGap: 54,
} as const

/**
 * Lay out a parsed gantt diagram by computing pixel coordinates for
 * the axis, section bands, task bars and milestone diamonds.
 */
export function layoutGantt(diagram: GanttDiagram, _options: RenderOptions = {}): PositionedGantt {
  const hasTitle = !!diagram.title
  const sectionsWithTasks = diagram.sections.filter(s => s.tasks.length > 0)

  // ---- time domain -------------------------------------------------------
  const { min, max } = timeDomain(diagram)
  const span = Math.max(max - min, DAY_MS)

  // ---- left gutter: widest section label, clamped -------------------------
  const labelWidths = sectionsWithTasks
    .filter(s => s.title.length > 0)
    .map(s => estimateTextWidth(s.title, G.sectionFontSize, G.sectionFontWeight))
  const gutter = labelWidths.length === 0
    ? 0
    : clamp(Math.max(...labelWidths) + G.gutterPad * 2, G.gutterMin, G.gutterMax)

  const plotWidth = G.plotWidth
  const plotX = G.padding + gutter
  const plotY = G.padding + (hasTitle ? G.titleHeight : 0) + G.axisHeight

  /** Map a timestamp onto an x coordinate inside the plot area. */
  const toX = (t: number) => plotX + ((t - min) / span) * plotWidth

  // ---- rows --------------------------------------------------------------
  // Rows were assigned by the parser, which is where compact mode decides
  // that two non-overlapping tasks may share one.
  const bars: PositionedGanttBar[] = []
  const milestones: PositionedMilestone[] = []
  const verticals: PositionedGanttVertical[] = []
  const positionedSections: PositionedGanttSection[] = []

  let y = plotY
  let alternate = false

  for (const section of sectionsWithTasks) {
    const bandTop = y
    y += G.sectionPadTop

    // A section occupies as many rows as its highest row index needs, which
    // in compact mode is fewer than its task count
    const firstRow = Math.min(...section.tasks.map(t => t.row))
    const rowCount = Math.max(...section.tasks.map(t => t.row)) - firstRow + 1
    const rowTop = y

    for (const task of section.tasks) {
      const rowY = rowTop + (task.row - firstRow) * G.rowHeight
      const rowCenter = rowY + G.rowHeight / 2

      if (task.vertical) {
        // A vert task marks a moment across the whole chart, so it is drawn
        // later as a full-height line; only its x is fixed here
        const x = toX(task.start)
        verticals.push({
          id: task.id,
          label: task.label,
          x,
          y1: plotY,
          y2: plotY,  // filled in once the plot height is known
          status: task.status,
          labelX: x + G.outsideLabelGap,
          labelY: plotY - 4,
          time: task.start,
        })
        continue
      }

      if (task.milestone) {
        const cx = toX(task.start)
        milestones.push({
          id: task.id,
          label: task.label,
          cx,
          cy: rowCenter,
          radius: G.milestoneRadius,
          status: task.status,
          labelX: cx + G.milestoneRadius + G.outsideLabelGap,
          labelY: rowCenter,
          labelAnchor: 'start',
          time: task.start,
        })
      } else {
        const x1 = toX(task.start)
        const x2 = toX(task.end)
        const width = Math.max(x2 - x1, G.minBarWidth)
        const barY = rowY + G.barInset
        const barHeight = G.rowHeight - G.barInset * 2

        const textWidth = estimateTextWidth(task.label, G.taskFontSize, G.taskFontWeight)
        const fitsInside = textWidth + G.barLabelPad * 2 <= width

        bars.push({
          id: task.id,
          label: task.label,
          x: x1,
          y: barY,
          width,
          height: barHeight,
          status: task.status,
          labelX: fitsInside ? x1 + width / 2 : x1 + width + G.outsideLabelGap,
          labelY: rowCenter,
          labelAnchor: fitsInside ? 'middle' : 'start',
          labelOutside: !fitsInside,
          progress: task.progress,
          progressWidth: task.progress === undefined ? 0 : width * task.progress,
          start: task.start,
          end: task.end,
        })
      }
    }

    y = rowTop + rowCount * G.rowHeight

    y += G.sectionPadBottom
    const bandHeight = y - bandTop

    positionedSections.push({
      title: section.title,
      labelX: G.padding + gutter - G.gutterPad,
      labelY: bandTop + bandHeight / 2,
      band: { x: G.padding, y: bandTop, width: gutter + plotWidth, height: bandHeight },
      alternate,
    })
    alternate = !alternate
  }

  const plotHeight = y - plotY

  // ---- axis --------------------------------------------------------------
  const pattern = diagram.axisFormat ?? defaultAxisFormat(span)
  const tickTimes = generateTicks(min, max, span, plotWidth, pattern, diagram)

  const ticks: GanttAxisTick[] = tickTimes.map(t => ({
    label: formatGanttDate(t, pattern),
    x: toX(t),
    labelY: plotY - G.axisHeight / 2 + 2,
    time: t,
  }))

  const axis: PositionedGanttAxis = {
    ticks,
    line: { x1: plotX, y1: plotY, x2: plotX + plotWidth, y2: plotY },
  }

  const gridLines: GanttGridLine[] = ticks.map(t => ({
    x1: t.x, y1: plotY, x2: t.x, y2: plotY + plotHeight,
  }))

  // Vert markers span the finished plot, which is only known now
  for (const vertical of verticals) {
    vertical.y2 = plotY + plotHeight
  }

  // ---- today marker ------------------------------------------------------
  // Drawn only when today actually falls inside the chart; `todayMarker off`
  // suppresses it, and any other value is an inline style for the line.
  const today = startOfDay(Date.now())
  const markerOff = diagram.todayMarker?.trim().toLowerCase() === 'off'
  const todayMarker = !markerOff && today >= min && today <= max
    ? {
        x: toX(today),
        y1: plotY,
        y2: plotY + plotHeight,
        style: diagram.todayMarker ? cssFromMarkerStyle(diagram.todayMarker) : undefined,
      }
    : undefined

  // ---- canvas ------------------------------------------------------------
  // The rightmost label may overhang the plot; grow the canvas to contain it.
  const labelOverhang = Math.max(
    0,
    ...bars.filter(b => b.labelOutside).map(b =>
      b.labelX + estimateTextWidth(b.label, G.taskFontSize, G.taskFontWeight) - (plotX + plotWidth)),
    ...milestones.map(m =>
      m.labelX + estimateTextWidth(m.label, G.taskFontSize, G.taskFontWeight) - (plotX + plotWidth)),
    ...ticks.length > 0
      ? [estimateTextWidth(ticks[ticks.length - 1]!.label, G.axisFontSize, G.axisFontWeight) / 2 -
         (plotX + plotWidth - ticks[ticks.length - 1]!.x)]
      : [0],
  )

  const width = widthForTitle(
    plotX + plotWidth + labelOverhang + G.padding,
    diagram.title,
    G.titleFontSize,
    G.titleFontWeight,
    G.padding,
  )

  // `topAxis` repeats the time axis on the far edge of the plot, so a long
  // chart stays readable without scrolling back to the header
  const bottomAxis: PositionedGanttAxis | undefined = diagram.topAxis
    ? {
        ticks: ticks.map(t => ({ ...t, labelY: plotY + plotHeight + G.axisHeight / 2 })),
        line: {
          x1: plotX, y1: plotY + plotHeight,
          x2: plotX + plotWidth, y2: plotY + plotHeight,
        },
      }
    : undefined

  const height = plotY + plotHeight + (bottomAxis ? G.axisHeight : 0) + G.padding

  const title = diagram.title
    ? { text: diagram.title, x: width / 2, y: G.padding + G.titleFontSize }
    : undefined

  return {
    width: Math.round(width),
    height: Math.round(height),
    title,
    axis,
    bottomAxis,
    gridLines,
    sections: positionedSections,
    bars,
    milestones,
    verticals,
    todayMarker,
    plotArea: { x: plotX, y: plotY, width: plotWidth, height: plotHeight },
  }
}

/**
 * Convert a `todayMarker` declaration into an inline style string.
 *
 * Mermaid writes it comma-separated (`stroke:red,stroke-width:2px`) and swaps
 * the commas for semicolons at render time, so this does the same.
 */
function cssFromMarkerStyle(declaration: string): string | undefined {
  const css = declaration.trim().replace(/,/g, ';')
  // Reject anything that could close the attribute or open a tag
  return /[<>"']/.test(css) ? undefined : css
}

// ---------------------------------------------------------------------------
// Time domain
// ---------------------------------------------------------------------------

/**
 * Smallest enclosing time range over all tasks, padded so the first bar does
 * not start flush against the axis edge.
 */
function timeDomain(diagram: GanttDiagram): { min: number; max: number } {
  if (diagram.tasks.length === 0) {
    const today = startOfDay(Date.now())
    return { min: today, max: today + 7 * DAY_MS }
  }

  let min = Infinity
  let max = -Infinity
  for (const task of diagram.tasks) {
    if (task.start < min) min = task.start
    if (task.end > max) max = task.end
  }

  // Degenerate span (single milestone, or all tasks on one instant)
  if (max - min < DAY_MS) {
    min -= DAY_MS
    max += DAY_MS
  }

  // 2% breathing room on both ends
  const pad = (max - min) * 0.02
  return { min: min - pad, max: max + pad }
}

// ---------------------------------------------------------------------------
// Axis ticks
// ---------------------------------------------------------------------------

/** Candidate tick granularities, coarsest decision made by span length. */
type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * Choose a default `axisFormat` from the span: days get a day-month label,
 * months get month-year, long ranges get bare years.
 */
function defaultAxisFormat(span: number): string {
  const days = span / DAY_MS
  if (days <= 14) return '%d %b'
  if (days <= 120) return '%d %b'
  if (days <= 1100) return '%b %Y'
  return '%Y'
}

/**
 * Generate tick timestamps across the domain.
 *
 * An explicit `tickInterval` wins outright — the author asked for that step.
 * Otherwise this starts from the natural calendar granularity for the span and
 * coarsens the step until consecutive labels are at least `minTickGap` pixels
 * apart, so long projects do not produce an unreadable picket fence.
 */
function generateTicks(
  min: number,
  max: number,
  span: number,
  plotWidth: number,
  pattern: string,
  diagram: GanttDiagram,
): number[] {
  // Explicit tickInterval, snapped to natural boundaries so ticks land on the
  // 1st of a month or on the configured first day of the week
  if (diagram.tickInterval) {
    const interval = parseTickInterval(diagram.tickInterval)
    if (interval) {
      const out: number[] = []
      let t = floorToTickUnit(min, interval, diagram.weekStart)
      while (t < min) t = advanceTick(t, interval)
      // Same hard cap as the automatic path: a bad interval must not hang
      while (t <= max && out.length < 400) {
        out.push(t)
        t = advanceTick(t, interval)
      }
      if (out.length > 0) return out
    }
    // An unparseable or empty interval falls through to the automatic axis
  }

  const days = span / DAY_MS

  const base: Granularity =
    days <= 21 ? 'day'
    : days <= 120 ? 'week'
    : days <= 900 ? 'month'
    : days <= 2600 ? 'quarter'
    : 'year'

  // Candidate steps, increasing: within a granularity we may take every Nth tick
  const candidates: Array<{ granularity: Granularity; every: number }> = [
    { granularity: base, every: 1 },
    { granularity: base, every: 2 },
    { granularity: base, every: 3 },
    ...coarser(base).map(g => ({ granularity: g, every: 1 })),
    ...coarser(base).map(g => ({ granularity: g, every: 2 })),
    { granularity: 'year' as Granularity, every: 5 },
    { granularity: 'year' as Granularity, every: 10 },
  ]

  for (const candidate of candidates) {
    const times = calendarTicks(min, max, candidate.granularity, candidate.every, diagram.weekStart)
    if (times.length <= 1) return times
    const widest = Math.max(...times.map(t => estimateTextWidth(formatGanttDate(t, pattern), G.axisFontSize, G.axisFontWeight)))
    const gap = (plotWidth / span) * (times[1]! - times[0]!)
    if (gap >= Math.max(G.minTickGap, widest + 10)) return times
  }

  // Everything collides — fall back to just the domain endpoints
  return [min, max]
}

/** Granularities coarser than the given one, in increasing order. */
function coarser(g: Granularity): Granularity[] {
  const order: Granularity[] = ['day', 'week', 'month', 'quarter', 'year']
  return order.slice(order.indexOf(g) + 1)
}

/** All calendar boundaries of the given granularity inside [min, max]. */
function calendarTicks(
  min: number,
  max: number,
  granularity: Granularity,
  every: number,
  weekStart: number,
): number[] {
  const starters: Record<Granularity, (t: number) => number> = {
    day: startOfDay,
    // `weekday <name>` moves where the weekly gridlines fall
    week: t => startOfWeekOn(t, weekStart),
    month: startOfMonth,
    quarter: startOfQuarter,
    year: startOfYear,
  }
  const steps: Record<Granularity, { amount: number; unit: 'd' | 'w' | 'mo' | 'y' }> = {
    day: { amount: 1, unit: 'd' },
    week: { amount: 1, unit: 'w' },
    month: { amount: 1, unit: 'mo' },
    quarter: { amount: 3, unit: 'mo' },
    year: { amount: 1, unit: 'y' },
  }

  const step = steps[granularity]
  const scaled = { amount: step.amount * every, unit: step.unit }

  let t = starters[granularity](min)
  // Never start before the domain — the first visible boundary wins
  while (t < min) t = addDuration(t, scaled)

  const out: number[] = []
  // Hard cap guards against a pathological span producing millions of ticks
  while (t <= max && out.length < 400) {
    out.push(t)
    t = addDuration(t, scaled)
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
