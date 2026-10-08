import { describe, expect, it } from 'bun:test'
import { parseC4Diagram } from '../c4/parser.ts'
import { layoutC4Diagram } from '../c4/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import type { C4Boundary, C4Shape } from '../c4/types.ts'

// ============================================================================
// C4 diagram tests
//
// Covers the syntax shared by all five C4 levels: shapes, boundaries,
// relationships, the named `$key="value"` argument form and the Update*Style
// statements.
// ============================================================================

function parse(text: string) {
  return parseC4Diagram(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  )
}

/** First shape in the parsed tree, depth first. */
function firstShape(nodes: ReturnType<typeof parse>['nodes']): C4Shape {
  for (const node of nodes) {
    if (node.kind === 'shape') return node
    const inner = firstShape(node.children)
    if (inner) return inner
  }
  return undefined as unknown as C4Shape
}

describe('c4 parser — levels and header', () => {
  it('reads every level keyword', () => {
    const levels = [
      'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
    ]
    for (const level of levels) {
      expect(parse(`${level}\nPerson(a, "A")`).level).toBe(level as never)
    }
  })

  it('defaults to C4Context', () => {
    expect(parse('Person(a, "A")').level).toBe('C4Context')
  })

  it('reads a title on its own line', () => {
    expect(parse('C4Context\ntitle My system').title).toBe('My system')
  })

  it('reads a title on the header line', () => {
    expect(parse('C4Context title My system').title).toBe('My system')
  })

  it('defaults the direction to TB', () => {
    expect(parse('C4Context\nPerson(a, "A")').direction).toBe('TB')
  })

  it('reads every direction', () => {
    for (const direction of ['TB', 'BT', 'LR', 'RL']) {
      expect(parse(`C4Context\ndirection ${direction}`).direction).toBe(direction as never)
    }
  })

  it('parses a bare header as an empty diagram', () => {
    const diagram = parse('C4Context')
    expect(diagram.nodes).toEqual([])
    expect(diagram.relationships).toEqual([])
  })

  it('ignores comment lines', () => {
    expect(parse('C4Context\n%% a note\nPerson(a, "A")').nodes).toHaveLength(1)
  })
})

