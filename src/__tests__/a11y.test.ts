import { describe, expect, it } from 'bun:test'
import { parseAccessibility, renderAccessibilityTags, withAccessibility } from '../a11y/parser.ts'
import { renderMermaidSVG } from '../index.ts'

// ============================================================================
// Accessibility metadata tests
//
// Mermaid's own suite checks accTitle/accDescr per diagram type (see the
// `it('should handle accTitle and multiline accDescr')` cases repeated across
// upstream parser specs). Here the handling is central, so the parser cases
// are shared and the per-type coverage is end-to-end instead.
// ============================================================================

describe('a11y parser — extraction', () => {
  it('reads accTitle', () => {
    const result = parseAccessibility('pie\naccTitle: My title\n"a": 1')
    expect(result.title).toBe('My title')
  })

  it('reads a single-line accDescr', () => {
    const result = parseAccessibility('pie\naccDescr: My description\n"a": 1')
    expect(result.description).toBe('My description')
  })

  it('reads both together', () => {
    const result = parseAccessibility('pie\naccTitle: T\naccDescr: D\n"a": 1')
    expect(result.title).toBe('T')
    expect(result.description).toBe('D')
  })

  it('reads a multi-line accDescr block', () => {
    const result = parseAccessibility(`pie
accDescr {
  First line
  Second line
}
"a": 1`)
    expect(result.description).toBe('First line\nSecond line')
  })

  it('reads a block that closes on its opening line', () => {
    const result = parseAccessibility('pie\naccDescr { All on one line }\n"a": 1')
    expect(result.description).toBe('All on one line')
  })

  it('removes the metadata lines from the body', () => {
    const result = parseAccessibility('pie\naccTitle: T\naccDescr: D\n"a": 1')
    expect(result.body).toBe('pie\n"a": 1')
  })

  it('removes a whole accDescr block from the body', () => {
    const result = parseAccessibility('pie\naccDescr {\n  text\n}\n"a": 1')
    expect(result.body).toBe('pie\n"a": 1')
  })

  it('leaves a body without metadata untouched', () => {
    const text = 'pie\n"a": 1'
    const result = parseAccessibility(text)
    expect(result.body).toBe(text)
    expect(result.title).toBeUndefined()
    expect(result.description).toBeUndefined()
  })

  it('tolerates indented metadata', () => {
    const result = parseAccessibility('pie\n    accTitle: T\n    accDescr: D')
    expect(result.title).toBe('T')
    expect(result.description).toBe('D')
  })

  it('is case-insensitive on the keywords', () => {
    const result = parseAccessibility('pie\nACCTITLE: T\nACCDESCR: D')
    expect(result.title).toBe('T')
    expect(result.description).toBe('D')
  })

  it('ignores an empty accTitle', () => {
    expect(parseAccessibility('pie\naccTitle:\n"a": 1').title).toBeUndefined()
  })

  it('ignores an empty accDescr', () => {
    expect(parseAccessibility('pie\naccDescr:\n"a": 1').description).toBeUndefined()
  })

  it('ignores an empty accDescr block', () => {
    expect(parseAccessibility('pie\naccDescr {\n}\n"a": 1').description).toBeUndefined()
  })

  it('lets a later declaration win', () => {
    const result = parseAccessibility('pie\naccTitle: first\naccTitle: second')
    expect(result.title).toBe('second')
  })

  it('keeps text that merely mentions accTitle mid-line', () => {
    const result = parseAccessibility('pie\n"a label with accTitle: inside": 1')
    expect(result.title).toBeUndefined()
    expect(result.body).toContain('a label with accTitle')
  })

  it('preserves colons inside a description', () => {
    const result = parseAccessibility('pie\naccDescr: ratio is 3:1')
    expect(result.description).toBe('ratio is 3:1')
  })
})

