import type {
  PositionedTreemap,
  TreemapCell,
  TreemapDiagram,
  TreemapNode,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { compileClass } from './parser.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'

// ============================================================================
// Treemap layout engine
//
// Squarified treemap: each level divides its rectangle among its children in
// proportion to their values, laying them out in rows chosen to keep the
// cells as close to square as possible.
//
// Squarified rather than the obvious slice-and-dice because long thin slivers
// are both hard to label and hard to compare by eye — the whole point of a
// treemap is that area is readable, and a 400:1 sliver is not. The algorithm
// is Bruls, Huizing and van Wijk's: keep adding cells to the current row
// while that improves the worst aspect ratio in it, then start a new row.
//
// A section reserves a header strip for its own name before dividing what is
// left, so a label never sits on top of its children.
// ============================================================================

/** Layout constants. */
const T = {
  padding: 16,
  /** Default canvas, before the title is added */
  width: 820,
  height: 480,
  /** Gap between sibling cells */
  gap: 3,
  /** Inset between a section's border and its children */
  sectionPad: 5,
  /** Header strip a section reserves for its own name */
  headerHeight: 22,
  headerFontSize: 12,
  headerFontWeight: 600,
  labelFontSize: 13,
  labelFontWeight: 500,
  labelLineHeight: 16,
  valueFontSize: 11,
  valueFontWeight: 400,
  /** Padding inside a leaf, around its label */
  leafPadX: 7,
  leafPadY: 6,
  /** A cell smaller than this in either direction gets no label at all */
  minLabelWidth: 34,
  minLabelHeight: 20,
  /** Extra height a leaf needs before its value is worth showing */
  minValueHeight: 38,
  /** Maximum lines a leaf label wraps to */
  maxLines: 3,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 36,
} as const

/**
 * Lay out a parsed treemap by subdividing the canvas in proportion to values.
 *
 * Section values are computed from their descendants rather than read from
 * the source, so the drawn areas always add up.
 *
 * The canvas is a fixed size, unlike the diagram types that grow to fit their
 * content: a treemap fills whatever rectangle it is given, so there is no
 * content-derived size to grow to. A host page scales the SVG instead.
 */
export function layoutTreemap(
  diagram: TreemapDiagram,
  _options: RenderOptions = {},
): PositionedTreemap {
  const titleHeight = diagram.title ? T.titleHeight : 0
  const width = widthForTitle(
    T.width,
    diagram.title,
    T.titleFontSize,
    T.titleFontWeight,
    T.padding,
  )
  const height = T.height + titleHeight

  const cells: TreemapCell[] = []

  // Compiled once: every cell carrying a class looks its style up here
  const styles = new Map<string, string>()
  for (const [name, css] of diagram.classes) {
    const compiled = compileClass(css)
    if (compiled) styles.set(name, compiled)
  }

  // A node with no value anywhere contributes no area, so it is dropped
  // rather than drawn as a zero-width sliver.
  const roots = diagram.nodes
    .map(node => ({ node, value: totalValue(node) }))
    .filter(entry => entry.value > 0)

  const frame = {
    x: T.padding,
    y: T.padding + titleHeight,
    width: width - T.padding * 2,
    height: height - titleHeight - T.padding * 2,
  }

  if (roots.length > 0 && frame.width > 0 && frame.height > 0) {
    // Each top-level branch keeps one palette index through its whole subtree
    const boxes = squarify(roots.map(r => r.value), frame)
    for (const [index, entry] of roots.entries()) {
      place(entry.node, entry.value, boxes[index]!, 0, index, diagram, styles, cells)
    }
  }

  const chart: PositionedTreemap = {
    width: Math.round(width),
    height: Math.round(height),
    cells,
  }

  if (diagram.title) {
    chart.title = {
      text: diagram.title,
      x: Math.round(width / 2),
      y: Math.round(T.padding + T.titleFontSize / 2),
    }
  }

  return chart
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * Total value of a subtree.
 *
 * A section's declared value, if any, is ignored in favour of its children's
 * sum: a parent that disagreed with its children would make the picture lie
 * about the proportions it draws. Negative values are clamped to zero, since
 * a negative area has no meaning.
 */
export function totalValue(node: TreemapNode): number {
  if (node.children.length === 0) return Math.max(0, node.value ?? 0)
  return node.children.reduce((sum, child) => sum + totalValue(child), 0)
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** Rectangle, in the sense the squarify algorithm uses. */
interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Recursively place one node and its subtree into the box it was given. */
function place(
  node: TreemapNode,
  value: number,
  box: Box,
  depth: number,
  colorIndex: number,
  diagram: TreemapDiagram,
  styles: Map<string, string>,
  out: TreemapCell[],
): void {
  const isSection = node.children.length > 0

  const cell: TreemapCell = {
    name: node.name,
    value,
    isSection,
    depth,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    lines: [],
    labelX: box.x,
    labelY: box.y,
    colorIndex,
    classSelector: node.classSelector,
    style: node.classSelector ? styles.get(node.classSelector) : undefined,
  }

  if (isSection) {
    layoutSectionLabel(cell)
    out.push(cell)

    // Children divide what is left under the header
    const inner = {
      x: box.x + T.sectionPad,
      y: box.y + T.headerHeight,
      width: box.width - T.sectionPad * 2,
      height: box.height - T.headerHeight - T.sectionPad,
    }
    if (inner.width <= 0 || inner.height <= 0) return

    const children = node.children
      .map(child => ({ node: child, value: totalValue(child) }))
      .filter(entry => entry.value > 0)
    if (children.length === 0) return

    const boxes = squarify(children.map(c => c.value), inner)
    for (const [index, entry] of children.entries()) {
      place(
        entry.node, entry.value, boxes[index]!, depth + 1, colorIndex,
        diagram, styles, out,
      )
    }
    return
  }

  layoutLeafLabel(cell, diagram)
  out.push(cell)
}

/** Place a section's name in its header strip, when the strip is wide enough. */
function layoutSectionLabel(cell: TreemapCell): void {
  if (cell.width < T.minLabelWidth || cell.height < T.headerHeight) return

  const available = cell.width - T.leafPadX * 2
  cell.lines = [clip(cell.name, available, T.headerFontSize, T.headerFontWeight)]
  cell.labelX = cell.x + T.leafPadX
  cell.labelY = cell.y + T.headerHeight / 2
}

/**
 * Place a leaf's name, and its value when there is room.
 *
 * A cell too small for even one line gets no label: a clipped word is worse
 * than a cell the reader hovers to identify, and the `<title>` carries the
 * full text either way.
 */
function layoutLeafLabel(cell: TreemapCell, diagram: TreemapDiagram): void {
  if (cell.width < T.minLabelWidth || cell.height < T.minLabelHeight) return

  const available = cell.width - T.leafPadX * 2
  const showValue =
    diagram.showValues !== false &&
    cell.value > 0 &&
    cell.height >= T.minValueHeight

  // Reserve the value's row before deciding how many label lines fit
  const labelSpace =
    cell.height - T.leafPadY * 2 - (showValue ? T.valueFontSize + 3 : 0)
  const maxLines = Math.max(1, Math.floor(labelSpace / T.labelLineHeight))

  cell.lines = wrap(cell.name, available).slice(0, Math.min(maxLines, T.maxLines))

  const blockHeight =
    cell.lines.length * T.labelLineHeight + (showValue ? T.valueFontSize + 3 : 0)
  const top = cell.y + (cell.height - blockHeight) / 2

  cell.labelX = cell.x + T.leafPadX
  cell.labelY = top + T.labelLineHeight / 2

  if (showValue) {
    cell.valueText = formatValue(cell.value, diagram.valueFormat)
    cell.valueX = cell.labelX
    cell.valueY =
      top + cell.lines.length * T.labelLineHeight + T.valueFontSize / 2 + 3
  }
}

// ---------------------------------------------------------------------------
// Squarified subdivision
// ---------------------------------------------------------------------------

/**
 * Divide a box among values, keeping cells as close to square as possible.
 *
 * Bruls, Huizing and van Wijk's squarified treemap: fill rows along the short
 * side of the remaining space, adding to the current row while that improves
 * its worst aspect ratio, and starting a new row when it stops.
 *
 * Returns one box per value, in input order, each inset by the gap so
 * neighbours do not touch.
 */
export function squarify(values: number[], frame: Box): Box[] {
  const boxes: Box[] = new Array(values.length)

  const total = values.reduce((sum, v) => sum + v, 0)
  if (total <= 0 || values.length === 0) {
    return values.map(() => ({ x: frame.x, y: frame.y, width: 0, height: 0 }))
  }

  // Work in area units so a value maps directly onto pixels²
  const scale = (frame.width * frame.height) / total
  const remaining = values.map((value, index) => ({ area: value * scale, index }))

  // Largest first, which is what makes the aspect ratios come out square;
  // the output is reordered back to input order at the end.
  remaining.sort((a, b) => b.area - a.area)

  let rect = { ...frame }
  let cursor = 0

  while (cursor < remaining.length) {
    const short = Math.min(rect.width, rect.height)
    if (short <= 0) {
      // No space left — give the rest zero-size boxes rather than negatives
      for (; cursor < remaining.length; cursor++) {
        boxes[remaining[cursor]!.index] = { x: rect.x, y: rect.y, width: 0, height: 0 }
      }
      break
    }

    // Grow the row while the worst aspect ratio in it keeps improving
    let rowEnd = cursor + 1
    let rowArea = remaining[cursor]!.area
    let best = worstRatio(remaining, cursor, rowEnd, rowArea, short)

    while (rowEnd < remaining.length) {
      const nextArea = rowArea + remaining[rowEnd]!.area
      const candidate = worstRatio(remaining, cursor, rowEnd + 1, nextArea, short)
      if (candidate > best) break
      best = candidate
      rowArea = nextArea
      rowEnd++
    }

    // Lay the row along the short side, then shrink the rectangle
    const thickness = rowArea / short
    let offset = 0

    for (let i = cursor; i < rowEnd; i++) {
      const length = remaining[i]!.area / thickness
      const box = rect.width <= rect.height
        ? { x: rect.x + offset, y: rect.y, width: length, height: thickness }
        : { x: rect.x, y: rect.y + offset, width: thickness, height: length }
      boxes[remaining[i]!.index] = inset(box)
      offset += length
    }

    if (rect.width <= rect.height) {
      rect = {
        x: rect.x,
        y: rect.y + thickness,
        width: rect.width,
        height: rect.height - thickness,
      }
    } else {
      rect = {
        x: rect.x + thickness,
        y: rect.y,
        width: rect.width - thickness,
        height: rect.height,
      }
    }

    cursor = rowEnd
  }

  return boxes
}

/**
 * Worst aspect ratio in a candidate row.
 *
 * The row runs along `short`; given its total area, every cell's thickness is
 * fixed, so the worst-shaped cell is either the largest or the smallest.
 */
function worstRatio(
  entries: { area: number }[],
  start: number,
  end: number,
  rowArea: number,
  short: number,
): number {
  if (rowArea <= 0) return Infinity

  let min = Infinity
  let max = 0
  for (let i = start; i < end; i++) {
    const area = entries[i]!.area
    if (area < min) min = area
    if (area > max) max = area
  }
  if (max <= 0) return Infinity

  const s2 = short * short
  const r2 = rowArea * rowArea
  return Math.max((s2 * max) / r2, r2 / (s2 * min))
}

/** Shrink a box by the gap, so neighbouring cells read as separate. */
function inset(box: Box): Box {
  const half = T.gap / 2
  return {
    x: box.x + half,
    y: box.y + half,
    width: Math.max(0, box.width - T.gap),
    height: Math.max(0, box.height - T.gap),
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Format a value for display.
 *
 * Supports the formats a treemap actually uses: a thousands separator, a
 * currency prefix and a fixed number of decimals. Anything else falls back to
 * the grouped integer, which is never wrong, only less specific.
 */
export function formatValue(value: number, format?: string): string {
  if (!format) return group(value)

  const currency = format.startsWith('$')
  const body = currency ? format.slice(1) : format

  const precision = body.match(/\.(\d+)/)
  const digits = precision ? Number(precision[1]!) : 0
  const grouped = body.includes(',')

  const fixed = value.toFixed(digits)
  const text = grouped ? group(Number(fixed), digits) : fixed

  // A percentage format scales by 100, as d3-format does
  if (body.endsWith('%')) {
    const scaled = (value * 100).toFixed(digits)
    return `${currency ? '$' : ''}${scaled}%`
  }

  return currency ? `$${text}` : text
}

/** Group the integer part in threes, keeping any decimals. */
function group(value: number, digits = 0): string {
  const fixed = value.toFixed(digits)
  const [whole, fraction] = fixed.split('.')
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${grouped}.${fraction}` : grouped
}

/** Wrap text to a pixel width using the DOM-free metrics. */
function wrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  const out: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (
      estimateTextWidth(candidate, T.labelFontSize, T.labelFontWeight) <= maxWidth ||
      !line
    ) {
      line = candidate
    } else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  if (out.length === 0) out.push('')

  return out
}

/** Truncate text with an ellipsis so it fits a pixel width. */
function clip(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
): string {
  if (estimateTextWidth(text, fontSize, fontWeight) <= maxWidth) return text

  let truncated = text
  while (
    truncated.length > 1 &&
    estimateTextWidth(`${truncated}\u2026`, fontSize, fontWeight) > maxWidth
  ) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}\u2026`
}

/** Geometry constants, exported so the renderer draws text where layout put it. */
export const TREEMAP_METRICS = {
  headerFontSize: T.headerFontSize,
  headerFontWeight: T.headerFontWeight,
  labelFontSize: T.labelFontSize,
  labelFontWeight: T.labelFontWeight,
  labelLineHeight: T.labelLineHeight,
  valueFontSize: T.valueFontSize,
  valueFontWeight: T.valueFontWeight,
  titleFontSize: T.titleFontSize,
  titleFontWeight: T.titleFontWeight,
} as const
