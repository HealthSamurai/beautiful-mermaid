import type { PositionedSankey } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Sankey SVG renderer
//
// Renders a positioned sankey diagram to an SVG string. Each node gets its
// own palette index from the xychart generator and its outgoing ribbons
// inherit it, so a flow is traceable by colour from where it starts.
//
// Render order (back to front):
//   1. Ribbons (so the bars sit on top of them)
//   2. Node bars (+ accessible <title>)
//   3. Node labels
// ============================================================================

const FONT = {
  labelSize: 12,
  labelWeight: 500,
} as const

/**
 * Render a positioned sankey diagram as a self-contained SVG string.
 */
export function renderSankeySvg(
  chart: PositionedSankey,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set<number>([
    ...chart.nodes.map(n => n.colorIndex),
    ...chart.links.map(l => l.colorIndex),
  ])

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(sankeyStyles(colorIndices, colors.accent, colors.bg))

  // 1. Ribbons
  for (const link of chart.links) {
    parts.push(
      `<path d="${link.path}" class="sankey-link sankey-flow-${link.colorIndex}" ` +
      `data-source="${escapeXml(link.source)}" data-target="${escapeXml(link.target)}" ` +
      `data-value="${link.value}">` +
      `<title>${escapeXml(link.source)} → ${escapeXml(link.target)}: ${link.value}</title></path>`
    )
  }

  // 2. Node bars
  for (const node of chart.nodes) {
    parts.push(
      `<rect x="${r(node.x)}" y="${r(node.y)}" width="${r(node.width)}" height="${r(node.height)}" ` +
      `rx="2" ry="2" class="sankey-node sankey-fill-${node.colorIndex}" ` +
      `data-node="${escapeXml(node.id)}" data-value="${round(node.value)}">` +
      `<title>${escapeXml(node.id)}: ${round(node.value)}</title></rect>`
    )
  }

  // 3. Node labels
  for (const node of chart.nodes) {
    parts.push(
      `<text x="${r(node.labelX)}" y="${r(node.labelY)}" text-anchor="${node.labelAnchor}" ` +
      `font-size="${FONT.labelSize}" font-weight="${FONT.labelWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="sankey-label">${escapeXml(node.id)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Sankey-specific CSS
//
// One `--sankey-color-N` custom property per node. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent recolours the first
// node live; later indices come from the shared palette generator.
//
// Ribbons are drawn semi-transparent so overlapping flows stay readable.
// ============================================================================

function sankeyStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --sankey-color-${idx}: ${value};`)
    rules.push(`  .sankey-fill-${idx} { fill: var(--sankey-color-${idx}); }`)
    rules.push(`  .sankey-flow-${idx} { fill: var(--sankey-color-${idx}); }`)
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .sankey-node { stroke: var(--bg); stroke-width: 1; }
  .sankey-link { fill-opacity: 0.4; stroke: none; }
  .sankey-label { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function r(n: number): string {
  return String(Math.round(n * 10) / 10)
}
