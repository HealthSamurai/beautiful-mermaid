import { describe, expect, it } from 'bun:test'
import { parseRequirementDiagram, compileStyles } from '../requirement/parser.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

// ============================================================================
// Requirement diagram tests
//
// The behavioural cases come from
// packages/mermaid/src/diagrams/requirement/requirementDb.spec.ts, restated
// against this parser: upstream drives its database directly, so the
// equivalent here is the source text that would drive it.
// ============================================================================

function parse(text: string) {
  return parseRequirementDiagram(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  )
}

describe('requirement parser — declarations', () => {
  it('should add a requirement', () => {
    const diagram = parse('requirementDiagram\nrequirement test_req {\n}')
    expect(diagram.requirements.has('test_req')).toBe(true)
    expect(diagram.requirements.get('test_req')!.type).toBe('Requirement')
  })

  it('should add an element', () => {
    const diagram = parse('requirementDiagram\nelement test_entity {\n}')
    expect(diagram.elements.has('test_entity')).toBe(true)
  })

  it('reads every requirement type', () => {
    const cases: [string, string][] = [
      ['requirement', 'Requirement'],
      ['functionalRequirement', 'Functional Requirement'],
      ['interfaceRequirement', 'Interface Requirement'],
      ['performanceRequirement', 'Performance Requirement'],
      ['physicalRequirement', 'Physical Requirement'],
      ['designConstraint', 'Design Constraint'],
    ]
    for (const [keyword, type] of cases) {
      const diagram = parse(`requirementDiagram\n${keyword} r {\n}`)
      expect(diagram.requirements.get('r')!.type).toBe(type as never)
    }
  })

  it('reads a full requirement body', () => {
    const diagram = parse(`requirementDiagram
      requirement test_req {
        id: 1
        text: the test text
        risk: high
        verifyMethod: test
      }`)
    expect(diagram.requirements.get('test_req')).toMatchObject({
      name: 'test_req',
      type: 'Requirement',
      requirementId: '1',
      text: 'the test text',
      risk: 'High',
      verifyMethod: 'Test',
    })
  })

  it('reads a full element body', () => {
    const diagram = parse(`requirementDiagram
      element test_entity {
        type: simulation
        docRef: none
      }`)
    expect(diagram.elements.get('test_entity')).toMatchObject({
      name: 'test_entity', type: 'simulation', docRef: 'none',
    })
  })

  it('reads every risk level', () => {
    for (const [keyword, risk] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
      const diagram = parse(`requirementDiagram\nrequirement r {\nrisk: ${keyword}\n}`)
      expect(diagram.requirements.get('r')!.risk).toBe(risk as never)
    }
  })

  it('reads every verification method', () => {
    const methods = [
      ['analysis', 'Analysis'], ['demonstration', 'Demonstration'],
      ['inspection', 'Inspection'], ['test', 'Test'],
    ]
    for (const [keyword, verify] of methods) {
      const diagram = parse(`requirementDiagram\nrequirement r {\nverifyMethod: ${keyword}\n}`)
      expect(diagram.requirements.get('r')!.verifyMethod).toBe(verify as never)
    }
  })

  it('drops an unrecognised risk', () => {
    const diagram = parse('requirementDiagram\nrequirement r {\nrisk: catastrophic\n}')
    expect(diagram.requirements.get('r')!.risk).toBeUndefined()
  })

  it('ignores an unknown body key', () => {
    const diagram = parse('requirementDiagram\nrequirement r {\nowner: nikolai\nid: 1\n}')
    expect(diagram.requirements.get('r')!.requirementId).toBe('1')
  })

  it('reads a quoted name', () => {
    const diagram = parse('requirementDiagram\nrequirement "the requirement" {\n}')
    expect(diagram.requirements.has('the requirement')).toBe(true)
  })

  it('reads a quoted body value', () => {
    const diagram = parse('requirementDiagram\nrequirement r {\ntext: "a: b, c"\n}')
    expect(diagram.requirements.get('r')!.text).toBe('a: b, c')
  })

  it('keeps a colon inside a text value', () => {
    const diagram = parse('requirementDiagram\nrequirement r {\ntext: see RFC 1: part 2\n}')
    expect(diagram.requirements.get('r')!.text).toBe('see RFC 1: part 2')
  })

  it('reads a title', () => {
    expect(parse('requirementDiagram\ntitle Traceability\nrequirement r {\n}').title)
      .toBe('Traceability')
  })

  it('defaults the direction to TB', () => {
    expect(parse('requirementDiagram\nrequirement r {\n}').direction).toBe('TB')
  })

  it('should detect direction', () => {
    for (const direction of ['TB', 'BT', 'LR', 'RL']) {
      expect(parse(`requirementDiagram\ndirection ${direction}\nrequirement r {\n}`).direction)
        .toBe(direction as never)
    }
  })

  it('parses a bare header as an empty diagram', () => {
    const diagram = parse('requirementDiagram')
    expect(diagram.requirements.size).toBe(0)
    expect(diagram.elements.size).toBe(0)
  })

  it('ignores comment lines', () => {
    const diagram = parse('requirementDiagram\n%% a note\nrequirement r {\n}')
    expect(diagram.requirements.size).toBe(1)
  })
})

