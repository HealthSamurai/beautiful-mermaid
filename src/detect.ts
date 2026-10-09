// ============================================================================
// Diagram type detection
//
// One source of truth for "which pipeline renders this source", shared by the
// SVG entry point and the ASCII one. They used to carry separate copies of
// this logic, which is how the two renderers came to disagree about whether a
// diagram behind a comment was a gantt chart or a malformed flowchart.
// ============================================================================

/** Every diagram type the library can route a source to. */
export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'er'
  | 'xychart'
  | 'gantt'
  | 'timeline'
  | 'pie'
  | 'journey'
  | 'quadrant'
  | 'mindmap'
  | 'sankey'
  | 'gitgraph'
  | 'block'
  | 'radar'
  | 'kanban'
  | 'treemap'
  | 'requirement'
  | 'c4'

/**
 * The first line of a diagram that is not frontmatter, a directive or a
 * comment — the line whose keyword names the diagram type.
 *
 * Returns undefined when the source carries no such line at all.
 */
export function headerLine(text: string): string | undefined {
  let rest = text.trim()

  // YAML frontmatter is a `---` fenced block at the very top
  if (rest.startsWith('---')) {
    const end = rest.indexOf('\n---', 3)
    if (end !== -1) {
      const after = rest.indexOf('\n', end + 1)
      rest = after === -1 ? '' : rest.slice(after + 1)
    }
  }

  for (const raw of rest.split(/[\n;]/)) {
    const line = raw.trim()
    // `%%{init}%%` directives and `%%` comments both precede the header
    if (!line || line.startsWith('%%')) continue
    return line
  }

  return undefined
}

/**
 * Detect the diagram type from the mermaid source text.
 * Returns the type keyword used for routing to the correct pipeline.
 */
export function detectDiagramType(text: string): DiagramType {
  // The header is the first line that actually declares something: YAML
  // frontmatter, `%%{init}%%` directives and `%%` comments may all precede it,
  // and the parsers skip them, so the detector has to skip them too or a
  // commented-out note above the diagram changes its type.
  const firstLine = (headerLine(text) ?? '').toLowerCase()

  if (/^xychart(-beta)?\b/.test(firstLine)) return 'xychart'
  if (/^gantt\b/.test(firstLine)) return 'gantt'
  if (/^timeline\b/.test(firstLine)) return 'timeline'
  if (/^pie\b/.test(firstLine)) return 'pie'
  if (/^journey\b/.test(firstLine)) return 'journey'
  if (/^quadrantchart\b/.test(firstLine)) return 'quadrant'
  if (/^mindmap\b/.test(firstLine)) return 'mindmap'
  if (/^sankey(-beta)?\b/.test(firstLine)) return 'sankey'
  if (/^gitgraph\b/.test(firstLine)) return 'gitgraph'
  if (/^block(-beta)?\b/.test(firstLine)) return 'block'
  if (/^radar(-beta)?\b/.test(firstLine)) return 'radar'
  if (/^kanban\b/.test(firstLine)) return 'kanban'
  if (/^treemap(-beta)?\b/.test(firstLine)) return 'treemap'
  if (/^requirementdiagram\b/.test(firstLine)) return 'requirement'
  if (/^c4(context|container|component|dynamic|deployment)\b/.test(firstLine)) return 'c4'
  // `classDiagram-v2` is the versioned spelling upstream accepts alongside
  // `classDiagram`; the `\b` guard still keeps `classDiagramatic` out.
  if (/^sequencediagram\b/.test(firstLine)) return 'sequence'
  if (/^classdiagram(-v2)?\b/.test(firstLine)) return 'class'
  if (/^erdiagram\b/.test(firstLine)) return 'er'

  // Default: flowchart/state (handled by parseMermaid internally)
  return 'flowchart'
}