describe('a11y renderer — tags', () => {
  it('renders a title tag', () => {
    expect(renderAccessibilityTags({ title: 'T' })).toBe('<title>T</title>')
  })

  it('renders a desc tag', () => {
    expect(renderAccessibilityTags({ description: 'D' })).toBe('<desc>D</desc>')
  })

  it('renders title before desc', () => {
    const tags = renderAccessibilityTags({ title: 'T', description: 'D' })
    expect(tags.indexOf('<title>')).toBeLessThan(tags.indexOf('<desc>'))
  })

  it('renders nothing when there is nothing to describe', () => {
    expect(renderAccessibilityTags({})).toBe('')
  })

  it('escapes XML special characters', () => {
    const tags = renderAccessibilityTags({ title: 'A & <B>', description: '"quoted"' })
    expect(tags).toContain('A &amp; &lt;B&gt;')
    expect(tags).not.toContain('<B>')
  })

  it('splices tags after the opening svg tag', () => {
    const result = withAccessibility('<svg width="10"><rect/></svg>', { title: 'T' })
    expect(result).toBe('<svg width="10">\n<title>T</title><rect/></svg>')
  })

  it('is a no-op when there is no metadata', () => {
    const svg = '<svg width="10"><rect/></svg>'
    expect(withAccessibility(svg, {})).toBe(svg)
  })

  it('is not fooled by a > inside an attribute value', () => {
    const result = withAccessibility('<svg style="a:b>c"><rect/></svg>', { title: 'T' })
    expect(result).toContain('<svg style="a:b>c">\n<title>T</title>')
  })
})

describe('a11y integration — renderMermaidSVG', () => {
  const CASES: [string, string][] = [
    ['flowchart', 'flowchart LR\n  A --> B'],
    ['sequence', 'sequenceDiagram\n  A->>B: hi'],
    ['class', 'classDiagram\n  class A'],
    ['er', 'erDiagram\n  A ||--o{ B : has'],
    ['state', 'stateDiagram-v2\n  [*] --> A'],
    ['xychart', 'xychart-beta\n  bar [1, 2, 3]'],
    ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  section S\n  T :2024-01-01, 30d'],
    ['timeline', 'timeline\n  2002 : LinkedIn'],
    ['pie', 'pie\n  "a" : 1'],
    ['journey', 'journey\n  section S\n    Task: 5: Me'],
    ['quadrant', 'quadrantChart\n  x-axis L --> H\n  y-axis L --> H\n  A: [0.3, 0.6]'],
    ['mindmap', 'mindmap\n  root\n    child'],
    ['sankey', 'sankey-beta\nA,B,1'],
    ['gitgraph', 'gitGraph\n  commit'],
  ]

  for (const [name, body] of CASES) {
    it(`renders title and desc for a ${name} diagram`, () => {
      const svg = renderMermaidSVG(`${body}\naccTitle: A title\naccDescr: A description`)
      expect(svg).toContain('<title>A title</title>')
      expect(svg).toContain('<desc>A description</desc>')
      expect(svg).toStartWith('<svg')
      expect(svg).toEndWith('</svg>')
    })
  }

  it('puts the diagram title before any shape tooltip', () => {
    const svg = renderMermaidSVG('gitGraph\n  commit id: "abc"\naccTitle: Diagram label')
    // A commit node also emits a <title>; the diagram-level one must come first
    expect(svg.indexOf('<title>Diagram label</title>')).toBeLessThan(svg.indexOf('<title>abc</title>'))
  })

  it('does not leave the metadata lines in the diagram', () => {
    const svg = renderMermaidSVG('pie\n  "a" : 1\naccTitle: T\naccDescr: D')
    expect(svg).not.toContain('accTitle')
    expect(svg).not.toContain('accDescr')
  })

  it('does not treat accTitle as the visible title', () => {
    const svg = renderMermaidSVG('pie\n  title Visible\n  "a" : 1\naccTitle: Hidden')
    expect(svg).toContain('Visible')
    expect(svg).toContain('<title>Hidden</title>')
    // The a11y title is not drawn as text
    expect(svg).not.toMatch(/<text[^>]*>Hidden<\/text>/)
  })

  it('renders a multiline accDescr in a desc tag', () => {
    const svg = renderMermaidSVG('pie\n  "a" : 1\naccDescr {\n  line one\n  line two\n}')
    expect(svg).toContain('<desc>line one\nline two</desc>')
  })

  it('works alongside frontmatter', () => {
    const svg = renderMermaidSVG('---\ntitle: Visible\n---\npie\n  "a" : 1\naccTitle: Hidden')
    expect(svg).toContain('Visible')
    expect(svg).toContain('<title>Hidden</title>')
  })

  it('emits no title or desc when none was given', () => {
    const svg = renderMermaidSVG('pie\n  "a" : 1')
    expect(svg).not.toContain('<desc>')
  })
})
