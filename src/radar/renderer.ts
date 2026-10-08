import type { PositionedRadar } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Radar chart SVG renderer
//
// Renders a positioned radar chart to an SVG string. Each curve takes its own
// palette index from the xychart generator, so a radar and a line chart of the
// same series agree on colour.
//
// Render order (back to front):
//   1. Grid rings
//   2. Spokes
//   3. Curve fills and outlines
//   4. Curve vertices (+ accessible <title>)
//   5. Axis labels
//   6. Legend
//   7. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  axisSize: 12,
  axisWeight: 500,
  legendSize: 12,
  legendWeight: 500,
  /** Radius of a data point dot */
  dotRadius: 3,
} as const

/**
 * Render a positioned radar chart as a self-contained SVG string.
 */
export function renderRadarSvg(
  chart: PositionedRadar,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set(chart.curves.map(c => c.colorIndex))

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(radarStyles(colorIndices, colors.accent, colors.bg))

  // 1. Grid rings — the outermost is drawn more strongly as the chart border
  for (const ring of chart.rings) {
    parts.push(
      `<path d="${ring.path}" class="radar-ring${ring.outer ? ' radar-ring-outer' : ''}"/>`
    )
  }

  // 2. Spokes
  for (const spoke of chart.spokes) {
    parts.push(
      `<line x1="${r(spoke.x1)}" y1="${r(spoke.y1)}" x2="${r(spoke.x2)}" y2="${r(spoke.y2)}" ` +
      `class="radar-spoke"/>`
    )
  }

  // 3. Curves — a translucent fill under a solid outline, so overlapping
  // curves stay readable
  for (const curve of chart.curves) {
    if (!curve.path) continue
    parts.push(
      `<path d="${curve.path}" class="radar-area radar-fill-${curve.colorIndex}" ` +
      `data-curve="${escapeXml(curve.name)}"/>`
    )
    parts.push(
      `<path d="${curve.path}" class="radar-line radar-stroke-${curve.colorIndex}"/>`
    )
  }

  // 4. Vertices
  for (const curve of chart.curves) {
    for (const point of curve.points) {
      parts.push(
        `<circle cx="${r(point.x)}" cy="${r(point.y)}" r="${FONT.dotRadius}" ` +
        `class="radar-dot radar-dot-${curve.colorIndex}">` +
        `<title>${escapeXml(`${curve.label} — ${point.axis}: ${point.value}`)}</title></circle>`
      )
    }
  }

  // 5. Axis labels
  for (const spoke of chart.spokes) {
    parts.push(
      `<text x="${r(spoke.labelX)}" y="${r(spoke.labelY)}" text-anchor="${spoke.labelAnchor}" ` +
      `font-size="${FONT.axisSize}" font-weight="${FONT.axisWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="radar-axis-label">${escapeXml(spoke.label)}</text>`
    )
  }

  // 6. Legend
  for (const entry of chart.legend) {
    parts.push(
      `<rect x="${r(entry.x)}" y="${r(entry.y)}" width="11" height="11" rx="2" ry="2" ` +
      `class="radar-swatch radar-swatch-${entry.colorIndex}"/>`
    )
    parts.push(
      `<text x="${r(entry.labelX)}" y="${r(entry.labelY)}" text-anchor="start" ` +
      `font-size="${FONT.legendSize}" font-weight="${FONT.legendWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="radar-legend-label">${escapeXml(entry.label)}</text>`
    )
  }

  // 7. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="radar-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Radar-specific CSS
//
// One `--radar-color-N` custom property per curve. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent recolours the first
// curve live; later indices come from the shared palette generator.
// ============================================================================

function radarStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --radar-color-${idx}: ${value};`)
    rules.push(`  .radar-fill-${idx} { fill: var(--radar-color-${idx}); }`)
    rules.push(`  .radar-stroke-${idx} { stroke: var(--radar-color-${idx}); }`)
    rules.push(`  .radar-dot-${idx} { fill: var(--radar-color-${idx}); }`)
    rules.push(`  .radar-swatch-${idx} { fill: var(--radar-color-${idx}); }`)
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .radar-ring { fill: none; stroke: var(--_inner-stroke); stroke-width: 1; }
  .radar-ring-outer { stroke: var(--_line); opacity: 0.5; }
  .radar-spoke { stroke: var(--_inner-stroke); stroke-width: 1; }
  .radar-area { fill-opacity: 0.14; stroke: none; }
  .radar-line { fill: none; stroke-width: 2; stroke-linejoin: round; }
  .radar-dot { stroke: var(--bg); stroke-width: 1.5; }
  .radar-axis-label { fill: var(--_text-sec); }
  .radar-legend-label { fill: var(--_text-sec); }
  .radar-swatch { stroke: none; }
  .radar-title { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r(n: number): string {
  return String(Math.round(n * 10) / 10)
}
