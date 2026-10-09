import type {
  JourneyDiagram, PositionedJourney, PositionedJourneySection,
  PositionedJourneyTask, PositionedScoreLine,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'

// ============================================================================
// Journey layout engine
//
// One column per task, left to right in source order. The vertical position
// of a task marker encodes its satisfaction score, so the polyline through
// the markers reads as the experience curve — the point of the diagram.
//
// Above the plot, section bands group the tasks of each phase. Below each
// marker sit the wrapped task label and, when present, the people involved.
// Task labels wrap to the column width using the DOM-free text metrics, so
// the canvas height is known before rendering.
// ============================================================================

/** Score range the vertical axis is drawn for. */
const MIN_SCORE = 1
const MAX_SCORE = 5

/** Layout constants. */
const J = {
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  sectionFontSize: 13,
  sectionFontWeight: 600,
  sectionHeight: 28,
  /** Width of one task column */
  columnWidth: 120,
  /** Gap between task columns */
  columnGap: 10,
  /** Height of the score plot area */
  plotHeight: 150,
  /** Task marker radius */
  markerRadius: 7,
  taskFontSize: 12,
  taskFontWeight: 500,
  peopleFontSize: 11,
  peopleFontWeight: 400,
  /** Gap between the plot bottom and the first task label line */
  labelGap: 14,
  /** Gap between the task label block and the people line */
  peopleGap: 6,
  /** Width of the score-axis gutter on the left */
  axisWidth: 26,
  axisFontSize: 11,
  /** Maximum lines a task label wraps to before it is clipped */
  maxLines: 3,
} as const

/**
 * Lay out a parsed journey diagram by computing pixel coordinates for the
 * score gridlines, section bands, task markers and the experience curve.
 */
export function layoutJourney(diagram: JourneyDiagram, _options: RenderOptions = {}): PositionedJourney {
  const hasTitle = !!diagram.title
  const sections = diagram.sections.filter(s => s.tasks.length > 0)
  const named = sections.some(s => s.title.length > 0)

  const top = J.padding + (hasTitle ? J.titleHeight : 0)
  const sectionRow = named ? J.sectionHeight : 0
  const plotTop = top + sectionRow
  const plotBottom = plotTop + J.plotHeight

  const columnStride = J.columnWidth + J.columnGap
  const left = J.padding + J.axisWidth

  // Wrap every label first — the tallest label block sets the canvas height
  const wrapped = diagram.tasks.map(t => wrapLabel(t.task))
  const maxLabelLines = wrapped.reduce((max, w) => Math.max(max, w.length), 0)
  const lineHeight = J.taskFontSize * LINE_HEIGHT_RATIO
  const labelBlockHeight = maxLabelLines * lineHeight
  const hasPeople = diagram.tasks.some(t => t.people.some(p => p.length > 0))
  const peopleHeight = hasPeople ? J.peopleFontSize * LINE_HEIGHT_RATIO + J.peopleGap : 0

  const tasks: PositionedJourneyTask[] = []
  const positionedSections: PositionedJourneySection[] = []
  const curvePoints: { x: number; y: number }[] = []

  let x = left
  let taskIndex = 0

  sections.forEach((section, colorIndex) => {
    const bandLeft = x

    for (const task of section.tasks) {
      const cx = x + J.columnWidth / 2
      const cy = scoreToY(task.score, plotTop, plotBottom)
      const lines = wrapped[taskIndex] ?? ['']
      const people = task.people.filter(p => p.length > 0)

      tasks.push({
        lines,
        label: task.task,
        score: task.score,
        people,
        cx,
        cy,
        radius: J.markerRadius,
        labelX: cx,
        labelY: plotBottom + J.labelGap,
        peopleLabel: people.length > 0
          ? {
              text: people.join(', '),
              x: cx,
              y: plotBottom + J.labelGap + labelBlockHeight + J.peopleGap,
            }
          : undefined,
        colorIndex,
      })

      curvePoints.push({ x: cx, y: cy })
      x += columnStride
      taskIndex++
    }

    const bandRight = x - J.columnGap
    positionedSections.push({
      title: section.title,
      labelX: (bandLeft + bandRight) / 2,
      labelY: top + J.sectionHeight / 2,
      band: { x: bandLeft, y: top, width: bandRight - bandLeft, height: 0 },
      colorIndex,
    })
  })

  const contentRight = Math.max(x - J.columnGap, left + J.columnWidth)
  const width = widthForTitle(
    contentRight + J.padding,
    diagram.title,
    J.titleFontSize,
    J.titleFontWeight,
    J.padding,
  )
  const height = plotBottom + J.labelGap + labelBlockHeight + peopleHeight + J.padding

  // Section bands span from the section row down to the plot bottom
  for (const section of positionedSections) {
    section.band.height = plotBottom - top
  }

  const scoreLines = buildScoreLines(plotTop, plotBottom, left, contentRight)

  const title = diagram.title
    ? { text: diagram.title, x: width / 2, y: J.padding + J.titleFontSize }
    : undefined

  return {
    width: Math.round(width),
    height: Math.round(height),
    title,
    scoreLines,
    sections: named ? positionedSections : [],
    tasks,
    curve: { points: curvePoints },
  }
}

// ---------------------------------------------------------------------------
// Score axis
// ---------------------------------------------------------------------------

/** Map a 1..5 score onto the plot area, with 5 at the top. */
function scoreToY(score: number, plotTop: number, plotBottom: number): number {
  const span = MAX_SCORE - MIN_SCORE
  const ratio = (score - MIN_SCORE) / span
  return plotBottom - ratio * (plotBottom - plotTop)
}

/** One horizontal gridline per score level, labelled in the left gutter. */
function buildScoreLines(
  plotTop: number,
  plotBottom: number,
  x1: number,
  x2: number,
): PositionedScoreLine[] {
  const out: PositionedScoreLine[] = []
  for (let score = MIN_SCORE; score <= MAX_SCORE; score++) {
    out.push({
      score,
      y: scoreToY(score, plotTop, plotBottom),
      x1,
      x2,
      labelX: x1 - 8,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Text wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap a task label to the column width, honouring explicit newlines that
 * the parser produced from `<br>` tags.
 */
function wrapLabel(text: string): string[] {
  const maxWidth = J.columnWidth - 8
  const out: string[] = []

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(w => w.length > 0)
    let line = ''

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (estimateTextWidth(candidate, J.taskFontSize, J.taskFontWeight) <= maxWidth || !line) {
        line = candidate
      } else {
        out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }

  if (out.length === 0) out.push('')
  return out.slice(0, J.maxLines)
}
