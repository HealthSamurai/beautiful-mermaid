// ============================================================================
// Radar chart types
//
// Models the parsed and positioned representations of a Mermaid `radar-beta`
// diagram: several named curves plotted against a shared set of axes radiating
// from a common centre.
//
//   radar-beta
//     axis A["Speed"], B["Power"], C["Range"]
//     curve prototype["Prototype"]{1, 2, 3}
//     curve shipped{3, 2, 1}
//
// Every curve has one entry per axis, which is what makes the shapes
// comparable — the point of the chart.
// ============================================================================

/** Background grid style: concentric rings or straight-sided polygons. */
export type RadarGraticule = 'circle' | 'polygon'

// ============================================================================
// Parsed radar chart — logical structure from mermaid text
// ============================================================================

/** Parsed radar chart. */
export interface RadarDiagram {
  /** Optional diagram title */
  title?: string
  /** Axes in declaration order — they fix the angle of every curve point */
  axes: RadarAxis[]
  /** Curves in declaration order */
  curves: RadarCurve[]
  /** Display options, defaulted to Mermaid's own values */
  options: RadarOptions
}

/** One axis of the chart. */
export interface RadarAxis {
  /** Axis id, used to address a value in the `{ A: 1 }` curve form */
  name: string
  /** Display label — defaults to the name */
  label: string
}

/** One plotted curve. */
export interface RadarCurve {
  /** Curve id */
  name: string
  /** Display label — defaults to the name */
  label: string
  /** One value per axis, in axis order */
  entries: number[]
}

/** Display options from the `ticks` / `graticule` / `min` / `max` statements. */
export interface RadarOptions {
  /** Number of grid rings. Capped, since a huge count is a denial of service */
  ticks: number
  graticule: RadarGraticule
  /** Whether to draw the curve legend */
  showLegend: boolean
  /** Value at the centre of the chart */
  min: number
  /**
   * Value at the outer edge.
   *
   * `null` means "take it from the data", which is Mermaid's default and
   * what makes a chart readable without the author stating a scale.
   */
  max: number | null
}

// ============================================================================
// Positioned radar chart — ready for SVG rendering
// ============================================================================

export interface PositionedRadar {
  width: number
  height: number
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** Chart centre and outer radius */
  center: { cx: number; cy: number; radius: number }
  graticule: RadarGraticule
  /** Background grid rings, outermost last */
  rings: RadarRing[]
  /** Spokes from the centre to each axis label */
  spokes: RadarSpoke[]
  /** Curves in draw order */
  curves: PositionedRadarCurve[]
  /** Legend rows, empty when the legend is switched off */
  legend: RadarLegendEntry[]
}

export interface RadarRing {
  /** Ring outline — a circle path or a polygon path */
  path: string
  /** Value this ring represents */
  value: number
  /** True for the outermost ring, which is drawn more strongly */
  outer: boolean
}

export interface RadarSpoke {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Axis label and its anchor outside the chart */
  label: string
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
}

export interface PositionedRadarCurve {
  name: string
  label: string
  /** Closed outline of the curve */
  path: string
  /** Vertices, so each data point can carry a dot and a tooltip */
  points: { x: number; y: number; value: number; axis: string }[]
  /** Palette index — one colour per curve */
  colorIndex: number
}

export interface RadarLegendEntry {
  label: string
  /** Swatch position */
  x: number
  y: number
  /** Label anchor, to the right of the swatch */
  labelX: number
  labelY: number
  colorIndex: number
}