describe('requirement parser — relationships', () => {
  it('should add a relationship', () => {
    const diagram = parse('requirementDiagram\nsrc - contains -> dst')
    expect(diagram.relationships[0]).toMatchObject({
      type: 'contains', src: 'src', dst: 'dst',
    })
  })

  it('reads every relationship type', () => {
    const types = [
      'contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces',
    ]
    for (const type of types) {
      const diagram = parse(`requirementDiagram\na - ${type} -> b`)
      expect(diagram.relationships[0]!.type).toBe(type as never)
    }
  })

  it('reverses the arrow, so the source stays the source', () => {
    // `a <- satisfies - b` is "b satisfies a"
    const diagram = parse('requirementDiagram\na <- satisfies - b')
    expect(diagram.relationships[0]).toMatchObject({ src: 'b', dst: 'a' })
  })

  it('reads both arrow forms as the same relationship', () => {
    const right = parse('requirementDiagram\nb - satisfies -> a').relationships[0]!
    const left = parse('requirementDiagram\na <- satisfies - b').relationships[0]!
    expect({ ...right, id: '' }).toEqual({ ...left, id: '' })
  })

  it('should create unique edge ids for parallel relationships', () => {
    const diagram = parse(`requirementDiagram
      requirement src {
      }
      requirement dst {
      }
      src - traces -> dst
      src - contains -> dst`)
    expect(diagram.relationships.map(r => r.id)).toEqual(['src-dst-0', 'src-dst-1'])
  })

  it('numbers each pair independently', () => {
    const diagram = parse('requirementDiagram\na - traces -> b\nc - traces -> d')
    expect(diagram.relationships.map(r => r.id)).toEqual(['a-b-0', 'c-d-0'])
  })

  it('ignores an unknown relationship keyword', () => {
    expect(parse('requirementDiagram\na - blesses -> b').relationships).toHaveLength(0)
  })

  it('reads a quoted endpoint name', () => {
    const diagram = parse('requirementDiagram\n"the source" - traces -> "the target"')
    expect(diagram.relationships[0]).toMatchObject({
      src: 'the source', dst: 'the target',
    })
  })
})

