import type { MindmapDiagram, MindmapNode, MindmapNodeShape } from './types.ts'

// ============================================================================
// Mindmap parser
//
// Parses Mermaid `mindmap` syntax into a tree. Nesting comes from source
// indentation, so this parser needs RAW lines — not the trimmed ones the
// other diagram parsers take.
//
// Node shapes, from the bracket pair around the label:
//   root            default
//   root[text]      rect
//   root(text)      rounded
//   root((text))    circle
//   root)text(      cloud
//   root))text((    bang
//   root{{text}}    hexagon
//
// A quoted label may contain brackets: root["String containing []"].
//
// Decorations attach to the node most recently declared:
//   ::icon(bomb)        icon name
//   :::class1 class2    class names
//
// Exactly one root is allowed. A second node at root indentation is an error,
// matching upstream, because the layout has nowhere to attach it.
// ============================================================================

/** Bracket pairs that denote a shape, longest opener first so `((` wins over `(`. */
const SHAPES: { open: string; close: string; shape: MindmapNodeShape }[] = [
  { open: '))', close: '((', shape: 'bang' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'rounded' },
  { open: ')', close: '(', shape: 'cloud' },
]

/**
 * Parse a Mermaid mindmap from RAW source text.
 *
 * Takes the whole text rather than preprocessed lines because indentation
 * carries the hierarchy and would be destroyed by trimming.
 *
 * @throws When the source declares more than one root.
 */
export function parseMindmapDiagram(text: string): MindmapDiagram {
  const rows = text.split('\n')

  // Stack of open ancestors, innermost last. Indent is the source column the
  // node started at, which is what decides parentage.
  const stack: { indent: number; node: MindmapNode }[] = []
  let root: MindmapNode | undefined
  let last: MindmapNode | undefined
  let seenHeader = false

  for (const raw of rows) {
    // Strip a trailing comment, then measure indentation on what is left
    const withoutComment = raw.replace(/%%.*$/, '')
    const content = withoutComment.trim()
    if (!content) continue

    // Everything before the `mindmap` keyword is ignored, as upstream does
    if (!seenHeader) {
      if (/^mindmap\b/i.test(content)) seenHeader = true
      continue
    }

    const indent = withoutComment.length - withoutComment.trimStart().length

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

    const { nodeId, descr, shape } = parseNodeText(content)
    const node: MindmapNode = { nodeId, descr, shape, level: 0, children: [] }

    // Pop ancestors that are no longer enclosing this line
    while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]
    if (!parent) {
      if (root) {
        throw new Error(
          `There can be only one root. No parent could be found for ("${descr}")`
        )
      }
      root = node
    } else {
      node.level = parent.node.level + 1
      parent.node.children.push(node)
    }

    stack.push({ indent, node })
    last = node
  }

  return { root }
}

// ---------------------------------------------------------------------------
// Node text
// ---------------------------------------------------------------------------

/**
 * Split a node declaration into its id, label and shape.
 *
 * With no bracket pair, the text is both the id and the label. With one, the
 * text before the opener is the id (possibly empty) and the bracketed text is
 * the label.
 */
function parseNodeText(content: string): {
  nodeId: string
  descr: string
  shape: MindmapNodeShape
} {
  for (const { open, close, shape } of SHAPES) {
    const start = content.indexOf(open)
    if (start < 0) continue
    if (!content.endsWith(close)) continue

    const inner = content.slice(start + open.length, content.length - close.length)
    const id = content.slice(0, start).trim()

    // An empty bracket body is not a shape — treat the line as plain text
    if (!inner) continue

    const descr = unquote(inner)
    return {
      nodeId: id || descr,
      descr,
      shape,
    }
  }

  return { nodeId: content, descr: content, shape: 'default' }
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}
