import type {
  PositionedAxisLabel, PositionedQuadrant, PositionedQuadrantChart,
  PositionedQuadrantPoint, QuadrantDiagram,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'

// ============================================================================
// Quadrant chart layout engine
//
// A fixed-size square plot with axis labels outside it on all four sides.
// Data coordinates are 0..1 with the origin at the bottom-left, so the y
// axis is flipped on the way to SVG coordinates.
//
// The canvas widens when a side axis label needs more room than the gutter
// provides, so long labels are never clipped.
// ============================================================================

/** Layout constants. */
const Q = {
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  /** Side of the square plot area */
  plotSize: 360,
  /** Gutter reserved outside the plot for an axis label */
  axisGutter: 26,
  axisFontSize: 13,
  axisFontWeight: 500,
  quadrantFontSize: 14,
  quadrantFontWeight: 600,
  /** Default marker radius, overridable per point with `radius:` */
  pointRadius: 6,
  pointFontSize: 12,
  pointFontWeight: 400,
  /** Gap between a marker and its label */
  pointLabelGap: 8,
} as const

/**
 * Lay out a parsed quadrant chart by computing the plot square, the four
 * quadrant rectangles, the crosshair, axis labels and point positions.
 */
export function layoutQuadrant(
  diagram: QuadrantDiagram,
  _options: RenderOptions = {},
): PositionedQuadrantChart {
  const hasTitle = !!diagram.title

  // Side gutters grow to fit their labels, so nothing is clipped
  const leftGutter = gutterFor(diagram.xAxis.start)
  const rightGutter = gutterFor(diagram.xAxis.end)

  const plotX = Q.padding + leftGutter
  const plotY = Q.padding + (hasTitle ? Q.titleHeight : 0) + (diagram.yAxis.end ? Q.axisGutter : 0)
  const plotSize = Q.plotSize

  const bottomGutter = diagram.yAxis.start ? Q.axisGutter : 0
  const width = widthForTitle(
    plotX + plotSize + rightGutter + Q.padding,
    diagram.title,
    Q.titleFontSize,
    Q.titleFontWeight,
    Q.padding,
  )
  const height = plotY + plotSize + bottomGutter + Q.padding

  const plot = { x: plotX, y: plotY, width: plotSize, height: plotSize }
  const midX = plotX + plotSize / 2
  const midY = plotY + plotSize / 2

  return {
    width: Math.round(width),
    height: Math.round(height),
    title: diagram.title
      ? { text: diagram.title, x: width / 2, y: Q.padding + Q.titleFontSize }
      : undefined,
    plot,
    quadrants: buildQuadrants(diagram, plot, midX, midY),
    crosshair: {
      vertical: { x: midX, y1: plotY, y2: plotY + plotSize },
      horizontal: { y: midY, x1: plotX, x2: plotX + plotSize },
    },
    axisLabels: buildAxisLabels(diagram, plot, midX, midY),
    points: buildPoints(diagram, plot),
  }
}

// ---------------------------------------------------------------------------
// Quadrants
// ---------------------------------------------------------------------------

/**
 * The four quadrant rectangles, numbered the way Mermaid numbers them:
 * 1 top-right, 2 top-left, 3 bottom-left, 4 bottom-right.
 */
function buildQuadrants(
  diagram: QuadrantDiagram,
  plot: { x: number; y: number; width: number; height: number },
  midX: number,
  midY: number,
): PositionedQuadrant[] {
  const halfW = plot.width / 2
  const halfH = plot.height / 2
  const { q1, q2, q3, q4 } = diagram.quadrants

  const specs = [
    { number: 1 as const, title: q1, x: midX, y: plot.y, colorIndex: 0 },
    { number: 2 as const, title: q2, x: plot.x, y: plot.y, colorIndex: 1 },
    { number: 3 as const, title: q3, x: plot.x, y: midY, colorIndex: 2 },
    { number: 4 as const, title: q4, x: midX, y: midY, colorIndex: 3 },
  ]

  return specs.map(spec => ({
    number: spec.number,
    title: spec.title ?? '',
    rect: { x: spec.x, y: spec.y, width: halfW, height: halfH },
    labelX: spec.x + halfW / 2,
    labelY: spec.y + Q.quadrantFontSize + 8,
    colorIndex: spec.colorIndex,
  }))
}

// ---------------------------------------------------------------------------
// Axis labels
// ---------------------------------------------------------------------------

/**
 * Axis end labels, one per declared end. The x labels sit below the plot and
 * the y labels outside it — left side rotated upright is avoided, so the
 * bottom label goes under the plot and the top label above it.
 */
function buildAxisLabels(
  diagram: QuadrantDiagram,
  plot: { x: number; y: number; width: number; height: number },
  midX: number,
  midY: number,
): PositionedAxisLabel[] {
  const out: PositionedAxisLabel[] = []
  const plotBottom = plot.y + plot.height
  const plotRight = plot.x + plot.width

  if (diagram.xAxis.start) {
    out.push({
      text: diagram.xAxis.start,
      x: plot.x - Q.pointLabelGap,
      y: midY,
      anchor: 'end',
      side: 'left',
    })
  }
  if (diagram.xAxis.end) {
    out.push({
      text: diagram.xAxis.end,
      x: plotRight + Q.pointLabelGap,
      y: midY,
      anchor: 'start',
      side: 'right',
    })
  }
  if (diagram.yAxis.end) {
    out.push({
      text: diagram.yAxis.end,
      x: midX,
      y: plot.y - Q.axisGutter / 2,
      anchor: 'middle',
      side: 'top',
    })
  }
  if (diagram.yAxis.start) {
    out.push({
      text: diagram.yAxis.start,
      x: midX,
      y: plotBottom + Q.axisGutter / 2,
      anchor: 'middle',
      side: 'bottom',
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** Map unit-square coordinates onto the plot, flipping y for SVG. */
function buildPoints(
  diagram: QuadrantDiagram,
  plot: { x: number; y: number; width: number; height: number },
): PositionedQuadrantPoint[] {
  return diagram.points.map(point => {
    const cx = plot.x + point.x * plot.width
    const cy = plot.y + (1 - point.y) * plot.height
    const radius = point.styles.radius ?? Q.pointRadius

    return {
      label: point.label,
      cx,
      cy,
      radius,
      labelX: cx + radius + Q.pointLabelGap,
      labelY: cy,
      dataX: point.x,
      dataY: point.y,
      styles: point.styles,
      className: point.className,
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Width a side axis label needs, at least the default gutter. */
function gutterFor(label: string | undefined): number {
  if (!label) return Q.axisGutter
  const textWidth = estimateTextWidth(label, Q.axisFontSize, Q.axisFontWeight)
  return Math.max(Q.axisGutter, textWidth + Q.pointLabelGap * 2)
}