describe('c4 parser — shapes', () => {
  it('reads a person', () => {
    const shape = firstShape(parse('C4Context\nPerson(a, "Customer", "A bank customer")').nodes)
    expect(shape).toMatchObject({
      alias: 'a', label: 'Customer', descr: 'A bank customer', shapeKind: 'person',
    })
  })

  it('reads every shape keyword', () => {
    const cases: [string, string][] = [
      ['Person', 'person'],
      ['Person_Ext', 'external_person'],
      ['System', 'system'],
      ['SystemDb', 'system_db'],
      ['SystemQueue', 'system_queue'],
      ['System_Ext', 'external_system'],
      ['SystemDb_Ext', 'external_system_db'],
      ['SystemQueue_Ext', 'external_system_queue'],
      ['Container', 'container'],
      ['ContainerDb', 'container_db'],
      ['ContainerQueue', 'container_queue'],
      ['Container_Ext', 'external_container'],
      ['ContainerDb_Ext', 'external_container_db'],
      ['ContainerQueue_Ext', 'external_container_queue'],
      ['Component', 'component'],
      ['ComponentDb', 'component_db'],
      ['ComponentQueue', 'component_queue'],
      ['Component_Ext', 'external_component'],
      ['ComponentDb_Ext', 'external_component_db'],
      ['ComponentQueue_Ext', 'external_component_queue'],
    ]
    for (const [keyword, kind] of cases) {
      const shape = firstShape(parse(`C4Context\n${keyword}(a, "A")`).nodes)
      expect(shape.shapeKind).toBe(kind as never)
    }
  })

  it('reads a container technology before its description', () => {
    const shape = firstShape(parse(
      'C4Container\nContainer(api, "API", "Java and Spring", "Handles requests")'
    ).nodes)
    expect(shape).toMatchObject({
      alias: 'api', label: 'API', techn: 'Java and Spring', descr: 'Handles requests',
    })
  })

  it('keeps a quoted technology containing a comma intact', () => {
    const shape = firstShape(parse(
      'C4Container\nContainer(api, "API", "Java, Spring", "Handles requests")'
    ).nodes)
    expect(shape.techn).toBe('Java, Spring')
    expect(shape.descr).toBe('Handles requests')
  })

  it('does not read a technology for a person', () => {
    const shape = firstShape(parse('C4Context\nPerson(a, "A", "A customer")').nodes)
    expect(shape.techn).toBeUndefined()
    expect(shape.descr).toBe('A customer')
  })

  it('defaults the label to the alias', () => {
    expect(firstShape(parse('C4Context\nPerson(a)').nodes).label).toBe('a')
  })

  it('reads an unquoted label', () => {
    expect(firstShape(parse('C4Context\nPerson(a, Customer)').nodes).label).toBe('Customer')
  })

  it('keeps a comma inside a quoted label', () => {
    expect(firstShape(parse('C4Context\nPerson(a, "One, two")').nodes).label).toBe('One, two')
  })

  it('reads named arguments in any order', () => {
    const shape = firstShape(parse(
      'C4Context\nSystem(s, "S", $tags="v1", $link="https://example.com", $descr="D")'
    ).nodes)
    expect(shape).toMatchObject({
      tags: 'v1', link: 'https://example.com', descr: 'D',
    })
  })

  it('lets a named argument win over a positional one', () => {
    const shape = firstShape(parse(
      'C4Context\nSystem(s, "S", "positional", $descr="named")'
    ).nodes)
    expect(shape.descr).toBe('named')
  })

  it('keeps positional indices when a named argument comes first', () => {
    const shape = firstShape(parse(
      'C4Context\nSystem(s, $tags="v1", "The label")'
    ).nodes)
    expect(shape.label).toBe('The label')
  })

  it('reads a sprite', () => {
    expect(firstShape(parse('C4Context\nPerson(a, "A", $sprite="user")').nodes).sprite)
      .toBe('user')
  })

  it('preserves an empty positional slot', () => {
    // The skipped description must not shift the later fields
    const shape = firstShape(parse('C4Container\nContainer(c, "C", , "The description")').nodes)
    expect(shape.techn).toBeUndefined()
    expect(shape.descr).toBe('The description')
  })

  it('ignores a shape with no alias', () => {
    expect(parse('C4Context\nPerson()').nodes).toHaveLength(0)
  })

  it('ignores an unknown keyword', () => {
    expect(parse('C4Context\nSpaceship(a, "A")').nodes).toHaveLength(0)
  })
})

describe('c4 parser — boundaries', () => {
  it('nests a shape inside a boundary', () => {
    const diagram = parse(`C4Context
      System_Boundary(b1, "Bank") {
        System(s1, "Banking")
      }`)
    expect(diagram.nodes).toHaveLength(1)
    const boundary = diagram.nodes[0] as C4Boundary
    expect(boundary.kind).toBe('boundary')
    expect(boundary.children).toHaveLength(1)
    expect((boundary.children[0] as C4Shape).alias).toBe('s1')
  })

  it('reads every boundary keyword', () => {
    const cases: [string, string][] = [
      ['Boundary', 'boundary'],
      ['Enterprise_Boundary', 'enterprise'],
      ['System_Boundary', 'system'],
      ['Container_Boundary', 'container'],
      ['Node', 'node'],
      ['Node_L', 'node'],
      ['Node_R', 'node'],
      ['Deployment_Node', 'node'],
    ]
    for (const [keyword, kind] of cases) {
      const diagram = parse(`C4Context\n${keyword}(b, "B") {\n}`)
      expect((diagram.nodes[0] as C4Boundary).boundaryKind).toBe(kind as never)
    }
  })

  it('nests boundaries inside boundaries', () => {
    const diagram = parse(`C4Container
      Enterprise_Boundary(e, "Enterprise") {
        System_Boundary(s, "System") {
          Container(c, "Container")
        }
      }`)
    const outer = diagram.nodes[0] as C4Boundary
    const inner = outer.children[0] as C4Boundary
    expect(inner.kind).toBe('boundary')
    expect((inner.children[0] as C4Shape).alias).toBe('c')
  })

  it('closes a boundary at its brace', () => {
    const diagram = parse(`C4Context
      System_Boundary(b, "B") {
        System(inside, "In")
      }
      System(outside, "Out")`)
    expect(diagram.nodes).toHaveLength(2)
    expect((diagram.nodes[1] as C4Shape).alias).toBe('outside')
  })

  it('closes two boundaries at once', () => {
    const diagram = parse(`C4Context
      Boundary(a, "A") {
        Boundary(b, "B") {
          System(s, "S")
        } }
      System(after, "After")`)
    expect(diagram.nodes).toHaveLength(2)
  })

  it('reads a boundary type override', () => {
    const diagram = parse('C4Context\nBoundary(b, "B", "Region") {\n}')
    expect((diagram.nodes[0] as C4Boundary).type).toBe('Region')
  })

  it('keeps an empty boundary', () => {
    const diagram = parse('C4Context\nSystem_Boundary(b, "B") {\n}')
    expect((diagram.nodes[0] as C4Boundary).children).toEqual([])
  })
})

