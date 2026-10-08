import { describe, expect, it } from 'bun:test'
import { parseSankeyDiagram } from '../sankey/parser.ts'

// ============================================================================
// Sankey parser tests
//
// The upstream-parity block ports
// packages/mermaid/src/diagrams/sankey/parser/sankey.spec.ts, including its
// issue #7528 fixture (special characters in node ids) and the `__proto__`
// case, which must stay an ordinary node id.
//
// Like the mindmap parser this one takes raw text, because a quoted CSV field
// may legally contain characters the shared preprocessor would strip.
// ============================================================================

function parse(text: string) {
  return parseSankeyDiagram(text)
}

/** The issue #7528 fixture, verbatim from upstream. */
const ISSUE_7528 = `
      Agricultural 'waste',Bio-conversion,124.729
      Bio-conversion,Liquid,0.597
      Bio-conversion,Losses,26.862
      Bio-conversion,Solid,280.322
      Bio-conversion,Gas,81.144
      Biofuel imports,Liquid,35
      Biomass imports,Solid,35
      Coal imports,Coal,11.606
      Coal reserves,Coal,63.965
      Coal,Solid,75.571
      District heating,Industry,10.639
      District heating,Heating and cooling - homes,22.505
      District heating,Heating and cooling - commercial,46.184
      Electricity grid,Over generation / exports,104.453
      Electricity grid,Lighting & appliances - commercial,113.726
      Electricity grid,Lighting & appliances - homes,27.14
      `

const SPECIAL_CHARACTER_NODES = [
  "Agricultural 'waste'",
  'Heating and cooling - homes',
  'Heating and cooling - commercial',
  'Over generation / exports',
  'Lighting & appliances - commercial',
  'Lighting & appliances - homes',
]

describe('sankey parser — upstream parity', () => {
  for (const syntax of ['sankey-beta', 'sankey'] as const) {
    it(`parses the issue #7528 sample with ${syntax} syntax`, () => {
      const graph = parse(`${syntax}${ISSUE_7528}`)
      expect(graph.nodes).toHaveLength(19)
      expect(graph.links).toHaveLength(16)
      for (const id of SPECIAL_CHARACTER_NODES) {
        expect(graph.nodes).toContainEqual({ id })
      }
    })

    it(`allows __proto__ as an id with ${syntax} syntax`, () => {
      const graph = parse(`${syntax}
      __proto__,A,0.597
      A,__proto__,0.403
      `)
      expect(graph.nodes.map(n => n.id)).toEqual(['__proto__', 'A'])
      expect(graph.links).toHaveLength(2)
    })
  }

  it('keeps leading and trailing spaces out of node ids', () => {
    const graph = parse(`sankey-beta
    Agricultural 'waste',Bio-conversion,124.729   `)
    expect(graph.nodes.map(n => n.id)).toEqual(["Agricultural 'waste'", 'Bio-conversion'])
  })

  it('ignores comment lines', () => {
    const graph = parse(`sankey-beta
%% line with a comment
Bio-conversion,Liquid,0.597
%% Normal line`)
    expect(graph.links).toHaveLength(1)
  })

  it('accepts an unquoted sankey keyword as a node id', () => {
    const graph = parse('sankey-beta\nsankey,target,10')
    expect(graph.nodes.map(n => n.id)).toEqual(['sankey', 'target'])
  })

  it('accepts a quoted sankey keyword as a node id', () => {
    const graph = parse('sankey-beta\n"sankey",target,10')
    expect(graph.nodes.map(n => n.id)).toEqual(['sankey', 'target'])
  })

  it('unescapes a doubled quote in a node id', () => {
    const graph = parse('sankey-beta\n"""Wind""",Electricity grid,289.366')
    expect(graph.nodes[0]!.id).toBe('"Wind"')
  })

  it('accepts an integer amount', () => {
    const graph = parse('sankey-beta\nBio-conversion,Solid,280')
    expect(graph.links[0]!.value).toBe(280)
  })

  it('tolerates blank lines in the middle of the CSV', () => {
    const graph = parse('sankey-beta\nA,B,1\n\n\nB,C,2')
    expect(graph.links).toHaveLength(2)
  })

  it('tolerates blank and comment lines at the end', () => {
    const graph = parse('sankey-beta\nA,B,1\n\n%% lines at the end, do not remove\n\n')
    expect(graph.links).toHaveLength(1)
  })
})

describe('sankey parser — CSV handling', () => {
  it('keeps a comma inside a quoted field', () => {
    const graph = parse('sankey\n"Source, with comma",target,10')
    expect(graph.nodes[0]!.id).toBe('Source, with comma')
    expect(graph.links[0]!.value).toBe(10)
  })

  it('parses a decimal value', () => {
    expect(parse('sankey\nA,B,0.403').links[0]!.value).toBe(0.403)
  })

  it('skips a row with fewer than three fields', () => {
    const graph = parse('sankey\nA,B\nC,D,1')
    expect(graph.links).toHaveLength(1)
    expect(graph.links[0]).toEqual({ source: 'C', target: 'D', value: 1 })
  })

  it('skips a row with more than three fields', () => {
    const graph = parse('sankey\nA,B,1,extra\nC,D,2')
    expect(graph.links.map(l => l.source)).toEqual(['C'])
  })

  it('skips a row with a non-numeric value', () => {
    const graph = parse('sankey\nA,B,lots\nC,D,2')
    expect(graph.links.map(l => l.source)).toEqual(['C'])
  })

  it('skips a row with an empty source', () => {
    const graph = parse('sankey\n,B,1\nC,D,2')
    expect(graph.links.map(l => l.source)).toEqual(['C'])
  })
})

describe('sankey parser — shape and edge cases', () => {
  it('returns an empty graph for a bare header', () => {
    expect(parse('sankey-beta')).toEqual({ nodes: [], links: [] })
  })

  it('returns an empty graph when the header is missing', () => {
    expect(parse('A,B,1')).toEqual({ nodes: [], links: [] })
  })

  it('ignores rows above the header', () => {
    const graph = parse('X,Y,9\nsankey\nA,B,1')
    expect(graph.links).toHaveLength(1)
    expect(graph.links[0]!.source).toBe('A')
  })

  it('registers each node only once', () => {
    const graph = parse('sankey\nA,B,1\nA,C,2\nB,C,3')
    expect(graph.nodes.map(n => n.id)).toEqual(['A', 'B', 'C'])
  })

  it('keeps nodes in first-appearance order', () => {
    const graph = parse('sankey\nZ,Y,1\nY,X,1')
    expect(graph.nodes.map(n => n.id)).toEqual(['Z', 'Y', 'X'])
  })

  it('keeps links in source order', () => {
    const graph = parse('sankey\nA,B,1\nB,C,2\nC,D,3')
    expect(graph.links.map(l => l.value)).toEqual([1, 2, 3])
  })

  it('accepts a self-link', () => {
    const graph = parse('sankey\nA,A,5')
    expect(graph.nodes).toHaveLength(1)
    expect(graph.links).toHaveLength(1)
  })

  it('accepts a zero value', () => {
    expect(parse('sankey\nA,B,0').links[0]!.value).toBe(0)
  })

  it('is case-insensitive on the header keyword', () => {
    expect(parse('SanKey-Beta\nA,B,1').links).toHaveLength(1)
  })

  it('handles CRLF line endings', () => {
    const graph = parse('sankey\r\nA,B,1\r\nB,C,2')
    expect(graph.links).toHaveLength(2)
  })
})
