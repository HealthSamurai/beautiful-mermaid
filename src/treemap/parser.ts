import type { TreemapDiagram, TreemapNode } from './types.ts'

// ============================================================================
// Treemap parser
//
// Parses Mermaid `treemap` syntax into a hierarchy. Nesting comes from source
// indentation, so this parser needs RAW lines.
//
//   treemap-beta
//   "Budget"
//       "Operations"
//           "Payroll": 400
//           "Rent": 120
//       "Marketing": 150
//
// A node with a `: value` suffix is a leaf; one without is a section whose
// value is the sum of its children. Quotes around a name are optional but
// are what lets a name contain a colon or leading spaces.
//
// A node may carry a class: `"Payroll": 400:::big`, defined with
//
//   classDef big fill:#f9f,stroke:#333
//
// Upstream builds the hierarchy from raw indent columns and pops the stack
// while the top has an indent >= the current one, so the actual indent step
// never matters — two spaces and four spaces nest identically. This does the
// same, which is why a half-indented line still finds the right parent.
// ============================================================================

/** Inline CSS declarations are rejected when they could break out of the attribute. */
const UNSAFE_STYLE = /[<>"']/

/**
 * Parse a Mermaid treemap from RAW source text.
 *
 * Takes the whole text rather than preprocessed lines because indentation
 * carries the hierarchy and would be destroyed by trimming.
 */
export function parseTreemapDiagram(text: string): TreemapDiagram {
  const diagram: TreemapDiagram = { nodes: [], classes: new Map() }

  // Stack of open sections, innermost last
  const stack: { indent: number; node: TreemapNode }[] = []
  let seenHeader = false

  for (const raw of text.split('\n')) {
    // Strip a trailing comment, then measure indentation on what is left.
    // A `%%` inside quotes is part of the name, so only an unquoted one counts.
    const withoutComment = stripComment(raw)
    const content = withoutComment.trim()
    if (!content) continue

    // Everything before the `treemap` keyword is ignored, as upstream does
    if (!seenHeader) {
      if (/^treemap(-beta)?\b/i.test(content)) seenHeader = true
      continue
    }

    const title = content.match(/^title\s+(.*)$/i)
    if (title) {
      const value = title[1]!.trim()
      if (value) diagram.title = value
      continue
    }

    const classDef = content.match(/^classDef\s+(\S+)\s+(.+)$/i)
    if (classDef) {
      // Several classDefs for one name accumulate, as in a flowchart
      const existing = diagram.classes.get(classDef[1]!)
      const added = classDef[2]!.trim()
      diagram.classes.set(classDef[1]!, existing ? `${existing},${added}` : added)
      continue
    }

    const indent = withoutComment.length - withoutComment.trimStart().length
    const node = parseNodeText(content)
    if (!node) continue

    // Pop sections that no longer enclose this line
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]
    if (parent) parent.node.children.push(node)
    else diagram.nodes.push(node)

    // Only a section can take children; a leaf closes immediately
    if (node.value === undefined) stack.push({ indent, node })
  }

  return diagram
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Remove a trailing `%%` comment, ignoring one inside a quoted name.
 *
 * A treemap label is often a percentage (`"Share %% of total"`), so a blind
 * strip would silently truncate it.
 */
function stripComment(line: string): string {
  let quoted = false
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i]!
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '%' && line[i + 1] === '%') return line.slice(0, i)
  }
  return line
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * Split a node declaration into its name, value and class.
 *
 *   "Payroll": 400:::big
 *   Payroll: 400
 *   "Operations"
 *   Operations:::muted
 *
 * Returns undefined for a line that declares nothing.
 */
function parseNodeText(content: string): TreemapNode | undefined {
  let body = content

  // The class suffix comes last, outside any quotes
  let classSelector: string | undefined
  const classAt = findClassSuffix(body)
  if (classAt >= 0) {
    const name = body.slice(classAt + 3).trim()
    if (name) classSelector = name
    body = body.slice(0, classAt).trim()
  }

  // Then the value, after the last unquoted colon
  let value: number | undefined
  const colonAt = findValueColon(body)
  if (colonAt >= 0) {
    const text = body.slice(colonAt + 1).trim()
    const parsed = Number(text.replace(/,/g, ''))
    if (text && Number.isFinite(parsed)) {
      value = parsed
      body = body.slice(0, colonAt).trim()
    }
  }

  const name = unquote(body)
  if (!name && value === undefined) return undefined

  return { name, value, children: [], classSelector }
}

/** Index of the `:::` that introduces a class, or -1 when there is none. */
function findClassSuffix(content: string): number {
  let quoted = false
  for (let i = 0; i < content.length - 2; i++) {
    const char = content[i]!
    if (char === '"') quoted = !quoted
    else if (!quoted && content.startsWith(':::', i)) return i
  }
  return -1
}

/** Index of the last unquoted `:` that is not part of a `:::`, or -1. */
function findValueColon(content: string): number {
  let quoted = false
  let found = -1
  for (let i = 0; i < content.length; i++) {
    const char = content[i]!
    if (char === '"') quoted = !quoted
    else if (!quoted && char === ':') found = i
  }
  return found
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

/**
 * Turn a `classDef` body into an SVG style attribute value.
 *
 * Mermaid writes these as comma-separated CSS declarations; SVG wants them
 * semicolon-separated, so commas outside a `rgb(...)` call are translated.
 *
 * Returns undefined when the value could break out of the attribute, since a
 * diagram is often pasted from elsewhere and should not be able to inject
 * markup into the page that renders it.
 */
export function compileClass(css: string): string | undefined {
  if (UNSAFE_STYLE.test(css)) return undefined

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
