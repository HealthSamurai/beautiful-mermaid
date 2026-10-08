// ============================================================================
// Sankey diagram types
//
// Models the parsed and positioned representations of a Mermaid `sankey`
// diagram: a flow graph given as CSV rows of `source,target,value`, drawn as
// ribbons whose thickness is proportional to the value they carry.
//
// Nodes are implicit — they exist because a link mentions them — and are
// assigned to columns by how far they are from a source node.
// ============================================================================

// ============================================================================
// Parsed sankey — logical structure from mermaid text
// ============================================================================

/** Parsed sankey diagram. */
export interface SankeyDiagram {
  /** Every node mentioned by a link, in first-appearance order */
  nodes: SankeyNode[]
  /** Links in source order */
  links: SankeyLink[]
}

/** A node, identified by the label the CSV used. */
export interface SankeyNode {
  id: string
}

/** One flow from a source node to a target node. */
export interface SankeyLink {
  source: string
  target: string
  /** Flow magnitude — sets the ribbon thickness */
  value: number
}

// ============================================================================
// Positioned sankey — ready for SVG rendering
// ============================================================================

export interface PositionedSankey {
  width: number
  height: number
  /** Node bars, grouped into columns by depth */
  nodes: PositionedSankeyNode[]
  /** Flow ribbons, drawn behind the bars */
  links: PositionedSankeyLink[]
}

export interface PositionedSankeyNode {
  id: string
  /** Column index, 0 for a pure source */
  depth: number
  /** Node bar */
  x: number
  y: number
  width: number
  height: number
  /** Total flow through this node — max(in, out) */
  value: number
  /** Label anchor, outside the bar on whichever side has room */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'end'
  /** Palette index — one colour per node */
  colorIndex: number
}

export interface PositionedSankeyLink {
  source: string
  target: string
  value: number
  /** Filled ribbon path from the source bar to the target bar */
  path: string
  /** Ribbon thickness, proportional to the value */
  thickness: number
  /** Palette index, inherited from the source node */
  colorIndex: number
}
