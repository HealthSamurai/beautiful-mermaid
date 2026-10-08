import type {
  Block, BlockDiagram, PositionedBlock, PositionedBlockDiagram, PositionedBlockEdge,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth } from '../styles.ts'

// ============================================================================
// Block diagram layout engine
//
// A grid, placed in reading order: each block takes the next free slot of the
// current row, wrapping when the row is full. A block may span several columns
// and `space` claims slots without drawing anything.
//
// Composites are laid out recursively: the children are placed in their own
// grid, and the parent is sized to fit them plus a title strip.
//
// Nothing here is derived from the edges — the author placed the blocks, and
// edges are routed between wherever the grid put them. That is the whole point
// of the type: a block diagram says "these things sit next to each other",
// where a flowchart says "these things connect".
// ============================================================================

/** Layout constants. */
const B = {
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  /** Width of one grid column, before any span */
  cellWidth: 140,
  /**
   * Width a single block may grow to for its label before the text wraps
   * instead. Without a cap one long label would stretch the whole diagram.
   */
  maxCellWidth: 260,
  /** Height of one grid row */
  cellHeight: 56,
  /** Gap between adjacent cells */
  gap: 12,
  labelFontSize: 13,
  labelFontWeight: 500,
  /** Max label lines before the text is clipped */
  maxLines: 3,
  lineHeight: 16,
  /** Horizontal padding inside a block before its label */
  labelPadX: 10,
  /** Height of a composite's title strip */
  compositeTitleHeight: 24,
  /** Inner padding of a composite around its children */
  compositePad: 12,
  edgeLabelFontSize: 11,
  edgeLabelFontWeight: 500,
  edgeLabelPadX: 5,
  edgeLabelHeight: 16,
} as const

/**
 * Lay out a parsed block diagram by placing every block on a grid and routing
 * the edges between the resulting rectangles.
 */
export function layoutBlockDiagram(
  diagram: BlockDiagram,
  _options: RenderOptions = {},
): PositionedBlockDiagram {
  const hasTitle = !!diagram.title

  const originX = B.padding
  const originY = B.padding + (hasTitle ? B.titleHeight : 0)

  const blocks: PositionedBlock[] = []
  const bounds = placeGrid(diagram.blocks, diagram.columns, originX, originY, 0, blocks)

  const width = Math.max(bounds.width + B.padding * 2, 200)
  const height = originY + bounds.height + B.padding

  const edges = routeEdges(diagram, blocks)

  return {
    width: Math.round(width),
    height: Math.round(height),
    title: diagram.title
      ? { text: diagram.title, x: width / 2, y: B.padding + B.titleFontSize }
      : undefined,
    blocks,
    edges,
  }
}

// ---------------------------------------------------------------------------
// Grid placement
// ---------------------------------------------------------------------------

/**
 * Place a list of blocks on a grid starting at (originX, originY).
 *
 * @param columns  Column count, or -1 for auto
 * @param out      Collects positioned blocks — a parent before its children,
 *                 so the render order puts composites behind their contents
 * @returns the size the placed grid occupies
 */
function placeGrid(
  children: readonly Block[],
  columns: number,
  originX: number,
  originY: number,
  depth: number,
  out: PositionedBlock[],
): { width: number; height: number } {
  if (children.length === 0) return { width: 0, height: 0 }

  // Auto: one column per block, so a bare list reads as a single row
  const columnCount = columns > 0 ? columns : children.length

  /** Rows of blocks, filled in reading order. */
  const rows: Block[][] = []
  let row: Block[] = []
  let used = 0

  for (const block of children) {
    // A block wider than the whole grid is clamped rather than dropped
    const span = Math.min(Math.max(1, block.widthInColumns), columnCount)

    if (used + span > columnCount && row.length > 0) {
      rows.push(row)
      row = []
      used = 0
    }

    row.push(block)
    used += span
  }
  if (row.length > 0) rows.push(row)

  // Each row is as tall as its tallest member, which is what lets a composite
  // sit beside a plain block without either being cropped
  let y = originY
  let maxRight = originX

  for (const currentRow of rows) {
    const heights = currentRow.map(block => intrinsicHeight(block))
    const rowHeight = Math.max(B.cellHeight, ...heights)

    let x = originX
    for (const block of currentRow) {
      const span = Math.min(Math.max(1, block.widthInColumns), columnCount)
      const cellWidth = span * B.cellWidth + (span - 1) * B.gap
      const blockWidth = Math.max(cellWidth, intrinsicWidth(block))

      if (block.shape !== 'space') {
        placeBlock(block, x, y, blockWidth, rowHeight, depth, out)
      }

      x += blockWidth + B.gap
      maxRight = Math.max(maxRight, x - B.gap)
    }

    y += rowHeight + B.gap
  }

  return {
    width: maxRight - originX,
    height: Math.max(0, y - B.gap - originY),
  }
}

/** Position one block, recursing into a composite's children. */
function placeBlock(
  block: Block,
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number,
  out: PositionedBlock[],
): void {
  const isComposite = block.children.length > 0
  const labelLines = block.label
    ? wrap(block.label, width - B.labelPadX * 2)
    : []

  // A composite labels its title strip; a leaf centres its label
  const labelY = isComposite
    ? y + B.compositeTitleHeight / 2
    : y + height / 2 - ((labelLines.length - 1) * B.lineHeight) / 2

  out.push({
    id: block.id,
    label: block.label,
    shape: block.shape,
    x, y, width, height,
    depth,
    labelX: x + width / 2,
    labelY,
    lines: labelLines,
    directions: block.directions,
    classes: block.classes,
    style: block.styles.length > 0 ? sanitizeStyle(block.styles) : undefined,
    // Colour by depth, so a nesting level reads as one family
    colorIndex: depth,
  })

  if (!isComposite) return

  placeGrid(
    block.children,
    block.columns,
    x + B.compositePad,
    y + B.compositeTitleHeight + (block.label ? 0 : B.compositePad - B.compositeTitleHeight),
    depth + 1,
    out,
  )
}

