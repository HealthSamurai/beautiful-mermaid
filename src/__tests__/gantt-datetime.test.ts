import { describe, expect, it } from 'bun:test'
import { parseGanttDiagram } from '../gantt/parser.ts'
import { renderMermaidSVG } from '../index.ts'

// ============================================================================
// Gantt task lines under a dateFormat that carries a clock
//
// A task line is `label : metadata`, and the parser picks the separating
// colon by scanning from the right for a tail that parses as metadata. That
// scan has to cope with two opposite cases:
//
//   - a colon inside the *label* ("Standup at 10:30 :a1, ...") must not be
//     taken as the separator;
//   - a colon inside the *date* ("2024-02-01 06:30:00") must not either.
//
// The second case used to be accepted on partial evidence: the tail
// "00, 5d" still ends in a valid duration, so the line was cut inside the
// timestamp and produced a task named "A :a, 2024-02-01 06:30" that silently
// started today. README documents "YYYY-MM-DD HH:mm:ss" as supported, so
// this is the documented syntax, not an exotic one.
// ============================================================================

const lines = (text: string): string[] =>
  text.split('\n').map(line => line.trim()).filter(line => line.length > 0)

/** ISO minute precision — enough to see a clock, short enough to read. */
const at = (ms: number): string => new Date(ms).toISOString().slice(0, 16)

describe('gantt dateFormat with a time component', () => {
  it('keeps the clock in a YYYY-MM-DD HH:mm:ss start date', () => {
    const diagram = parseGanttDiagram(lines(`gantt
      dateFormat YYYY-MM-DD HH:mm:ss
      section S
      A :a, 2024-02-01 06:30:00, 2d`))

    expect(diagram.tasks).toHaveLength(1)
    const [task] = diagram.tasks
    expect(task!.id).toBe('a')
    expect(task!.label).toBe('A')
    expect(at(task!.start)).toBe('2024-02-01T06:30')
    expect(at(task!.end)).toBe('2024-02-03T06:30')
  })

  it('keeps the clock in a YYYY-MM-DD HH:mm start date', () => {
    const diagram = parseGanttDiagram(lines(`gantt
      dateFormat YYYY-MM-DD HH:mm
      section S
      A :a, 2024-02-01 06:30, 5d`))

    const [task] = diagram.tasks
    expect(task!.label).toBe('A')
    expect(at(task!.start)).toBe('2024-02-01T06:30')
  })

  it('resolves a dependency between two timestamped tasks', () => {
    const diagram = parseGanttDiagram(lines(`gantt
      dateFormat YYYY-MM-DD HH:mm:ss
      section S
      A :a, 2024-02-01 06:30:00, 2d
      B :b, after a, 1d`))

    const [first, second] = diagram.tasks
    expect(second!.start).toBe(first!.end)
    expect(at(second!.start)).toBe('2024-02-03T06:30')
  })

  it('still treats a colon inside the label as part of the label', () => {
    // The case the right-to-left scan exists for: a clock time in the label.
    const diagram = parseGanttDiagram(lines(`gantt
      dateFormat YYYY-MM-DD
      section S
      Standup at 10:30 :a1, 2024-01-01, 5d`))

    const [task] = diagram.tasks
    expect(task!.id).toBe('a1')
    expect(task!.label).toBe('Standup at 10:30')
    expect(at(task!.start)).toBe('2024-01-01T00:00')
  })

  it('keeps a label colon when the task has no explicit id', () => {
    const diagram = parseGanttDiagram(lines(`gantt
      dateFormat YYYY-MM-DD
      section S
      Review: round 2 :2024-01-01, 5d`))

    const [task] = diagram.tasks
    expect(task!.label).toBe('Review: round 2')
    expect(at(task!.start)).toBe('2024-01-01T00:00')
  })

  it('renders a timestamped chart without falling back to today', () => {
    const svg = renderMermaidSVG(`gantt
      title Timed
      dateFormat YYYY-MM-DD HH:mm:ss
      axisFormat %H:%M
      section S
      A :a, 2024-02-01 06:30:00, 2d`)

    expect(svg).toContain('<svg')
    expect(svg).not.toMatch(/NaN|Infinity/)
    // The label must survive intact rather than absorbing the metadata.
    expect(svg).toContain('>A<')
  })
})
