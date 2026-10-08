import type {
  PositionedSankey, PositionedSankeyLink, PositionedSankeyNode, SankeyDiagram,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth } from '../styles.ts'

// ============================================================================
// Sankey layout engine
//
// Nodes are assigned to columns by longest path from a source, so a node
// always sits to the right of everything that feeds it. Within a column,
// bars are stacked in first-appearance order and sized proportionally to the
// flow through them.
//
// Ribbons leave a source bar and enter a target bar at offsets accumulated in
// link order, so the ribbons entering a bar exactly fill it.
// ============================================================================

/** Layout constants. */
const S = {
  padding: 24,
  /** Width of a node bar */
  nodeWidth: 16,
  /** Minimum vertical gap between stacked bars */
  nodeGap: 14,
  /** Height of the tallest column, before gaps */
  plotHeight: 380,
  /** Horizontal gap between columns, excluding the bar width */
  columnGap: 150,
  labelFontSize: 12,
  labelFontWeight: 500,
  /** Gap between a bar and its label */
  labelGap: 8,
  /** Thinnest ribbon that still reads as a ribbon */
  minThickness: 1,
} as const

/**
 * Lay out a parsed sankey diagram: assign nodes to columns, size the bars
 * from the flow through them, and build a ribbon path per link.
 */
export function layoutSankey(
  diagram: SankeyDiagram,
  _options: RenderOptions = {},
): PositionedSankey {
  if (diagram.nodes.length === 0) {
    return { width: S.padding * 2, height: S.padding * 2, nodes: [], links: [] }
  }

  const depths = assignDepths(diagram)
  const totals = nodeTotals(diagram)
  const maxDepth = Math.max(...depths.values())

  // Group nodes by column, keeping first-appearance order within a column
  const columns: string[][] = Array.from({ length: maxDepth + 1 }, () => [])
  for (const node of diagram.nodes) {
    columns[depths.get(node.id) ?? 0]!.push(node.id)
  }

  // The busiest column decides the value→pixel scale, so no column overflows
  const scale = valueScale(columns, totals)

  const labelWidths = new Map(
    diagram.nodes.map(n => [n.id, estimateTextWidth(n.id, S.labelFontSize, S.labelFontWeight)]),
  )

  // Leftmost labels sit left of their bar, the rest sit to the right
  const leftGutter = gutterFor(columns[0] ?? [], labelWidths)
  const rightGutter = gutterFor(columns[maxDepth] ?? [], labelWidths)

  const positioned: PositionedSankeyNode[] = []
  const nodeById = new Map<string, PositionedSankeyNode>()
  let maxBottom = S.padding

  columns.forEach((column, depth) => {
    const x = S.padding + leftGutter + depth * (S.nodeWidth + S.columnGap)
    let y = S.padding

    for (const id of column) {
      const value = totals.get(id) ?? 0
      const height = Math.max(S.minThickness, value * scale)
      // Last column labels to the left of the bar, everything else to the right
      const onRight = depth < maxDepth

      const node: PositionedSankeyNode = {
        id,
        depth,
        x,
        y,
        width: S.nodeWidth,
        height,
        value,
        labelX: onRight ? x + S.nodeWidth + S.labelGap : x - S.labelGap,
        labelY: y + height / 2,
        labelAnchor: onRight ? 'start' : 'end',
        colorIndex: positioned.length,
      }

      positioned.push(node)
      nodeById.set(id, node)
      y += height + S.nodeGap
    }

    if (y - S.nodeGap > maxBottom) maxBottom = y - S.nodeGap
  })

  const links = buildLinks(diagram, nodeById, scale)

  const contentRight = S.padding + leftGutter + maxDepth * (S.nodeWidth + S.columnGap) + S.nodeWidth

  return {
    width: Math.round(contentRight + rightGutter + S.padding),
    height: Math.round(maxBottom + S.padding),
    nodes: positioned,
    links,
  }
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * Assign each node its column: the longest path from any pure source.
 *
 * Longest path (rather than shortest) keeps a node to the right of every
 * node that feeds it. Cycles are broken by an iteration cap, so a malformed
 * diagram still lays out instead of spinning.
 */
function assignDepths(diagram: SankeyDiagram): Map<string, number> {
  const depths = new Map<string, number>()
  for (const node of diagram.nodes) depths.set(node.id, 0)

  // Relaxation: a target must be deeper than its source. At most N passes
  // are needed for an acyclic graph; the cap also bounds cyclic input.
  const maxPasses = diagram.nodes.length
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false

    for (const link of diagram.links) {
      const sourceDepth = depths.get(link.source) ?? 0
      const targetDepth = depths.get(link.target) ?? 0
      if (targetDepth <= sourceDepth) {
        depths.set(link.target, sourceDepth + 1)
        changed = true
      }
    }

    if (!changed) break
  }

  return depths
}

