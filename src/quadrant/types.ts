// ============================================================================
// Quadrant chart types
//
// Models the parsed and positioned representations of a Mermaid
// `quadrantChart`: labelled points scattered in the unit square, split into
// four named quadrants by a crosshair at (0.5, 0.5).
//
// Quadrant numbering follows Mermaid, which follows the maths convention —
// quadrant 1 is top-right and they run anticlockwise:
//
//      quadrant-2 │ quadrant-1
//      ───────────┼───────────
//      quadrant-3 │ quadrant-4
// ============================================================================

// ============================================================================
// Parsed quadrant chart — logical structure from mermaid text
// ============================================================================

/** Parsed quadrant chart. */
export interface QuadrantDiagram {
  /** Optional diagram title */
  title?: string
  /** Axis end labels */
  xAxis: QuadrantAxis
  yAxis: QuadrantAxis
  /** Quadrant labels, indexed by Mermaid's 1-4 numbering */
  quadrants: QuadrantLabels
  /** Points in source order */
  points: QuadrantPoint[]
}

/**
 * Labels at the two ends of an axis. For x these read left → right, for y
 * bottom → top, matching the `a --> b` source order.
 */
export interface QuadrantAxis {
  /** Left end (x) or bottom end (y) */
  start?: string
  /** Right end (x) or top end (y) */
  end?: string
}

/** The four quadrant labels, any of which may be absent. */
export interface QuadrantLabels {
  /** Top-right */
  q1?: string
  /** Top-left */
  q2?: string
  /** Bottom-left */
  q3?: string
  /** Bottom-right */
  q4?: string
}

/** One labelled point in the unit square. */
export interface QuadrantPoint {
  /** Point label */
  label: string
  /** Horizontal position, 0..1 */
  x: number
  /** Vertical position, 0..1 — 1 is the top of the chart */
  y: number
  /** Class name from `label:::className`, empty when absent */
  className: string
  /** Inline style overrides from a trailing `radius: 8, color: #f00` list */
  styles: QuadrantPointStyles
}

/** Per-point style overrides. All fields are optional. */
export interface QuadrantPointStyles {
  /** Marker radius in pixels */
  radius?: number
  /** Marker fill, a 3- or 6-digit hex colour */
  color?: string
  /** Marker stroke, a 3- or 6-digit hex colour */
  strokeColor?: string
  /** Marker stroke width, e.g. `2px` */
  strokeWidth?: string
}

// ============================================================================
// Positioned quadrant chart — ready for SVG rendering
// ============================================================================

export interface PositionedQuadrantChart {
  width: number
  height: number
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** The plot square the points live in */
  plot: { x: number; y: number; width: number; height: number }
  /** The four quadrant backgrounds with their labels */
  quadrants: PositionedQuadrant[]
  /** The crosshair splitting the plot into quadrants */
  crosshair: {
    vertical: { x: number; y1: number; y2: number }
    horizontal: { y: number; x1: number; x2: number }
  }
  /** Axis end labels around the plot */
  axisLabels: PositionedAxisLabel[]
  /** Scattered points */
  points: PositionedQuadrantPoint[]
}

export interface PositionedQuadrant {
  /** Mermaid's quadrant number, 1-4 */
  number: 1 | 2 | 3 | 4
  /** Quadrant label ('' when unnamed — then no label is drawn) */
  title: string
  /** Background rectangle */
  rect: { x: number; y: number; width: number; height: number }
  /** Label anchor, centred in the quadrant */
  labelX: number
  labelY: number
  /** Palette index — same generator as xychart series */
  colorIndex: number
}

export interface PositionedQuadrantPoint {
  /** Point label */
  label: string
  /** Marker centre */
  cx: number
  cy: number
  radius: number
  /** Label anchor, to the right of the marker */
  labelX: number
  labelY: number
  /** Raw data coordinates, for the accessible <title> child */
  dataX: number
  dataY: number
  /** Resolved inline styles, empty when the point uses theme defaults */
  styles: QuadrantPointStyles
  /** Class name, emitted as an extra CSS class for host-page styling */
  className: string
}

export interface PositionedAxisLabel {
  text: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  /** Which axis end this labels, for the CSS class */
  side: 'left' | 'right' | 'top' | 'bottom'
}
