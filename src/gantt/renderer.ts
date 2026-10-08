import type { PositionedGantt, GanttTaskStatus } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK } from '../xychart/colors.ts'

// ============================================================================
// Gantt SVG renderer
//
// Renders a positioned gantt chart to an SVG string. Every color comes from
// the theme system — either a derived var(--_xxx) or a color-mix() over the
// theme accent — so the chart re-themes without re-rendering.
//
// Status palette (all derived, nothing hardcoded):
//   default  — accent at medium strength
//   done     — muted fg tint, no accent: visually "settled"
//   active   — accent at full strength, with a brighter left edge
//   crit     — accent at full strength with a dashed outline
//
// Render order (back to front):
//   1. Section bands (alternating tint)
//   2. Grid lines
//   3. Axis baseline + axis labels
//   4. Task bars (+ their labels)
//   5. Milestone diamonds (+ their labels)
//   6. Section labels in the gutter
//   7. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  sectionSize: 13,
  sectionWeight: 600,
  taskSize: 12,
  taskWeight: 500,
  axisSize: 12,
  axisWeight: 400,
  barRadius: 4,
} as const

/**
 * Render a positioned gantt diagram as a self-contained SVG string.
 */
export function renderGanttSvg(
  chart: PositionedGantt,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(ganttStyles())

  // 1. Section bands — alternating tint keeps adjacent sections readable
  for (const section of chart.sections) {
    if (!section.alternate) continue
    parts.push(
      `<rect x="${r(section.band.x)}" y="${r(section.band.y)}" ` +
      `width="${r(section.band.width)}" height="${r(section.band.height)}" class="gantt-band"/>`
    )
  }

  // 2. Grid lines
  for (const g of chart.gridLines) {
    parts.push(`<line x1="${r(g.x1)}" y1="${r(g.y1)}" x2="${r(g.x2)}" y2="${r(g.y2)}" class="gantt-grid"/>`)
  }

  // 3. Axis baseline + labels
  const { line } = chart.axis
  parts.push(`<line x1="${r(line.x1)}" y1="${r(line.y1)}" x2="${r(line.x2)}" y2="${r(line.y2)}" class="gantt-axis-line"/>`)
  for (const tick of chart.axis.ticks) {
    parts.push(
      `<text x="${r(tick.x)}" y="${r(tick.labelY)}" text-anchor="middle" ` +
      `font-size="${FONT.axisSize}" font-weight="${FONT.axisWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="gantt-axis-label">${escapeXml(tick.label)}</text>`
    )
  }

  // 4. Task bars
  for (const bar of chart.bars) {
    const cls = `gantt-bar gantt-${bar.status}`
    parts.push(
      `<rect x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.width)}" height="${r(bar.height)}" ` +
      `rx="${FONT.barRadius}" ry="${FONT.barRadius}" class="${cls}" ` +
      `data-task="${escapeXml(bar.id)}" data-start="${isoDay(bar.start)}" data-end="${isoDay(bar.end)}">` +
      `<title>${escapeXml(`${bar.label} — ${isoDay(bar.start)} → ${isoDay(bar.end)}`)}</title></rect>`
    )

    const labelCls = bar.labelOutside ? 'gantt-task-label-out' : `gantt-task-label-in gantt-text-${bar.status}`
    parts.push(
      `<text x="${r(bar.labelX)}" y="${r(bar.labelY)}" text-anchor="${bar.labelAnchor}" ` +
      `font-size="${FONT.taskSize}" font-weight="${FONT.taskWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="${labelCls}">${escapeXml(bar.label)}</text>`
    )
  }

  // 5. Milestones — diamonds centered on their instant
  for (const m of chart.milestones) {
    const d = [
      `M${r(m.cx)},${r(m.cy - m.radius)}`,
      `L${r(m.cx + m.radius)},${r(m.cy)}`,
      `L${r(m.cx)},${r(m.cy + m.radius)}`,
      `L${r(m.cx - m.radius)},${r(m.cy)}`,
      'Z',
    ].join(' ')

    parts.push(
      `<path d="${d}" class="gantt-milestone gantt-${m.status}" ` +
      `data-task="${escapeXml(m.id)}" data-start="${isoDay(m.time)}">` +
      `<title>${escapeXml(`${m.label} — ${isoDay(m.time)}`)}</title></path>`
    )
    parts.push(
      `<text x="${r(m.labelX)}" y="${r(m.labelY)}" text-anchor="${m.labelAnchor}" ` +
      `font-size="${FONT.taskSize}" font-weight="${FONT.taskWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="gantt-task-label-out">${escapeXml(m.label)}</text>`
    )
  }

  // 6. Section labels
  for (const section of chart.sections) {
    if (!section.title) continue
    parts.push(
      `<text x="${r(section.labelX)}" y="${r(section.labelY)}" text-anchor="end" ` +
      `font-size="${FONT.sectionSize}" font-weight="${FONT.sectionWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="gantt-section-label">${escapeXml(section.title)}</text>`
    )
  }

  // 7. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="gantt-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Gantt-specific CSS
//
// `--_gantt-accent` resolves to the theme accent with a blue fallback, so a
// mono bg/fg theme still produces a colored, readable chart. Status fills are
// color-mix() over it, which means a host page swapping --accent re-colors the
// whole chart live.
// ============================================================================

function ganttStyles(): string {
  return `<style>
  svg {
    --_gantt-accent: var(--accent, ${CHART_ACCENT_FALLBACK});
    --_gantt-default:  color-mix(in srgb, var(--_gantt-accent) 62%, var(--bg));
    --_gantt-active:   var(--_gantt-accent);
    --_gantt-crit:     color-mix(in srgb, var(--_gantt-accent) 80%, var(--fg));
    --_gantt-done:     color-mix(in srgb, var(--fg) 26%, var(--bg));
  }
  .gantt-band { fill: color-mix(in srgb, var(--fg) 4%, var(--bg)); }
  .gantt-grid { stroke: var(--_inner-stroke); stroke-width: 1; }
  .gantt-axis-line { stroke: var(--_line); stroke-width: 1; opacity: 0.55; }
  .gantt-axis-label { fill: var(--_text-muted); }
  .gantt-section-label { fill: var(--_text-sec); }
  .gantt-title { fill: var(--_text); }
  .gantt-bar { stroke-width: 1; }
  .gantt-bar.gantt-default   { fill: var(--_gantt-default); stroke: color-mix(in srgb, var(--_gantt-accent) 80%, var(--bg)); }
  .gantt-bar.gantt-active    { fill: var(--_gantt-active);  stroke: color-mix(in srgb, var(--_gantt-accent) 85%, var(--fg)); }
  .gantt-bar.gantt-crit      { fill: var(--_gantt-crit);    stroke: var(--fg); stroke-dasharray: 4 2; }
  .gantt-bar.gantt-done      { fill: var(--_gantt-done);    stroke: color-mix(in srgb, var(--fg) 38%, var(--bg)); }
  .gantt-milestone { stroke-width: 1.5; }
  .gantt-milestone.gantt-default { fill: var(--_gantt-default); stroke: var(--_gantt-accent); }
  .gantt-milestone.gantt-active  { fill: var(--_gantt-active);  stroke: var(--_gantt-accent); }
  .gantt-milestone.gantt-crit    { fill: var(--_gantt-crit);    stroke: var(--fg); }
  .gantt-milestone.gantt-done    { fill: var(--_gantt-done);    stroke: color-mix(in srgb, var(--fg) 38%, var(--bg)); }
  .gantt-task-label-out { fill: var(--_text-sec); }
  .gantt-task-label-in { fill: var(--bg); }
  .gantt-task-label-in.gantt-text-done { fill: var(--_text); }
</style>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO day (YYYY-MM-DD) for data attributes and tooltips. */
function isoDay(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10)
}

function r(n: number): string {
  return String(Math.round(n * 10) / 10)
}
