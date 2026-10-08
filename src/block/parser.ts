import type {
  Block, BlockArrowDirection, BlockClassDef, BlockDiagram, BlockEdge, BlockEdgeStyle, BlockShape,
} from './types.ts'

// ============================================================================
// Block diagram parser
//
// Parses Mermaid `block-beta` syntax. Placement is authored, not derived:
// `columns N` sets how many slots a row has, a block may span several of them,
// and `space` leaves a deliberate hole. Edges are drawn between wherever the
// grid put the blocks, so they never move anything.
//
// Statements:
//   block-beta | block
//   columns 3 | columns auto
//   id                           — bare block, shape 'na'
//   id["label"]                  — any of the bracket shapes below
//   id["label"]:2                — spans two columns
//   space | space:2              — an empty slot
//   block ... end                — anonymous composite
//   block:myId["Title"] ... end  — named composite
//   blockArrow<["label"]>(right, left)
//   A --> B | A -- "label" --> B | A ==> B | A -.-> B
//   classDef name prop:value,...
//   class id1,id2 name
//   style id prop:value,...
//
// A `block` line opens a nesting level and `end` closes it, so the parser
// keeps an explicit stack of levels rather than recursing.
// ============================================================================

/** Bracket pairs mapped to shapes, longest opener first so `((` beats `(`. */
const SHAPES: Array<{ open: string; close: string; shape: BlockShape }> = [
  { open: '<[', close: ']>', shape: 'block_arrow' },
  { open: '(((', close: ')))', shape: 'doublecircle' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '[/', close: '\\]', shape: 'trapezoid' },
  { open: '[\\', close: '/]', shape: 'inv_trapezoid' },
  { open: '[/', close: '/]', shape: 'lean_right' },
  { open: '[\\', close: '\\]', shape: 'lean_left' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '[', close: ']', shape: 'square' },
  { open: '(', close: ')', shape: 'round' },
]

/** Directions an arrow block may point in. */
const DIRECTIONS = new Set<BlockArrowDirection>(['up', 'down', 'left', 'right', 'x', 'y'])

/** Mermaid's sentinel for "decide the column count from the content". */
const AUTO_COLUMNS = -1

/**
 * Parse a Mermaid block diagram from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 */
export function parseBlockDiagram(lines: string[]): BlockDiagram {
  let title: string | undefined
  const edges: BlockEdge[] = []
  const classes = new Map<string, BlockClassDef>()

  /** Every block by id, for attaching classes and styles after the fact. */
  const byId = new Map<string, Block>()

  // The root behaves like a composite whose children are the top-level blocks
  const root: Block = {
    id: 'root', label: '', shape: 'composite', widthInColumns: 1,
    children: [], columns: AUTO_COLUMNS, directions: [], classes: [], styles: [],
  }

  /** Open nesting levels, innermost last. */
  const stack: Block[] = [root]
  let anonymous = 0
  // The header and a nested `block` opener look alike, so the first one wins
  let headerSeen = false

  const register = (block: Block) => {
    stack[stack.length - 1]!.children.push(block)
    // Use `set` on a Map, never a plain object, so an id like `__proto__`
    // is stored as data instead of touching the prototype chain
    byId.set(block.id, block)
  }

  for (const raw of lines) {
    const line = stripInlineComment(raw)
    if (!line) continue

    // Header — `block`, `block-beta`, optionally with a trailing title.
    // Only the first such line is the header; later ones open a composite.
    const header = line.match(/^block(?:-beta)?\b\s*:?\s*(.*)$/i)
    if (header && !headerSeen) {
      headerSeen = true
      const rest = header[1]!.trim()
      if (rest) {
        const inlineTitle = rest.match(/^title\s+(.+)$/i)
        if (inlineTitle) title = inlineTitle[1]!.trim()
      }
      continue
    }

    // `end` closes the innermost composite
    if (/^end$/i.test(line)) {
      if (stack.length > 1) stack.pop()
      continue
    }

    // A nested `block` opens a composite: `block`, `block:id`, `block:id["T"]`
    if (isCompositeOpener(line)) {
      const composite = parseCompositeOpener(line, () => `_composite_${++anonymous}`)
      register(composite)
      stack.push(composite)
      continue
    }

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = titleMatch[1]!.trim()
      continue
    }

    // columns N | columns auto — applies to the innermost open level
    const columnsMatch = line.match(/^columns\s+(.+)$/i)
    if (columnsMatch) {
      const value = columnsMatch[1]!.trim()
      const parsed = Number(value)
      // `auto` and anything unparseable both mean "decide for me"
      stack[stack.length - 1]!.columns =
        Number.isInteger(parsed) && parsed > 0 ? parsed : AUTO_COLUMNS
      continue
    }

    // classDef name prop:value,prop:value
    const classDef = line.match(/^classDef\s+(\S+)\s+(.+?);?\s*$/i)
    if (classDef) {
      const name = classDef[1]!
      classes.set(name, {
        id: name,
        styles: classDef[2]!.split(',').map(s => s.trim()).filter(Boolean),
      })
      continue
    }

    // class id1,id2 name
    const classAssign = line.match(/^class\s+(\S+)\s+(\S+?);?\s*$/i)
    if (classAssign) {
      const names = classAssign[2]!.split(',').map(s => s.trim()).filter(Boolean)
      for (const id of classAssign[1]!.split(',').map(s => s.trim())) {
        const block = byId.get(id)
        if (block) block.classes.push(...names)
      }
      continue
    }

    // style id prop:value,prop:value
    const styleStatement = line.match(/^style\s+(\S+)\s+(.+?);?\s*$/i)
    if (styleStatement) {
      const block = byId.get(styleStatement[1]!)
      if (block) {
        block.styles.push(...styleStatement[2]!.split(',').map(s => s.trim()).filter(Boolean))
      }
      continue
    }

    // Edge statement — one or more links on a line
    if (hasEdge(line)) {
      for (const parsed of parseEdgeLine(line)) {
        // An edge may introduce blocks that were never declared on their own
        for (const node of [parsed.startNode, parsed.endNode]) {
          if (node && !byId.has(node.id)) register(node)
        }
        edges.push(parsed.edge)
      }
      continue
    }

    // space | space:3
    const spaceMatch = line.match(/^space(?::(\d+))?\s*$/i)
    if (spaceMatch) {
      register({
        id: `_space_${++anonymous}`,
        label: '',
        shape: 'space',
        widthInColumns: spaceMatch[1] ? Number(spaceMatch[1]) : 1,
        children: [], columns: AUTO_COLUMNS, directions: [], classes: [], styles: [],
      })
      continue
    }

    // A plain block declaration. Several may share a line, separated by
    // whitespace or a semicolon, which is how `A; classDef ...` parses.
    for (const piece of splitStatements(line)) {
      const block = parseBlockDeclaration(piece)
      if (!block) continue
      // A repeated id refers back to the same block rather than adding a twin
      if (byId.has(block.id)) continue
      register(block)
    }
  }

  return {
    title,
    blocks: root.children,
    columns: root.columns,
    edges,
    classes,
  }
}

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

