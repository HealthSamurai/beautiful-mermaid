import type { PieDiagram, PieSlice } from './types.ts'

// ============================================================================
// Pie parser
//
// Parses Mermaid `pie` syntax into a PieDiagram.
//
// Directives:
//   pie [showData]
//   title <text>                       — rest of the line, unquoted
//   accTitle: <text>                   — accepted and ignored (a11y metadata)
//   accDescr: <text>                   — accepted and ignored
//   accDescr { ... }                   — accepted and ignored (multi-line)
//   "label" : <number>                 — one slice
//
// Mermaid requires slice labels to be quoted and rejects negative values with
// an explicit error; we match both behaviours. Values may be decimal and zero
// is allowed. Slices keep their declaration order.
// ============================================================================

/**
 * Parse a Mermaid pie diagram from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 *
 * @throws When a slice has a negative value, mirroring Mermaid's own message.
 */
export function parsePieDiagram(lines: string[]): PieDiagram {
  let title: string | undefined
  let showData = false
  const slices: PieSlice[] = []

  // `accDescr { ... }` spans several lines; swallow them without interpreting.
  let inAccDescrBlock = false

  for (const line of lines) {
    if (inAccDescrBlock) {
      if (line.includes('}')) inAccDescrBlock = false
      continue
    }

    // Header line — `pie` or `pie showData`, optionally with a trailing title
    const header = line.match(/^pie\b\s*(showData\b\s*)?(.*)$/i)
    if (header) {
      if (header[1]) showData = true
      const rest = header[2]?.trim()
      if (rest) {
        const inlineTitle = rest.match(/^title\s+(.+)$/i)
        if (inlineTitle) title = inlineTitle[1]!.trim()
      }
      continue
    }

    // Accessibility metadata — parsed so it never lands in a slice label
    if (/^accDescr\s*\{/i.test(line)) {
      if (!line.includes('}')) inAccDescrBlock = true
      continue
    }
    if (/^acc(Title|Descr)\s*:/i.test(line)) continue

    // title <text> — the whole remainder, quotes stripped if present
    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = unquote(titleMatch[1]!.trim())
      continue
    }

    // "label" : value
    const slice = line.match(/^"([^"]*)"\s*:\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (slice) {
      const label = slice[1]!
      const value = parseFloat(slice[2]!)
      if (value < 0) {
        throw new Error(
          `"${label}" has invalid value: ${value}. ` +
          `Negative values are not allowed in pie charts. All slice values must be >= 0.`
        )
      }
      slices.push({ label, value })
      continue
    }
  }

  return { title, showData, slices }
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}
