import type { SankeyDiagram, SankeyLink, SankeyNode } from './types.ts'

// ============================================================================
// Sankey parser
//
// Parses Mermaid `sankey` / `sankey-beta` syntax: a CSV body of exactly three
// fields per row, `source,target,value`.
//
//   sankey-beta
//   Agricultural 'waste',Bio-conversion,124.729
//   "Quoted, with comma",target,10
//   """Wind""",Electricity grid,289.366
//
// CSV quoting follows the upstream grammar: a double-quoted field may contain
// commas and the `""` escape for a literal quote. Nodes are implicit — a node
// exists because a link mentions it — and are kept in first-appearance order.
//
// This parser takes RAW text rather than preprocessed lines, because a quoted
// field may legally contain a `%%` sequence that the shared comment stripper
// would eat.
// ============================================================================

/**
 * Parse a Mermaid sankey diagram from RAW source text.
 *
 * @throws Never — malformed rows are skipped, matching the tolerance the rest
 *         of this library applies to sloppy diagram source.
 */
export function parseSankeyDiagram(text: string): SankeyDiagram {
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const seen = new Set<string>()

  /** Register a node on first mention, preserving declaration order. */
  const findOrCreateNode = (id: string): string => {
    if (!seen.has(id)) {
      seen.add(id)
      nodes.push({ id })
    }
    return id
  }

  let seenHeader = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    // Everything before the header keyword is ignored
    if (!seenHeader) {
      if (/^sankey(-beta)?\s*$/i.test(line)) seenHeader = true
      continue
    }

    // A comment line — but only when the `%%` is not inside a quoted field
    if (line.startsWith('%%')) continue

    const fields = splitCsvRow(line)
    if (fields.length !== 3) continue

    const source = fields[0]!.trim()
    const target = fields[1]!.trim()
    const value = parseFloat(fields[2]!.trim())

    if (!source || !target || !Number.isFinite(value)) continue

    links.push({
      source: findOrCreateNode(source),
      target: findOrCreateNode(target),
      value,
    })
  }

  return { nodes, links }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Split one CSV row into fields.
 *
 * Handles the subset the upstream grammar defines: optional double quotes
 * around a field, commas inside a quoted field, and `""` for a literal quote.
 */
function splitCsvRow(row: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  while (i < row.length) {
    const char = row[i]!

    if (quoted) {
      if (char === '"') {
        // `""` inside a quoted field is one literal quote
        if (row[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += char
      i++
      continue
    }

    if (char === '"') {
      quoted = true
      i++
      continue
    }

    if (char === ',') {
      fields.push(field)
      field = ''
      i++
      continue
    }

    field += char
    i++
  }

  fields.push(field)
  return fields
}
