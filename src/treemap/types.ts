// ============================================================================
// Treemap types
//
// Models the parsed and positioned representations of a Mermaid `treemap`:
// a hierarchy whose leaves carry values, drawn as nested rectangles whose
// areas are proportional to those values.
//
// Like a mindmap, the hierarchy comes from source indentation, so the parser
// takes raw lines.
// ============================================================================

// ============================================================================
// Parsed treemap — logical structure from mermaid text
// ============================================================================

/** Parsed treemap diagram. */
export interface TreemapDiagram {
  /** Optional heading, from `title` or from frontmatter */
  title?: string
  /** Top-level nodes in source order */
  nodes: TreemapNode[]
  /** `classDef` declarations, by class name */
  classes: Map<string, string>
  /** Show each leaf's value under its name — `config.treemap.showValues` */
  showValues?: boolean
  /** Value format from `config.treemap.valueFormat` */
  valueFormat?: string
}

/**
 * One node of the hierarchy.
 *
 * A node is a leaf when the source gave it a value, and a section otherwise.
 * A section's value is the sum of its descendants, computed during layout —
 * a treemap whose parents did not equal their children would be a lie about
 * the proportions it is drawing.
 */
export interface TreemapNode {
  name: string
  /** Declared value — leaves only */
  value?: number
  /** Child nodes in source order — sections only */
  children: TreemapNode[]
  /** Class name from a `:::className` suffix, when present */
  classSelector?: string
}

// ============================================================================
// Positioned treemap — ready for SVG rendering
// ============================================================================

export interface PositionedTreemap {
  width: number
  height: number
  /** Every cell in draw order (sections before the leaves inside them) */
  cells: TreemapCell[]
  /** Title anchor, when the diagram has one */
  title?: { text: string; x: number; y: number }
}

export interface TreemapCell {
  name: string
  /**
   * Summed value of this cell — a leaf's own, or the total of its subtree.
   * This is what the cell's area is proportional to.
   */
  value: number
  /** Whether the cell has children, which decides how it is drawn */
  isSection: boolean
  /** Nesting depth — 0 for a top-level node */
  depth: number
  /** Cell box */
  x: number
  y: number
  width: number
  height: number
  /** Label lines, wrapped to the cell, empty when the cell is too small */
  lines: string[]
  /** Label anchor */
  labelX: number
  labelY: number
  /** Formatted value, placed under the label — leaves only, when shown */
  valueText?: string
  valueX?: number
  valueY?: number
  /** Palette index — one colour per top-level branch */
  colorIndex: number
  /** Inline CSS compiled from the node's `classDef`, when it has one */
  style?: string
  /** Class name, emitted so a host page can target the cell */
  classSelector?: string
}
