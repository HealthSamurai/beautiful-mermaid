import type {
  TimelineConnector, TimelineDiagram, PositionedEvent, PositionedPeriod,
  PositionedTimeline, PositionedTimelineSection,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'

// ============================================================================
// Timeline layout engine
//
// Two layouts over the same parsed structure:
//
//   horizontal — periods sit on a top axis, event cards stack downwards in a
//                column under each period (the Mermaid default look)
//   vertical   — the axis runs down the left, periods label the rows and
//                event cards stack to the right of each period
//
// Event text is wrapped to a fixed card width using the DOM-free text metrics,
// so card heights are known before rendering.
// ============================================================================

/** Layout constants. */
const T = {
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  sectionFontSize: 13,
  sectionFontWeight: 600,
  sectionHeight: 28,
  periodFontSize: 14,
  periodFontWeight: 600,
  periodHeight: 26,
  eventFontSize: 12,
  eventFontWeight: 400,
  /** Width of one event card (and of a horizontal period column) */
  cardWidth: 150,
  /** Horizontal padding inside an event card */
  cardPadX: 10,
  /** Vertical padding inside an event card */
  cardPadY: 8,
  /** Gap between stacked event cards */
  cardGap: 8,
  /** Gap between columns (horizontal) or rows (vertical) */
  trackGap: 18,
  /** Marker dot radius on the axis */
  markerRadius: 5,
  /** Distance from the axis to the first event card */
  axisGap: 22,
  /** Width of the period-label gutter in the vertical layout */
  vLabelWidth: 130,
  /** Maximum lines an event card wraps to before it is clipped */
  maxLines: 4,
} as const

/**
 * Lay out a parsed timeline diagram by computing pixel coordinates for the
 * axis, section bands, period markers and event cards.
 */
export function layoutTimeline(diagram: TimelineDiagram, _options: RenderOptions = {}): PositionedTimeline {
  return diagram.orientation === 'vertical'
    ? layoutVertical(diagram)
    : layoutHorizontal(diagram)
}

// ============================================================================
// Horizontal layout — periods across the top, events hanging below
// ============================================================================

function layoutHorizontal(diagram: TimelineDiagram): PositionedTimeline {
  const hasTitle = !!diagram.title
  const sections = diagram.sections.filter(s => s.periods.length > 0)
  const named = sections.some(s => s.title.length > 0)

  const top = T.padding + (hasTitle ? T.titleHeight : 0)
  const sectionRow = named ? T.sectionHeight : 0
  const periodRow = top + sectionRow
  const axisY = periodRow + T.periodHeight
  const eventsTop = axisY + T.axisGap

  const periods: PositionedPeriod[] = []
  const events: PositionedEvent[] = []
  const connectors: TimelineConnector[] = []
  const positionedSections: PositionedTimelineSection[] = []

  const columnStride = T.cardWidth + T.trackGap
  let x = T.padding
  let maxEventsBottom = eventsTop

  // `config.timeline.disableMulticolor` collapses the per-section palette onto
  // the single accent colour, for a chart that should read as one series
  sections.forEach((section, sectionIndex) => {
    const colorIndex = diagram.disableMulticolor ? 0 : sectionIndex

    const bandLeft = x

    for (const period of section.periods) {
      const cx = x + T.cardWidth / 2

      periods.push({
        label: period.label,
        cx,
        cy: axisY,
        radius: T.markerRadius,
        labelX: cx,
        labelY: periodRow + T.periodHeight / 2,
        labelAnchor: 'middle',
        colorIndex,
      })

      let y = eventsTop
      for (const text of period.events) {
        const { lines, height } = wrapEvent(text)
        events.push({
          text: lines.join('\n'),
          x,
          y,
          width: T.cardWidth,
          height,
          labelX: x + T.cardPadX,
          labelY: y + height / 2,
          labelAnchor: 'start',
          colorIndex,
        })
        y += height + T.cardGap
      }

      if (period.events.length > 0) {
        connectors.push({ x1: cx, y1: axisY + T.markerRadius, x2: cx, y2: eventsTop, colorIndex })
      }

      if (y > maxEventsBottom) maxEventsBottom = y
      x += columnStride
    }

    const bandRight = x - T.trackGap
    positionedSections.push({
      title: section.title,
      labelX: (bandLeft + bandRight) / 2,
      labelY: top + T.sectionHeight / 2,
      labelAnchor: 'middle',
      band: { x: bandLeft, y: top, width: bandRight - bandLeft, height: 0 },
      colorIndex,
    })
  })

  const contentRight = Math.max(x - T.trackGap, T.padding + T.cardWidth)
  const width = widthForTitle(
    contentRight + T.padding,
    diagram.title,
    T.titleFontSize,
    T.titleFontWeight,
    T.padding,
  )
  const height = Math.max(maxEventsBottom - T.cardGap, eventsTop) + T.padding

  // Section bands span the full content height once it is known
  for (const section of positionedSections) {
    section.band.height = height - T.padding - top
  }

  const axis = {
    x1: T.padding,
    y1: axisY,
    x2: contentRight,
    y2: axisY,
  }

  const title = diagram.title
    ? { text: diagram.title, x: width / 2, y: T.padding + T.titleFontSize }
    : undefined

  return {
    width: Math.round(width),
    height: Math.round(height),
    orientation: 'horizontal',
    title,
    axis,
    sections: named ? positionedSections : [],
    periods,
    events,
    connectors,
  }
}

// ============================================================================
// Vertical layout — axis down the left, events to the right
// ============================================================================

function layoutVertical(diagram: TimelineDiagram): PositionedTimeline {
  const hasTitle = !!diagram.title
  const sections = diagram.sections.filter(s => s.periods.length > 0)
  const named = sections.some(s => s.title.length > 0)

  const top = T.padding + (hasTitle ? T.titleHeight : 0)
  const axisX = T.padding + T.vLabelWidth
  const eventsLeft = axisX + T.axisGap

  const periods: PositionedPeriod[] = []
  const events: PositionedEvent[] = []
  const connectors: TimelineConnector[] = []
  const positionedSections: PositionedTimelineSection[] = []

  let y = top
  let maxEventsRight = eventsLeft

  // `config.timeline.disableMulticolor` collapses the per-section palette onto
  // the single accent colour, for a chart that should read as one series
  sections.forEach((section, sectionIndex) => {
    const colorIndex = diagram.disableMulticolor ? 0 : sectionIndex

    const bandTop = y
    if (named && section.title) y += T.sectionHeight

    for (const period of section.periods) {
      // Height of this row: the stacked event cards, or one bare marker row
      const wrapped = period.events.map(wrapEvent)
      const stackHeight = wrapped.length === 0
        ? T.periodHeight
        : wrapped.reduce((sum, w) => sum + w.height, 0) + T.cardGap * (wrapped.length - 1)
      const rowHeight = Math.max(stackHeight, T.periodHeight)
      const cy = y + rowHeight / 2

      periods.push({
        label: period.label,
        cx: axisX,
        cy,
        radius: T.markerRadius,
        labelX: axisX - T.markerRadius - 10,
        labelY: cy,
        labelAnchor: 'end',
        colorIndex,
      })

      let cardY = y + (rowHeight - stackHeight) / 2
      for (let i = 0; i < wrapped.length; i++) {
        const { lines, height } = wrapped[i]!
        events.push({
          text: lines.join('\n'),
          x: eventsLeft,
          y: cardY,
          width: T.cardWidth,
          height,
          labelX: eventsLeft + T.cardPadX,
          labelY: cardY + height / 2,
          labelAnchor: 'start',
          colorIndex,
        })
        cardY += height + T.cardGap
      }

      if (wrapped.length > 0) {
        connectors.push({ x1: axisX + T.markerRadius, y1: cy, x2: eventsLeft, y2: cy, colorIndex })
        maxEventsRight = Math.max(maxEventsRight, eventsLeft + T.cardWidth)
      }

      y += rowHeight + T.trackGap
    }

    const bandBottom = y - T.trackGap
    positionedSections.push({
      title: section.title,
      labelX: T.padding,
      labelY: bandTop + T.sectionHeight / 2,
      labelAnchor: 'start',
      band: { x: T.padding, y: bandTop, width: 0, height: bandBottom - bandTop },
      colorIndex,
    })
  })

  const contentBottom = Math.max(y - T.trackGap, top + T.periodHeight)
  const width = widthForTitle(
    Math.max(maxEventsRight, axisX) + T.padding,
    diagram.title,
    T.titleFontSize,
    T.titleFontWeight,
    T.padding,
  )
  const height = contentBottom + T.padding

  // Section bands span the full content width once it is known
  for (const section of positionedSections) {
    section.band.width = width - T.padding * 2
  }

  const axis = { x1: axisX, y1: top, x2: axisX, y2: contentBottom }

  const title = diagram.title
    ? { text: diagram.title, x: width / 2, y: T.padding + T.titleFontSize }
    : undefined

  return {
    width: Math.round(width),
    height: Math.round(height),
    orientation: 'vertical',
    title,
    axis,
    sections: named ? positionedSections : [],
    periods,
    events,
    connectors,
  }
}

// ============================================================================
// Event text wrapping
// ============================================================================

/**
 * Greedily wrap event text to the card width and return the resulting lines
 * plus the card height they need. A single word longer than the card is kept
 * on its own line rather than broken mid-word.
 */
function wrapEvent(text: string): { lines: string[]; height: number } {
  const maxWidth = T.cardWidth - T.cardPadX * 2
  const words = text.split(/\s+/).filter(w => w.length > 0)

  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (estimateTextWidth(candidate, T.eventFontSize, T.eventFontWeight) <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length === 0) lines.push('')

  const clipped = lines.slice(0, T.maxLines)
  const lineHeight = T.eventFontSize * LINE_HEIGHT_RATIO
  const height = clipped.length * lineHeight + T.cardPadY * 2

  return { lines: clipped, height }
}
