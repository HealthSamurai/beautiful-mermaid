import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parseMindmapDiagram } from '../mindmap/parser.ts'
import { layoutMindmap } from '../mindmap/layout.ts'

// ============================================================================
// Mindmap end-to-end tests
//
// Checks that `mindmap` routes through the dispatcher with its indentation
// intact, produces well-formed SVG, and that the tidy-tree layout puts
// children to the right of their parents without overlapping siblings.
// ============================================================================

const RESEARCH = `mindmap
  root((mindmap))
    Origins
      Long history
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
      On Automatic creation
    Tools
      Pen and paper
      Mermaid`

function layout(text: string) {
  return layoutMindmap(parseMindmapDiagram(text))
}

describe('mindmap integration — renderMermaidSVG', () => {
  it('renders a mindmap to SVG', () => {
    const svg = renderMermaidSVG(RESEARCH)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(() => renderMermaidSVG(RESEARCH)).not.toThrow()
    expect(renderMermaidSVG(RESEARCH)).toContain('mindmap-node')
  })

  it('keeps indentation when routing through the dispatcher', () => {
    // The flowchart path trims lines; a mindmap would collapse to one root.
    const svg = renderMermaidSVG(RESEARCH)
    expect(svg).toContain('data-level="1"')
    expect(svg).toContain('data-level="3"')
  })

  it('renders every node label', () => {
    const svg = renderMermaidSVG(RESEARCH)
    for (const label of ['mindmap', 'Origins', 'Research', 'Tools', 'Pen and paper', 'Mermaid']) {
      expect(svg).toContain(label)
    }
  })

  it('draws one edge per parent-child pair', () => {
    const svg = renderMermaidSVG(RESEARCH)
    // 10 non-root nodes, so 10 edges
    expect(svg.match(/class="mindmap-edge/g)).toHaveLength(10)
  })

  it('renders the root as an ellipse for the circle shape', () => {
    expect(renderMermaidSVG(RESEARCH)).toContain('<ellipse')
  })

  it('renders a hexagon node as a polygon', () => {
    expect(renderMermaidSVG('mindmap\nroot{{hex}}')).toContain('<polygon')
  })

  it('renders a bang node as a starburst polygon', () => {
    const svg = renderMermaidSVG('mindmap\nroot))bang((')
    expect(svg).toContain('mindmap-node-bang')
    expect(svg).toContain('<polygon')
  })

  it('renders a rect node as a rectangle', () => {
    const svg = renderMermaidSVG('mindmap\nroot[boxy]')
    expect(svg).toContain('mindmap-node-rect')
    expect(svg).toContain('<rect')
  })

  it('emits an accessible <title> per node', () => {
    expect(renderMermaidSVG(RESEARCH)).toContain('<title>Origins</title>')
  })

  it('tags nodes with data attributes', () => {
    const svg = renderMermaidSVG(RESEARCH)
    expect(svg).toContain('data-node="Origins"')
    expect(svg).toContain('data-level="0"')
  })

  it('emits node class names as extra CSS classes', () => {
    const svg = renderMermaidSVG('mindmap\nroot[The root]\n:::hot')
    expect(svg).toContain('hot"')
  })

  it('renders an icon name as a label prefix', () => {
    const svg = renderMermaidSVG('mindmap\nroot[The root]\n::icon(bomb)')
    expect(svg).toContain('bomb')
  })

  it('declares a colour variable per top-level branch', () => {
    const svg = renderMermaidSVG(RESEARCH)
    expect(svg).toContain('--mindmap-color-0')
    expect(svg).toContain('--mindmap-color-1')
    expect(svg).toContain('--mindmap-color-2')
  })

  it('maps branch 0 onto the theme accent', () => {
    expect(renderMermaidSVG(RESEARCH)).toContain('--mindmap-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(RESEARCH, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    const svg = renderMermaidSVG(RESEARCH, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('mindmap\nroot["A & <B>"]')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders a single-node mindmap', () => {
    const svg = renderMermaidSVG('mindmap\nroot')
    expect(svg).toContain('root')
    expect(svg).not.toContain('mindmap-edge m')
  })

  it('renders an empty mindmap without throwing', () => {
    const svg = renderMermaidSVG('mindmap')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('propagates the multiple-roots error', () => {
    expect(() => renderMermaidSVG('mindmap\nroot\nother')).toThrow(/only one root/)
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(RESEARCH)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(RESEARCH)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(RESEARCH)).toThrow(/not supported for mindmap/)
  })
})

describe('mindmap layout', () => {
  it('positions every node in the tree', () => {
    expect(layout(RESEARCH).nodes).toHaveLength(11)
  })

  it('builds one edge per non-root node', () => {
    const chart = layout(RESEARCH)
    expect(chart.edges).toHaveLength(chart.nodes.length - 1)
  })

  it('places children to the right of their parent', () => {
    const chart = layout(RESEARCH)
    const rootNode = chart.nodes.find(n => n.level === 0)!
    for (const node of chart.nodes.filter(n => n.level === 1)) {
      expect(node.x).toBeGreaterThan(rootNode.x + rootNode.width)
    }
  })

  it('lines up nodes of the same depth in one column', () => {
    const chart = layout(RESEARCH)
    const firstLevel = chart.nodes.filter(n => n.level === 1)
    const xs = new Set(firstLevel.map(n => n.x))
    expect(xs.size).toBe(1)
  })

  it('does not overlap sibling boxes vertically', () => {
    const chart = layout(RESEARCH)
    const siblings = chart.nodes
      .filter(n => n.level === 1)
      .sort((a, b) => a.y - b.y)

    for (let i = 1; i < siblings.length; i++) {
      const prev = siblings[i - 1]!
      expect(siblings[i]!.y).toBeGreaterThanOrEqual(prev.y + prev.height)
    }
  })

  it('gives each top-level branch its own colour index', () => {
    const chart = layout(RESEARCH)
    const branches = chart.nodes.filter(n => n.level === 1)
    expect(branches.map(n => n.colorIndex)).toEqual([0, 1, 2])
  })

  it('makes descendants inherit their branch colour', () => {
    const chart = layout(RESEARCH)
    const deep = chart.nodes.find(n => n.label.includes('Tony Buzan'))!
    expect(deep.colorIndex).toBe(0)
  })

  it('keeps every node inside the canvas', () => {
    const chart = layout(RESEARCH)
    for (const node of chart.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(chart.width)
      expect(node.y + node.height).toBeLessThanOrEqual(chart.height)
    }
  })

  it('wraps a long label onto several lines', () => {
    const chart = layout('mindmap\nroot[A considerably longer label than fits in one box]')
    expect(chart.nodes[0]!.lines.length).toBeGreaterThan(1)
  })

  it('grows the canvas with the tree depth', () => {
    const shallow = layout('mindmap\nroot\n  a')
    const deep = layout('mindmap\nroot\n  a\n    b\n      c')
    expect(deep.width).toBeGreaterThan(shallow.width)
  })

  it('grows the canvas with the sibling count', () => {
    const few = layout('mindmap\nroot\n  a')
    const many = layout('mindmap\nroot\n  a\n  b\n  c\n  d')
    expect(many.height).toBeGreaterThan(few.height)
  })

  it('returns an empty layout for an empty mindmap', () => {
    const chart = layout('mindmap')
    expect(chart.nodes).toEqual([])
    expect(chart.edges).toEqual([])
  })

  it('emits a bezier path for every edge', () => {
    const chart = layout(RESEARCH)
    for (const edge of chart.edges) {
      expect(edge.path).toMatch(/^M[\d.,-]+ C/)
    }
  })

  it('preserves the node shape through layout', () => {
    const chart = layout('mindmap\nroot((circle))\n  child{{hex}}')
    expect(chart.nodes[0]!.shape).toBe('circle')
    expect(chart.nodes[1]!.shape).toBe('hexagon')
  })
})
