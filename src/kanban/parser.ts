import type {
  KanbanDiagram,
  KanbanItem,
  KanbanPriority,
  KanbanSection,
} from './types.ts'

// ============================================================================
// Kanban parser
//
// Parses Mermaid `kanban` syntax into columns of cards. Like a mindmap, the
// structure comes from source indentation, so this parser needs RAW lines.
//
//   kanban
//     todo[Todo]
//       t1[Write the parser]
//       t2[Write the tests]
//     doing[In progress]
//       d1[Design the grammar]
//
// The outermost indentation level is the columns; everything deeper is a card
// in the column above it. Upstream deliberately does not distinguish deeper
// levels from each other — a doubly-indented line is still just a card — and
// neither do we, because a board has no third dimension to show it in.
//
// A card may carry metadata in a trailing `@{ ... }` block:
//
//     t1[Write the parser]@{ assigned: nikolai, priority: High }
//
// Decorations attach to the node most recently declared, as in a mindmap:
//
//     ::icon(bomb)        icon name
//     :::class1 class2    class names
//
// Columns may also be styled by id, after the board:
//
//     style todo fill:#eee,stroke:#333
// ============================================================================

/**
 * Bracket pairs that may wrap a label, longest opener first so `((` wins
 * over `(`.
 *
 * Kanban reuses the mindmap's shape syntax but ignores the shape itself: a
 * column is always a column and a card is always a card. The brackets are
 * still honoured because they are how an id is separated from a label.
 */
const BRACKETS: { open: string; close: string }[] = [
  { open: '))', close: '((' },
  { open: '((', close: '))' },
  { open: '{{', close: '}}' },
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: ')', close: '(' },
]

/** Priorities upstream accepts, lowercased for lookup. */
const PRIORITIES: Record<string, KanbanPriority> = {
  'very high': 'Very High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  'very low': 'Very Low',
}

