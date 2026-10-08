import type {
  PieDiagram, PositionedLegendEntry, PositionedPie, PositionedSlice,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth } from '../styles.ts'

// ============================================================================
// Pie layout engine
//
// A single circle on the left, a legend column on the right. The circle size
// is fixed; the canvas grows horizontally to fit the widest legend entry, so
// long labels never get clipped.
//
// Slice angles start at 12 o'clock and sweep clockwise, matching Mermaid.
// Percentage labels are placed at 60% of the radius along the slice bisector
// and dropped for slices too thin to hold the text.
// ============================================================================

/** Layout constants. */
const P = {
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  /** Pie radius */
  radius: 110,
  /** Gap between the circle and the legend column */
  legendGap: 32,
  legendFontSize: 13,
  legendFontWeight: 400,
  /** Side of a legend colour swatch */
  swatchSize: 13,
  /** Gap between a swatch and its label */
  swatchGap: 9,
  /** Vertical pitch of legend rows */
  legendRowHeight: 22,
  percentFontSize: 12,
  percentFontWeight: 600,
  /** Fraction of the radius at which percentage labels sit */
  percentRadiusRatio: 0.6,
  /** Slices thinner than this (in degrees) get no inline percentage label */
  minLabelAngle: 18,
} as const

/**
 * Lay out a parsed pie diagram by computing the circle geometry, one wedge
 * path per slice and the legend rows beside it.
 */
export function layoutPie(diagram: PieDiagram, _options: RenderOptions = {}): PositionedPie {
  const slices = diagram.slices
  const total = slices.reduce((sum, s) => sum + s.value, 0)

  const titleHeight = diagram.title ? P.titleHeight : 0
  const diameter = P.radius * 2

  // Legend text is built first — its width decides the canvas width
  const legendTexts = slices.map(s => legendText(s.label, s.value, diagram.showData))
  const legendTextWidth = legendTexts.reduce(
    (max, text) => Math.max(max, estimateTextWidth(text, P.legendFontSize, P.legendFontWeight)),
    0,
  )
  const legendWidth = legendTexts.length > 0
    ? P.swatchSize + P.swatchGap + legendTextWidth
    : 0
  const legendHeight = legendTexts.length * P.legendRowHeight

  const contentHeight = Math.max(diameter, legendHeight)
  const width = P.padding * 2 + diameter + (legendWidth > 0 ? P.legendGap + legendWidth : 0)
  const height = P.padding * 2 + titleHeight + contentHeight

  const cx = P.padding + P.radius
  const cy = P.padding + titleHeight + contentHeight / 2

  const positionedSlices = layoutSlices(slices, total, cx, cy)
  const legend = layoutLegend(
    legendTexts,
    P.padding + diameter + P.legendGap,
    P.padding + titleHeight + contentHeight / 2 - legendHeight / 2,
  )

  return {
    width: Math.round(width),
    height: Math.round(height),
    title: diagram.title
      ? { text: diagram.title, x: width / 2, y: P.padding + P.titleHeight / 2 }
      : undefined,
    center: { cx, cy, radius: P.radius },
    slices: positionedSlices,
    legend,
  }
}

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

/**
 * Turn slice values into wedge paths. A zero total (or a single slice) is
 * drawn as one full circle, because an arc of exactly 360° collapses to a
 * point in SVG path syntax.
 */
function layoutSlices(
  slices: readonly { label: string; value: number }[],
  total: number,
  cx: number,
  cy: number,
): PositionedSlice[] {
  const out: PositionedSlice[] = []
  const drawn = slices.filter(s => total <= 0 || s.value > 0)
  const fullCircle = drawn.length === 1

  let angle = 0
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!
    const fraction = total > 0 ? slice.value / total : 1 / Math.max(1, slices.length)

    // A zero-value slice has no wedge, but keeps its legend row
    if (total > 0 && slice.value === 0) {
      out.push({
        label: slice.label,
        value: slice.value,
        fraction: 0,
        path: '',
        colorIndex: i,
      })
      continue
    }

    const sweep = fraction * 360
    const path = fullCircle
      ? circlePath(cx, cy, P.radius)
      : wedgePath(cx, cy, P.radius, angle, angle + sweep)

    const mid = angle + sweep / 2
    const labelRadius = P.radius * P.percentRadiusRatio
    const percentLabel = sweep >= P.minLabelAngle
      ? {
          text: formatPercent(fraction),
          x: cx + Math.sin(toRad(mid)) * labelRadius,
          y: cy - Math.cos(toRad(mid)) * labelRadius,
        }
      : undefined

    out.push({
      label: slice.label,
      value: slice.value,
      fraction,
      path,
      colorIndex: i,
      percentLabel,
    })

    angle += sweep
  }

  return out
}

/** Wedge from `startAngle` to `endAngle`, both measured clockwise from 12 o'clock. */
function wedgePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const [x1, y1] = pointOnCircle(cx, cy, radius, startAngle)
  const [x2, y2] = pointOnCircle(cx, cy, radius, endAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return (
    `M${round(cx)},${round(cy)} L${round(x1)},${round(y1)} ` +
    `A${radius},${radius} 0 ${largeArc} 1 ${round(x2)},${round(y2)} Z`
  )
}

/** A full circle as two half arcs — a single 360° arc would render as nothing. */
function circlePath(cx: number, cy: number, radius: number): string {
  return (
    `M${round(cx)},${round(cy - radius)} ` +
    `A${radius},${radius} 0 1 1 ${round(cx)},${round(cy + radius)} ` +
    `A${radius},${radius} 0 1 1 ${round(cx)},${round(cy - radius)} Z`
  )
}

function pointOnCircle(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + Math.sin(toRad(angle)) * radius, cy - Math.cos(toRad(angle)) * radius]
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function layoutLegend(texts: readonly string[], x: number, top: number): PositionedLegendEntry[] {
  return texts.map((text, i) => {
    const rowCenter = top + i * P.legendRowHeight + P.legendRowHeight / 2
    return {
      text,
      swatch: { x, y: rowCenter - P.swatchSize / 2, size: P.swatchSize },
      labelX: x + P.swatchSize + P.swatchGap,
      labelY: rowCenter,
      colorIndex: i,
    }
  })
}

/** Legend entry text — Mermaid appends the raw value when `showData` is on. */
function legendText(label: string, value: number, showData: boolean): string {
  return showData ? `${label} [${formatValue(value)}]` : label
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Percentage with at most one decimal, trailing `.0` dropped. */
function formatPercent(fraction: number): string {
  const pct = fraction * 100
  const text = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1).replace(/\.0$/, '')
  return `${text}%`
}

/** Values keep their decimals but lose a pointless trailing zero. */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
