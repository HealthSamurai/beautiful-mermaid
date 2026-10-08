// ============================================================================
// Pie chart types
//
// Models the parsed and positioned representations of a Mermaid `pie`
// diagram: an ordered list of labelled slices plus an optional `showData`
// flag that appends the raw value to each legend entry.
//
// Mermaid keeps slices in declaration order (not sorted by size), and so do
// we — the order decides both the sweep direction and the palette index.
// ============================================================================

// ============================================================================
// Parsed pie — logical structure from mermaid text
// ============================================================================

/** Parsed pie diagram. */
export interface PieDiagram {
  /** Optional diagram title */
  title?: string
  /** When true, each legend entry shows the slice value next to its label */
  showData: boolean
  /** Slices in source order */
  slices: PieSlice[]
  /**
   * Where percentage labels sit along the radius, 0 (centre) to 1 (edge).
   *
   * Set from `config.pie.textPosition` in a frontmatter or init block; left
   * undefined the layout uses its own default.
   */
  textPosition?: number
}

/** One labelled slice. */
export interface PieSlice {
  /** Slice label (the quoted text before the `:`) */
  label: string
  /** Slice value — always >= 0, Mermaid rejects negatives */
  value: number
}

// ============================================================================
// Positioned pie — ready for SVG rendering
// ============================================================================

export interface PositionedPie {
  width: number
  height: number
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** Circle centre and radius shared by every slice */
  center: { cx: number; cy: number; radius: number }
  /** Slice arcs in source order */
  slices: PositionedSlice[]
  /** Legend rows to the right of the circle */
  legend: PositionedLegendEntry[]
}

export interface PositionedSlice {
  /** Slice label, for the accessible `<title>` child */
  label: string
  /** Raw value, for the accessible `<title>` child */
  value: number
  /** Share of the total, 0..1 — used for the percentage label */
  fraction: number
  /** SVG path `d` for the wedge (or the full circle when there is one slice) */
  path: string
  /** Palette index — same generator as xychart series */
  colorIndex: number
  /** Percentage label placed inside the wedge, omitted for very thin slices */
  percentLabel?: { text: string; x: number; y: number }
}

export interface PositionedLegendEntry {
  /** Legend text — the label, plus the value when `showData` is on */
  text: string
  /** Swatch rectangle */
  swatch: { x: number; y: number; size: number }
  /** Text anchor, vertically centred on the swatch */
  labelX: number
  labelY: number
  /** Palette index matching the slice */
  colorIndex: number
}