describe('requirement parser — classes and styles', () => {
  it('should detect single class', () => {
    const diagram = parse('requirementDiagram\nclassDef a stroke-width: 8px')
    expect(diagram.classes.has('a')).toBe(true)
    expect(diagram.classes.get('a')).toBe('stroke-width: 8px')
  })

  it('should detect many classes', () => {
    const diagram = parse('requirementDiagram\nclassDef a,b stroke-width: 8px')
    expect(diagram.classes.get('a')).toBe('stroke-width: 8px')
    expect(diagram.classes.get('b')).toBe('stroke-width: 8px')
  })

  it('accumulates several classDefs for one name', () => {
    const diagram = parse('requirementDiagram\nclassDef a fill:#f9f\nclassDef a stroke:#333')
    expect(diagram.classes.get('a')).toBe('fill:#f9f,stroke:#333')
  })

  it('should add styles to a requirement and element', () => {
    const diagram = parse(`requirementDiagram
      requirement requirement {
      }
      element element {
      }
      style requirement color:red
      style element stroke-width:4px, stroke: yellow`)

    expect(diagram.requirements.get('requirement')!.cssStyles).toEqual(['color:red'])
    expect(diagram.elements.get('element')!.cssStyles)
      .toEqual(['stroke-width:4px', 'stroke: yellow'])
  })

  it('assigns a class with a class statement', () => {
    const diagram = parse('requirementDiagram\nrequirement r {\n}\nclass r big')
    expect(diagram.requirements.get('r')!.classes).toEqual(['big'])
  })

  it('assigns a class to several nodes at once', () => {
    const diagram = parse('requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\nclass a,b big')
    expect(diagram.requirements.get('a')!.classes).toEqual(['big'])
    expect(diagram.requirements.get('b')!.classes).toEqual(['big'])
  })

  it('assigns a class with the :::name shorthand on a declaration', () => {
    const diagram = parse('requirementDiagram\nrequirement r:::big {\n}')
    expect(diagram.requirements.get('r')!.name).toBe('r')
    expect(diagram.requirements.get('r')!.classes).toEqual(['big'])
  })

  it('assigns a class with a standalone :::name line', () => {
    const diagram = parse('requirementDiagram\nrequirement r {\n}\nr:::big')
    expect(diagram.requirements.get('r')!.classes).toEqual(['big'])
  })

  it('does not duplicate a class assigned twice', () => {
    const diagram = parse('requirementDiagram\nrequirement r:::big {\n}\nclass r big')
    expect(diagram.requirements.get('r')!.classes).toEqual(['big'])
  })

  it('ignores a style naming an unknown node', () => {
    expect(() => parse('requirementDiagram\nstyle nope fill:#eee')).not.toThrow()
  })
})

describe('requirement parser — compileStyles', () => {
  it('joins declarations with semicolons', () => {
    expect(compileStyles(['fill:#f9f', 'stroke:#333'])).toBe('fill:#f9f;stroke:#333')
  })

  it('returns undefined for no declarations', () => {
    expect(compileStyles([])).toBeUndefined()
  })

  it('rejects a value that could break out of the attribute', () => {
    expect(compileStyles(['fill:"><script>'])).toBeUndefined()
  })
})

