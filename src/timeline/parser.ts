import type { TimelineDiagram, TimelineOrientation, TimelinePeriod, TimelineSection } from './types.ts'

// ============================================================================
// Timeline parser
//
// Parses Mermaid `timeline` syntax into a TimelineDiagram.
//
//   timeline
//   title History of Social Media
//   section Early days
//     2002 : LinkedIn
//     2004 : Facebook : Google
//   section Mobile era
//     2006 : Twitter
//          : Extra event for 2006      (continuation line)
//
// A period line is `label : event : event ...`. Everything before the first
// colon is the period, each remaining colon-separated chunk is one event; a
// line that *starts* with a colon appends more events to the previous period,
// which is how Mermaid lets authors wrap long event lists.
//
// `timeline vertical` opts into the vertical layout — a non-standard but
// harmless extension, since upstream Mermaid ignores trailing header words.
// ============================================================================

/**
 * Parse a Mermaid timeline diagram from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 */
export function parseTimelineDiagram(lines: string[]): TimelineDiagram {
  let title: string | undefined
  let orientation: TimelineOrientation = 'horizontal'

  const sections: TimelineSection[] = []
  const periods: TimelinePeriod[] = []

  let current: TimelineSection | undefined
  let last: TimelinePeriod | undefined

  /** Append to the active section, opening an unnamed one on demand. */
  const push = (period: TimelinePeriod) => {
    if (!current) {
      current = { title: '', periods: [] }
      sections.push(current)
    }
    period.section = current.title
    current.periods.push(period)
    periods.push(period)
    last = period
  }

  for (const raw of lines) {
    const line = stripInlineComment(raw)
    if (!line) continue

    // Header — `timeline` optionally followed by an orientation hint
    const header = line.match(/^timeline\b\s*(.*)$/i)
    if (header) {
      if (/\bvertical\b/i.test(header[1]!)) orientation = 'vertical'
      continue
    }

    // Title
    const titleMatch = line.match(/^title\s+(.*)$/i)
    if (titleMatch) {
      title = unquote(titleMatch[1]!.trim())
      continue
    }

    // Section
    const sectionMatch = line.match(/^section\s*(.*)$/i)
    if (sectionMatch) {
      current = { title: unquote(sectionMatch[1]!.trim()), periods: [] }
      sections.push(current)
      last = undefined
      continue
    }

    // Continuation — a line starting with ':' adds events to the previous period
    if (line.startsWith(':')) {
      if (!last) continue
      last.events.push(...splitEvents(line.slice(1)))
      continue
    }

    // Period — `label : event : event`
    const colon = line.indexOf(':')
    if (colon === -1) {
      // A bare line is a period with no events
      push({ label: line, events: [], section: '' })
      continue
    }

    const label = line.slice(0, colon).trim()
    if (!label) continue
    push({ label, events: splitEvents(line.slice(colon + 1)), section: '' })
  }

  return { title, orientation, sections, periods }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split the part after a period label into individual event texts. */
function splitEvents(rest: string): string[] {
  return rest.split(':').map(e => e.trim()).filter(e => e.length > 0)
}

/** Remove a trailing `%% comment` from a line. */
function stripInlineComment(line: string): string {
  const idx = line.indexOf('%%')
  return (idx === -1 ? line : line.slice(0, idx)).trim()
}

/** Strip matching surrounding quotes from a directive value. */
function unquote(value: string): string {
  const m = value.match(/^"(.*)"$/) ?? value.match(/^'(.*)'$/)
  return m ? m[1]! : value
}