describe('c4 parser — relationships', () => {
  it('reads a relationship', () => {
    const diagram = parse('C4Context\nRel(a, b, "Uses", "HTTPS")')
    expect(diagram.relationships[0]).toMatchObject({
      relKind: 'rel', from: 'a', to: 'b', label: 'Uses', techn: 'HTTPS',
    })
  })

  it('reads every relationship keyword', () => {
    const cases: [string, string][] = [
      ['Rel', 'rel'],
      ['BiRel', 'birel'],
      ['Rel_U', 'rel_u'],
      ['Rel_Up', 'rel_u'],
      ['Rel_D', 'rel_d'],
      ['Rel_Down', 'rel_d'],
      ['Rel_L', 'rel_l'],
      ['Rel_Left', 'rel_l'],
      ['Rel_R', 'rel_r'],
      ['Rel_Right', 'rel_r'],
      ['Rel_B', 'rel_b'],
      ['Rel_Back', 'rel_b'],
    ]
    for (const [keyword, kind] of cases) {
      expect(parse(`C4Context\n${keyword}(a, b, "L")`).relationships[0]!.relKind)
        .toBe(kind as never)
    }
  })

  it('drops the sequence number from a RelIndex', () => {
    const diagram = parse('C4Dynamic\nRelIndex(1, a, b, "Uses")')
    expect(diagram.relationships[0]).toMatchObject({ from: 'a', to: 'b', label: 'Uses' })
  })

  it('allows an empty label', () => {
    expect(parse('C4Context\nRel(a, b)').relationships[0]!.label).toBe('')
  })

  it('reads a description after the technology', () => {
    const diagram = parse('C4Context\nRel(a, b, "Uses", "HTTPS", "Over the internet")')
    expect(diagram.relationships[0]!.descr).toBe('Over the internet')
  })

  it('reads named arguments on a relationship', () => {
    const diagram = parse('C4Context\nRel(a, b, "Uses", $tags="async")')
    expect(diagram.relationships[0]!.tags).toBe('async')
  })

  it('ignores a relationship missing an endpoint', () => {
    expect(parse('C4Context\nRel(a)').relationships).toHaveLength(0)
  })
})

describe('c4 parser — style statements', () => {
  it('applies UpdateElementStyle to a shape', () => {
    const diagram = parse(
      'C4Context\nSystem(s, "S")\nUpdateElementStyle(s, $bgColor="#ff0000", $fontColor="#ffffff")'
    )
    expect(firstShape(diagram.nodes).style).toMatchObject({
      bgColor: '#ff0000', fontColor: '#ffffff',
    })
  })

  it('applies UpdateElementStyle to a boundary', () => {
    const diagram = parse(
      'C4Context\nBoundary(b, "B") {\n}\nUpdateElementStyle(b, $borderColor="#00ff00")'
    )
    expect((diagram.nodes[0] as C4Boundary).style!.borderColor).toBe('#00ff00')
  })

  it('reads shadowing as a boolean', () => {
    const diagram = parse(
      'C4Context\nSystem(s, "S")\nUpdateElementStyle(s, $shadowing="true")'
    )
    expect(firstShape(diagram.nodes).style!.shadowing).toBe(true)
  })

  it('applies UpdateRelStyle to the matching relationship', () => {
    const diagram = parse(
      'C4Context\nRel(a, b, "Uses")\nUpdateRelStyle(a, b, $textColor="#ff0000", $offsetY="-20")'
    )
    expect(diagram.relationships[0]!.style).toMatchObject({
      textColor: '#ff0000', offsetY: -20,
    })
  })

  it('rejects a colour that could break out of a style attribute', () => {
    const diagram = parse(
      'C4Context\nSystem(s, "S")\nUpdateElementStyle(s, $bgColor="red;}<script>")'
    )
    expect(firstShape(diagram.nodes).style!.bgColor).toBeUndefined()
  })

  it('ignores a style naming an unknown alias', () => {
    expect(() => parse('C4Context\nUpdateElementStyle(nope, $bgColor="red")')).not.toThrow()
  })

  it('ignores UpdateLayoutConfig', () => {
    expect(() => parse('C4Context\nUpdateLayoutConfig($c4ShapeInRow="3")')).not.toThrow()
  })
})

