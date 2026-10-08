import type { PositionedQuadrantChart } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Quadrant chart SVG renderer
//
// Renders a positioned quadrant chart to an SVG string. Quadrant tints reuse
// the xychart palette generator, so the chart sits in the same colour family
// as anything else rendered from the same theme.
//
// Render order (back to front):
//   1. Quadrant backgrounds
//   2. Plot border and crosshair
//   3. Quadrant labels
//   4. Axis end labels
//   5. Point markers (+ accessible <title>) and their labels
//   6. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  axisSize: 13,
  axisWeight: 500,
  quadrantSize: 14,
  quadrantWeight: 600,
  pointSize: 12,
  pointWeight: 400,
} as const

/**
 * Render a positioned quadrant chart as a self-contained SVG string.
 */
export function renderQuadrantSvg(
  chart: PositionedQuadrantChart,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set<number>(chart.quadrants.map(q => q.colorIndex))

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(quadrantStyles(colorIndices, colors.accent, colors.bg))

  // 1. Quadrant backgrounds
  for (const quadrant of chart.quadrants) {
    parts.push(
      `<rect x="${r(quadrant.rect.x)}" y="${r(quadrant.rect.y)}" ` +
      `width="${r(quadrant.rect.width)}" height="${r(quadrant.rect.height)}" ` +
      `class="quadrant-bg quadrant-color-${quadrant.colorIndex}" ` +
      `data-quadrant="${quadrant.number}"/>`
    )
  }

  // 2. Plot border and crosshair
  parts.push(
    `<rect x="${r(chart.plot.x)}" y="${r(chart.plot.y)}" ` +
    `width="${r(chart.plot.width)}" height="${r(chart.plot.height)}" ` +
    `class="quadrant-frame"/>`
  )
  parts.push(
    `<line x1="${r(chart.crosshair.vertical.x)}" y1="${r(chart.crosshair.vertical.y1)}" ` +
    `x2="${r(chart.crosshair.vertical.x)}" y2="${r(chart.crosshair.vertical.y2)}" ` +
    `class="quadrant-crosshair"/>`
  )
  parts.push(
    `<line x1="${r(chart.crosshair.horizontal.x1)}" y1="${r(chart.crosshair.horizontal.y)}" ` +
    `x2="${r(chart.crosshair.horizontal.x2)}" y2="${r(chart.crosshair.horizontal.y)}" ` +
    `class="quadrant-crosshair"/>`
  )

  // 3. Quadrant labels
  for (const quadrant of chart.quadrants) {
    if (!quadrant.title) continue
    parts.push(
      `<text x="${r(quadrant.labelX)}" y="${r(quadrant.labelY)}" text-anchor="middle" ` +
      `font-size="${FONT.quadrantSize}" font-weight="${FONT.quadrantWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="quadrant-label">${escapeXml(quadrant.title)}</text>`
    )
  }

  // 4. Axis end labels
  for (const label of chart.axisLabels) {
    parts.push(
      `<text x="${r(label.x)}" y="${r(label.y)}" text-anchor="${label.anchor}" ` +
      `font-size="${FONT.axisSize}" font-weight="${FONT.axisWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="quadrant-axis quadrant-axis-${label.side}">` +
      `${escapeXml(label.text)}</text>`
    )
  }

  // 5. Point markers and labels
  for (const point of chart.points) {
    const extraClass = point.className ? ` ${escapeXml(point.className)}` : ''
    parts.push(
      `<circle cx="${r(point.cx)}" cy="${r(point.cy)}" r="${r(point.radius)}" ` +
      `class="quadrant-point${extraClass}"${pointStyleAttr(point.styles)} ` +
      `data-point="${escapeXml(point.label)}" ` +
      `data-x="${point.dataX}" data-y="${point.dataY}">` +
      `<title>${escapeXml(point.label)} (${point.dataX}, ${point.dataY})</title></circle>`
    )
    parts.push(
      `<text x="${r(point.labelX)}" y="${r(point.labelY)}" text-anchor="start" ` +
      `font-size="${FONT.pointSize}" font-weight="${FONT.pointWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="quadrant-point-label">${escapeXml(point.label)}</text>`
    )
  }

  // 6. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="quadrant-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Per-point style overrides
// ---------------------------------------------------------------------------

/**
 * Build the inline `style` attribute for a point's explicit overrides.
 * Returns an empty string when the point uses theme defaults, so unstyled
 * points stay fully theme-driven.
 */
function pointStyleAttr(styles: {
  color?: string
  strokeColor?: string
  strokeWidth?: string
}): string {
  const decls = [
    styles.color ? `fill:${styles.color}` : '',
    styles.strokeColor ? `stroke:${styles.strokeColor}` : '',
    styles.strokeWidth ? `stroke-width:${styles.strokeWidth}` : '',
  ].filter(Boolean)

  return decls.length > 0 ? ` style="${decls.join(';')}"` : ''
}

// ============================================================================
// Quadrant-specific CSS
//
// One `--quadrant-color-N` custom property per quadrant. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent recolours the first
// quadrant live; later indices come from the shared palette generator.
// ============================================================================

function quadrantStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --quadrant-color-${idx}: ${value};`)
    rules.push(`  .quadrant-color-${idx} { fill: color-mix(in srgb, var(--quadrant-color-${idx}) 8%, var(--bg)); }`)
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .quadrant-bg { stroke: none; }
  .quadrant-frame { fill: none; stroke: var(--_line); stroke-width: 1; opacity: 0.6; }
  .quadrant-crosshair { stroke: var(--_line); stroke-width: 1; opacity: 0.45; }
  .quadrant-label { fill: var(--_text-sec); }
  .quadrant-axis { fill: var(--_text-sec); }
  .quadrant-point { fill: var(--accent, ${CHART_ACCENT_FALLBACK}); stroke: var(--bg); stroke-width: 1.5; }
  .quadrant-point-label { fill: var(--_text); }
  .quadrant-title { fill: var(--_text); }
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
