import type { PositionedTreemap, TreemapCell } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'
import { TREEMAP_METRICS as T } from './layout.ts'

// ============================================================================
// Treemap SVG renderer
//
// Renders a positioned treemap to an SVG string. Each top-level branch takes
// its own palette index and keeps it through its whole subtree, so a cell's
// colour says which branch it belongs to; depth is shown by tint instead, so
// the two readings do not fight each other.
//
// Render order (back to front): sections first, then the leaves inside them,
// which is the order layout emitted.
// ============================================================================

/** Corner radius, small enough that the areas still read as a partition. */
const RADIUS = 3

/** How much a cell is lightened per nesting level, as a percentage point. */
const DEPTH_STEP = 9

/** Deepest level that still gets its own tint, so colours stay distinct. */
const MAX_DEPTH = 4

/**
 * Render a positioned treemap as a self-contained SVG string.
 */
export function renderTreemapSvg(
  chart: PositionedTreemap,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set(chart.cells.map(c => c.colorIndex))
  const depths = new Set(chart.cells.map(c => Math.min(c.depth, MAX_DEPTH)))

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(treemapStyles(colorIndices, depths, colors.accent, colors.bg))

  for (const cell of chart.cells) {
    parts.push(...renderCell(cell))
  }

  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${T.titleFontSize}" font-weight="${T.titleFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="treemap-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** Draw one cell: its rectangle, its label and its value. */
function renderCell(cell: TreemapCell): string[] {
  const parts: string[] = []
  const depth = Math.min(cell.depth, MAX_DEPTH)

  const classes = [
    'treemap-cell',
    cell.isSection ? 'treemap-section' : 'treemap-leaf',
    `treemap-fill-${cell.colorIndex}`,
    `treemap-depth-${depth}`,
  ]
  if (cell.classSelector) classes.push(escapeXml(cell.classSelector))

  const style = cell.style ? ` style="${escapeXml(cell.style)}"` : ''

  parts.push(
    `<rect x="${r(cell.x)}" y="${r(cell.y)}" width="${r(cell.width)}" ` +
    `height="${r(cell.height)}" rx="${RADIUS}" ry="${RADIUS}" ` +
    `class="${classes.join(' ')}"${style} data-name="${escapeXml(cell.name)}" ` +
    `data-value="${cell.value}">` +
    `<title>${escapeXml(tooltip(cell))}</title></rect>`
  )

  if (cell.lines.length === 0) return parts

  const fontSize = cell.isSection ? T.headerFontSize : T.labelFontSize
  const fontWeight = cell.isSection ? T.headerFontWeight : T.labelFontWeight
  const labelClass = cell.isSection ? 'treemap-section-label' : 'treemap-leaf-label'

  for (const [index, line] of cell.lines.entries()) {
    parts.push(
      `<text x="${r(cell.labelX)}" y="${r(cell.labelY + index * T.labelLineHeight)}" ` +
      `font-size="${fontSize}" font-weight="${fontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="${labelClass}">${escapeXml(line)}</text>`
    )
  }

  if (cell.valueText !== undefined && cell.valueX !== undefined && cell.valueY !== undefined) {
    parts.push(
      `<text x="${r(cell.valueX)}" y="${r(cell.valueY)}" ` +
      `font-size="${T.valueFontSize}" font-weight="${T.valueFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="treemap-value">` +
      `${escapeXml(cell.valueText)}</text>`
    )
  }

  return parts
}

/**
 * Accessible description of a cell.
 *
 * The value is always included, even when the cell is too small to show it,
 * because the area is the whole message and a reader who cannot measure it
 * by eye still deserves the number.
 */
function tooltip(cell: TreemapCell): string {
  return `${cell.name}: ${cell.value}`
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Build the treemap stylesheet.
 *
 * One custom property per branch, so a host page can recolour a single
 * branch, and one tint rule per depth so nesting reads without a border.
 */
function treemapStyles(
  colorIndices: Set<number>,
  depths: Set<number>,
  themeAccent?: string,
  bgColor?: string,
): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sortedColors = [...colorIndices].sort((a, b) => a - b)
  const sortedDepths = [...depths].sort((a, b) => a - b)

  const varDefs: string[] = []
  for (const idx of sortedColors) {
    // Index 0 resolves through var(--accent) so live theme switching works
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --treemap-color-${idx}: ${value};`)
  }

  const rules: string[] = []
  for (const idx of sortedColors) {
    for (const depth of sortedDepths) {
      // Deeper cells are mixed further towards the background, which keeps a
      // nested leaf lighter than the section it sits in
      const mix = Math.max(12, 62 - depth * DEPTH_STEP)
      rules.push(
        `  .treemap-fill-${idx}.treemap-depth-${depth} { ` +
        `fill: color-mix(in srgb, var(--treemap-color-${idx}) ${mix}%, var(--bg)); }`
      )
    }
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .treemap-cell { stroke: var(--bg); stroke-width: 1; }
  .treemap-section { fill-opacity: 0.55; }
  .treemap-section-label { fill: var(--_text); }
  .treemap-leaf-label { fill: var(--_text); }
  .treemap-value { fill: var(--_text-sec); }
  .treemap-title { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

/** Round to two decimals, keeping coordinates short without visible drift. */
function r(value: number): number {
  return Math.round(value * 100) / 100
}