/** Width a block needs for its own content, ignoring its grid span. */
function intrinsicWidth(block: Block): number {
  if (block.children.length === 0) {
    const textWidth =
      estimateTextWidth(block.label, B.labelFontSize, B.labelFontWeight) + B.labelPadX * 2
    // Past the cap the label wraps rather than widening the block further
    return Math.min(textWidth, B.maxCellWidth)
  }

  // A composite is as wide as its own grid plus padding
  const columnCount = block.columns > 0 ? block.columns : block.children.length
  const inner = block.children.reduce((max, child) => Math.max(max, intrinsicWidth(child)), 0)
  const cellWidth = Math.max(B.cellWidth, inner)
  return columnCount * cellWidth + (columnCount - 1) * B.gap + B.compositePad * 2
}

/** Height a block needs for its own content. */
function intrinsicHeight(block: Block): number {
  if (block.children.length === 0) {
    // A label that wrapped needs room for the extra lines
    const lines = block.label
      ? wrap(block.label, B.maxCellWidth - B.labelPadX * 2).length
      : 1
    return Math.max(B.cellHeight, lines * B.lineHeight + B.labelPadX * 2)
  }

  const columnCount = block.columns > 0 ? block.columns : block.children.length
  // Rows needed once spans are accounted for
  const slots = block.children.reduce(
    (sum, child) => sum + Math.min(Math.max(1, child.widthInColumns), columnCount),
    0,
  )
  const rowCount = Math.max(1, Math.ceil(slots / columnCount))
  const rowHeight = Math.max(
    B.cellHeight,
    ...block.children.map(child => intrinsicHeight(child)),
  )

  return B.compositeTitleHeight + rowCount * rowHeight + (rowCount - 1) * B.gap + B.compositePad
}

// ---------------------------------------------------------------------------
// Edge routing
// ---------------------------------------------------------------------------

/**
 * Route each edge between the rectangles its endpoints landed on.
 *
 * The connector leaves the side of the source that faces the target, which
 * keeps a horizontal neighbour pair joined side to side and a vertical pair
 * joined top to bottom.
 */
function routeEdges(diagram: BlockDiagram, blocks: PositionedBlock[]): PositionedBlockEdge[] {
  const byId = new Map(blocks.map(b => [b.id, b]))
  const out: PositionedBlockEdge[] = []

  for (const edge of diagram.edges) {
    const from = byId.get(edge.start)
    const to = byId.get(edge.end)
    // An edge to a block that was never placed (e.g. inside a space) is skipped
    if (!from || !to) continue

    const start = anchor(from, to)
    const end = anchor(to, from)

    const midX = (start.x + end.x) / 2
    const midY = (start.y + end.y) / 2

    const horizontal = Math.abs(start.x - end.x) >= Math.abs(start.y - end.y)
    const path = horizontal
      ? `M${r(start.x)},${r(start.y)} C${r(midX)},${r(start.y)} ${r(midX)},${r(end.y)} ${r(end.x)},${r(end.y)}`
      : `M${r(start.x)},${r(start.y)} C${r(start.x)},${r(midY)} ${r(end.x)},${r(midY)} ${r(end.x)},${r(end.y)}`

    const label = edge.label
      ? {
          text: edge.label,
          x: midX,
          y: midY,
          width: estimateTextWidth(edge.label, B.edgeLabelFontSize, B.edgeLabelFontWeight) +
            B.edgeLabelPadX * 2,
          height: B.edgeLabelHeight,
        }
      : undefined

    out.push({ path, label, style: edge.style, arrowEnd: edge.arrowEnd, arrowStart: edge.arrowStart })
  }

  return out
}

/** Point on `from`'s edge that faces `to`. */
function anchor(from: PositionedBlock, to: PositionedBlock): { x: number; y: number } {
  const fromCx = from.x + from.width / 2
  const fromCy = from.y + from.height / 2
  const toCx = to.x + to.width / 2
  const toCy = to.y + to.height / 2

  const dx = toCx - fromCx
  const dy = toCy - fromCy

  // Leave through whichever side the target lies past
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? from.x + from.width : from.x, y: fromCy }
  }
  return { x: fromCx, y: dy >= 0 ? from.y + from.height : from.y }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Greedy word wrap using the DOM-free text metrics, capped at `maxLines`.
 *
 * A single word longer than the width is kept whole rather than broken, since
 * a block label is usually a name that must stay readable.
 */
function wrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  const out: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (estimateTextWidth(candidate, B.labelFontSize, B.labelFontWeight) <= maxWidth || !line) {
      line = candidate
    } else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)

  return out.slice(0, B.maxLines)
}

/**
 * Join style declarations into an inline style string.
 *
 * Anything that could close the attribute or open a tag is dropped, since
 * these declarations come straight from diagram source.
 */
function sanitizeStyle(styles: readonly string[]): string | undefined {
  const safe = styles.filter(s => !/[<>"';]/.test(s))
  return safe.length > 0 ? safe.join(';') : undefined
}

function r(n: number): number {
  return Math.round(n * 10) / 10
}
