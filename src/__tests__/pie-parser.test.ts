import { describe, expect, it } from 'bun:test'
import { parsePieDiagram } from '../pie/parser.ts'

// ============================================================================
// Pie parser tests
//
// Cases mirror the upstream Mermaid suite
// (packages/mermaid/src/diagrams/pie/pie.spec.ts) so our subset stays
// behaviour-compatible where it overlaps.
// ============================================================================

/** Preprocess like src/index.ts does before handing lines to the parser. */
function lines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
}

function parse(text: string) {
  return parsePieDiagram(lines(text))
}

/** Slices as a label→value map, the shape upstream asserts on. */
function sections(text: string): Map<string, number> {
  return new Map(parse(text).slices.map(s => [s.label, s.value]))
}

describe('pie parser — upstream parity', () => {
  it('handles a very simple pie', () => {
    const map = sections(`pie
      "ash": 100
    `)
    expect(map.get('ash')).toBe(100)
  })

  it('handles a simple pie', () => {
    const map = sections(`pie
      "ash" : 60
      "bat" : 40
    `)
    expect(map.get('ash')).toBe(60)
    expect(map.get('bat')).toBe(40)
  })

  it('handles showData', () => {
    const diagram = parse(`pie showData
      "ash" : 60
      "bat" : 40
    `)
    expect(diagram.showData).toBe(true)
    expect(diagram.slices).toHaveLength(2)
  })

  it('defaults showData to false', () => {
    expect(parse(`pie\n"ash" : 60`).showData).toBe(false)
  })

  it('handles comments', () => {
    const map = sections(`pie
      %% comments
      "ash" : 60
      "bat" : 40
    `)
    expect(map.size).toBe(2)
    expect(map.get('ash')).toBe(60)
  })

  it('handles a title on the header line', () => {
    const diagram = parse(`pie title a 60/40 pie
      "ash" : 60
      "bat" : 40
    `)
    expect(diagram.title).toBe('a 60/40 pie')
    expect(diagram.slices).toHaveLength(2)
  })

  it('handles a title on its own line', () => {
    const diagram = parse(`pie
      title Animal adoption
      "dogs" : 60
    `)
    expect(diagram.title).toBe('Animal adoption')
  })

  it('keeps a colon inside the title text', () => {
    const diagram = parse(`pie title Default text position: Animal adoption
      "dogs" : 80
      "rats" : 40.12
    `)
    expect(diagram.title).toBe('Default text position: Animal adoption')
    expect(diagram.slices).toHaveLength(2)
  })

  it('ignores accTitle without swallowing slices', () => {
    const diagram = parse(`pie title a neat chart
      accTitle: a neat acc title
      "ash" : 60
      "bat" : 40
    `)
    expect(diagram.title).toBe('a neat chart')
    expect(diagram.slices.map(s => s.label)).toEqual(['ash', 'bat'])
  })

  it('ignores a single-line accDescr', () => {
    const diagram = parse(`pie title a neat chart
      accDescr: a neat description
      "ash" : 60
      "bat" : 40
    `)
    expect(diagram.title).toBe('a neat chart')
    expect(diagram.slices).toHaveLength(2)
  })

  it('ignores a multi-line accDescr block', () => {
    const diagram = parse(`pie title a neat chart
      accDescr {
        a neat description
        on multiple lines
      }
      "ash" : 60
      "bat" : 40
    `)
    expect(diagram.title).toBe('a neat chart')
    expect(diagram.slices.map(s => s.label)).toEqual(['ash', 'bat'])
  })

  it('handles positive decimals', () => {
    const map = sections(`pie
      "ash" : 60.67
      "bat" : 40
    `)
    expect(map.get('ash')).toBe(60.67)
    expect(map.get('bat')).toBe(40)
  })

  it('handles a zero slice value', () => {
    const map = sections(`pie title Default text position: Animal adoption
      accTitle: simple pie char demo
      accDescr: pie chart with 3 sections
      "dogs" : 0
      "rats" : 40.12
    `)
    expect(map.get('dogs')).toBe(0)
    expect(map.get('rats')).toBe(40.12)
  })

  it('rejects a negative decimal', () => {
    expect(() => parse(`pie
      "ash" : -60.67
      "bat" : 40.12
    `)).toThrow()
  })

  it('reports the negative value with the upstream message', () => {
    expect(() => parse(`pie title Default text position: Animal adoption
      "dogs" : -60.67
      "rats" : 40.12
    `)).toThrow(
      '"dogs" has invalid value: -60.67. Negative values are not allowed in pie charts. ' +
      'All slice values must be >= 0.'
    )
  })

  it('keeps unsafe property names as plain labels', () => {
    const diagram = parse(`pie title Unsafe props test
      "__proto__" : 386
      "constructor" : 85
      "prototype" : 15
    `)
    expect(diagram.slices.map(s => s.label)).toEqual(['__proto__', 'constructor', 'prototype'])
  })
})

describe('pie parser — shape and edge cases', () => {
  it('preserves declaration order', () => {
    const diagram = parse(`pie
      "c" : 1
      "a" : 2
      "b" : 3
    `)
    expect(diagram.slices.map(s => s.label)).toEqual(['c', 'a', 'b'])
  })

  it('accepts an empty pie', () => {
    const diagram = parse('pie')
    expect(diagram.slices).toEqual([])
    expect(diagram.title).toBeUndefined()
  })

  it('accepts an empty label', () => {
    const diagram = parse(`pie\n"" : 10`)
    expect(diagram.slices).toEqual([{ label: '', value: 10 }])
  })

  it('allows showData together with a title line', () => {
    const diagram = parse(`pie showData
      title Sales
      "a" : 1
    `)
    expect(diagram.showData).toBe(true)
    expect(diagram.title).toBe('Sales')
  })

  it('strips quotes around a title', () => {
    expect(parse(`pie\ntitle "Quoted"\n"a" : 1`).title).toBe('Quoted')
  })

  it('ignores unparseable lines instead of throwing', () => {
    const diagram = parse(`pie
      this is not a slice
      "a" : 1
    `)
    expect(diagram.slices).toEqual([{ label: 'a', value: 1 }])
  })

  it('tolerates spacing around the colon', () => {
    const diagram = parse(`pie
      "a":1
      "b"   :   2
    `)
    expect(diagram.slices).toEqual([{ label: 'a', value: 1 }, { label: 'b', value: 2 }])
  })

  it('keeps duplicate labels as separate slices', () => {
    const diagram = parse(`pie
      "a" : 1
      "a" : 2
    `)
    expect(diagram.slices).toHaveLength(2)
  })

  it('accepts a label containing spaces and punctuation', () => {
    const diagram = parse(`pie\n"Dogs & cats (2024)" : 5`)
    expect(diagram.slices[0]!.label).toBe('Dogs & cats (2024)')
  })

  it('is case-insensitive on the header keyword', () => {
    expect(parse(`PIE showData\n"a" : 1`).showData).toBe(true)
  })
})
