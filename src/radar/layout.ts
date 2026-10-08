import type {
  PositionedRadar, PositionedRadarCurve, RadarDiagram, RadarLegendEntry, RadarRing, RadarSpoke,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth } from '../styles.ts'

// ============================================================================
// Radar chart layout engine
//
// Axes are spread evenly around the circle starting at twelve o'clock, so the
// first declared axis points up — which is what makes two radar charts of the
// same data comparable at a glance.
//
// A value maps to a radius linearly between `min` and `max`. When `max` is not
// declared it comes from the data, so a chart is readable without the author
// stating a scale.
// ============================================================================

/** Layout constants. */
const R = {
  /** Outer radius of the plot */
  radius: 150,
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  axisFontSize: 12,
  axisFontWeight: 500,
  /** Gap between the outer ring and an axis label */
  axisLabelGap: 14,
  legendFontSize: 12,
  legendFontWeight: 500,
  /** Gap between the plot and the legend column */
  legendGap: 28,
  legendRowHeight: 22,
  legendSwatch: 11,
  legendTextGap: 8,
  /**
   * Curve smoothing for the circle graticule, as a fraction of the distance
   * between neighbouring points. Mermaid's own default.
   */
  curveTension: 0.17,
} as const

/**
 * Lay out a parsed radar chart: place the axes around the circle, map each
 * curve's values onto radii, and build the background grid.
 */
export function layoutRadar(diagram: RadarDiagram, _options: RenderOptions = {}): PositionedRadar {
  const { axes, curves, options } = diagram
  const hasTitle = !!diagram.title
  const axisCount = axes.length

  const { min, max } = valueDomain(diagram)

  // ---- canvas ------------------------------------------------------------
  // Axis labels stick out past the rings, so the plot is inset by the widest
  const labelOverhang = axes.reduce(
    (widest, axis) =>
      Math.max(widest, estimateTextWidth(axis.label, R.axisFontSize, R.axisFontWeight)),
    0,
  )
  const plotExtent = R.radius + R.axisLabelGap + labelOverhang

  const legendEntries = options.showLegend ? curves : []
  const legendWidth = legendEntries.length === 0
    ? 0
    : R.legendGap + R.legendSwatch + R.legendTextGap + legendEntries.reduce(
        (widest, curve) =>
          Math.max(widest, estimateTextWidth(curve.label, R.legendFontSize, R.legendFontWeight)),
        0,
      )

  const cx = R.padding + plotExtent
  const cy = R.padding + (hasTitle ? R.titleHeight : 0) + plotExtent

  const width = cx + plotExtent + legendWidth + R.padding
  const height = cy + plotExtent + R.padding

  /** Angle of axis `i`, in radians, measured from twelve o'clock. */
  const angleOf = (i: number) => (i / Math.max(1, axisCount)) * Math.PI * 2 - Math.PI / 2

  /** Radius for a value, clipped to the domain. */
  const radiusOf = (value: number) => relativeRadius(value, min, max, R.radius)

  // ---- background grid ---------------------------------------------------
  const rings: RadarRing[] = []
  for (let tick = 1; tick <= options.ticks; tick++) {
    const fraction = tick / options.ticks
    const ringRadius = R.radius * fraction

    rings.push({
      path: options.graticule === 'polygon' && axisCount >= 3
        ? polygonPath(cx, cy, ringRadius, axisCount, angleOf)
        : circlePath(cx, cy, ringRadius),
      value: min + (max - min) * fraction,
      outer: tick === options.ticks,
    })
  }

  // ---- spokes and axis labels --------------------------------------------
  const spokes: RadarSpoke[] = axes.map((axis, i) => {
    const angle = angleOf(i)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const labelRadius = R.radius + R.axisLabelGap

    return {
      x1: cx,
      y1: cy,
      x2: cx + cos * R.radius,
      y2: cy + sin * R.radius,
      label: axis.label,
      labelX: cx + cos * labelRadius,
      labelY: cy + sin * labelRadius,
      // A label to the left of the centre reads outwards only if it ends there
      labelAnchor: anchorFor(cos),
    }
  })

  // ---- curves ------------------------------------------------------------
  const positionedCurves: PositionedRadarCurve[] = curves.map((curve, index) => {
    const points = curve.entries.map((value, i) => {
      const angle = angleOf(i)
      const r = radiusOf(value)
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        value,
        axis: axes[i]?.label ?? '',
      }
    })

    return {
      name: curve.name,
      label: curve.label,
      // A polygon graticule gets straight edges so the curve matches the grid
      path: points.length === 0
        ? ''
        : options.graticule === 'polygon'
          ? straightPath(points)
          : closedRoundCurve(points, R.curveTension),
      points,
      colorIndex: index,
    }
  })

  // ---- legend ------------------------------------------------------------
  const legendX = cx + plotExtent + R.legendGap
  const legendTop = cy - (legendEntries.length * R.legendRowHeight) / 2

  const legend: RadarLegendEntry[] = legendEntries.map((curve, i) => {
    const rowY = legendTop + i * R.legendRowHeight + R.legendRowHeight / 2
    return {
      label: curve.label,
      x: legendX,
      y: rowY - R.legendSwatch / 2,
      labelX: legendX + R.legendSwatch + R.legendTextGap,
      labelY: rowY,
      colorIndex: i,
    }
  })

  return {
    width: Math.round(width),
    height: Math.round(height),
    title: diagram.title
      ? { text: diagram.title, x: width / 2, y: R.padding + R.titleFontSize }
      : undefined,
    center: { cx, cy, radius: R.radius },
    graticule: options.graticule,
    rings,
    spokes,
    curves: positionedCurves,
    legend,
  }
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

