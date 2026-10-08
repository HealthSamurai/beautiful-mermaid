import type { PositionedPie } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Pie SVG renderer
//
// Renders a positioned pie chart to an SVG string. Slice colours reuse the
// xychart palette generator, so a pie sits in the same colour family as a
// chart rendered from the same theme. Index 0 resolves to var(--accent)
// through a CSS variable, keeping live theme switching working.
//
// Render order (back to front):
//   1. Slice wedges (+ accessible <title>)
//   2. Inline percentage labels
//   3. Legend swatches and labels
//   4. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  legendSize: 13,
  legendWeight: 400,
  percentSize: 12,
  percentWeight: 600,
} as const

/**
 * Render a positioned pie diagram as a self-contained SVG string.
 */
export function renderPieSvg(
  chart: PositionedPie,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set<number>([
    ...chart.slices.map(s => s.colorIndex),
    ...chart.legend.map(l => l.colorIndex),
  ])

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(pieStyles(colorIndices, colors.accent, colors.bg))

  // 1. Slice wedges
  for (const slice of chart.slices) {
    if (!slice.path) continue
    parts.push(
      `<path d="${slice.path}" class="pie-slice pie-fill-${slice.colorIndex}" ` +
      `data-label="${escapeXml(slice.label)}" data-value="${slice.value}">` +
      `<title>${escapeXml(slice.label)}: ${slice.value}</title></path>`
    )
  }

  // 2. Inline percentage labels
  for (const slice of chart.slices) {
    if (!slice.percentLabel) continue
    parts.push(
      `<text x="${r(slice.percentLabel.x)}" y="${r(slice.percentLabel.y)}" text-anchor="middle" ` +
      `font-size="${FONT.percentSize}" font-weight="${FONT.percentWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="pie-percent pie-on-${slice.colorIndex}">` +
      `${escapeXml(slice.percentLabel.text)}</text>`
    )
  }

  // 3. Legend
  for (const entry of chart.legend) {
    parts.push(
      `<rect x="${r(entry.swatch.x)}" y="${r(entry.swatch.y)}" ` +
      `width="${entry.swatch.size}" height="${entry.swatch.size}" rx="3" ry="3" ` +
      `class="pie-swatch pie-fill-${entry.colorIndex}"/>`
    )
    parts.push(
      `<text x="${r(entry.labelX)}" y="${r(entry.labelY)}" text-anchor="start" ` +
      `font-size="${FONT.legendSize}" font-weight="${FONT.legendWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="pie-legend-label">${escapeXml(entry.text)}</text>`
    )
  }

  // 4. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="pie-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Pie-specific CSS
//
// One `--pie-color-N` custom property per slice. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent recolours the first
// slice live; later indices come from the shared palette generator.
//
// Percentage labels sit on top of a saturated fill, so they are drawn in the
// background colour rather than the text colour — readable on both light and
// dark themes.
// ============================================================================

function pieStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --pie-color-${idx}: ${value};`)
    rules.push(`  .pie-fill-${idx} { fill: var(--pie-color-${idx}); }`)
    rules.push(`  .pie-on-${idx} { fill: var(--bg); }`)
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .pie-slice { stroke: var(--bg); stroke-width: 2; }
  .pie-swatch { stroke: none; }
  .pie-legend-label { fill: var(--_text); }
  .pie-title { fill: var(--_text); }
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