describe('c4 layout', () => {
  const DIAGRAM = `C4Context
    Person(customer, "Customer", "A bank customer")
    System_Boundary(b1, "Bank") {
      System(banking, "Internet Banking")
      SystemDb(db, "Database")
    }
    System_Ext(mail, "E-mail system")
    Rel(customer, banking, "Uses", "HTTPS")
    Rel(banking, db, "Reads from")
    Rel(banking, mail, "Sends e-mails")`

  it('places one node per shape', () => {
    expect(layoutC4Diagram(parse(DIAGRAM)).shapes).toHaveLength(4)
  })

  it('places one box per boundary', () => {
    expect(layoutC4Diagram(parse(DIAGRAM)).boundaries).toHaveLength(1)
  })

  it('keeps a shape inside its boundary', () => {
    const chart = layoutC4Diagram(parse(DIAGRAM))
    const boundary = chart.boundaries[0]!
    for (const alias of ['banking', 'db']) {
      const shape = chart.shapes.find(s => s.alias === alias)!
      expect(shape.x).toBeGreaterThanOrEqual(boundary.x)
      expect(shape.y).toBeGreaterThanOrEqual(boundary.y)
      expect(shape.x + shape.width).toBeLessThanOrEqual(boundary.x + boundary.width + 1)
      expect(shape.y + shape.height).toBeLessThanOrEqual(boundary.y + boundary.height + 1)
    }
  })

  it('keeps a shape outside the boundary it was not declared in', () => {
    const chart = layoutC4Diagram(parse(DIAGRAM))
    const boundary = chart.boundaries[0]!
    const outside = chart.shapes.find(s => s.alias === 'customer')!
    const overlaps =
      outside.x < boundary.x + boundary.width && outside.x + outside.width > boundary.x &&
      outside.y < boundary.y + boundary.height && outside.y + outside.height > boundary.y
    expect(overlaps).toBe(false)
  })

  it('records the boundary depth', () => {
    const chart = layoutC4Diagram(parse(`C4Container
      Enterprise_Boundary(e, "E") {
        System_Boundary(s, "S") {
          Container(c, "C")
        }
      }`))
    expect(chart.boundaries.map(b => b.depth).sort()).toEqual([0, 1])
  })

  it('labels a boundary with its kind', () => {
    const chart = layoutC4Diagram(parse(DIAGRAM))
    expect(chart.boundaries[0]!.typeLabel).toBe('System')
  })

  it('gives each tier its own fixed colour index', () => {
    const chart = layoutC4Diagram(parse(`C4Component
      Person(p, "P")
      System(s, "S")
      Container(c, "C")
      Component(cp, "CP")
      Node(n, "N") {
      }`))
    const index = (alias: string) => chart.shapes.find(s => s.alias === alias)!.colorIndex
    expect([index('p'), index('s'), index('c'), index('cp')]).toEqual([0, 1, 2, 3])
  })

  it('marks an external shape as external', () => {
    const chart = layoutC4Diagram(parse(DIAGRAM))
    expect(chart.shapes.find(s => s.alias === 'mail')!.external).toBe(true)
    expect(chart.shapes.find(s => s.alias === 'banking')!.external).toBe(false)
  })

  it('resolves the drawing form from the shape kind', () => {
    const chart = layoutC4Diagram(parse(`C4Container
      Person(p, "P")
      System(s, "S")
      SystemDb(d, "D")
      SystemQueue(q, "Q")`))
    const form = (alias: string) => chart.shapes.find(s => s.alias === alias)!.form
    expect([form('p'), form('s'), form('d'), form('q')])
      .toEqual(['person', 'box', 'database', 'queue'])
  })

  it('formats a technology in brackets', () => {
    const chart = layoutC4Diagram(parse('C4Container\nContainer(c, "C", "Java")'))
    expect(chart.shapes[0]!.technLine).toBe('[Java]')
  })

  it('makes a shape with a description taller', () => {
    const bare = layoutC4Diagram(parse('C4Context\nSystem(s, "S")')).shapes[0]!
    const full = layoutC4Diagram(parse(
      'C4Context\nSystem(s, "S", "A description long enough to wrap onto two lines of its own")'
    )).shapes[0]!
    expect(full.height).toBeGreaterThanOrEqual(bare.height)
    expect(full.descrLines.length).toBeGreaterThan(1)
  })

  it('caps the box width', () => {
    const chart = layoutC4Diagram(parse(
      `C4Context\nSystem(s, "${'word '.repeat(60)}")`
    ))
    expect(chart.shapes[0]!.width).toBeLessThanOrEqual(220)
  })

  it('routes one edge per relationship', () => {
    expect(layoutC4Diagram(parse(DIAGRAM)).edges).toHaveLength(3)
  })

  it('puts an edge label on its own line', () => {
    // An edge between two shapes inside a boundary is reported by ELK in that
    // boundary's coordinates, so this guards the offset that corrects it
    const chart = layoutC4Diagram(parse(DIAGRAM))
    for (const edge of chart.edges) {
      const points = [...edge.path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)]
        .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
      const minX = Math.min(...points.map(p => p.x))
      const maxX = Math.max(...points.map(p => p.x))
      const minY = Math.min(...points.map(p => p.y))
      const maxY = Math.max(...points.map(p => p.y))
      expect(edge.labelX).toBeGreaterThanOrEqual(minX - 60)
      expect(edge.labelX).toBeLessThanOrEqual(maxX + 60)
      expect(edge.labelY).toBeGreaterThanOrEqual(minY - 20)
      expect(edge.labelY).toBeLessThanOrEqual(maxY + 20)
    }
  })

  it('marks a BiRel as bidirectional', () => {
    const chart = layoutC4Diagram(parse(
      'C4Context\nSystem(a, "A")\nSystem(b, "B")\nBiRel(a, b, "Syncs")'
    ))
    expect(chart.edges[0]!.bidirectional).toBe(true)
  })

  it('drops a relationship whose endpoints do not exist', () => {
    const chart = layoutC4Diagram(parse('C4Context\nSystem(a, "A")\nRel(a, ghost, "Uses")'))
    expect(chart.edges).toEqual([])
  })

  it('builds a legend row per tier present', () => {
    const chart = layoutC4Diagram(parse(DIAGRAM))
    expect(chart.legend.map(r => r.text).sort())
      .toEqual(['External System', 'Person', 'System'])
  })

  it('does not repeat a legend row', () => {
    const chart = layoutC4Diagram(parse(
      'C4Context\nSystem(a, "A")\nSystem(b, "B")\nSystemDb(c, "C")'
    ))
    expect(chart.legend).toHaveLength(1)
  })

  it('reserves room for the legend', () => {
    const chart = layoutC4Diagram(parse(DIAGRAM))
    for (const row of chart.legend) {
      expect(row.y).toBeLessThanOrEqual(chart.height)
    }
  })

  it('reserves room for a title', () => {
    const without = layoutC4Diagram(parse('C4Context\nSystem(s, "S")'))
    const withTitle = layoutC4Diagram(parse('C4Context\ntitle T\nSystem(s, "S")'))
    expect(withTitle.height).toBeGreaterThan(without.height)
    expect(withTitle.shapes[0]!.y).toBeGreaterThan(without.shapes[0]!.y)
  })

  it('honours the direction', () => {
    const down = layoutC4Diagram(parse(
      'C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")'
    ))
    const across = layoutC4Diagram(parse(
      'C4Context\ndirection LR\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")'
    ))
    expect(across.width).toBeGreaterThan(down.width)
  })

  it('keeps every shape inside the canvas', () => {
    const chart = layoutC4Diagram(parse(DIAGRAM))
    for (const shape of chart.shapes) {
      expect(shape.x).toBeGreaterThanOrEqual(0)
      expect(shape.y).toBeGreaterThanOrEqual(0)
      expect(shape.x + shape.width).toBeLessThanOrEqual(chart.width + 1)
      expect(shape.y + shape.height).toBeLessThanOrEqual(chart.height + 1)
    }
  })

  it('handles an empty diagram', () => {
    const chart = layoutC4Diagram(parse('C4Context'))
    expect(chart.shapes).toEqual([])
    expect(chart.width).toBeGreaterThan(0)
  })
})

