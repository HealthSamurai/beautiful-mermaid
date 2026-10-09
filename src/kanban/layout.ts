import type {
  KanbanChip,
  KanbanDiagram,
  PositionedKanban,
  PositionedKanbanCard,
  PositionedKanbanColumn,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'

// ============================================================================
// Kanban layout engine
//
// Columns of fixed width sit side by side; cards stack down each column. The
// board is as tall as its longest column, so the columns all share a bottom
// edge and read as one surface rather than as separate lists.
//
// Column width is fixed rather than fitted to content, because a kanban board
// is a comparison between columns: a wide "Done" next to a narrow "Todo"
// would suggest the work is bigger there, which is the opposite of what the
// board says. Labels wrap to the fixed width instead.
// ============================================================================

/** Layout constants. */
const K = {
  padding: 20,
  /** Fixed column width — see the note above on why it is not fitted */
  columnWidth: 210,
  /** Gap between columns */
  columnGap: 16,
  /** Gap between cards inside a column */
  cardGap: 8,
  /** Horizontal padding inside a column, around its cards */
  columnPadX: 10,
  /** Vertical padding inside a column, below the header and above the floor */
  columnPadY: 10,
  /** Height of the column header band */
  headerHeight: 34,
  headerFontSize: 14,
  headerFontWeight: 600,
  /** Extra header height per wrapped line beyond the first */
  headerLineHeight: 18,
  /** Horizontal padding inside a card */
  cardPadX: 10,
  /** Vertical padding inside a card */
  cardPadY: 9,
  cardFontSize: 13,
  cardFontWeight: 400,
  cardLineHeight: 17,
  /** Maximum lines a card label wraps to before it is clipped */
  maxLines: 6,
  /** Metadata chip geometry */
  chipHeight: 17,
  chipGap: 5,
  chipPadX: 7,
  chipFontSize: 10,
  chipFontWeight: 500,
  /** Gap between a card's text and its chip row */
  chipMarginTop: 7,
  /** Width of the priority stripe down a card's left edge */
  stripeWidth: 3,
  /** Extra width reserved for an icon prefix */
  iconWidth: 18,
  titleFontSize: 18,
  titleFontWeight: 600,
  /** Vertical space the title occupies above the board */
  titleHeight: 36,
  /** Minimum column height, so an empty column is still a visible column */
  minColumnHeight: 90,
} as const

/**
 * Lay out a parsed kanban board: columns left to right, cards top to bottom.
 *
 * Every column is given the height of the tallest one, so the board has a
 * single bottom edge.
 */
export function layoutKanban(
  diagram: KanbanDiagram,
  _options: RenderOptions = {},
): PositionedKanban {
  const titleHeight = diagram.title ? K.titleHeight : 0
  const top = K.padding + titleHeight

  // 1. Build each column's contents, measuring as we go. Heights are
  //    provisional — they are equalised in step 2.
  const columns: PositionedKanbanColumn[] = []
  let x = K.padding

  for (const [index, section] of diagram.sections.entries()) {
    const innerWidth = K.columnWidth - K.columnPadX * 2

    const headerLines = wrap(
      section.label,
      innerWidth - (section.icon ? K.iconWidth : 0),
      K.headerFontSize,
      K.headerFontWeight,
    )
    const headerHeight =
      K.headerHeight + (headerLines.length - 1) * K.headerLineHeight

    const cards: PositionedKanbanCard[] = []
    let cardY = top + headerHeight + K.columnPadY

    for (const item of section.items) {
      const card = layoutCard(
        item,
        x + K.columnPadX,
        cardY,
        innerWidth,
        index,
        diagram.showIds === true,
      )
      cards.push(card)
      cardY += card.height + K.cardGap
    }

    // Drop the gap that follows the last card; an empty column keeps none
    const contentBottom = cards.length > 0 ? cardY - K.cardGap : cardY
    const height = Math.max(
      contentBottom + K.columnPadY - top,
      K.minColumnHeight,
    )

    columns.push({
      id: section.id,
      headerLines,
      label: section.label,
      x,
      y: top,
      width: K.columnWidth,
      height,
      headerHeight,
      colorIndex: index,
      cards,
      class: section.class,
      icon: section.icon,
      style: section.style,
    })

    x += K.columnWidth + K.columnGap
  }

  // 2. Equalise, so the columns share a bottom edge
  const tallest = columns.reduce((max, c) => Math.max(max, c.height), 0)
  for (const column of columns) column.height = tallest

  const contentWidth = columns.length > 0 ? x - K.columnGap : K.padding
  const width = Math.round(
    widthForTitle(
      contentWidth + K.padding,
      diagram.title,
      K.titleFontSize,
      K.titleFontWeight,
      K.padding,
    ),
  )
  const height = Math.round(top + tallest + K.padding)

  const chart: PositionedKanban = { width, height, columns }

  if (diagram.title) {
    chart.title = {
      text: diagram.title,
      x: Math.round(width / 2),
      y: Math.round(K.padding + K.titleFontSize / 2),
    }
  }

  return chart
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Measure and place one card.
 *
 * Height comes from the wrapped text plus a chip row when the card carries
 * metadata, so a bare card stays compact.
 */
function layoutCard(
  item: KanbanDiagram['sections'][number]['items'][number],
  x: number,
  y: number,
  width: number,
  colorIndex: number,
  showIds: boolean,
): PositionedKanbanCard {
  const textWidth =
    width - K.cardPadX * 2 - (item.priority ? K.stripeWidth : 0) -
    (item.icon ? K.iconWidth : 0)

  const lines = wrap(item.label, textWidth, K.cardFontSize, K.cardFontWeight)

  const chipTexts: { kind: KanbanChip['kind']; text: string }[] = []
  if (item.assigned) chipTexts.push({ kind: 'assigned', text: item.assigned })
  if (item.ticket) chipTexts.push({ kind: 'ticket', text: item.ticket })
  if (showIds) chipTexts.push({ kind: 'id', text: item.id })

  const textBottom = y + K.cardPadY + lines.length * K.cardLineHeight
  const chips = layoutChips(
    chipTexts,
    x + K.cardPadX + (item.priority ? K.stripeWidth : 0),
    textBottom + K.chipMarginTop,
    width - K.cardPadX * 2,
  )

  const contentBottom = chips.length > 0
    ? chips[chips.length - 1]!.y + K.chipHeight
    : textBottom

  return {
    id: item.id,
    lines,
    label: item.label,
    x,
    y,
    width,
    height: Math.round(contentBottom + K.cardPadY - y),
    colorIndex,
    chips,
    priority: item.priority,
    class: item.class,
    icon: item.icon,
    style: item.style,
  }
}

/**
 * Place metadata chips left to right, wrapping onto a new row when the next
 * chip would overflow the card.
 */
function layoutChips(
  entries: { kind: KanbanChip['kind']; text: string }[],
  x: number,
  y: number,
  maxWidth: number,
): KanbanChip[] {
  const chips: KanbanChip[] = []
  let cursorX = x
  let cursorY = y

  for (const entry of entries) {
    const width = Math.round(
      estimateTextWidth(entry.text, K.chipFontSize, K.chipFontWeight) +
      K.chipPadX * 2,
    )

    if (cursorX > x && cursorX + width > x + maxWidth) {
      cursorX = x
      cursorY += K.chipHeight + K.chipGap
    }

    chips.push({
      kind: entry.kind,
      text: entry.text,
      x: cursorX,
      y: cursorY,
      width,
      height: K.chipHeight,
    })

    cursorX += width + K.chipGap
  }

  return chips
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Wrap text to a pixel width using the DOM-free metrics, clipping at maxLines. */
function wrap(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  const out: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (estimateTextWidth(candidate, fontSize, fontWeight) <= maxWidth || !line) {
      line = candidate
    } else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  if (out.length === 0) out.push('')

  return out.slice(0, K.maxLines)
}

/** Geometry constants, exported so the renderer draws text where layout put it. */
export const KANBAN_METRICS = {
  cardPadX: K.cardPadX,
  cardPadY: K.cardPadY,
  cardFontSize: K.cardFontSize,
  cardFontWeight: K.cardFontWeight,
  cardLineHeight: K.cardLineHeight,
  columnPadX: K.columnPadX,
  headerFontSize: K.headerFontSize,
  headerFontWeight: K.headerFontWeight,
  headerLineHeight: K.headerLineHeight,
  headerHeight: K.headerHeight,
  chipFontSize: K.chipFontSize,
  chipFontWeight: K.chipFontWeight,
  stripeWidth: K.stripeWidth,
  iconWidth: K.iconWidth,
  titleFontSize: K.titleFontSize,
  titleFontWeight: K.titleFontWeight,
} as const
