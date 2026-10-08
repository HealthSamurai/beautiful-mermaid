// ============================================================================
// Block diagram types
//
// Models the parsed and positioned representations of a Mermaid `block-beta`
// diagram: a grid of blocks placed in reading order across a fixed number of
// columns, with optional nesting and arrows between blocks.
//
// Unlike a flowchart, placement is NOT computed from the edges — the author
// controls it directly through `columns N`, block widths and `space`. Edges
// are drawn between wherever the grid put the blocks.
// ============================================================================

/**
 * Block shape, from the bracket pair around its label.
 *
 *   na              — bare id, no brackets
 *   square          — [label]
 *   round           — (label)
 *   circle          — ((label))
 *   doublecircle    — ((( label )))
 *   diamond         — {label}
 *   hexagon         — {{label}}
 *   stadium         — ([label])
 *   subroutine      — [[label]]
 *   cylinder        — [(label)]
 *   lean_right      — [/label/]
 *   lean_left       — [\label\]
 *   trapezoid       — [/label\]
 *   inv_trapezoid   — [\label/]
 *   block_arrow     — <[label]>(direction)
 *   composite       — a block holding other blocks
 *   space           — a deliberate gap in the grid
 */
export type BlockShape =
  | 'na' | 'square' | 'round' | 'circle' | 'doublecircle'
  | 'diamond' | 'hexagon' | 'stadium' | 'subroutine' | 'cylinder'
  | 'lean_right' | 'lean_left' | 'trapezoid' | 'inv_trapezoid'
  | 'block_arrow' | 'composite' | 'space'

/** Direction an arrow block points in. */
export type BlockArrowDirection = 'up' | 'down' | 'left' | 'right' | 'x' | 'y'

/** Edge line style. */
export type BlockEdgeStyle = 'normal' | 'thick' | 'dotted'

// ============================================================================
// Parsed block diagram — logical structure from mermaid text
// ============================================================================

/** Parsed block diagram. */
export interface BlockDiagram {
  /** Optional diagram title */
  title?: string
  /** Top-level blocks in source order */
  blocks: Block[]
  /**
   * Column count for the root level.
   *
   * `-1` means "auto": both an absent `columns` statement and `columns auto`
   * produce it, matching Mermaid, and the layout then uses one column per
   * block so a bare list reads as a row.
   */
  columns: number
  /** Edges in source order */
  edges: BlockEdge[]
  /** classDef definitions by name */
  classes: Map<string, BlockClassDef>
}

/** One block, possibly holding others. */
export interface Block {
  /** Block id — explicit, or generated for an anonymous composite or space */
  id: string
  /** Display label — defaults to the id, empty for a space or bare composite */
  label: string
  shape: BlockShape
  /** How many grid columns this block spans (`id["x"]:2`) */
  widthInColumns: number
  /** Nested blocks, empty for a leaf */
  children: Block[]
  /** Column count for this block's own children, `-1` for auto */
  columns: number
  /** Directions an arrow block points in, empty otherwise */
  directions: BlockArrowDirection[]
  /** Class names attached via `class` or `:::` */
  classes: string[]
  /** Inline style declarations from a `style` statement */
  styles: string[]
}

/** An arrow between two blocks. */
export interface BlockEdge {
  /** Source block id */
  start: string
  /** Target block id */
  end: string
  /** Edge label, when one was written */
  label?: string
  style: BlockEdgeStyle
  /** True when the edge has an arrowhead at its target */
  arrowEnd: boolean
  /** True when the edge also has an arrowhead at its source */
  arrowStart: boolean
}

/** A `classDef` definition. */
export interface BlockClassDef {
  id: string
  /** Raw `prop:value` declarations in source order */
  styles: string[]
}

// ============================================================================
// Positioned block diagram — ready for SVG rendering
// ============================================================================

export interface PositionedBlockDiagram {
  width: number
  height: number
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** Blocks in draw order — a parent always precedes its children */
  blocks: PositionedBlock[]
  /** Arrow connectors between blocks */
  edges: PositionedBlockEdge[]
}

export interface PositionedBlock {
  id: string
  label: string
  shape: BlockShape
  x: number
  y: number
  width: number
  height: number
  /** Nesting depth — 0 for a top-level block */
  depth: number
  /** Label anchor, centred in the block (at the top for a composite) */
  labelX: number
  labelY: number
  /** Wrapped label lines */
  lines: string[]
  /** Arrow directions for a block_arrow shape */
  directions: BlockArrowDirection[]
  /** Class names, emitted as extra CSS classes */
  classes: string[]
  /** Inline style string, when the block had a `style` statement */
  style?: string
  /** Palette index — one colour per top-level branch of the grid */
  colorIndex: number
}

export interface PositionedBlockEdge {
  /** Connector path */
  path: string
  /** Edge label and its anchor, when the edge has one */
  label?: { text: string; x: number; y: number; width: number; height: number }
  style: BlockEdgeStyle
  arrowEnd: boolean
  arrowStart: boolean
}
