import type { PositionedBlock, PositionedBlockDiagram } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml, safeStyleString } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Block diagram SVG renderer
//
// Renders a positioned block diagram to an SVG string. Each nesting depth
// takes its own palette index, so a composite and its contents read as one
// colour family while sibling levels stay distinguishable.
//
// Render order (back to front):
//   1. Block shapes, outermost depth first (so children sit on top)
//   2. Block labels
//   3. Edge connectors
//   4. Edge labels
//   5. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  labelSize: 13,
  labelWeight: 500,
  lineHeight: 16,
  edgeLabelSize: 11,
  edgeLabelWeight: 500,
  cornerRadius: 6,
} as const

/** Arrowhead marker ids, one per edge style. */
const MARKER_END = 'block-arrow-end'
const MARKER_START = 'block-arrow-start'

/**
 * Render a positioned block diagram as a self-contained SVG string.
 */
export function renderBlockSvg(
  chart: PositionedBlockDiagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set(chart.blocks.map(b => b.colorIndex))

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(blockStyles(colorIndices, colors.accent, colors.bg))
  parts.push(arrowMarkers())

  // 1. Shapes, shallowest depth first so a nested block draws over its parent
  const ordered = [...chart.blocks].sort((a, b) => a.depth - b.depth)
  for (const block of ordered) {
    parts.push(blockShape(block))
  }

  // 2. Labels
  for (const block of ordered) {
    parts.push(...blockLabel(block))
  }

  // 3. Edges
  for (const edge of chart.edges) {
    const markers = [
      edge.arrowEnd ? `marker-end="url(#${MARKER_END})"` : '',
      edge.arrowStart ? `marker-start="url(#${MARKER_START})"` : '',
    ].filter(Boolean).join(' ')

    parts.push(
      `<path d="${edge.path}" class="block-edge block-edge-${edge.style}" ${markers}/>`
    )
  }

  // 4. Edge labels — a chip behind the text so it stays readable over a line
  for (const edge of chart.edges) {
    if (!edge.label) continue
    const { text, x, y, width, height } = edge.label

    parts.push(
      `<rect x="${r(x - width / 2)}" y="${r(y - height / 2)}" width="${r(width)}" ` +
      `height="${r(height)}" rx="3" ry="3" class="block-edge-label-bg"/>`
    )
    parts.push(
      `<text x="${r(x)}" y="${r(y)}" text-anchor="middle" ` +
      `font-size="${FONT.edgeLabelSize}" font-weight="${FONT.edgeLabelWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="block-edge-label">${escapeXml(text)}</text>`
    )
  }

  // 5. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="block-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * Draw one block in its declared shape.
 *
 * A composite is drawn as a plain outlined rectangle whatever brackets it was
 * written with, because its brackets only supplied a title.
 */
function blockShape(block: PositionedBlock): string {
  const { x, y, width: w, height: h } = block
  const cls = `block-shape block-${block.shape} block-fill-${block.colorIndex}` +
    (block.classes.length > 0 ? ` ${block.classes.map(c => escapeXml(c)).join(' ')}` : '')
  const safeStyle = safeStyleString(block.style)
  const style = safeStyle ? ` style="${escapeXml(safeStyle)}"` : ''
  const data = `data-block="${escapeXml(block.id)}" data-shape="${block.shape}"`
  const title = block.label ? `<title>${escapeXml(block.label)}</title>` : ''

  /** Wrap a shape element with its common attributes. */
  const shape = (element: string) => `${element.slice(0, -2)} class="${cls}"${style} ${data}>${title}${closingTagOf(element)}`

  const cx = x + w / 2
  const cy = y + h / 2

  switch (block.shape) {
    case 'circle':
      return shape(`<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(Math.min(w, h) / 2)}"/>`)

    case 'doublecircle': {
      const radius = Math.min(w, h) / 2
      return (
        `<g ${data} class="${cls}"${style}>${title}` +
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}" class="block-ring"/>` +
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius - 4)}"/>` +
        `</g>`
      )
    }

    case 'round':
    case 'stadium':
      // A stadium is a rectangle rounded to a full half-circle on each end
      return shape(
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ` +
        `rx="${r(block.shape === 'stadium' ? h / 2 : FONT.cornerRadius * 2)}" ` +
        `ry="${r(block.shape === 'stadium' ? h / 2 : FONT.cornerRadius * 2)}"/>`
      )

    case 'diamond':
      return shape(polygon([
        [cx, y], [x + w, cy], [cx, y + h], [x, cy],
      ]))

    case 'hexagon': {
      const inset = Math.min(w / 4, h / 2)
      return shape(polygon([
        [x + inset, y], [x + w - inset, y], [x + w, cy],
        [x + w - inset, y + h], [x + inset, y + h], [x, cy],
      ]))
    }

    case 'subroutine':
      // A rectangle with an inner vertical rule on each side
      return (
        `<g ${data} class="${cls}"${style}>${title}` +
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}"/>` +
        `<line x1="${r(x + 8)}" y1="${r(y)}" x2="${r(x + 8)}" y2="${r(y + h)}" class="block-rule"/>` +
        `<line x1="${r(x + w - 8)}" y1="${r(y)}" x2="${r(x + w - 8)}" y2="${r(y + h)}" class="block-rule"/>` +
        `</g>`
      )

    case 'cylinder': {
      // A database-style cylinder: a body with an elliptical cap
      const ry = Math.min(h / 5, 10)
      const d = [
        `M${r(x)},${r(y + ry)}`,
        `A${r(w / 2)},${r(ry)} 0 0 1 ${r(x + w)},${r(y + ry)}`,
        `L${r(x + w)},${r(y + h - ry)}`,
        `A${r(w / 2)},${r(ry)} 0 0 1 ${r(x)},${r(y + h - ry)}`,
        'Z',
      ].join(' ')
      return (
        `<g ${data} class="${cls}"${style}>${title}` +
        `<path d="${d}"/>` +
        `<path d="M${r(x)},${r(y + ry)} A${r(w / 2)},${r(ry)} 0 0 0 ${r(x + w)},${r(y + ry)}" class="block-rule"/>` +
        `</g>`
      )
    }

    case 'lean_right':
      return shape(polygon([
        [x + w * 0.2, y], [x + w, y], [x + w * 0.8, y + h], [x, y + h],
      ]))

    case 'lean_left':
      return shape(polygon([
        [x, y], [x + w * 0.8, y], [x + w, y + h], [x + w * 0.2, y + h],
      ]))

    case 'trapezoid':
      return shape(polygon([
        [x + w * 0.2, y], [x + w * 0.8, y], [x + w, y + h], [x, y + h],
      ]))

    case 'inv_trapezoid':
      return shape(polygon([
        [x, y], [x + w, y], [x + w * 0.8, y + h], [x + w * 0.2, y + h],
      ]))

    case 'block_arrow':
      return shape(polygon(arrowPoints(block)))

    case 'space':
      // Never drawn — a space only claims grid slots
      return ''

    case 'composite':
    case 'square':
    case 'na':
    default:
      return shape(
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ` +
        `rx="${FONT.cornerRadius}" ry="${FONT.cornerRadius}"/>`
      )
  }
}

/**
 * Outline of an arrow block.
 *
 * A single declared direction gives a plain arrow pointing that way; two or
 * more give a double-headed arrow along the dominant axis, which is how
 * `(up, down)` and `(left, right)` are meant to read.
 */
function arrowPoints(block: PositionedBlock): Array<[number, number]> {
  const { x, y, width: w, height: h } = block
  const cx = x + w / 2
  const cy = y + h / 2

  const dirs = block.directions
  const vertical = dirs.some(d => d === 'up' || d === 'down' || d === 'y')
  const both = dirs.length > 1 ||
    dirs.includes('x') || dirs.includes('y') ||
    (dirs.includes('up') && dirs.includes('down')) ||
    (dirs.includes('left') && dirs.includes('right'))

  // Head depth and shaft half-thickness
  const head = vertical ? Math.min(h / 3, 18) : Math.min(w / 3, 24)
  const shaft = vertical ? w / 4 : h / 4

  if (vertical) {
    if (both) {
      return [
        [cx, y], [x + w, y + head], [cx + shaft, y + head],
        [cx + shaft, y + h - head], [x + w, y + h - head], [cx, y + h],
        [x, y + h - head], [cx - shaft, y + h - head],
        [cx - shaft, y + head], [x, y + head],
      ]
    }
    // A single vertical direction: pointing up unless 'down' was asked for
    const up = !dirs.includes('down')
    return up
      ? [[cx, y], [x + w, y + head], [cx + shaft, y + head], [cx + shaft, y + h],
         [cx - shaft, y + h], [cx - shaft, y + head], [x, y + head]]
      : [[cx, y + h], [x + w, y + h - head], [cx + shaft, y + h - head], [cx + shaft, y],
         [cx - shaft, y], [cx - shaft, y + h - head], [x, y + h - head]]
  }

  if (both) {
    return [
      [x, cy], [x + head, y], [x + head, cy - shaft],
      [x + w - head, cy - shaft], [x + w - head, y], [x + w, cy],
      [x + w - head, y + h], [x + w - head, cy + shaft],
      [x + head, cy + shaft], [x + head, y + h],
    ]
  }

  // A single horizontal direction: pointing right unless 'left' was asked for
  const left = dirs.includes('left')
  return left
    ? [[x, cy], [x + head, y], [x + head, cy - shaft], [x + w, cy - shaft],
       [x + w, cy + shaft], [x + head, cy + shaft], [x + head, y + h]]
    : [[x + w, cy], [x + w - head, y], [x + w - head, cy - shaft], [x, cy - shaft],
       [x, cy + shaft], [x + w - head, cy + shaft], [x + w - head, y + h]]
}

/** A `<polygon>` element from a point list. */
function polygon(points: Array<[number, number]>): string {
  const coords = points.map(([px, py]) => `${r(px)},${r(py)}`).join(' ')
  return `<polygon points="${coords}"/>`
}

/** Closing tag matching a self-closed element, for the shape() wrapper. */
function closingTagOf(element: string): string {
  const name = element.match(/^<(\w+)/)?.[1] ?? 'rect'
  return `</${name}>`
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Label lines for one block. */
function blockLabel(block: PositionedBlock): string[] {
  if (block.lines.length === 0) return []

  // A composite labels its title strip and carries the heavier weight
  const weight = block.shape === 'composite' ? 600 : FONT.labelWeight

  return block.lines.map((line, i) =>
    `<text x="${r(block.labelX)}" y="${r(block.labelY + i * FONT.lineHeight)}" ` +
    `text-anchor="middle" font-size="${FONT.labelSize}" font-weight="${weight}" ` +
    `dy="${TEXT_BASELINE_SHIFT}" class="block-label">${escapeXml(line)}</text>`
  )
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** Arrowhead markers, one for each end of an edge. */
function arrowMarkers(): string {
  return `<defs>
  <marker id="${MARKER_END}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" class="block-arrowhead"/>
  </marker>
  <marker id="${MARKER_START}" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M10,0 L0,5 L10,10 z" class="block-arrowhead"/>
  </marker>
</defs>`
}

// ============================================================================
// Block-specific CSS
//
// One `--block-color-N` custom property per nesting depth. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent recolours the
// top level live; deeper levels come from the shared palette generator.
// ============================================================================

function blockStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --block-color-${idx}: ${value};`)
    rules.push(
      `  .block-fill-${idx} { ` +
      `fill: color-mix(in srgb, var(--block-color-${idx}) 12%, var(--bg)); ` +
      `stroke: color-mix(in srgb, var(--block-color-${idx}) 45%, var(--bg)); }`
    )
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .block-shape { stroke-width: 1.5; }
  .block-composite { fill: color-mix(in srgb, var(--fg) 3%, var(--bg)); stroke-dasharray: 4 3; }
  .block-ring { fill: none; stroke-width: 1.5; }
  .block-rule { fill: none; stroke: inherit; stroke-width: 1.5; opacity: 0.6; }
  .block-label { fill: var(--_text); }
  .block-edge { fill: none; stroke: var(--_line); stroke-width: 1.8; }
  .block-edge-thick { stroke-width: 3; }
  .block-edge-dotted { stroke-dasharray: 4 3; }
  .block-arrowhead { fill: var(--_arrow); stroke: none; }
  .block-edge-label-bg { fill: var(--bg); stroke: none; }
  .block-edge-label { fill: var(--_text-sec); }
  .block-title { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r(n: number): string {
  return String(Math.round(n * 10) / 10)
}
