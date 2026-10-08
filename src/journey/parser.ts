import type { JourneyDiagram, JourneySection, JourneyTask } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'

// ============================================================================
// Journey parser
//
// Parses Mermaid `journey` syntax into a JourneyDiagram.
//
// Directives:
//   journey
//   title <text>
//   accTitle: <text>           — accepted and ignored (a11y metadata)
//   accDescr: <text>           — accepted and ignored
//   accDescr { ... }           — accepted and ignored (multi-line)
//   section <text>             — <br> variants normalised to newlines
//
// Tasks — `label : score[: people]`:
//   A task: 5: Alice, Bob, Charlie    → people ['Alice','Bob','Charlie']
//   B task: 3:Bob, Charlie            → people ['Bob','Charlie']
//   C task: 5                         → people []     (no second colon)
//   E task: 5:                        → people ['']   (second colon, empty)
//
// The `[]` vs `['']` distinction is an upstream quirk we reproduce, because
// the renderer uses it to decide whether to draw a people row at all.
// ============================================================================

/** Journey scores are a 1..5 satisfaction scale. */
const MIN_SCORE = 1
const MAX_SCORE = 5

/**
 * Parse a Mermaid journey diagram from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 */
export function parseJourneyDiagram(lines: string[]): JourneyDiagram {
  let title: string | undefined
  const sections: JourneySection[] = []
  const tasks: JourneyTask[] = []
  const actors: string[] = []
  const seenActors = new Set<string>()

  let current: JourneySection | undefined

  // `accDescr { ... }` spans several lines; swallow them without interpreting.
  let inAccDescrBlock = false

  for (const line of lines) {
    if (inAccDescrBlock) {
      if (line.includes('}')) inAccDescrBlock = false
      continue
    }

    // Header line — `journey`, optionally with a trailing title
    const header = line.match(/^journey\b\s*(.*)$/i)
    if (header) {
      const rest = header[1]?.trim()
      if (rest) {
        const inlineTitle = rest.match(/^title\s+(.+)$/i)
        if (inlineTitle) title = inlineTitle[1]!.trim()
      }
      continue
    }

    // Accessibility metadata — parsed so it never lands in a task label
    if (/^accDescr\s*\{/i.test(line)) {
      if (!line.includes('}')) inAccDescrBlock = true
      continue
    }
    if (/^acc(Title|Descr)\s*:/i.test(line)) continue

    // title <text>
    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = titleMatch[1]!.trim()
      continue
    }

    // section <text>
    const sectionMatch = line.match(/^section\s+(.*)$/i)
    if (sectionMatch) {
      current = { title: normalizeBrTags(sectionMatch[1]!.trim()), tasks: [] }
      sections.push(current)
      continue
    }

    // label : score [: people]
    const task = parseTaskLine(line)
    if (task) {
      if (!current) {
        current = { title: '', tasks: [] }
        sections.push(current)
      }
      const withSection: JourneyTask = { ...task, section: current.title }
      current.tasks.push(withSection)
      tasks.push(withSection)

      for (const person of withSection.people) {
        if (person && !seenActors.has(person)) {
          seenActors.add(person)
          actors.push(person)
        }
      }
      continue
    }
  }

  return { title, sections, tasks, actors }
}

/**
 * Parse one task line into a task without its section.
 * Returns undefined when the line is not a task.
 */
function parseTaskLine(line: string): Omit<JourneyTask, 'section'> | undefined {
  // Split on the first colon only — a task label may not contain one, but
  // the people list is itself comma-separated after a second colon.
  const firstColon = line.indexOf(':')
  if (firstColon < 0) return undefined

  const label = line.slice(0, firstColon).trim()
  if (!label) return undefined

  const rest = line.slice(firstColon + 1)

  // `5: Alice, Bob` or `5` — the score is everything up to the next colon
  const secondColon = rest.indexOf(':')
  const scoreText = (secondColon < 0 ? rest : rest.slice(0, secondColon)).trim()

  const score = Number(scoreText)
  if (!Number.isFinite(score)) return undefined

  // No second colon at all → upstream yields an empty people array.
  // A second colon, even with nothing after it, yields [''].
  const people = secondColon < 0
    ? []
    : rest.slice(secondColon + 1).split(',').map(p => p.trim())

  return {
    task: normalizeBrTags(label),
    score: clampScore(score),
    people,
  }
}

/** Keep scores on the 1..5 scale the axis is drawn for. */
function clampScore(score: number): number {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(score)))
}
