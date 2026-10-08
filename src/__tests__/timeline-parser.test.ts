/**
 * Tests for the timeline parser.
 *
 * Covers: header and orientation, title, sections, period/event splitting,
 * continuation lines, and robustness against sloppy input.
 */
import { describe, it, expect } from 'bun:test'
import { parseTimelineDiagram } from '../timeline/parser.ts'

/** Helper to parse — preprocesses text the same way index.ts does */
function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseTimelineDiagram(lines)
}

// ============================================================================
// Header and directives
// ============================================================================

describe('parseTimelineDiagram – header and directives', () => {
  it('defaults to a horizontal orientation', () => {
    const d = parse(`timeline
      2002 : LinkedIn`)
    expect(d.orientation).toBe('horizontal')
  })

  it('opts into the vertical orientation from the header', () => {
    const d = parse(`timeline vertical
      2002 : LinkedIn`)
    expect(d.orientation).toBe('vertical')
  })

  it('parses the title', () => {
    const d = parse(`timeline
      title History of Social Media
      2002 : LinkedIn`)
    expect(d.title).toBe('History of Social Media')
  })

  it('strips surrounding quotes from the title', () => {
    const d = parse(`timeline
      title "Quoted title"
      2002 : LinkedIn`)
    expect(d.title).toBe('Quoted title')
  })

  it('leaves the title unset when none is written', () => {
    const d = parse(`timeline
      2002 : LinkedIn`)
    expect(d.title).toBeUndefined()
  })

  it('ignores a %% comment at the end of a line', () => {
    const d = parse(`timeline
      title Plan %% heading
      2002 : LinkedIn %% first`)
    expect(d.title).toBe('Plan')
    expect(d.periods[0]!.events).toEqual(['LinkedIn'])
  })
})

// ============================================================================
// Periods and events
// ============================================================================

describe('parseTimelineDiagram – periods and events', () => {
  it('parses a period with a single event', () => {
    const d = parse(`timeline
      2002 : LinkedIn`)
    expect(d.periods).toHaveLength(1)
    expect(d.periods[0]!.label).toBe('2002')
    expect(d.periods[0]!.events).toEqual(['LinkedIn'])
  })

  it('splits several events on one line', () => {
    const d = parse(`timeline
      2004 : Facebook : Google : Flickr`)
    expect(d.periods[0]!.events).toEqual(['Facebook', 'Google', 'Flickr'])
  })

  it('keeps periods in source order', () => {
    const d = parse(`timeline
      2002 : LinkedIn
      2004 : Facebook
      2006 : Twitter`)
    expect(d.periods.map(p => p.label)).toEqual(['2002', '2004', '2006'])
  })

  it('accepts a period with no events', () => {
    const d = parse(`timeline
      2002
      2004 : Facebook`)
    expect(d.periods[0]!.label).toBe('2002')
    expect(d.periods[0]!.events).toEqual([])
    expect(d.periods[1]!.events).toEqual(['Facebook'])
  })

  it('appends events from a continuation line starting with a colon', () => {
    const d = parse(`timeline
      2006 : Twitter
           : Launched at Odeo
           : Acquired Summize`)
    expect(d.periods).toHaveLength(1)
    expect(d.periods[0]!.events).toEqual(['Twitter', 'Launched at Odeo', 'Acquired Summize'])
  })

  it('ignores a continuation line that has no preceding period', () => {
    const d = parse(`timeline
      : orphan event
      2002 : LinkedIn`)
    expect(d.periods).toHaveLength(1)
    expect(d.periods[0]!.label).toBe('2002')
  })

  it('trims whitespace around labels and events', () => {
    const d = parse(`timeline
      2002   :   LinkedIn   :   Friendster  `)
    expect(d.periods[0]!.label).toBe('2002')
    expect(d.periods[0]!.events).toEqual(['LinkedIn', 'Friendster'])
  })

  it('drops empty event chunks from a trailing colon', () => {
    const d = parse(`timeline
      2002 : LinkedIn :`)
    expect(d.periods[0]!.events).toEqual(['LinkedIn'])
  })

  it('supports non-numeric period labels', () => {
    const d = parse(`timeline
      Q1 2024 : Discovery
      Later   : Delivery`)
    expect(d.periods.map(p => p.label)).toEqual(['Q1 2024', 'Later'])
  })
})

// ============================================================================
// Sections
// ============================================================================

describe('parseTimelineDiagram – sections', () => {
  it('groups periods into their sections', () => {
    const d = parse(`timeline
      section Early days
        2002 : LinkedIn
        2004 : Facebook
      section Mobile era
        2010 : Instagram`)
    expect(d.sections).toHaveLength(2)
    expect(d.sections[0]!.title).toBe('Early days')
    expect(d.sections[0]!.periods.map(p => p.label)).toEqual(['2002', '2004'])
    expect(d.sections[1]!.title).toBe('Mobile era')
    expect(d.sections[1]!.periods.map(p => p.label)).toEqual(['2010'])
  })

  it('records the owning section title on each period', () => {
    const d = parse(`timeline
      section Early days
        2002 : LinkedIn`)
    expect(d.periods[0]!.section).toBe('Early days')
  })

  it('puts periods declared before any section into an unnamed one', () => {
    const d = parse(`timeline
      2002 : LinkedIn
      section Named
        2010 : Instagram`)
    expect(d.sections[0]!.title).toBe('')
    expect(d.sections[0]!.periods[0]!.label).toBe('2002')
    expect(d.sections[1]!.title).toBe('Named')
  })

  it('does not let a continuation line cross a section boundary', () => {
    const d = parse(`timeline
      section A
        2002 : LinkedIn
      section B
           : stray continuation
        2004 : Facebook`)
    expect(d.sections[0]!.periods[0]!.events).toEqual(['LinkedIn'])
    expect(d.sections[1]!.periods).toHaveLength(1)
    expect(d.sections[1]!.periods[0]!.label).toBe('2004')
  })

  it('flattens all periods across sections in source order', () => {
    const d = parse(`timeline
      section A
        2002 : X
      section B
        2004 : Y`)
    expect(d.periods.map(p => p.label)).toEqual(['2002', '2004'])
  })
})

// ============================================================================
// Robustness
// ============================================================================

describe('parseTimelineDiagram – robustness', () => {
  it('returns an empty diagram for a bare header', () => {
    const d = parse('timeline')
    expect(d.periods).toHaveLength(0)
    expect(d.sections).toHaveLength(0)
  })

  it('ignores a period line whose label is empty', () => {
    const d = parse(`timeline
      2002 : LinkedIn`)
    expect(d.periods).toHaveLength(1)
  })

  it('handles a section with no periods', () => {
    const d = parse(`timeline
      section Empty
      section Full
        2002 : LinkedIn`)
    expect(d.sections).toHaveLength(2)
    expect(d.sections[0]!.periods).toHaveLength(0)
    expect(d.sections[1]!.periods).toHaveLength(1)
  })
})
