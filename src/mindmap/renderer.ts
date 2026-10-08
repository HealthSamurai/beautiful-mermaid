import type { PositionedMindmap, PositionedMindmapNode } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { escapeXml } from '../multiline-utils.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Mindmap SVG renderer
//
// Renders a positioned mindmap to an SVG string. Each top-level branch gets
// its own palette index from the xychart generator, so a branch reads as one
// colour family; the root uses the theme accent.
//
// Render order (back to front):
//   1. Edges (so boxes sit on top of their connectors)
//   2. Node shapes
//   3. Node labels (+ icon prefix)
// ============================================================================

const FONT = {
  size: 13,
  weight: 500,
  rootSize: 15,
  rootWeight: 600,
} as const

/**
 * Render a positioned mindmap as a self-contained SVG string.
 */
export function renderMindmapSvg(
  chart: PositionedMindmap,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set<number>([
    ...chart.nodes.map(n => n.colorIndex),
    ...chart.edges.map(e => e.colorIndex),
  ])

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(mindmapStyles(colorIndices, colors.accent, colors.bg))

  // 1. Edges
  for (const edge of chart.edges) {
    parts.push(`<path d="${edge.path}" class="mindmap-edge mindmap-stroke-${edge.colorIndex}"/>`)
  }

  // 2. Node shapes
  for (const node of chart.nodes) {
    parts.push(nodeShape(node))
  }

  // 3. Node labels
  for (const node of chart.nodes) {
    const isRoot = node.level === 0
    const fontSize = isRoot ? FONT.rootSize : FONT.size
    const fontWeight = isRoot ? FONT.rootWeight : FONT.weight
    const lineHeight = fontSize * LINE_HEIGHT_RATIO

    // An icon has no font here, so it is rendered as a bracketed text prefix
    const prefix = node.icon ? `${escapeXml(node.icon)} ` : ''
    const spans = node.lines
      .map((line, i) =>
        `<tspan x="${r(node.labelX)}" dy="${i === 0 ? 0 : r(lineHeight)}">` +
        `${i === 0 ? prefix : ''}${escapeXml(line)}</tspan>`
      )
      .join('')

    parts.push(
      `<text x="${r(node.labelX)}" y="${r(node.labelY)}" text-anchor="middle" ` +
      `font-size="${fontSize}" font-weight="${fontWeight}" dominant-baseline="middle" ` +
      `class="mindmap-label${isRoot ? ' mindmap-label-root' : ''}">${spans}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Node shapes
// ---------------------------------------------------------------------------

/**
 * Draw the node outline for its shape. Cloud and bang are approximated with
 * heavily rounded rectangles rather than lobed outlines — the distinction
 * readers rely on is "this node looks different", which survives, and the
 * shapes stay DOM-free one-liners.
 */
function nodeShape(node: PositionedMindmapNode): string {
  const extraClass = node.class ? ` ${escapeXml(node.class)}` : ''
  const cls =
    `class="mindmap-node mindmap-node-${node.shape} mindmap-fill-${node.colorIndex}${extraClass}"`
  const data = `data-node="${escapeXml(node.nodeId)}" data-level="${node.level}"`
  const title = `<title>${escapeXml(node.label)}</title>`

  const { x, y, width, height } = node
  const cx = x + width / 2
  const cy = y + height / 2

  switch (node.shape) {
    case 'circle': {
      const rx = width / 2
      const ry = height / 2
      return `<ellipse cx="${r(cx)}" cy="${r(cy)}" rx="${r(rx)}" ry="${r(ry)}" ${cls} ${data}>${title}</ellipse>`
    }
    case 'hexagon': {
      const inset = Math.min(14, width / 4)
      const points = [
        `${r(x + inset)},${r(y)}`,
        `${r(x + width - inset)},${r(y)}`,
        `${r(x + width)},${r(cy)}`,
        `${r(x + width - inset)},${r(y + height)}`,
        `${r(x + inset)},${r(y + height)}`,
        `${r(x)},${r(cy)}`,
      ].join(' ')
      return `<polygon points="${points}" ${cls} ${data}>${title}</polygon>`
    }
    case 'bang': {
      // A starburst: alternating outer and inner radii around the box
      return `<polygon points="${starPoints(cx, cy, width / 2, height / 2)}" ${cls} ${data}>${title}</polygon>`
    }
    case 'cloud':
      return rect(node, Math.min(height / 2, 24), cls, data, title)
    case 'rounded':
      return rect(node, 14, cls, data, title)
    case 'rect':
      return rect(node, 2, cls, data, title)
    case 'default':
    default:
      return rect(node, 6, cls, data, title)
  }
}

function rect(
  node: PositionedMindmapNode,
  radius: number,
  cls: string,
  data: string,
  title: string,
): string {
  return (
    `<rect x="${r(node.x)}" y="${r(node.y)}" width="${r(node.width)}" height="${r(node.height)}" ` +
    `rx="${r(radius)}" ry="${r(radius)}" ${cls} ${data}>${title}</rect>`
  )
}

/** A 12-point starburst inscribed in the node box, for the `bang` shape. */
function starPoints(cx: number, cy: number, rx: number, ry: number): string {
  const spikes = 12
  const points: string[] = []

  for (let i = 0; i < spikes * 2; i++) {
    const outer = i % 2 === 0
    const angle = (i * Math.PI) / spikes
    const px = cx + Math.cos(angle) * rx * (outer ? 1 : 0.82)
    const py = cy + Math.sin(angle) * ry * (outer ? 1 : 0.82)
    points.push(`${r(px)},${r(py)}`)
  }

  return points.join(' ')
}

// ============================================================================
// Mindmap-specific CSS
//
// One `--mindmap-color-N` custom property per top-level branch. Index 0
// resolves to var(--accent) so a host page swapping the theme accent
// recolours the first branch live.
// ============================================================================

function mindmapStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --mindmap-color-${idx}: ${value};`)
    rules.push(
      `  .mindmap-fill-${idx} { ` +
      `fill: color-mix(in srgb, var(--mindmap-color-${idx}) 12%, var(--bg)); ` +
      `stroke: color-mix(in srgb, var(--mindmap-color-${idx}) 45%, var(--bg)); }`
    )
    rules.push(
      `  .mindmap-stroke-${idx} { ` +
      `stroke: color-mix(in srgb, var(--mindmap-color-${idx}) 50%, var(--bg)); }`
    )
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .mindmap-node { stroke-width: 1.5; }
  .mindmap-edge { fill: none; stroke-width: 2; stroke-linecap: round; }
  .mindmap-label { fill: var(--_text); }
  .mindmap-label-root { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 10) / 10
}

function r(n: number): string {
  return String(round(n))
}
