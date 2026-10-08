// ============================================================================
// Kanban types
//
// Models the parsed and positioned representations of a Mermaid `kanban`
// board: columns side by side, each holding a stack of cards.
//
// Like a mindmap, a kanban board is indentation-sensitive — the outermost
// indentation level is the columns, anything deeper is a card inside the
// column above it. So its parser takes raw (untrimmed) lines.
// ============================================================================

/**
 * Card priority, which upstream spells out in full words.
 *
 * Rendered as a coloured stripe down the left edge of the card, so the
 * urgent end of a board is visible without reading any text.
 */
export type KanbanPriority =
  | 'Very High'
  | 'High'
  | 'Medium'
  | 'Low'
  | 'Very Low'

// ============================================================================
// Parsed kanban — logical structure from mermaid text
// ============================================================================

/** Parsed kanban diagram. */
export interface KanbanDiagram {
  /** Optional heading, from `title` or from frontmatter */
  title?: string
  /** Columns in source order */
  sections: KanbanSection[]
  /** Show card ids on the cards — `config.kanban.showIds` */
  showIds?: boolean
}

/** One column of the board. */
export interface KanbanSection {
  /** Explicit id when the source gave one, else a generated `kbnN` */
  id: string
  /** Column heading */
  label: string
  /** Cards in source order */
  items: KanbanItem[]
  /** Class names from a `:::class1 class2` line, when present */
  class?: string
  /** Icon name from an `::icon(name)` line, when present */
  icon?: string
  /** Inline CSS from a `style <id> ...` statement, when present */
  style?: string
}

/** One card in a column. */
export interface KanbanItem {
  /** Explicit id when the source gave one, else a generated `kbnN` */
  id: string
  /** Card text */
  label: string
  /** `assigned:` from the `@{ ... }` metadata block */
  assigned?: string
  /** `ticket:` from the metadata block — a tracker reference */
  ticket?: string
  /** `priority:` from the metadata block */
  priority?: KanbanPriority
  /** `icon:` from the metadata block or an `::icon(name)` line */
  icon?: string
  /** Class names from a `:::class1 class2` line, when present */
  class?: string
  /** Inline CSS from a `style <id> ...` statement, when present */
  style?: string
}

// ============================================================================
// Positioned kanban — ready for SVG rendering
// ============================================================================

export interface PositionedKanban {
  width: number
  height: number
  /** Columns, left to right */
  columns: PositionedKanbanColumn[]
  /** Title anchor, when the diagram has one */
  title?: { text: string; x: number; y: number }
}

export interface PositionedKanbanColumn {
  /** Column id, emitted as a data attribute */
  id: string
  /** Heading, wrapped to the column width */
  headerLines: string[]
  /** Raw heading, for the accessible <title> child */
  label: string
  /** Column box, enclosing the header and every card */
  x: number
  y: number
  width: number
  height: number
  /** Header band height, measured from the top of the column box */
  headerHeight: number
  /** Palette index — one colour per column */
  colorIndex: number
  /** Cards, top to bottom */
  cards: PositionedKanbanCard[]
  /** Class names for host-page styling, when the source set any */
  class?: string
  /** Icon name, rendered as a text prefix on the header */
  icon?: string
  /** Inline CSS from a `style` statement */
  style?: string
}

export interface PositionedKanbanCard {
  /** Card id, emitted as a data attribute */
  id: string
  /** Card text, wrapped to the card width */
  lines: string[]
  /** Raw text, for the accessible <title> child */
  label: string
  /** Card box */
  x: number
  y: number
  width: number
  height: number
  /** Palette index, inherited from the column */
  colorIndex: number
  /**
   * Footer chips — assignee, ticket, id — laid out left to right under the
   * text. Absent when the card carries no metadata.
   */
  chips: KanbanChip[]
  /** Priority stripe down the left edge, when the card declares one */
  priority?: KanbanPriority
  /** Class names for host-page styling, when the source set any */
  class?: string
  /** Icon name, rendered as a text prefix */
  icon?: string
  /** Inline CSS from a `style` statement */
  style?: string
}

/** One metadata chip under a card's text. */
export interface KanbanChip {
  /** Which field this chip shows — drives its styling */
  kind: 'assigned' | 'ticket' | 'id'
  text: string
  x: number
  y: number
  width: number
  height: number
}
