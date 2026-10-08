import type {
  C4Boundary,
  C4BoundaryKind,
  C4Diagram,
  C4Direction,
  C4ElementStyle,
  C4Level,
  C4Node,
  C4Rel,
  C4RelKind,
  C4RelStyle,
  C4Shape,
  C4ShapeKind,
} from './types.ts'

// ============================================================================
// C4 diagram parser
//
// Parses Mermaid's C4 syntax, which is one grammar shared by all five levels:
//
//   C4Context
//     title System Context diagram
//     Person(customer, "Customer", "A banking customer")
//     System_Boundary(b1, "Internet Banking") {
//       System(banking, "Internet Banking System", "Lets customers view…")
//       SystemDb(db, "Database")
//     }
//     Rel(customer, banking, "Uses", "HTTPS")
//
// Arguments are positional and comma-separated, with quotes optional. From
// the fourth onward they may instead be written as named `$key="value"`
// pairs, in any order — which is how a diagram declares a link or tags
// without also having to supply the fields before them.
//
// A boundary opens a block, so the parser keeps a stack: a shape declared
// inside one belongs to it, and that nesting is the whole point of C4.
// ============================================================================

/** Shape keywords, longest first so `System_Ext` wins over `System`. */
const SHAPE_KEYWORDS: [string, C4ShapeKind][] = [
  ['Person_Ext', 'external_person'],
  ['Person', 'person'],
  ['SystemQueue_Ext', 'external_system_queue'],
  ['SystemDb_Ext', 'external_system_db'],
  ['System_Ext', 'external_system'],
  ['SystemQueue', 'system_queue'],
  ['SystemDb', 'system_db'],
  ['System', 'system'],
  ['ContainerQueue_Ext', 'external_container_queue'],
  ['ContainerDb_Ext', 'external_container_db'],
  ['Container_Ext', 'external_container'],
  ['ContainerQueue', 'container_queue'],
  ['ContainerDb', 'container_db'],
  ['Container', 'container'],
  ['ComponentQueue_Ext', 'external_component_queue'],
  ['ComponentDb_Ext', 'external_component_db'],
  ['Component_Ext', 'external_component'],
  ['ComponentQueue', 'component_queue'],
  ['ComponentDb', 'component_db'],
  ['Component', 'component'],
]

/** Boundary keywords, longest first for the same reason. */
const BOUNDARY_KEYWORDS: [string, C4BoundaryKind][] = [
  ['Enterprise_Boundary', 'enterprise'],
  ['System_Boundary', 'system'],
  ['Container_Boundary', 'container'],
  ['Deployment_Node', 'node'],
  ['Boundary', 'boundary'],
  ['Node_L', 'node'],
  ['Node_R', 'node'],
  ['Node', 'node'],
]

/** Relationship keywords, longest first. */
const REL_KEYWORDS: [string, C4RelKind][] = [
  ['BiRel', 'birel'],
  ['Rel_Back', 'rel_b'],
  ['Rel_Down', 'rel_d'],
  ['Rel_Left', 'rel_l'],
  ['Rel_Right', 'rel_r'],
  ['Rel_Up', 'rel_u'],
  ['RelIndex', 'rel'],
  ['Rel_B', 'rel_b'],
  ['Rel_D', 'rel_d'],
  ['Rel_L', 'rel_l'],
  ['Rel_R', 'rel_r'],
  ['Rel_U', 'rel_u'],
  ['Rel', 'rel'],
]

/** Which levels the header may declare. */
const LEVELS: Record<string, C4Level> = {
  c4context: 'C4Context',
  c4container: 'C4Container',
  c4component: 'C4Component',
  c4dynamic: 'C4Dynamic',
  c4deployment: 'C4Deployment',
}