/** Inline CSS declarations are rejected when they could break out of the attribute. */
const UNSAFE_STYLE = /[<>"']/

/**
 * Parse a Mermaid kanban board from RAW source text.
 *
 * Takes the whole text rather than preprocessed lines because indentation
 * carries the column/card distinction and would be destroyed by trimming.
 *
 * @throws When a card is indented less than the first column, which would
 *   leave it with no column to belong to.
 */
export function parseKanbanDiagram(text: string): KanbanDiagram {
  const diagram: KanbanDiagram = { sections: [] }

  // Column indentation, fixed by the first node — everything deeper is a card
  let columnIndent: number | undefined
  let generated = 0

  /** The node a `::icon` or `:::class` line would decorate. */
  let last: KanbanSection | KanbanItem | undefined

  /** Deferred, because a `style` statement may name a node declared later. */
  const styles: { id: string; css: string }[] = []

  for (const { indent, content } of logicalLines(text)) {
    const title = content.match(/^title\s+(.*)$/i)
    if (title) {
      const value = title[1]!.trim()
      if (value) diagram.title = value
      continue
    }

    const style = content.match(/^style\s+(\S+)\s+(.+)$/i)
    if (style) {
      styles.push({ id: style[1]!, css: style[2]!.trim() })
      continue
    }

    // ::icon(name) — attaches to the node declared above it
    const icon = content.match(/^::icon\(\s*(.+?)\s*\)$/i)
    if (icon) {
      if (last) last.icon = icon[1]!
      continue
    }

    // :::class1 class2 — attaches to the node declared above it
    const classes = content.match(/^:::\s*(.+)$/)
    if (classes) {
      if (last) last.class = classes[1]!.trim()
      continue
    }

    const { id, label, metadata } = parseNodeText(content)

    columnIndent ??= indent

    if (indent < columnIndent) {
      // A node shallower than the first column has nowhere to go: it is
      // neither a column (the columns are already established at a deeper
      // indent) nor a card (it has no column above it).
      throw new Error(`Items without section detected, found section ("${label}")`)
    }

    if (indent === columnIndent) {
      const section: KanbanSection = {
        id: id || `kbn${generated++}`,
        label,
        items: [],
      }
      if (metadata) applyMetadata(section, metadata)
      diagram.sections.push(section)
      last = section
      continue
    }

    const column = diagram.sections[diagram.sections.length - 1]
    if (!column) {
      // Cannot happen: the first node always sets columnIndent and so lands
      // in the branch above. Kept so the invariant is stated, not assumed.
      throw new Error(`Items without section detected, found section ("${label}")`)
    }

    const item: KanbanItem = { id: id || `kbn${generated++}`, label }
    if (metadata) applyMetadata(item, metadata)
    column.items.push(item)
    last = item
  }

  applyStyles(diagram, styles)
  return diagram
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Split the source into the lines that carry meaning, after the header.
 *
 * A `@{ ... }` metadata block may run over several source lines, so those are
 * joined back into the line that opened them — otherwise the continuation
 * lines would look like deeply indented cards. Comments are not stripped
 * inside such a block, because a `%%` there is part of a value (`"50%% off"`)
 * rather than a comment.
 *
 * The indent reported is the one of the line that opened the node, which is
 * what decides whether it is a column or a card.
 */
function* logicalLines(text: string): Generator<{ indent: number; content: string }> {
  let seenHeader = false

  /** Set while a metadata block is still open. */
  let pending: { indent: number; parts: string[] } | undefined

  for (const raw of text.split('\n')) {
    if (pending) {
      pending.parts.push(raw.trim())
      if (raw.includes('}')) {
        yield { indent: pending.indent, content: pending.parts.join(' ') }
        pending = undefined
      }
      continue
    }

    // Strip a trailing comment, then measure indentation on what is left
    const withoutComment = raw.replace(/%%.*$/, '')
    const content = withoutComment.trim()
    if (!content) continue

    // Everything before the `kanban` keyword is ignored, as upstream does
    if (!seenHeader) {
      if (/^kanban\b/i.test(content)) seenHeader = true
      continue
    }

    const indent = withoutComment.length - withoutComment.trimStart().length

    // An unterminated `@{` opens a block that continues on the lines below
    const open = findMetadataStart(content)
    if (open >= 0 && !content.slice(open).includes('}')) {
      pending = { indent, parts: [content] }
      continue
    }

    yield { indent, content }
  }

  // An unterminated block at end of input is still worth reading: the node it
  // opened is real, even though its metadata never closed.
  if (pending) {
    yield { indent: pending.indent, content: pending.parts.join(' ') }
  }
}

// ---------------------------------------------------------------------------
// Node text
// ---------------------------------------------------------------------------

/**
 * Split a node declaration into its id, label and metadata block.
 *
 * With no bracket pair, the text is both the id and the label. With one, the
 * text before the opener is the id (possibly empty) and the bracketed text is
 * the label.
 */
function parseNodeText(content: string): {
  id: string
  label: string
  metadata?: string
} {
  // The metadata block comes last, so peel it off before looking for brackets
  let body = content
  let metadata: string | undefined

  const open = findMetadataStart(content)
  if (open >= 0) {
    const close = content.lastIndexOf('}')
    if (close > open) {
      metadata = content.slice(open + 2, close)
      body = content.slice(0, open).trim()
    }
  }

  for (const { open: lhs, close: rhs } of BRACKETS) {
    const start = body.indexOf(lhs)
    if (start < 0) continue
    if (!body.endsWith(rhs)) continue

    const inner = body.slice(start + lhs.length, body.length - rhs.length)
    // An empty bracket body is not a label — treat the line as plain text
    if (!inner) continue

    const label = unquote(inner)
    return { id: body.slice(0, start).trim() || label, label, metadata }
  }

  return { id: unquote(body), label: unquote(body), metadata }
}

/**
 * Find the `@{` that opens a metadata block, ignoring one inside quotes.
 *
 * A label may legitimately contain `@{`: `a["email @{host}"]`.
 */
function findMetadataStart(content: string): number {
  let quoted = false
  for (let i = 0; i < content.length - 1; i++) {
    const char = content[i]!
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '@' && content[i + 1] === '{') return i
  }
  return -1
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Read a node's `@{ ... }` block into its fields.
 *
 * Upstream runs the block through a YAML parser; this reads the flat
 * `key: value` subset that a kanban node actually uses, which keeps the
 * library dependency-free. Unknown keys are ignored rather than rejected,
 * so a board written for a newer Mermaid still renders.
 *
 * Columns accept the same block as cards but use only the fields that mean
 * something for a column — an assignee on a column is dropped rather than
 * shown somewhere it would mislead.
 */
function applyMetadata(node: KanbanSection | KanbanItem, metadata: string): void {
  const isCard = !('items' in node)

  for (const entry of splitEntries(metadata)) {
    const match = entry.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!match) continue

    const value = unquote(match[2]!.trim())
    if (!value) continue

    switch (match[1]!.toLowerCase()) {
      case 'label':
        node.label = value
        break
      case 'icon':
        node.icon = value
        break
      case 'assigned':
        if (isCard) (node as KanbanItem).assigned = value
        break
      case 'ticket':
        if (isCard) (node as KanbanItem).ticket = value
        break
      case 'priority': {
        // An unrecognised priority is dropped: a stripe in the wrong place
        // misinforms, where no stripe merely says nothing.
        const priority = PRIORITIES[value.toLowerCase()]
        if (isCard && priority) (node as KanbanItem).priority = priority
        break
      }
    }
  }
}

/**
 * Split a metadata block into entries on commas and newlines, respecting
 * quotes so a description containing a comma survives intact.
 */
function splitEntries(metadata: string): string[] {
  const entries: string[] = []
  let current = ''
  let quoted = false

  for (const char of metadata) {
    if (char === '"') {
      quoted = !quoted
      current += char
    } else if (!quoted && (char === ',' || char === '\n')) {
      entries.push(current)
      current = ''
    } else {
      current += char
    }
  }
  entries.push(current)

  return entries.map(e => e.trim()).filter(e => e.length > 0)
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Attach deferred `style` statements to their columns and cards.
 *
 * Mermaid writes these as comma-separated CSS declarations; SVG wants them
 * semicolon-separated, so commas outside a `rgb(...)` call are translated.
 */
function applyStyles(
  diagram: KanbanDiagram,
  styles: { id: string; css: string }[],
): void {
  if (styles.length === 0) return

  // A Map, not an object, so a node called `__proto__` is just a node
  const byId = new Map<string, KanbanSection | KanbanItem>()
  for (const section of diagram.sections) {
    byId.set(section.id, section)
    for (const item of section.items) byId.set(item.id, item)
  }

  for (const { id, css } of styles) {
    const target = byId.get(id)
    if (!target) continue

    const declarations = cssFromStyleStatement(css)
    if (declarations) target.style = declarations
  }
}

/**
 * Turn a Mermaid `style` body into an SVG style attribute value.
 *
 * Returns undefined when the value could break out of the attribute, since
 * a board is often pasted from elsewhere and should not be able to inject
 * markup into the page that renders it.
 */
function cssFromStyleStatement(css: string): string | undefined {
  if (UNSAFE_STYLE.test(css)) return undefined

  // Split on commas that are not inside parentheses, so `rgb(1, 2, 3)` holds
  const declarations: string[] = []
  let current = ''
  let depth = 0

  for (const char of css) {
    if (char === '(') depth++
    else if (char === ')') depth--

    if (char === ',' && depth === 0) {
      declarations.push(current)
      current = ''
    } else {
      current += char
    }
  }
  declarations.push(current)

  const cleaned = declarations.map(d => d.trim()).filter(d => d.length > 0)
  return cleaned.length > 0 ? cleaned.join(';') : undefined
}