describe('requirement layout', () => {
  const DIAGRAM = `requirementDiagram
    requirement req {
      id: 1
      text: the text
      risk: high
      verifyMethod: test
    }
    element ent {
      type: simulation
      docRef: none
    }
    ent - satisfies -> req`

  it('places one node per requirement and element', () => {
    expect(layoutRequirementDiagram(parse(DIAGRAM)).nodes).toHaveLength(2)
  })

  it('marks requirements and elements apart', () => {
    const nodes = layoutRequirementDiagram(parse(DIAGRAM)).nodes
    expect(nodes.find(n => n.name === 'req')!.kind).toBe('requirement')
    expect(nodes.find(n => n.name === 'ent')!.kind).toBe('element')
  })

  it('gives requirements and elements different colour indices', () => {
    const nodes = layoutRequirementDiagram(parse(DIAGRAM)).nodes
    expect(nodes.find(n => n.name === 'req')!.colorIndex).toBe(0)
    expect(nodes.find(n => n.name === 'ent')!.colorIndex).toBe(1)
  })

  it('shows the requirement type as the stereotype', () => {
    const nodes = layoutRequirementDiagram(parse(
      'requirementDiagram\nfunctionalRequirement r {\n}'
    )).nodes
    expect(nodes[0]!.stereotype).toBe('Functional Requirement')
  })

  it('builds one row per declared field', () => {
    const nodes = layoutRequirementDiagram(parse(DIAGRAM)).nodes
    expect(nodes.find(n => n.name === 'req')!.rows.map(r => r.label))
      .toEqual(['Id', 'Text', 'Risk', 'Verification'])
  })

  it('omits a row for a field that was not declared', () => {
    const nodes = layoutRequirementDiagram(parse(
      'requirementDiagram\nrequirement r {\nid: 1\n}'
    )).nodes
    expect(nodes[0]!.rows).toHaveLength(1)
  })

  it('makes a node with rows taller than one without', () => {
    const bare = layoutRequirementDiagram(parse('requirementDiagram\nrequirement r {\n}')).nodes[0]!
    const full = layoutRequirementDiagram(parse(DIAGRAM)).nodes
      .find(n => n.name === 'req')!
    expect(full.height).toBeGreaterThan(bare.height)
  })

  it('clips a very long text value', () => {
    const long = 'x'.repeat(200)
    const nodes = layoutRequirementDiagram(parse(
      `requirementDiagram\nrequirement r {\ntext: ${long}\n}`
    )).nodes
    expect(nodes[0]!.rows[0]!.value.length).toBeLessThan(60)
    expect(nodes[0]!.rows[0]!.value).toEndWith('\u2026')
  })

  it('caps the box width', () => {
    const nodes = layoutRequirementDiagram(parse(
      `requirementDiagram\nrequirement ${'r'.repeat(200)} {\n}`
    )).nodes
    expect(nodes[0]!.width).toBeLessThanOrEqual(280)
  })

  it('wraps a long name', () => {
    const nodes = layoutRequirementDiagram(parse(
      'requirementDiagram\nrequirement "a name long enough to need several lines of its own" {\n}'
    )).nodes
    expect(nodes[0]!.nameLines.length).toBeGreaterThan(1)
  })

  it('routes one edge per relationship', () => {
    expect(layoutRequirementDiagram(parse(DIAGRAM)).edges).toHaveLength(1)
  })

  it('labels an edge with its relationship type', () => {
    expect(layoutRequirementDiagram(parse(DIAGRAM)).edges[0]!.label.text).toBe('satisfies')
  })

  it('drops a relationship whose endpoints do not exist', () => {
    const chart = layoutRequirementDiagram(parse(
      'requirementDiagram\nrequirement r {\n}\nr - traces -> ghost'
    ))
    expect(chart.edges).toEqual([])
    expect(chart.nodes).toHaveLength(1)
  })

  it('gives an edge a path with at least two points', () => {
    expect(layoutRequirementDiagram(parse(DIAGRAM)).edges[0]!.path)
      .toMatch(/^M[\d.,-]+ L/)
  })

  it('compiles a classDef into an inline style', () => {
    const nodes = layoutRequirementDiagram(parse(
      'requirementDiagram\nclassDef big fill:#f9f,stroke:#333\nrequirement r:::big {\n}'
    )).nodes
    expect(nodes[0]!.style).toBe('fill:#f9f;stroke:#333')
  })

  it('combines a classDef with a style statement', () => {
    const nodes = layoutRequirementDiagram(parse(
      'requirementDiagram\nclassDef big fill:#f9f\nrequirement r:::big {\n}\nstyle r stroke:#333'
    )).nodes
    expect(nodes[0]!.style).toBe('fill:#f9f;stroke:#333')
  })

  it('honours the direction', () => {
    // Left to right puts the two boxes side by side, so the canvas is wider
    const down = layoutRequirementDiagram(parse(DIAGRAM))
    const across = layoutRequirementDiagram(parse(
      DIAGRAM.replace('requirementDiagram', 'requirementDiagram\ndirection LR')
    ))
    expect(across.width).toBeGreaterThan(down.width)
    expect(across.height).toBeLessThan(down.height)
  })

  it('reserves room for a title', () => {
    const without = layoutRequirementDiagram(parse('requirementDiagram\nrequirement r {\n}'))
    const withTitle = layoutRequirementDiagram(parse(
      'requirementDiagram\ntitle T\nrequirement r {\n}'
    ))
    expect(withTitle.height).toBeGreaterThan(without.height)
    expect(withTitle.nodes[0]!.y).toBeGreaterThan(without.nodes[0]!.y)
    expect(withTitle.title!.text).toBe('T')
  })

  it('keeps every node inside the canvas', () => {
    const chart = layoutRequirementDiagram(parse(DIAGRAM))
    for (const node of chart.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(chart.width + 1)
      expect(node.y + node.height).toBeLessThanOrEqual(chart.height + 1)
    }
  })

  it('handles an empty diagram', () => {
    const chart = layoutRequirementDiagram(parse('requirementDiagram'))
    expect(chart.nodes).toEqual([])
    expect(chart.edges).toEqual([])
    expect(chart.width).toBeGreaterThan(0)
  })
})

