// ============================================================================
// Mindmap types
//
// Models the parsed and positioned representations of a Mermaid `mindmap`:
// a single root with a tree of children, where nesting comes from source
// indentation rather than from explicit edges.
//
// Unlike every other diagram here, a mindmap is indentation-sensitive, so its
// parser takes raw (untrimmed) lines.
// ============================================================================

/**
 * Node shape, from the bracket pair around the label.
 *
 *   default  — bare text, no brackets
 *   rect     — [text]
 *   rounded  — (text)
 *   circle   — ((text))
 *   cloud    — )text(
 *   bang     — ))text((
 *   hexagon  — {{text}}
 */
export type MindmapNodeShape =
  | 'default'
  | 'rect'
  | 'rounded'
  | 'circle'
  | 'cloud'
  | 'bang'
  | 'hexagon'

// ============================================================================
// Parsed mindmap — logical structure from mermaid text
// ============================================================================

/** Parsed mindmap diagram. */
export interface MindmapDiagram {
  /** The single root node, or undefined for an empty mindmap */
  root?: MindmapNode
}

/** One node of the tree. */
export interface MindmapNode {
  /** Explicit id when the source gave one, else the label text */
  nodeId: string
  /** Display label */
  descr: string
  /** Shape derived from the bracket pair */
  shape: MindmapNodeShape
  /** Nesting depth — 0 for the root */
  level: number
  /** Child nodes in source order */
  children: MindmapNode[]
  /** Class names from a `:::class1 class2` line, when present */
  class?: string
  /** Icon name from an `::icon(name)` line, when present */
  icon?: string
}

// ============================================================================
// Positioned mindmap — ready for SVG rendering
// ============================================================================

export interface PositionedMindmap {
  width: number
  height: number
  /** Nodes in draw order (parents before children) */
  nodes: PositionedMindmapNode[]
  /** Curved connectors from each parent to each child */
  edges: MindmapEdge[]
}

export interface PositionedMindmapNode {
  /** Display label, wrapped to the node box */
  lines: string[]
  /** Raw label, for the accessible <title> child */
  label: string
  /** Node id, emitted as a data attribute */
  nodeId: string
  shape: MindmapNodeShape
  level: number
  /** Node box */
  x: number
  y: number
  width: number
  height: number
  /** Label anchor, centred in the box */
  labelX: number
  labelY: number
  /** Palette index — one colour per top-level branch */
  colorIndex: number
  /** Class names for host-page styling, when the source set any */
  class?: string
  /** Icon name, rendered as a text prefix when present */
  icon?: string
}

export interface MindmapEdge {
  /** Cubic bezier path from the parent box edge to the child box edge */
  path: string
  /** Palette index of the branch this edge belongs to */
  colorIndex: number
}