/** Flow through each node — the larger of what enters and what leaves. */
function nodeTotals(diagram: SankeyDiagram): Map<string, number> {
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()

  for (const link of diagram.links) {
    outgoing.set(link.source, (outgoing.get(link.source) ?? 0) + link.value)
    incoming.set(link.target, (incoming.get(link.target) ?? 0) + link.value)
  }

  const totals = new Map<string, number>()
  for (const node of diagram.nodes) {
    totals.set(node.id, Math.max(incoming.get(node.id) ?? 0, outgoing.get(node.id) ?? 0))
  }

  return totals
}

/** Pixels per unit of value, set by the column carrying the most flow. */
function valueScale(columns: readonly string[][], totals: Map<string, number>): number {
  let maxColumnValue = 0
  let maxColumnCount = 1

  for (const column of columns) {
    const sum = column.reduce((acc, id) => acc + (totals.get(id) ?? 0), 0)
    if (sum > maxColumnValue) {
      maxColumnValue = sum
      maxColumnCount = column.length
    }
  }

  if (maxColumnValue <= 0) return 1

  // Gaps between bars eat into the available height
  const available = S.plotHeight - Math.max(0, maxColumnCount - 1) * S.nodeGap
  return Math.max(0.0001, available / maxColumnValue)
}

// ---------------------------------------------------------------------------
// Ribbons
// ---------------------------------------------------------------------------

/**
 * Build one ribbon per link. Offsets accumulate per node, so the ribbons
 * leaving a bar stack down its right edge and the ribbons entering a bar
 * stack down its left edge, exactly filling both.
 */
function buildLinks(
  diagram: SankeyDiagram,
  nodeById: Map<string, PositionedSankeyNode>,
  scale: number,
): PositionedSankeyLink[] {
  const outOffset = new Map<string, number>()
  const inOffset = new Map<string, number>()

  const out: PositionedSankeyLink[] = []

  for (const link of diagram.links) {
    const source = nodeById.get(link.source)
    const target = nodeById.get(link.target)
    if (!source || !target) continue

    const thickness = Math.max(S.minThickness, link.value * scale)

    const sourceOffset = outOffset.get(link.source) ?? 0
    const targetOffset = inOffset.get(link.target) ?? 0

    const y0 = source.y + sourceOffset
    const y1 = target.y + targetOffset

    out.push({
      source: link.source,
      target: link.target,
      value: link.value,
      path: ribbonPath(
        source.x + source.width, y0,
        target.x, y1,
        thickness,
      ),
      thickness,
      colorIndex: source.colorIndex,
    })

    outOffset.set(link.source, sourceOffset + thickness)
    inOffset.set(link.target, targetOffset + thickness)
  }

  return out
}

/**
 * A closed ribbon between two bar edges: a cubic bezier along the top, down
 * the target edge, a mirrored bezier back along the bottom, and close.
 */
function ribbonPath(
  x0: number, y0: number,
  x1: number, y1: number,
  thickness: number,
): string {
  const midX = (x0 + x1) / 2
  const b0 = y0 + thickness
  const b1 = y1 + thickness

  return (
    `M${r(x0)},${r(y0)} ` +
    `C${r(midX)},${r(y0)} ${r(midX)},${r(y1)} ${r(x1)},${r(y1)} ` +
    `L${r(x1)},${r(b1)} ` +
    `C${r(midX)},${r(b1)} ${r(midX)},${r(b0)} ${r(x0)},${r(b0)} Z`
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Width the widest label in a column needs outside its bar. */
function gutterFor(column: readonly string[], labelWidths: Map<string, number>): number {
  const widest = column.reduce((max, id) => Math.max(max, labelWidths.get(id) ?? 0), 0)
  return widest > 0 ? widest + S.labelGap : 0
}

function r(n: number): number {
  return Math.round(n * 10) / 10
}