describe('requirement integration — renderMermaidSVG', () => {
  const DIAGRAM = `requirementDiagram

    requirement test_req {
      id: 1
      text: the test text
      risk: high
      verifyMethod: test
    }

    element test_entity {
      type: simulation
      docRef: none
    }

    test_entity - satisfies -> test_req`

  it('renders a requirement diagram to SVG', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain('req-node')
  })

  it('renders one rect per node', () => {
    expect(renderMermaidSVG(DIAGRAM).match(/class="req-node/g)).toHaveLength(2)
  })

  it('renders the stereotypes in guillemets', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('\u00ABRequirement\u00BB')
    expect(svg).toContain('\u00ABElement\u00BB')
  })

  it('renders every name', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('test_req')
    expect(svg).toContain('test_entity')
  })

  it('renders the body rows', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    for (const text of ['the test text', 'High', 'Test', 'simulation', 'none']) {
      expect(svg).toContain(text)
    }
  })

  it('emits name and kind as data attributes', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('data-name="test_req"')
    expect(svg).toContain('data-kind="element"')
  })

  it('spells the fields out in the node title', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain(
      '<title>Requirement: test_req (Id: 1, Text: the test text, Risk: High, Verification: Test)</title>'
    )
  })

  it('renders the relationship and its label', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('data-relation="satisfies"')
    expect(svg).toContain('>satisfies</text>')
  })

  it('describes a relationship in its title', () => {
    expect(renderMermaidSVG(DIAGRAM))
      .toContain('<title>test_entity satisfies test_req</title>')
  })

  it('draws a derived relationship dashed and a structural one solid', () => {
    const derived = renderMermaidSVG('requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\na - traces -> b')
    const structural = renderMermaidSVG('requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\na - contains -> b')
    // The CSS rule is always emitted; what differs is the class on the path
    expect(derived).toContain('req-edge req-edge-traces req-edge-derived')
    expect(structural).toContain('class="req-edge req-edge-contains"')
  })

  it('points a derived relationship with an open arrowhead', () => {
    const svg = renderMermaidSVG('requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\na - traces -> b')
    expect(svg).toContain('marker-end="url(#req-arrow-dashed)"')
  })

  it('declares a colour variable per node kind', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('--req-color-0')
    expect(svg).toContain('--req-color-1')
  })

  it('maps requirements onto the theme accent', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain('--req-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(DIAGRAM, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    expect(renderMermaidSVG(DIAGRAM, { transparent: true })).not.toContain('background:var(--bg)')
  })

  it('renders a title', () => {
    expect(renderMermaidSVG('requirementDiagram\ntitle Traceability\nrequirement r {\n}'))
      .toContain('Traceability')
  })

  it('takes a title from frontmatter', () => {
    expect(renderMermaidSVG('---\ntitle: From meta\n---\nrequirementDiagram\nrequirement r {\n}'))
      .toContain('From meta')
  })

  it('emits an inline style from a classDef', () => {
    const svg = renderMermaidSVG(
      'requirementDiagram\nclassDef big fill:#f9f\nrequirement r:::big {\n}'
    )
    expect(svg).toContain('style="fill:#f9f"')
    expect(svg).toContain('req-node req-requirement req-fill-0 big')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('requirementDiagram\nrequirement "A & <B>" {\n}')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders accTitle and accDescr', () => {
    const svg = renderMermaidSVG(
      'requirementDiagram\naccTitle: The model\naccDescr: What traces to what\nrequirement r {\n}'
    )
    expect(svg).toContain('<title>The model</title>')
    expect(svg).toContain('<desc>What traces to what</desc>')
  })

  it('renders an empty diagram without throwing', () => {
    const svg = renderMermaidSVG('requirementDiagram')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(DIAGRAM)).toThrow(/not supported for requirement/)
  })
})