/** Colour values are rejected when they could break out of a style attribute. */
const UNSAFE_COLOR = /[<>"';{}]/

/**
 * Parse a Mermaid C4 diagram from preprocessed lines.
 *
 * Lines are expected trimmed and comment-free, as the shared preprocessing
 * produces. Indentation is purely cosmetic in C4 — the braces carry the
 * nesting — so nothing here depends on it.
 */
export function parseC4Diagram(lines: string[]): C4Diagram {
  const diagram: C4Diagram = {
    level: 'C4Context',
    direction: 'TB',
    nodes: [],
    relationships: [],
  }

  /** Open boundaries, innermost last. */
  const stack: C4Boundary[] = []

  /** Shapes and boundaries by alias, for the deferred style statements. */
  const byAlias = new Map<string, C4Shape | C4Boundary>()

  /** Deferred, because a style may name a node declared later. */
  const elementStyles: { alias: string; style: C4ElementStyle }[] = []
  const relStyles: { from: string; to: string; style: C4RelStyle }[] = []

  /** Where a new node goes — into the innermost open boundary, or the root. */
  const push = (node: C4Node): void => {
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else diagram.nodes.push(node)
  }

  for (const raw of lines) {
    let line = raw.trim()
    if (!line) continue

    // A closing brace ends the innermost boundary. It may share a line with
    // the statement before it, so it is stripped and handled separately.
    while (line.endsWith('}')) {
      line = line.slice(0, -1).trim()
      stack.pop()
    }
    if (!line) continue

    const level = LEVELS[line.toLowerCase().split(/\s+/)[0] ?? '']
    if (level) {
      diagram.level = level
      // A header may carry a title: `C4Context` then `title …` is normal, but
      // `C4Context title X` also appears in the wild, with or without the
      // keyword repeated
      const rest = line.slice(line.split(/\s+/)[0]!.length).trim()
        .replace(/^title\s+/i, '')
        .trim()
      if (rest) diagram.title = rest
      continue
    }

    const title = line.match(/^title\s+(.*)$/i)
    if (title) {
      const value = title[1]!.trim()
      if (value) diagram.title = value
      continue
    }

    const direction = line.match(/^direction\s+(TB|BT|LR|RL)\b/i)
    if (direction) {
      diagram.direction = direction[1]!.toUpperCase() as C4Direction
      continue
    }

    const call = parseCall(line)
    if (!call) continue

    // An opening brace at the end of the line means a boundary block follows
    const opensBlock = line.endsWith('{')

    const relKind = matchKeyword(REL_KEYWORDS, call.keyword)
    if (relKind) {
      const relation = buildRel(relKind, call.keyword, call.args)
      if (relation) diagram.relationships.push(relation)
      continue
    }

    const boundaryKind = matchKeyword(BOUNDARY_KEYWORDS, call.keyword)
    if (boundaryKind) {
      const boundary = buildBoundary(boundaryKind, call.args)
      if (!boundary) continue
      push(boundary)
      byAlias.set(boundary.alias, boundary)
      if (opensBlock) stack.push(boundary)
      continue
    }

    const shapeKind = matchKeyword(SHAPE_KEYWORDS, call.keyword)
    if (shapeKind) {
      const shape = buildShape(shapeKind, call.args)
      if (!shape) continue
      push(shape)
      byAlias.set(shape.alias, shape)
      continue
    }

    if (/^UpdateElementStyle$/i.test(call.keyword)) {
      const alias = positional(call.args, 0)
      if (alias) elementStyles.push({ alias, style: readElementStyle(call.args) })
      continue
    }

    if (/^UpdateRelStyle$/i.test(call.keyword)) {
      const from = positional(call.args, 0)
      const to = positional(call.args, 1)
      if (from && to) relStyles.push({ from, to, style: readRelStyle(call.args) })
      continue
    }

    // UpdateLayoutConfig and anything else is ignored: a layout hint for a
    // renderer with a different engine would only mislead here.
  }

  for (const { alias, style } of elementStyles) {
    const node = byAlias.get(alias)
    if (node) node.style = style
  }

  for (const { from, to, style } of relStyles) {
    const relation = diagram.relationships.find(r => r.from === from && r.to === to)
    if (relation) relation.style = style
  }

  return diagram
}

// ---------------------------------------------------------------------------
// Call syntax
// ---------------------------------------------------------------------------

/** One parsed argument — positional text, or a named `$key="value"` pair. */
type C4Arg = { key?: string; value: string }

/**
 * Split a `Keyword(arg, arg, …)` line into its keyword and arguments.
 *
 * Returns undefined for a line that is not a call.
 */
function parseCall(line: string): { keyword: string; args: C4Arg[] } | undefined {
  const open = line.indexOf('(')
  if (open < 0) return undefined

  const keyword = line.slice(0, open).trim()
  if (!/^\w+$/.test(keyword)) return undefined

  const close = findClosingParen(line, open)
  if (close < 0) return undefined

  return { keyword, args: splitArgs(line.slice(open + 1, close)) }
}

/** Index of the `)` matching the `(` at `open`, respecting quotes. */
function findClosingParen(line: string, open: number): number {
  let depth = 0
  let quoted = false

  for (let i = open; i < line.length; i++) {
    const char = line[i]!
    if (char === '"') quoted = !quoted
    else if (quoted) continue
    else if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Split an argument list on commas outside quotes.
 *
 * An empty slot is kept rather than dropped, because the arguments are
 * positional: `System(a, "A", , "tagged")` skips the description, and
 * collapsing the gap would silently shift every later field.
 */
function splitArgs(body: string): C4Arg[] {
  const raw: string[] = []
  let current = ''
  let quoted = false

  for (const char of body) {
    if (char === '"') {
      quoted = !quoted
      current += char
    } else if (!quoted && char === ',') {
      raw.push(current)
      current = ''
    } else {
      current += char
    }
  }
  raw.push(current)

  return raw.map(text => {
    const trimmed = text.trim()

    // $key="value" — a named argument
    const named = trimmed.match(/^\$(\w+)\s*=\s*(.*)$/)
    if (named) return { key: named[1]!.toLowerCase(), value: unquote(named[2]!.trim()) }

    return { value: unquote(trimmed) }
  })
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/s)
  return quoted ? quoted[1]! : text
}

/** Longest-first keyword lookup, case-insensitive. */
function matchKeyword<T>(table: [string, T][], keyword: string): T | undefined {
  for (const [name, value] of table) {
    if (name.toLowerCase() === keyword.toLowerCase()) return value
  }
  return undefined
}

/**
 * Read the nth positional argument.
 *
 * Named arguments do not occupy a position, so `System(a, $descr="x", "B")`
 * reads "B" as the second positional — which is what makes the named form
 * usable in the middle of a list.
 */
function positional(args: C4Arg[], index: number): string | undefined {
  let seen = 0
  for (const arg of args) {
    if (arg.key !== undefined) continue
    if (seen === index) return arg.value || undefined
    seen++
  }
  return undefined
}

/** Read a named argument. */
function named(args: C4Arg[], key: string): string | undefined {
  const found = args.find(arg => arg.key === key)
  return found?.value || undefined
}

/**
 * Read a field that may be written positionally or by name.
 *
 * The named form wins when both are present, since naming a field is the
 * more deliberate act.
 */
function field(args: C4Arg[], index: number, key: string): string | undefined {
  return named(args, key) ?? positional(args, index)
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build a shape from its arguments.
 *
 * Containers and components take a technology before the description;
 * people and systems do not, so the positional indices differ.
 */
function buildShape(shapeKind: C4ShapeKind, args: C4Arg[]): C4Shape | undefined {
  const alias = positional(args, 0)
  if (!alias) return undefined

  const hasTechn = /container|component|^node$/.test(shapeKind)

  return {
    kind: 'shape',
    alias,
    label: positional(args, 1) ?? alias,
    techn: hasTechn ? field(args, 2, 'techn') : named(args, 'techn'),
    descr: field(args, hasTechn ? 3 : 2, 'descr'),
    sprite: named(args, 'sprite'),
    tags: named(args, 'tags'),
    link: named(args, 'link'),
    shapeKind,
  }
}

/** Build a boundary from its arguments. */
function buildBoundary(
  boundaryKind: C4BoundaryKind,
  args: C4Arg[],
): C4Boundary | undefined {
  const alias = positional(args, 0)
  if (!alias) return undefined

  return {
    kind: 'boundary',
    alias,
    label: positional(args, 1) ?? alias,
    boundaryKind,
    type: field(args, 2, 'type'),
    descr: field(args, 3, 'descr'),
    tags: named(args, 'tags'),
    link: named(args, 'link'),
    children: [],
  }
}

/**
 * Build a relationship from its arguments.
 *
 * `RelIndex` puts a sequence number first, which only matters for a dynamic
 * diagram's ordering; the number is dropped and the rest read as a normal
 * relationship.
 */
function buildRel(
  relKind: C4RelKind,
  keyword: string,
  args: C4Arg[],
): C4Rel | undefined {
  const offset = /^RelIndex$/i.test(keyword) ? 1 : 0

  const from = positional(args, offset)
  const to = positional(args, offset + 1)
  if (!from || !to) return undefined

  return {
    relKind,
    from,
    to,
    label: positional(args, offset + 2) ?? '',
    techn: field(args, offset + 3, 'techn'),
    descr: field(args, offset + 4, 'descr'),
    sprite: named(args, 'sprite'),
    tags: named(args, 'tags'),
    link: named(args, 'link'),
  }
}

// ---------------------------------------------------------------------------
// Style statements
// ---------------------------------------------------------------------------

/** Read an `UpdateElementStyle` statement's named arguments. */
function readElementStyle(args: C4Arg[]): C4ElementStyle {
  const style: C4ElementStyle = {}

  const bg = color(named(args, 'bgcolor'))
  if (bg) style.bgColor = bg
  const fontColor = color(named(args, 'fontcolor'))
  if (fontColor) style.fontColor = fontColor
  const border = color(named(args, 'bordercolor'))
  if (border) style.borderColor = border

  const shadowing = named(args, 'shadowing')
  if (shadowing !== undefined) style.shadowing = isTrue(shadowing)

  const shape = named(args, 'shape')
  if (shape) style.shape = shape
  const legendText = named(args, 'legendtext')
  if (legendText) style.legendText = legendText
  const legendSprite = named(args, 'legendsprite')
  if (legendSprite) style.legendSprite = legendSprite

  return style
}

/** Read an `UpdateRelStyle` statement's named arguments. */
function readRelStyle(args: C4Arg[]): C4RelStyle {
  const style: C4RelStyle = {}

  const text = color(named(args, 'textcolor'))
  if (text) style.textColor = text
  const line = color(named(args, 'linecolor'))
  if (line) style.lineColor = line

  const offsetX = Number(named(args, 'offsetx'))
  if (Number.isFinite(offsetX)) style.offsetX = offsetX
  const offsetY = Number(named(args, 'offsety'))
  if (Number.isFinite(offsetY)) style.offsetY = offsetY

  return style
}

/**
 * Accept a colour value, or reject it.
 *
 * A C4 diagram is often pasted from elsewhere, and these values end up in a
 * style attribute, so anything that could close it is dropped rather than
 * escaped — a wrong colour is a smaller failure than an injection.
 */
function color(value: string | undefined): string | undefined {
  if (!value) return undefined
  return UNSAFE_COLOR.test(value) ? undefined : value
}

/** YAML-ish truthiness, so `true`, `yes` and `1` all read as enabled. */
function isTrue(value: string): boolean {
  return ['true', 'yes', '1', 'on'].includes(value.trim().toLowerCase())
}
