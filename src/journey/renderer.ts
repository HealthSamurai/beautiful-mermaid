import type { PositionedJourney } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Journey SVG renderer
//
// Renders a positioned user journey to an SVG string. Section colours reuse
// the xychart palette generator, so a journey matches a chart rendered from
// the same theme. Index 0 resolves to var(--accent) through a CSS variable,
// keeping live theme switching working for the first section.
//
// Render order (back to front):
//   1. Section bands
//   2. Score gridlines (+ axis labels)
//   3. The experience curve
//   4. Task markers (+ accessible <title>)
//   5. Task labels and people rows
//   6. Section labels
//   7. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  sectionSize: 13,
  sectionWeight: 600,
  taskSize: 12,
  taskWeight: 500,
  peopleSize: 11,
  peopleWeight: 400,
  axisSize: 11,
  axisWeight: 400,
} as const

/**
 * Render a positioned journey diagram as a self-contained SVG string.
 */
export function renderJourneySvg(
  chart: PositionedJourney,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set<number>([
    ...chart.sections.map(s => s.colorIndex),
    ...chart.tasks.map(t => t.colorIndex),
  ])

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(journeyStyles(colorIndices, colors.accent, colors.bg))

  // 1. Section bands
  for (const section of chart.sections) {
    parts.push(
      `<rect x="${r(section.band.x)}" y="${r(section.band.y)}" ` +
      `width="${r(section.band.width)}" height="${r(section.band.height)}" ` +
      `rx="8" ry="8" class="journey-band journey-color-${section.colorIndex}"/>`
    )
  }

  // 2. Score gridlines and axis labels
  for (const line of chart.scoreLines) {
    parts.push(
      `<line x1="${r(line.x1)}" y1="${r(line.y)}" x2="${r(line.x2)}" y2="${r(line.y)}" ` +
      `class="journey-gridline"/>`
    )
    parts.push(
      `<text x="${r(line.labelX)}" y="${r(line.y)}" text-anchor="end" ` +
      `font-size="${FONT.axisSize}" font-weight="${FONT.axisWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="journey-axis-label">${line.score}</text>`
    )
  }

  // 3. The experience curve
  if (chart.curve.points.length > 1) {
    const points = chart.curve.points.map(p => `${r(p.x)},${r(p.y)}`).join(' ')
    parts.push(`<polyline points="${points}" class="journey-curve"/>`)
  }

  // 4. Task markers
  for (const task of chart.tasks) {
    parts.push(
      `<circle cx="${r(task.cx)}" cy="${r(task.cy)}" r="${task.radius}" ` +
      `class="journey-marker journey-marker-${task.colorIndex}" ` +
      `data-task="${escapeXml(task.label)}" data-score="${task.score}">` +
      `<title>${escapeXml(task.label)} — ${task.score}/5` +
      `${task.people.length > 0 ? ` (${escapeXml(task.people.join(', '))})` : ''}` +
      `</title></circle>`
    )
  }

  // 5. Task labels and people rows
  const taskLineHeight = FONT.taskSize * LINE_HEIGHT_RATIO
  for (const task of chart.tasks) {
    const spans = task.lines
      .map((line, i) => `<tspan x="${r(task.labelX)}" dy="${i === 0 ? 0 : r(taskLineHeight)}">${escapeXml(line)}</tspan>`)
      .join('')
    parts.push(
      `<text x="${r(task.labelX)}" y="${r(task.labelY)}" text-anchor="middle" ` +
      `font-size="${FONT.taskSize}" font-weight="${FONT.taskWeight}" ` +
      `class="journey-task-label">${spans}</text>`
    )

    if (task.peopleLabel) {
      parts.push(
        `<text x="${r(task.peopleLabel.x)}" y="${r(task.peopleLabel.y)}" text-anchor="middle" ` +
        `font-size="${FONT.peopleSize}" font-weight="${FONT.peopleWeight}" ` +
        `dy="${TEXT_BASELINE_SHIFT}" class="journey-people">${escapeXml(task.peopleLabel.text)}</text>`
      )
    }
  }

  // 6. Section labels
  for (const section of chart.sections) {
    if (!section.title) continue
    parts.push(
      `<text x="${r(section.labelX)}" y="${r(section.labelY)}" text-anchor="middle" ` +
      `font-size="${FONT.sectionSize}" font-weight="${FONT.sectionWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="journey-section-label">${escapeXml(section.title)}</text>`
    )
  }

  // 7. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="journey-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Journey-specific CSS
//
// One `--journey-color-N` custom property per section. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent recolours the first
// section live; later indices come from the shared palette generator.
// ============================================================================

function journeyStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --journey-color-${idx}: ${value};`)
    rules.push(`  .journey-color-${idx} { fill: color-mix(in srgb, var(--journey-color-${idx}) 7%, var(--bg)); }`)
    rules.push(`  .journey-marker-${idx} { fill: var(--journey-color-${idx}); stroke: var(--bg); }`)
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .journey-band { stroke: none; }
  .journey-gridline { stroke: var(--_line); stroke-width: 1; opacity: 0.45; }
  .journey-axis-label { fill: var(--_text-faint); }
  .journey-curve { fill: none; stroke: var(--_arrow); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; opacity: 0.75; }
  .journey-marker { stroke-width: 2; }
  .journey-task-label { fill: var(--_text); }
  .journey-people { fill: var(--_text-muted); }
  .journey-section-label { fill: var(--_text-sec); }
  .journey-title { fill: var(--_text); }
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