/** True when a line opens a nested composite rather than declaring a block. */
function isCompositeOpener(line: string): boolean {
  // `block` alone, `block:id`, `block:id["Title"]` — but not `block-beta`
  // and not a block whose own id merely starts with "block"
  return /^block\s*(?::|$)/i.test(line)
}

/** Parse `block`, `block:id` or `block:id["Title"]` into a composite block. */
function parseCompositeOpener(line: string, nextId: () => string): Block {
  const withId = line.match(/^block\s*:\s*(.+)$/i)

  if (withId) {
    const declared = parseBlockDeclaration(withId[1]!.trim())
    if (declared) {
      return {
        ...declared,
        // A composite keeps its own shape regardless of the brackets used,
        // which only supplied its title
        shape: 'composite',
        children: [],
        columns: AUTO_COLUMNS,
      }
    }
  }

  return {
    id: nextId(), label: '', shape: 'composite', widthInColumns: 1,
    children: [], columns: AUTO_COLUMNS, directions: [], classes: [], styles: [],
  }
}

// ---------------------------------------------------------------------------
// Block declarations
// ---------------------------------------------------------------------------

/**
 * Parse one block declaration: an id, an optional shape with a label, an
 * optional arrow direction list and an optional column span.
 */
export function parseBlockDeclaration(text: string): Block | null {
  let rest = text.trim()
  if (!rest) return null

  // Trailing `:2` column span — taken before the shape, so a label
  // containing a colon is not mistaken for one
  let widthInColumns = 1
  const span = rest.match(/:(\d+)\s*$/)
  if (span) {
    widthInColumns = Number(span[1])
    rest = rest.slice(0, rest.length - span[0].length).trim()
  }

  // Trailing `(up, down)` arrow directions
  let directions: BlockArrowDirection[] = []
  const dirs = rest.match(/\(([^()]*)\)\s*$/)
  if (dirs && rest.includes('<[')) {
    const parsed = dirs[1]!
      .split(',')
      .map(d => d.trim().toLowerCase())
      .filter((d): d is BlockArrowDirection => DIRECTIONS.has(d as BlockArrowDirection))
    if (parsed.length > 0) {
      directions = parsed
      rest = rest.slice(0, rest.length - dirs[0].length).trim()
    }
  }

  // Trailing `:::className`
  const classes: string[] = []
  const classShorthand = rest.match(/:::\s*([\w-]+(?:\s+[\w-]+)*)\s*$/)
  if (classShorthand) {
    classes.push(...classShorthand[1]!.trim().split(/\s+/))
    rest = rest.slice(0, rest.length - classShorthand[0].length).trim()
  }

  // Shape brackets, if any
  for (const { open, close, shape } of SHAPES) {
    const openAt = rest.indexOf(open)
    if (openAt === -1) continue
    if (!rest.endsWith(close)) continue

    const id = rest.slice(0, openAt).trim()
    const inner = rest.slice(openAt + open.length, rest.length - close.length)
    if (!id) continue

    return {
      id,
      label: unquote(inner.trim()),
      shape,
      widthInColumns,
      children: [], columns: AUTO_COLUMNS,
      directions,
      classes,
      styles: [],
    }
  }

  // Bare id — the label is the id itself
  if (!/^[^\s[\](){}<>|]+$/.test(rest)) return null

  return {
    id: rest,
    label: rest,
    shape: 'na',
    widthInColumns,
    children: [], columns: AUTO_COLUMNS,
    directions: [], classes, styles: [],
  }
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * Link operator, in one piece.
 *
 * An operator may carry its own label (`-- "text" -->`), so the label is part
 * of the match rather than something to find afterwards — otherwise splitting
 * the line on operators would tear the label in half.
 */
const LINK_PATTERN =
  /<?(?:-{2,}|={2,}|-\.+-)(?:\s*"[^"]*"\s*(?:-{2,}|={2,}|-\.+-)?)?>?/

/** True when a line contains a link operator. */
function hasEdge(line: string): boolean {
  return new RegExp(LINK_PATTERN.source).test(line)
}

/**
 * Split an edge line into links.
 *
 * `A --> B --> C` is two links sharing B, so the right-hand node of one link
 * becomes the left-hand node of the next.
 */
function parseEdgeLine(line: string): Array<{
  edge: BlockEdge
  startNode: Block | null
  endNode: Block | null
}> {
  const out: Array<{ edge: BlockEdge; startNode: Block | null; endNode: Block | null }> = []

  // Split on link operators, keeping them: [node, link, node, link, node...]
  const parts = line.split(new RegExp(`\\s*(${LINK_PATTERN.source})\\s*`))
  if (parts.length < 3) return out

  for (let i = 0; i + 2 < parts.length; i += 2) {
    const left = parts[i]!.trim()
    const operator = parts[i + 1]!.trim()
    const right = parts[i + 2]!.trim()
    if (!left || !right) continue

    // A label may be written inside the link (`-- "text" -->`), in which
    // case the split leaves it attached to the operator
    const { label, cleaned } = extractEdgeLabel(operator)

    const startNode = parseBlockDeclaration(left)
    const endNode = parseBlockDeclaration(right)
    if (!startNode || !endNode) continue

    out.push({
      edge: {
        start: startNode.id,
        end: endNode.id,
        label,
        style: edgeStyle(cleaned),
        arrowEnd: cleaned.endsWith('>'),
        arrowStart: cleaned.startsWith('<'),
      },
      startNode,
      endNode,
    })
  }

  return out
}

/** Pull a quoted label out of a link operator, if it carries one. */
function extractEdgeLabel(operator: string): { label?: string; cleaned: string } {
  const quoted = operator.match(/"([^"]*)"/)
  if (!quoted) return { cleaned: operator }
  return { label: quoted[1], cleaned: operator.replace(quoted[0], '').trim() }
}

/** Line style implied by the operator characters. */
function edgeStyle(operator: string): BlockEdgeStyle {
  if (operator.includes('=')) return 'thick'
  if (operator.includes('.')) return 'dotted'
  return 'normal'
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Split a line into separate statements.
 *
 * Semicolons always separate. Whitespace separates too, except inside a
 * bracketed label, so `A["one two"] B` is two blocks but `A["one two"]`
 * is one.
 */
function splitStatements(line: string): string[] {
  const out: string[] = []
  let current = ''
  let depth = 0
  let inQuotes = false

  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes
    if (!inQuotes) {
      if ('([{<'.includes(char)) depth++
      else if (')]}>'.includes(char)) depth--
    }

    const isSeparator = !inQuotes && depth <= 0 && (char === ';' || /\s/.test(char))
    if (isSeparator) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) out.push(current.trim())
  return out
}

/** Remove a trailing `%% comment` from a line. */
function stripInlineComment(line: string): string {
  const idx = line.indexOf('%%')
  return (idx === -1 ? line : line.slice(0, idx)).trim()
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}