describe('c4 integration — renderMermaidSVG', () => {
  const DIAGRAM = `C4Context
    title System Context diagram
    Person(customerA, "Banking Customer A", "A customer of the bank")
    System_Boundary(b1, "BankBoundary") {
      System(SystemAA, "Internet Banking System", "Allows customers to view information")
      SystemDb(SystemE, "Mainframe Database")
    }
    System_Ext(SystemC, "E-mail system")
    Rel(customerA, SystemAA, "Uses", "HTTPS")
    Rel(SystemAA, SystemE, "Reads from")
    Rel(SystemAA, SystemC, "Sends e-mails", "SMTP")`

  it('renders a C4 diagram to SVG', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain('c4-shape')
  })

  it('detects every level keyword', () => {
    for (const level of ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']) {
      expect(renderMermaidSVG(`${level}\nSystem(s, "S")`)).toContain('c4-shape')
    }
  })

  it('renders one shape per declaration', () => {
    expect(renderMermaidSVG(DIAGRAM).match(/class="c4-shape/g)).toHaveLength(4)
  })

  it('renders the boundary and its label', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('c4-boundary')
    expect(svg).toContain('BankBoundary')
    expect(svg).toContain('[System]')
  })

  it('renders every label and description', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    for (const text of ['Banking Customer A', 'A customer of the bank', 'Mainframe Database']) {
      expect(svg).toContain(text)
    }
  })

  it('renders a technology in brackets', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain('[HTTPS]')
  })

  it('emits alias and tier as data attributes', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('data-alias="customerA"')
    expect(svg).toContain('data-tier="person"')
  })

  it('marks an external shape with a class', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain('c4-external')
  })

  it('draws a person with a head and a database as a cylinder', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('c4-form-person')
    expect(svg).toContain('c4-form-database')
  })

  it('renders the relationships and their labels', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('data-from="customerA"')
    expect(svg).toContain('>Uses</text>')
  })

  it('describes a relationship in its title', () => {
    expect(renderMermaidSVG(DIAGRAM))
      .toContain('<title>customerA \u2192 SystemAA: Uses</title>')
  })

  it('marks a BiRel with a start arrowhead', () => {
    const svg = renderMermaidSVG(
      'C4Context\nSystem(a, "A")\nSystem(b, "B")\nBiRel(a, b, "Syncs")'
    )
    expect(svg).toContain('marker-start="url(#c4-arrow-start)"')
  })

  it('renders a legend', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('c4-legend-swatch')
    expect(svg).toContain('External System')
  })

  it('declares a colour variable per tier present', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toContain('--c4-color-0')
    expect(svg).toContain('--c4-color-1')
  })

  it('maps the person tier onto the theme accent', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain('--c4-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(DIAGRAM, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    expect(renderMermaidSVG(DIAGRAM, { transparent: true })).not.toContain('background:var(--bg)')
  })

  it('renders the title', () => {
    expect(renderMermaidSVG(DIAGRAM)).toContain('System Context diagram')
  })

  it('takes a title from frontmatter', () => {
    expect(renderMermaidSVG('---\ntitle: From meta\n---\nC4Context\nSystem(s, "S")'))
      .toContain('From meta')
  })

  it('applies an element style inline', () => {
    const svg = renderMermaidSVG(
      'C4Context\nSystem(s, "S")\nUpdateElementStyle(s, $bgColor="#ff0000")'
    )
    expect(svg).toContain('style="fill:#ff0000"')
  })

  it('wraps a linked shape in an anchor', () => {
    const svg = renderMermaidSVG('C4Context\nSystem(s, "S", $link="https://example.com")')
    expect(svg).toContain('<a href="https://example.com"')
    expect(svg).toContain('rel="noopener noreferrer"')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('C4Context\nSystem(s, "A & <B>")')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders accTitle and accDescr', () => {
    const svg = renderMermaidSVG(
      'C4Context\naccTitle: The context\naccDescr: Who talks to what\nSystem(s, "S")'
    )
    expect(svg).toContain('<title>The context</title>')
    expect(svg).toContain('<desc>Who talks to what</desc>')
  })

  it('renders an empty diagram without throwing', () => {
    const svg = renderMermaidSVG('C4Context')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
    expect(svg.match(/<g /g)?.length).toBe(svg.match(/<\/g>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(DIAGRAM)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(DIAGRAM)).toThrow(/not supported for c4/)
  })
})
