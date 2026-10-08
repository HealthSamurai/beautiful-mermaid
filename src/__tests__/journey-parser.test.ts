import { describe, expect, it } from 'bun:test'
import { parseJourneyDiagram } from '../journey/parser.ts'

// ============================================================================
// Journey parser tests
//
// The upstream-parity block ports
// packages/mermaid/src/diagrams/user-journey/parser/journey.spec.js, including
// its people-array quirks: `C task: 5` yields [] while `E task: 5:` yields [''].
// ============================================================================

/** Preprocess like src/index.ts does before handing lines to the parser. */
function lines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
}

function parse(text: string) {
  return parseJourneyDiagram(lines(text))
}

describe('journey parser — upstream parity', () => {
  it('handles a title definition', () => {
    const diagram = parse('journey\ntitle Adding journey diagram functionality to mermaid')
    expect(diagram.title).toBe('Adding journey diagram functionality to mermaid')
  })

  it('handles an accessibility description', () => {
    const diagram = parse(`journey
      accDescr: A user journey for family shopping
      title Adding journey diagram functionality to mermaid
      section Order from website`)
    expect(diagram.title).toBe('Adding journey diagram functionality to mermaid')
    expect(diagram.sections.map(s => s.title)).toEqual(['Order from website'])
  })

  it('handles a multiline accessibility description', () => {
    const diagram = parse(`journey
      accDescr {
        A user journey for
        family shopping
      }
      title Adding journey diagram functionality to mermaid
      accTitle: Adding acc journey diagram functionality to mermaid
      section Order from website`)
    expect(diagram.title).toBe('Adding journey diagram functionality to mermaid')
    expect(diagram.sections.map(s => s.title)).toEqual(['Order from website'])
  })

  it('handles an accessibility title', () => {
    const diagram = parse(`journey
      accTitle: The title
      section Order from website`)
    expect(diagram.title).toBeUndefined()
    expect(diagram.sections.map(s => s.title)).toEqual(['Order from website'])
  })

  it('handles a section definition', () => {
    const diagram = parse(`journey
      title Adding journey diagram functionality to mermaid
      section Order from website`)
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.title).toBe('Order from website')
  })

  it('normalises every <br> variant in a section title', () => {
    const diagram = parse(
      'journey\n' +
      'title Adding gantt diagram functionality to mermaid\n' +
      'section Line1<br>Line2<br/>Line3</br />Line4<br\t/>Line5'
    )
    expect(diagram.sections[0]!.title).toBe('Line1\nLine2\nLine3\nLine4\nLine5')
  })

  it('parses the full upstream task fixture', () => {
    const diagram = parse(
      'journey\n' +
      'title Adding journey diagram functionality to mermaid\n' +
      'section Documentation\n' +
      'A task: 5: Alice, Bob, Charlie\n' +
      'B task: 3:Bob, Charlie\n' +
      'C task: 5\n' +
      'D task: 5: Charlie, Alice\n' +
      'E task: 5:\n' +
      'section Another section\n' +
      'P task: 5:\n' +
      'Q task: 5:\n' +
      'R task: 5:'
    )

    expect(diagram.tasks).toHaveLength(8)

    expect(diagram.tasks[0]).toEqual({
      score: 5, people: ['Alice', 'Bob', 'Charlie'], section: 'Documentation', task: 'A task',
    })
    expect(diagram.tasks[1]).toEqual({
      score: 3, people: ['Bob', 'Charlie'], section: 'Documentation', task: 'B task',
    })
    expect(diagram.tasks[2]).toEqual({
      score: 5, people: [], section: 'Documentation', task: 'C task',
    })
    expect(diagram.tasks[3]).toEqual({
      score: 5, people: ['Charlie', 'Alice'], section: 'Documentation', task: 'D task',
    })
    expect(diagram.tasks[4]).toEqual({
      score: 5, people: [''], section: 'Documentation', task: 'E task',
    })
    expect(diagram.tasks[5]).toEqual({
      score: 5, people: [''], section: 'Another section', task: 'P task',
    })
    expect(diagram.tasks[7]).toEqual({
      score: 5, people: [''], section: 'Another section', task: 'R task',
    })
  })

  it('distinguishes a missing people list from an empty one', () => {
    const diagram = parse('journey\nC task: 5\nE task: 5:')
    expect(diagram.tasks[0]!.people).toEqual([])
    expect(diagram.tasks[1]!.people).toEqual([''])
  })
})

describe('journey parser — shape and edge cases', () => {
  it('collects distinct actors in first-appearance order', () => {
    const diagram = parse(`journey
      section Shop
      Browse: 4: Alice, Bob
      Pay: 3: Bob, Carol`)
    expect(diagram.actors).toEqual(['Alice', 'Bob', 'Carol'])
  })

  it('does not record the empty-string person as an actor', () => {
    expect(parse('journey\nA: 5:').actors).toEqual([])
  })

  it('opens an unnamed section for tasks declared before any section', () => {
    const diagram = parse('journey\nA task: 4: Alice')
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.title).toBe('')
    expect(diagram.tasks[0]!.section).toBe('')
  })

  it('groups tasks under their section', () => {
    const diagram = parse(`journey
      section One
      A: 1
      B: 2
      section Two
      C: 3`)
    expect(diagram.sections.map(s => s.tasks.length)).toEqual([2, 1])
  })

  it('clamps a score above the scale', () => {
    expect(parse('journey\nA: 9').tasks[0]!.score).toBe(5)
  })

  it('clamps a score below the scale', () => {
    expect(parse('journey\nA: 0').tasks[0]!.score).toBe(1)
  })

  it('rounds a decimal score', () => {
    expect(parse('journey\nA: 3.6').tasks[0]!.score).toBe(4)
  })

  it('handles a title on the header line', () => {
    expect(parse('journey title Shopping trip\nA: 3').title).toBe('Shopping trip')
  })

  it('accepts an empty journey', () => {
    const diagram = parse('journey')
    expect(diagram.tasks).toEqual([])
    expect(diagram.sections).toEqual([])
    expect(diagram.actors).toEqual([])
  })

  it('ignores comments', () => {
    const diagram = parse(`journey
      %% a comment
      A: 4: Alice`)
    expect(diagram.tasks).toHaveLength(1)
  })

  it('ignores a line without a colon', () => {
    const diagram = parse('journey\nnot a task\nA: 4')
    expect(diagram.tasks.map(t => t.task)).toEqual(['A'])
  })

  it('ignores a line whose score is not a number', () => {
    const diagram = parse('journey\nA: high\nB: 4')
    expect(diagram.tasks.map(t => t.task)).toEqual(['B'])
  })

  it('normalises <br> in a task label', () => {
    expect(parse('journey\nLong<br>label: 4').tasks[0]!.task).toBe('Long\nlabel')
  })

  it('trims whitespace around people names', () => {
    expect(parse('journey\nA: 4:   Alice ,  Bob  ').tasks[0]!.people).toEqual(['Alice', 'Bob'])
  })

  it('keeps tasks in source order across sections', () => {
    const diagram = parse(`journey
      section One
      A: 1
      section Two
      B: 2
      section Three
      C: 3`)
    expect(diagram.tasks.map(t => t.task)).toEqual(['A', 'B', 'C'])
  })

  it('is case-insensitive on keywords', () => {
    const diagram = parse('JOURNEY\nTITLE Trip\nSECTION Phase\nA: 4')
    expect(diagram.title).toBe('Trip')
    expect(diagram.sections[0]!.title).toBe('Phase')
  })

  it('accepts a section with no tasks', () => {
    const diagram = parse('journey\nsection Empty')
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.tasks).toEqual([])
  })
})