/**
 * Radius for a value on a linear scale, clipped to [minValue, maxValue].
 *
 * Exported because it is the one piece of radar arithmetic worth testing on
 * its own, and upstream tests it the same way.
 */
export function relativeRadius(
  value: number,
  minValue: number,
  maxValue: number,
  radius: number,
): number {
  const clipped = Math.min(Math.max(value, minValue), maxValue)
  const span = maxValue - minValue
  // A zero span would divide by zero; everything sits at the centre instead
  if (span === 0) return 0
  return (radius * (clipped - minValue)) / span
}

/**
 * Value range of the chart.
 *
 * `max` comes from the data when the diagram did not declare one, and the
 * range is widened if it would otherwise be empty.
 */
function valueDomain(diagram: RadarDiagram): { min: number; max: number } {
  const { min } = diagram.options
  const declared = diagram.options.max

  if (declared !== null) {
    return { min, max: declared > min ? declared : min + 1 }
  }

  const values = diagram.curves.flatMap(c => c.entries)
  const dataMax = values.length > 0 ? Math.max(...values) : min + 1

  return { min, max: dataMax > min ? dataMax : min + 1 }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * A closed Catmull-Rom spline through the points.
 *
 * Each segment's control points are derived from its neighbours, with the
 * list treated as a ring so the curve closes smoothly instead of showing a
 * corner at the first axis.
 */
export function closedRoundCurve(
  points: readonly { x: number; y: number }[],
  tension: number,
): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M${f(points[0]!.x)},${f(points[0]!.y)} Z`

  let d = `M${f(points[0]!.x)},${f(points[0]!.y)}`

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!
    const p1 = points[i]!
    const p2 = points[(i + 1) % n]!
    const p3 = points[(i + 2) % n]!

    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension

    d += ` C${f(cp1x)},${f(cp1y)} ${f(cp2x)},${f(cp2y)} ${f(p2.x)},${f(p2.y)}`
  }

  return `${d} Z`
}

/** A closed polyline through the points. */
function straightPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  return `M${f(first!.x)},${f(first!.y)} ${rest.map(p => `L${f(p.x)},${f(p.y)}`).join(' ')} Z`
}

/** A full circle as a path, so rings and curves share one element type. */
function circlePath(cx: number, cy: number, radius: number): string {
  return (
    `M${f(cx - radius)},${f(cy)} ` +
    `a${f(radius)},${f(radius)} 0 1 0 ${f(radius * 2)},0 ` +
    `a${f(radius)},${f(radius)} 0 1 0 ${f(-radius * 2)},0 Z`
  )
}

/** A regular polygon with one vertex per axis. */
function polygonPath(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  angleOf: (i: number) => number,
): string {
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = angleOf(i)
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
  })
  return straightPath(points)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Text anchor for a label at a given horizontal direction. */
function anchorFor(cos: number): 'start' | 'middle' | 'end' {
  if (cos > 0.1) return 'start'
  if (cos < -0.1) return 'end'
  return 'middle'
}

function f(n: number): number {
  return Math.round(n * 100) / 100
}
