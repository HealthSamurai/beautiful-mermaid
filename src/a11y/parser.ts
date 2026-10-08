import type { AccessibilityInfo, AccessibilityResult } from './types.ts'
import { escapeXml } from '../multiline-utils.ts'

// ============================================================================
// Accessibility metadata parser and renderer
//
// Mermaid allows `accTitle:` and `accDescr:` in every diagram type, so this is
// handled once in the dispatcher rather than in fourteen parsers. The lines are
// removed from the body, which means each diagram parser keeps seeing only the
// syntax it actually knows.
//
// Three forms:
//   accTitle: a short label
//   accDescr: a one-line description
//   accDescr {
//     a description
//     over several lines
//   }
// ============================================================================

/**
 * Lift `accTitle` / `accDescr` out of a diagram source.
 *
 * Returns the body with those lines removed, so a diagram parser never has to
 * know about them. Later declarations win over earlier ones, matching Mermaid.
 */
export function parseAccessibility(text: string): AccessibilityResult {
  // Cheap bail-out: most diagrams have no accessibility metadata at all
  if (!/\bacc(?:Title|Descr)\b/i.test(text)) {
    return { body: text }
  }

  const kept: string[] = []
  const lines = text.split('\n')

  let title: string | undefined
  let description: string | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    // accTitle: <text>
    const titleMatch = trimmed.match(/^accTitle\s*:\s*(.*)$/i)
    if (titleMatch) {
      const value = titleMatch[1]!.trim()
      if (value) title = value
      continue
    }

    // accDescr { ... } — a block that runs until the closing brace
    if (/^accDescr\s*\{/i.test(trimmed)) {
      const block: string[] = []

      // Text may start on the opening line, after the brace
      const sameLine = trimmed.replace(/^accDescr\s*\{/i, '')
      const closedOnOpenLine = sameLine.includes('}')
      const firstChunk = closedOnOpenLine ? sameLine.slice(0, sameLine.indexOf('}')) : sameLine
      if (firstChunk.trim()) block.push(firstChunk.trim())

      if (!closedOnOpenLine) {
        // Consume following lines up to the one holding the closing brace
        while (++i < lines.length) {
          const inner = lines[i]!
          const closeAt = inner.indexOf('}')

          if (closeAt === -1) {
            if (inner.trim()) block.push(inner.trim())
            continue
          }

          const lastChunk = inner.slice(0, closeAt)
          if (lastChunk.trim()) block.push(lastChunk.trim())
          break
        }
      }

      const value = block.join('\n')
      if (value) description = value
      continue
    }

    // accDescr: <text>
    const descrMatch = trimmed.match(/^accDescr\s*:\s*(.*)$/i)
    if (descrMatch) {
      const value = descrMatch[1]!.trim()
      if (value) description = value
      continue
    }

    kept.push(line)
  }

  return { body: kept.join('\n'), title, description }
}

/**
 * Render accessibility metadata as the SVG's `<title>` and `<desc>`.
 *
 * These must be the first children of `<svg>`: assistive technology reads the
 * first `<title>` it finds, and a shape's own `<title>` tooltip appearing
 * earlier would shadow the diagram-level one.
 *
 * Returns an empty string when there is nothing to describe, so callers can
 * splice the result in unconditionally.
 */
export function renderAccessibilityTags(info: AccessibilityInfo): string {
  const parts: string[] = []

  if (info.title) {
    parts.push(`<title>${escapeXml(info.title)}</title>`)
  }
  if (info.description) {
    parts.push(`<desc>${escapeXml(info.description)}</desc>`)
  }

  return parts.join('\n')
}

/**
 * Insert accessibility tags directly after the opening `<svg>` tag.
 *
 * Done as a post-pass on the finished SVG string so that all fourteen
 * renderers stay untouched: every one of them already returns a string that
 * starts with its `<svg ...>` open tag.
 */
export function withAccessibility(svg: string, info: AccessibilityInfo): string {
  const tags = renderAccessibilityTags(info)
  if (!tags) return svg

  // Find the end of the opening <svg ...> tag. A '>' inside an attribute value
  // would break a naive search, so scan with quote awareness.
  const end = findTagEnd(svg)
  if (end === -1) return svg

  return `${svg.slice(0, end + 1)}\n${tags}${svg.slice(end + 1)}`
}

/** Index of the `>` that closes the first tag, ignoring quoted attributes. */
function findTagEnd(svg: string): number {
  let quote: string | undefined

  for (let i = 0; i < svg.length; i++) {
    const char = svg[i]!

    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '>') return i
  }

  return -1
}
