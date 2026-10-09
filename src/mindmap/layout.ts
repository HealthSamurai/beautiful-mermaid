import type {
  MindmapDiagram, MindmapEdge, MindmapNode, PositionedMindmap, PositionedMindmapNode,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, wrapText } from '../styles.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'

// ============================================================================
// Mindmap layout engine
//
// A left-to-right tree: depth sets the column, and each subtree gets a block
// of rows tall enough for its leaves. A parent is centred on its children,
// which is the classic tidy-tree arrangement and needs no iteration.
//
// Node boxes are sized from the wrapped label using the DOM-free text
// metrics, so the canvas is known before rendering. Each top-level branch
// gets its own palette index, so a branch reads as one colour family.
// ============================================================================

/** Layout constants. */
const M = {
  padding: 24,
  /** Horizontal gap between a parent box and its children */
  columnGap: 46,
  /** Vertical gap between sibling rows */
  rowGap: 12,
  /** Height of one leaf row, before label wrapping grows it */
  rowHeight: 38,
  fontSize: 13,
  fontWeight: 500,
  rootFontSize: 15,
  rootFontWeight: 600,
  /** Horizontal padding inside a node box */
  padX: 12,
  /** Vertical padding inside a node box */
  padY: 8,
  /** Maximum box width before the label wraps */
  maxBoxWidth: 180,
  /** Maximum lines a label wraps to before it is clipped */
  maxLines: 3,
  /** Extra width reserved for an icon prefix */
  iconWidth: 18,
} as const

/**
 * Lay out a parsed mindmap by assigning each node a column from its depth and
 * a row block sized to its subtree, then centring parents on their children.
 */
export function layoutMindmap(
  diagram: MindmapDiagram,
  _options: RenderOptions = {},
): PositionedMindmap {
  if (!diagram.root) {
    return { width: M.padding * 2, height: M.padding * 2, nodes: [], edges: [] }
  }

  // 1. Measure every node, so column widths and row heights are known
  const measured = measure(diagram.root)

  // 2. Column x offsets come from the widest box at each depth
  const columnWidths = collectColumnWidths(measured)
  const columnX: number[] = []
  let x = M.padding
  for (const width of columnWidths) {
    columnX.push(x)
    x += width + M.columnGap
  }
  const contentWidth = x - M.columnGap

  // 3. Place rows top to bottom, centring each parent on its children
  const nodes: PositionedMindmapNode[] = []
  const edges: MindmapEdge[] = []
  const bottom = place(measured, 0, M.padding, columnX, nodes, edges, 0)

  return {
    width: Math.round(contentWidth + M.padding),
    height: Math.round(bottom + M.padding),
    nodes,
    edges,
  }
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** A node with its box size and wrapped label, plus measured children. */
interface Measured {
  node: MindmapNode
  lines: string[]
  width: number
  height: number
  /** Total height this subtree needs, including sibling gaps */
  subtreeHeight: number
  children: Measured[]
}

/** Recursively size a node and its subtree. */
function measure(node: MindmapNode): Measured {
  const isRoot = node.level === 0
  const fontSize = isRoot ? M.rootFontSize : M.fontSize
  const fontWeight = isRoot ? M.rootFontWeight : M.fontWeight

  const iconSpace = node.icon ? M.iconWidth : 0
  const maxTextWidth = M.maxBoxWidth - M.padX * 2 - iconSpace
  const lines = wrap(node.descr, maxTextWidth, fontSize, fontWeight)

  const textWidth = lines.reduce(
    (max, line) => Math.max(max, estimateTextWidth(line, fontSize, fontWeight)),
    0,
  )
  const width = Math.min(M.maxBoxWidth, textWidth + M.padX * 2 + iconSpace)
  const height = Math.max(M.rowHeight, lines.length * fontSize * LINE_HEIGHT_RATIO + M.padY * 2)

  const children = node.children.map(measure)

  // A subtree is as tall as its children stacked, or its own box, whichever wins
  const childrenHeight = children.length > 0
    ? children.reduce((sum, c) => sum + c.subtreeHeight, 0) + (children.length - 1) * M.rowGap
    : 0
  const subtreeHeight = Math.max(height, childrenHeight)

  return { node, lines, width, height, subtreeHeight, children }
}

/** Widest box at each depth, so columns line up. */
function collectColumnWidths(root: Measured): number[] {
  const widths: number[] = []

  const walk = (m: Measured, depth: number) => {
    widths[depth] = Math.max(widths[depth] ?? 0, m.width)
    for (const child of m.children) walk(child, depth + 1)
  }
  walk(root, 0)

  return widths
}

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

/**
 * Place a subtree starting at `top`, returning the bottom edge it reached.
 * The node itself is centred vertically on the block its children occupy.
 */
function place(
  m: Measured,
  depth: number,
  top: number,
  columnX: readonly number[],
  nodes: PositionedMindmapNode[],
  edges: MindmapEdge[],
  colorIndex: number,
): number {
  const x = columnX[depth] ?? M.padding
  const y = top + (m.subtreeHeight - m.height) / 2

  const isRoot = m.node.level === 0
  const fontSize = isRoot ? M.rootFontSize : M.fontSize
  const lineHeight = fontSize * LINE_HEIGHT_RATIO

  const positioned: PositionedMindmapNode = {
    lines: m.lines,
    label: m.node.descr,
    nodeId: m.node.nodeId,
    shape: m.node.shape,
    level: m.node.level,
    x,
    y,
    width: m.width,
    height: m.height,
    labelX: x + m.width / 2,
    labelY: y + m.height / 2 - ((m.lines.length - 1) * lineHeight) / 2,
    colorIndex,
    class: m.node.class,
    icon: m.node.icon,
  }
  nodes.push(positioned)

  // Children stack within this subtree's block
  let childTop = top
  m.children.forEach((child, i) => {
    // Each top-level branch owns a palette index; deeper nodes inherit it
    const childColor = depth === 0 ? i : colorIndex

    const childX = columnX[depth + 1] ?? x + m.width + M.columnGap
    const childY = childTop + (child.subtreeHeight - child.height) / 2

    edges.push({
      path: edgePath(
        x + m.width, y + m.height / 2,
        childX, childY + child.height / 2,
      ),
      colorIndex: childColor,
    })

    childTop = place(child, depth + 1, childTop, columnX, nodes, edges, childColor) + M.rowGap
  })

  return top + m.subtreeHeight
}

/** A horizontal cubic bezier, flat at both ends so it meets the boxes cleanly. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2
  return `M${round(x1)},${round(y1)} C${round(midX)},${round(y1)} ${round(midX)},${round(y2)} ${round(x2)},${round(y2)}`
}

// ---------------------------------------------------------------------------
// Text wrapping
// ---------------------------------------------------------------------------

/** Wrap a label to the available box width, clipped to maxLines. */
function wrap(text: string, maxWidth: number, fontSize: number, fontWeight: number): string[] {
  return wrapText(text, maxWidth, fontSize, fontWeight, M.maxLines)
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
