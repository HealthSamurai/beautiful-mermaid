import type { PositionedTimeline } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml, renderMultilineText } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Timeline SVG renderer
//
// Renders a positioned timeline to an SVG string. Section colors reuse the
// xychart palette generator, so a timeline sits in the same color family as a
// chart rendered from the same theme. Index 0 resolves to var(--accent) via a
// CSS variable, which keeps live theme switching working for the first band.
//
// Render order (back to front):
//   1. Section bands
//   2. Axis spine
//   3. Connectors from markers to event stacks
//   4. Event cards (+ wrapped text)
//   5. Period markers (+ labels)
//   6. Section labels
//   7. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  sectionSize: 13,
  sectionWeight: 600,
  periodSize: 14,
  periodWeight: 600,
  eventSize: 12,
  eventWeight: 400,
  cardRadius: 6,
} as const

/**
 * Render a positioned timeline diagram as a self-contained SVG string.
 */
export function renderTimelineSvg(
  chart: PositionedTimeline,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  // How many distinct section colors this diagram needs
  const colorIndices = new Set<number>([
    ...chart.sections.map(s => s.colorIndex),
    ...chart.periods.map(p => p.colorIndex),
    ...chart.events.map(e => e.colorIndex),
  ])

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(timelineStyles(colorIndices, colors.accent, colors.bg))

  // 1. Section bands
  for (const section of chart.sections) {
    parts.push(
      `<rect x="${r(section.band.x)}" y="${r(section.band.y)}" ` +
      `width="${r(section.band.width)}" height="${r(section.band.height)}" ` +
      `rx="8" ry="8" class="timeline-band timeline-color-${section.colorIndex}"/>`
    )
  }

  // 2. Axis spine
  parts.push(
    `<line x1="${r(chart.axis.x1)}" y1="${r(chart.axis.y1)}" ` +
    `x2="${r(chart.axis.x2)}" y2="${r(chart.axis.y2)}" class="timeline-axis"/>`
  )

  // 3. Connectors
  for (const c of chart.connectors) {
    parts.push(
      `<line x1="${r(c.x1)}" y1="${r(c.y1)}" x2="${r(c.x2)}" y2="${r(c.y2)}" ` +
      `class="timeline-connector timeline-stroke-${c.colorIndex}"/>`
    )
  }

  // 4. Event cards
  for (const e of chart.events) {
    parts.push(
      `<rect x="${r(e.x)}" y="${r(e.y)}" width="${r(e.width)}" height="${r(e.height)}" ` +
      `rx="${FONT.cardRadius}" ry="${FONT.cardRadius}" ` +
      `class="timeline-event timeline-fill-${e.colorIndex}"/>`
    )
    parts.push(renderMultilineText(
      e.text,
      round(e.labelX),
      round(e.labelY),
      FONT.eventSize,
      `text-anchor="${e.labelAnchor}" font-size="${FONT.eventSize}" ` +
      `font-weight="${FONT.eventWeight}" class="timeline-event-label"`,
    ))
  }

  // 5. Period markers and labels
  for (const p of chart.periods) {
    parts.push(
      `<circle cx="${r(p.cx)}" cy="${r(p.cy)}" r="${p.radius}" ` +
      `class="timeline-marker timeline-marker-${p.colorIndex}"/>`
    )
    parts.push(
      `<text x="${r(p.labelX)}" y="${r(p.labelY)}" text-anchor="${p.labelAnchor}" ` +
      `font-size="${FONT.periodSize}" font-weight="${FONT.periodWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="timeline-period-label">${escapeXml(p.label)}</text>`
    )
  }

  // 6. Section labels
  for (const section of chart.sections) {
    if (!section.title) continue
    parts.push(
      `<text x="${r(section.labelX)}" y="${r(section.labelY)}" text-anchor="${section.labelAnchor}" ` +
      `font-size="${FONT.sectionSize}" font-weight="${FONT.sectionWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="timeline-section-label">${escapeXml(section.title)}</text>`
    )
  }

  // 7. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="timeline-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Timeline-specific CSS
//
// One `--timeline-color-N` custom property per section. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent re-colors the first
// section live; later indices come from the shared palette generator.
// ============================================================================

function timelineStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --timeline-color-${idx}: ${value};`)
    rules.push(`  .timeline-color-${idx} { fill: color-mix(in srgb, var(--timeline-color-${idx}) 7%, var(--bg)); }`)
    rules.push(`  .timeline-fill-${idx} { fill: color-mix(in srgb, var(--timeline-color-${idx}) 14%, var(--bg)); stroke: color-mix(in srgb, var(--timeline-color-${idx}) 35%, var(--bg)); }`)
    rules.push(`  .timeline-stroke-${idx} { stroke: color-mix(in srgb, var(--timeline-color-${idx}) 45%, var(--bg)); }`)
    rules.push(`  .timeline-marker-${idx} { fill: var(--timeline-color-${idx}); stroke: var(--bg); }`)
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .timeline-band { stroke: none; }
  .timeline-axis { stroke: var(--_line); stroke-width: 1.5; opacity: 0.5; stroke-linecap: round; }
  .timeline-connector { stroke-width: 1.5; }
  .timeline-event { stroke-width: 1; }
  .timeline-event-label { fill: var(--_text); }
  .timeline-marker { stroke-width: 2; }
  .timeline-period-label { fill: var(--_text); }
  .timeline-section-label { fill: var(--_text-sec); }
  .timeline-title { fill: var(--_text); }
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
