import { describe, expect, it } from 'bun:test'
import { parseQuadrantDiagram, parseStyles } from '../quadrant/parser.ts'

// ============================================================================
// Quadrant chart parser tests
//
// Ports the upstream suites:
//   quadrant-chart/parser/quadrant.jison.spec.ts  — grammar
//   quadrant-chart/quadrantDb.spec.ts             — point style parsing
// ============================================================================

/** Preprocess like src/index.ts does before handing lines to the parser. */
function lines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
}

function parse(text: string) {
  return parseQuadrantDiagram(lines(text))
}

describe('quadrant parser — grammar parity', () => {
  it('accepts a bare quadrantChart', () => {
    const diagram = parse('quadrantChart')
    expect(diagram.points).toEqual([])
    expect(diagram.title).toBeUndefined()
  })

  it('parses both x-axis ends', () => {
    const diagram = parse('quadrantChart\nx-axis urgent --> not urgent')
    expect(diagram.xAxis.start).toBe('urgent')
    expect(diagram.xAxis.end).toBe('not urgent')
  })

  it('is case-insensitive and whitespace-tolerant on x-axis', () => {
    const diagram = parse('quadrantChart\n       x-AxIs         Urgent     -->        Not Urgent    ')
    expect(diagram.xAxis.start).toBe('Urgent')
    expect(diagram.xAxis.end).toBe('Not Urgent')
  })

  it('parses quoted x-axis labels with punctuation', () => {
    const diagram = parse('quadrantChart\n   x-AxIs   "Urgent(* +=[❤"  -->  "Not Urgent (* +=[❤"')
    expect(diagram.xAxis.start).toBe('Urgent(* +=[❤')
    expect(diagram.xAxis.end).toBe('Not Urgent (* +=[❤')
  })

  it('leaves the right end unset when only one label is given', () => {
    const diagram = parse('quadrantChart\n   x-AxIs   "Urgent(* +=[❤"')
    expect(diagram.xAxis.start).toBe('Urgent(* +=[❤')
    expect(diagram.xAxis.end).toBeUndefined()
  })

  it('keeps a dangling arrow in the left label', () => {
    const diagram = parse('quadrantChart\n   x-AxIs   "Urgent(* +=[❤"  --> ')
    expect(diagram.xAxis.start).toBe('Urgent(* +=[❤ ⟶')
    expect(diagram.xAxis.end).toBeUndefined()
  })

  it('maps y-axis source order to bottom then top', () => {
    const diagram = parse('quadrantChart\ny-axis Ability to Execute --> "y-axis-2"')
    expect(diagram.yAxis.start).toBe('Ability to Execute')
    expect(diagram.yAxis.end).toBe('y-axis-2')
  })

  it('parses quadrant-1 text', () => {
    expect(parse('quadrantChart\nquadrant-1 Leaders').quadrants.q1).toBe('Leaders')
  })

  it('parses quadrant-2 text, case-insensitively', () => {
    expect(parse('QuadRantChart\n     QuaDrant-2 Do').quadrants.q2).toBe('Do')
  })

  it('parses quadrant-3 text with quotes and punctuation', () => {
    expect(parse('QuadRantChart\n   QuaDrant-3 "Delegate(* +=[❤"').quadrants.q3).toBe('Delegate(* +=[❤')
  })

  it('parses quadrant-4 text', () => {
    expect(parse('quadrantChart\nquadrant-4 delete').quadrants.q4).toBe('delete')
  })

  it('parses a title', () => {
    expect(parse('quadrantChart\ntitle this is title').title).toBe('this is title')
  })

  it('parses a title case-insensitively', () => {
    expect(parse('QuadRantChart\n     TiTle this Is title    ').title).toBe('this Is title')
  })

  it('keeps the quotes in a quoted title, as upstream does', () => {
    expect(parse('QuadRantChart\n     title "this is title (* +=[❤"').title).toBe('"this is title (* +=[❤"')
  })

  it('parses a point', () => {
    const diagram = parse('quadrantChart\npoint1: [0.1, 0.4]')
    expect(diagram.points).toEqual([
      { label: 'point1', x: 0.1, y: 0.4, className: '', styles: {} },
    ])
  })

  it('tolerates whitespace around a point definition', () => {
    const diagram = parse('QuadRantChart\n     Point1      : [0.1, 0.4]   ')
    expect(diagram.points[0]).toMatchObject({ label: 'Point1', x: 0.1, y: 0.4 })
  })

  it('allows a colon inside a quoted point label', () => {
    const diagram = parse('QuadRantChart\n     "Point1 : (* +=[❤": [1, 0]   ')
    expect(diagram.points[0]).toMatchObject({ label: 'Point1 : (* +=[❤', x: 1, y: 0 })
  })

  it('rejects a coordinate above 1', () => {
    expect(() => parse('QuadRantChart\n     Point1 : [1.2, 0.4]   ')).toThrow()
  })

  it('rejects a negative coordinate', () => {
    expect(() => parse('quadrantChart\nPoint1: [-0.1, 0.4]')).toThrow()
  })

  it('parses the whole upstream chart fixture', () => {
    const diagram = parse(`quadrantChart
      title Analytics and Business Intelligence Platforms
      x-axis "Completeness of Vision ❤" --> "x-axis-2"
      y-axis Ability to Execute --> "y-axis-2"
      quadrant-1 Leaders
      quadrant-2 Challengers
      quadrant-3 Niche
      quadrant-4 Visionaries
      Microsoft: [0.75, 0.75]
      Salesforce: [0.55, 0.60]
      IBM: [0.51, 0.40]
      Incorta: [0.20, 0.30]`)

    expect(diagram.title).toBe('Analytics and Business Intelligence Platforms')
    expect(diagram.xAxis).toEqual({ start: 'Completeness of Vision ❤', end: 'x-axis-2' })
    expect(diagram.yAxis).toEqual({ start: 'Ability to Execute', end: 'y-axis-2' })
    expect(diagram.quadrants).toEqual({
      q1: 'Leaders', q2: 'Challengers', q3: 'Niche', q4: 'Visionaries',
    })
    expect(diagram.points.map(p => p.label)).toEqual(['Microsoft', 'Salesforce', 'IBM', 'Incorta'])
    expect(diagram.points[0]).toMatchObject({ x: 0.75, y: 0.75 })
    expect(diagram.points[3]).toMatchObject({ x: 0.2, y: 0.3 })
  })

  it('parses a point class name', () => {
    const diagram = parse('quadrantChart\nCampaign A:::class1: [0.3, 0.6]')
    expect(diagram.points[0]).toMatchObject({ label: 'Campaign A', className: 'class1' })
  })

  it('parses inline point styles', () => {
    const diagram = parse('quadrantChart\nCampaign A: [0.3, 0.6] radius: 10, color: #ff0000')
    expect(diagram.points[0]!.styles).toEqual({ radius: 10, color: '#ff0000' })
  })
})

