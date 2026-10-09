import type {
  KanbanPriority,
  PositionedKanban,
  PositionedKanbanCard,
  PositionedKanbanColumn,
} from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml, safeStyleString } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'
import { KANBAN_METRICS as K } from './layout.ts'

// ============================================================================
// Kanban board SVG renderer
//
// Renders a positioned kanban board to an SVG string. Each column takes its
// own palette index and tints its header and cards, so a card is recognisable
// as belonging to its column even when the board is scrolled past the header.
//
// Render order (back to front):
//   1. Column bodies
//   2. Column headers and headings
//   3. Cards, their priority stripes, text and metadata chips
//   4. Title
// ============================================================================

/** Corner radii, picked so cards read as smaller objects than columns. */
const RADIUS = { column: 8, card: 5, chip: 3 } as const

/** How urgent each priority is, for the stripe colour. 0 is calmest. */
const PRIORITY_LEVEL: Record<KanbanPriority, number> = {
  'Very Low': 0,
  Low: 1,
  Medium: 2,
  High: 3,
  'Very High': 4,
}

/**
 * Render a positioned kanban board as a self-contained SVG string.
 */
export function renderKanbanSvg(
  chart: PositionedKanban,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set(chart.columns.map(c => c.colorIndex))

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(kanbanStyles(colorIndices, colors.accent, colors.bg))

  for (const column of chart.columns) {
    parts.push(...renderColumn(column))
  }

  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${K.titleFontSize}" font-weight="${K.titleFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="kanban-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Draw one column: its body, its header band, its heading and its cards. */
function renderColumn(column: PositionedKanbanColumn): string[] {
  const parts: string[] = []
  const { x, y, width: w, height: h, headerHeight: hh } = column

  const classes = ['kanban-column', `kanban-column-${column.colorIndex}`]
  if (column.class) classes.push(...column.class.split(/\s+/).map(c => escapeXml(c)))
  const safe = safeStyleString(column.style)
  const style = safe ? ` style="${escapeXml(safe)}"` : ''

  parts.push(
    `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ` +
    `rx="${RADIUS.column}" ry="${RADIUS.column}" class="${classes.join(' ')}"${style} ` +
    `data-column="${escapeXml(column.id)}">` +
    `<title>${escapeXml(column.label)}</title></rect>`
  )

  // The header band is the column rect clipped to its top corners: a path,
  // because only the top two corners are rounded.
  parts.push(
    `<path d="${roundedTop(x, y, w, hh, RADIUS.column)}" ` +
    `class="kanban-header kanban-header-${column.colorIndex}"/>`
  )

  // A rule under the header, so the band reads as attached to the column
  parts.push(
    `<line x1="${r(x)}" y1="${r(y + hh)}" x2="${r(x + w)}" y2="${r(y + hh)}" ` +
    `class="kanban-header-rule kanban-rule-${column.colorIndex}"/>`
  )

  const labelX = x + K.columnPadX + (column.icon ? K.iconWidth : 0)
  // Centre the wrapped heading vertically in the band
  const blockHeight = column.headerLines.length * K.headerLineHeight
  const firstBaseline = y + (hh - blockHeight) / 2 + K.headerLineHeight / 2

  if (column.icon) {
    parts.push(
      `<text x="${r(x + K.columnPadX)}" y="${r(firstBaseline)}" ` +
      `font-size="${K.headerFontSize}" dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="kanban-icon">${escapeXml(iconGlyph(column.icon))}</text>`
    )
  }

  for (const [index, line] of column.headerLines.entries()) {
    parts.push(
      `<text x="${r(labelX)}" y="${r(firstBaseline + index * K.headerLineHeight)}" ` +
      `font-size="${K.headerFontSize}" font-weight="${K.headerFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="kanban-column-label">${escapeXml(line)}</text>`
    )
  }

  for (const card of column.cards) {
    parts.push(...renderCard(card))
  }

  return parts
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Draw one card: its body, its priority stripe, its text and its chips. */
function renderCard(card: PositionedKanbanCard): string[] {
  const parts: string[] = []
  const { x, y, width: w, height: h } = card

  const classes = ['kanban-card', `kanban-card-${card.colorIndex}`]
  if (card.class) classes.push(...card.class.split(/\s+/).map(c => escapeXml(c)))
  const safe = safeStyleString(card.style)
  const style = safe ? ` style="${escapeXml(safe)}"` : ''

  const data = [
    `data-card="${escapeXml(card.id)}"`,
    card.priority ? `data-priority="${escapeXml(card.priority)}"` : '',
  ].filter(Boolean).join(' ')

  parts.push(
    `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ` +
    `rx="${RADIUS.card}" ry="${RADIUS.card}" class="${classes.join(' ')}"${style} ${data}>` +
    `<title>${escapeXml(cardTooltip(card))}</title></rect>`
  )

  if (card.priority) {
    // A stripe down the left edge, rounded on the left to follow the card
    parts.push(
      `<path d="${roundedLeft(x, y, K.stripeWidth, h, RADIUS.card)}" ` +
      `class="kanban-stripe kanban-priority-${PRIORITY_LEVEL[card.priority]}"/>`
    )
  }

  const textX = x + K.cardPadX + (card.priority ? K.stripeWidth : 0) +
    (card.icon ? K.iconWidth : 0)
  const firstBaseline = y + K.cardPadY + K.cardLineHeight / 2

  if (card.icon) {
    parts.push(
      `<text x="${r(x + K.cardPadX + (card.priority ? K.stripeWidth : 0))}" ` +
      `y="${r(firstBaseline)}" font-size="${K.cardFontSize}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="kanban-icon">` +
      `${escapeXml(iconGlyph(card.icon))}</text>`
    )
  }

  for (const [index, line] of card.lines.entries()) {
    parts.push(
      `<text x="${r(textX)}" y="${r(firstBaseline + index * K.cardLineHeight)}" ` +
      `font-size="${K.cardFontSize}" font-weight="${K.cardFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="kanban-card-label">${escapeXml(line)}</text>`
    )
  }

  for (const chip of card.chips) {
    parts.push(
      `<rect x="${r(chip.x)}" y="${r(chip.y)}" width="${r(chip.width)}" ` +
      `height="${r(chip.height)}" rx="${RADIUS.chip}" ry="${RADIUS.chip}" ` +
      `class="kanban-chip kanban-chip-${chip.kind}"/>`
    )
    parts.push(
      `<text x="${r(chip.x + chip.width / 2)}" y="${r(chip.y + chip.height / 2)}" ` +
      `text-anchor="middle" font-size="${K.chipFontSize}" ` +
      `font-weight="${K.chipFontWeight}" dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="kanban-chip-label kanban-chip-label-${chip.kind}">` +
      `${escapeXml(chip.text)}</text>`
    )
  }

  return parts
}

/**
 * Accessible description of a card.
 *
 * Metadata is appended to the label, because a screen reader reaching the
 * card should hear who owns it without having to find the chips separately.
 */
function cardTooltip(card: PositionedKanbanCard): string {
  const extras: string[] = []
  if (card.priority) extras.push(`priority: ${card.priority}`)
  for (const chip of card.chips) {
    if (chip.kind !== 'id') extras.push(`${chip.kind}: ${chip.text}`)
  }
  return extras.length > 0 ? `${card.label} (${extras.join(', ')})` : card.label
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/**
 * Stand-in glyph for an `::icon(name)` declaration.
 *
 * Upstream pulls icon packs from the network at render time; this renderer is
 * synchronous and offline, so a named icon becomes a single character that
 * occupies the same slot. A name with no glyph gets a neutral bullet rather
 * than nothing, so the layout's reserved space does not look like a bug.
 */
function iconGlyph(name: string): string {
  const glyphs: Record<string, string> = {
    bomb: '\u25C8',
    heart: '\u2665',
    star: '\u2605',
    clock: '\u25D4',
    check: '\u2713',
    cross: '\u2717',
    warning: '\u26A0',
    flag: '\u2691',
    bug: '\u2638',
    rocket: '\u27A4',
    fire: '\u2668',
    person: '\u263A',
    lock: '\u26BF',
    note: '\u270E',
  }
  return glyphs[name.toLowerCase()] ?? '\u2022'
}

// ---------------------------------------------------------------------------
// Partially rounded rectangles
// ---------------------------------------------------------------------------

/** Path for a rectangle with only its top two corners rounded. */
function roundedTop(
  x: number, y: number, w: number, h: number, radius: number,
): string {
  const rad = Math.min(radius, w / 2, h)
  return [
    `M${r(x)},${r(y + h)}`,
    `L${r(x)},${r(y + rad)}`,
    `Q${r(x)},${r(y)} ${r(x + rad)},${r(y)}`,
    `L${r(x + w - rad)},${r(y)}`,
    `Q${r(x + w)},${r(y)} ${r(x + w)},${r(y + rad)}`,
    `L${r(x + w)},${r(y + h)}`,
    'Z',
  ].join(' ')
}

/** Path for a rectangle with only its left two corners rounded. */
function roundedLeft(
  x: number, y: number, w: number, h: number, radius: number,
): string {
  const rad = Math.min(radius, w, h / 2)
  return [
    `M${r(x + w)},${r(y)}`,
    `L${r(x + rad)},${r(y)}`,
    `Q${r(x)},${r(y)} ${r(x)},${r(y + rad)}`,
    `L${r(x)},${r(y + h - rad)}`,
    `Q${r(x)},${r(y + h)} ${r(x + rad)},${r(y + h)}`,
    `L${r(x + w)},${r(y + h)}`,
    'Z',
  ].join(' ')
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Build the kanban stylesheet.
 *
 * One custom property per column, so a host page can recolour a single
 * column, and priority colours interpolated from the theme so the stripes
 * stay legible in both light and dark themes.
 */
function kanbanStyles(
  colorIndices: Set<number>,
  themeAccent?: string,
  bgColor?: string,
): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    // Index 0 resolves through var(--accent) so live theme switching works
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --kanban-color-${idx}: ${value};`)
    rules.push(
      `  .kanban-column-${idx} { ` +
      `fill: color-mix(in srgb, var(--kanban-color-${idx}) 7%, var(--bg)); ` +
      `stroke: color-mix(in srgb, var(--kanban-color-${idx}) 28%, var(--bg)); }\n` +
      `  .kanban-header-${idx} { ` +
      `fill: color-mix(in srgb, var(--kanban-color-${idx}) 20%, var(--bg)); }\n` +
      `  .kanban-rule-${idx} { ` +
      `stroke: color-mix(in srgb, var(--kanban-color-${idx}) 38%, var(--bg)); }`
    )
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  svg {
    /*
     * Urgency is the one thing on a board that should not be themeable away:
     * a red stripe means the same in every palette. It is nudged towards the
     * foreground so it stays legible on a dark background.
     */
    --_kanban-urgent: color-mix(in srgb, #e11d48 85%, var(--fg));
    --_kanban-calm:   color-mix(in srgb, var(--fg) 30%, var(--bg));
  }
  .kanban-column { stroke-width: 1; }
  .kanban-header { stroke: none; }
  .kanban-header-rule { stroke-width: 1; }
  .kanban-column-label { fill: var(--_text); }
  .kanban-card {
    fill: var(--surface, color-mix(in srgb, var(--fg) 2%, var(--bg)));
    stroke: var(--border, color-mix(in srgb, var(--fg) 16%, var(--bg)));
    stroke-width: 1;
  }
  .kanban-card-label { fill: var(--_text); }
  .kanban-stripe { stroke: none; }
  .kanban-priority-0 { fill: var(--_kanban-calm); }
  .kanban-priority-1 { fill: color-mix(in srgb, var(--_kanban-urgent) 25%, var(--_kanban-calm)); }
  .kanban-priority-2 { fill: color-mix(in srgb, var(--_kanban-urgent) 50%, var(--_kanban-calm)); }
  .kanban-priority-3 { fill: color-mix(in srgb, var(--_kanban-urgent) 78%, var(--_kanban-calm)); }
  .kanban-priority-4 { fill: var(--_kanban-urgent); }
  .kanban-chip { fill: color-mix(in srgb, var(--fg) 8%, var(--bg)); stroke: none; }
  .kanban-chip-ticket { fill: color-mix(in srgb, var(--accent, ${CHART_ACCENT_FALLBACK}) 14%, var(--bg)); }
  .kanban-chip-label { fill: var(--_text-sec); }
  .kanban-chip-label-id { fill: var(--_text-muted); }
  .kanban-icon { fill: var(--_text-sec); }
  .kanban-title { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

/** Round to two decimals, keeping paths short without visible drift. */
function r(value: number): number {
  return Math.round(value * 100) / 100
}