describe('quadrant parser — point styles', () => {
  it('parses the full upstream style list', () => {
    const result = parseStyles(['radius: 10', 'color: #ff0000', 'stroke-color: #ff00ff', 'stroke-width: 10px'])
    expect(result).toEqual({
      radius: 10,
      color: '#ff0000',
      strokeColor: '#ff00ff',
      strokeWidth: '10px',
    })
  })

  it('returns an empty object for an empty list', () => {
    expect(parseStyles([])).toEqual({})
  })

  it('rejects an unsupported style name', () => {
    expect(() => parseStyles(['test_name: value'])).toThrow('style named test_name is not supported.')
  })

  it('rejects a non-numeric radius', () => {
    expect(() => parseStyles(['radius: f'])).toThrow(
      'value for radius f is invalid, please use a valid number'
    )
  })

  it('rejects a malformed colour', () => {
    expect(() => parseStyles(['color: ffaa'])).toThrow(
      'value for color ffaa is invalid, please use a valid hex code'
    )
  })

  it('rejects a malformed stroke colour', () => {
    expect(() => parseStyles(['stroke-color: #f677779'])).toThrow(
      'value for stroke-color #f677779 is invalid, please use a valid hex code'
    )
  })

  it('rejects a stroke width without a unit', () => {
    expect(() => parseStyles(['stroke-width: 30'])).toThrow(
      'value for stroke-width 30 is invalid, please use a valid number of pixels (eg. 10px)'
    )
  })

  it('accepts a 3-digit hex colour', () => {
    expect(parseStyles(['color: #f00'])).toEqual({ color: '#f00' })
  })
})

describe('quadrant parser — edge cases', () => {
  it('accepts the corners of the unit square', () => {
    const diagram = parse('quadrantChart\nA: [0, 0]\nB: [1, 1]')
    expect(diagram.points).toHaveLength(2)
  })

  it('preserves point declaration order', () => {
    const diagram = parse('quadrantChart\nC: [0.1, 0.1]\nA: [0.2, 0.2]\nB: [0.3, 0.3]')
    expect(diagram.points.map(p => p.label)).toEqual(['C', 'A', 'B'])
  })

  it('ignores comments', () => {
    const diagram = parse('quadrantChart\n%% a comment\nA: [0.1, 0.1]')
    expect(diagram.points).toHaveLength(1)
  })

  it('ignores accessibility metadata', () => {
    const diagram = parse('quadrantChart\naccTitle: a title\naccDescr: a description\nA: [0.1, 0.1]')
    expect(diagram.points).toHaveLength(1)
    expect(diagram.title).toBeUndefined()
  })

  it('ignores a malformed point line', () => {
    const diagram = parse('quadrantChart\nA: [0.1]\nB: [0.2, 0.2]')
    expect(diagram.points.map(p => p.label)).toEqual(['B'])
  })

  it('ignores a point with non-numeric coordinates', () => {
    const diagram = parse('quadrantChart\nA: [x, y]\nB: [0.2, 0.2]')
    expect(diagram.points.map(p => p.label)).toEqual(['B'])
  })

  it('leaves unmentioned quadrants undefined', () => {
    const diagram = parse('quadrantChart\nquadrant-1 Only')
    expect(diagram.quadrants).toEqual({ q1: 'Only' })
  })
})
