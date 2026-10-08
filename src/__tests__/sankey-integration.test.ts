import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'
import { layoutSankey } from '../sankey/layout.ts'

// ============================================================================
// Sankey end-to-end tests
//
// Checks that `sankey` and `sankey-beta` route through the dispatcher,
// produce well-formed SVG, and that the layout keeps a node right of
// everything that feeds it while ribbons stay proportional to their values.
// ============================================================================

const ENERGY = `sankey-beta
Coal,Electricity,120
Gas,Electricity,80
Electricity,Homes,100
Electricity,Industry,100`

function layout(text: string) {
  return layoutSankey(parseSankeyDiagram(text))
}

describe('sankey integration — renderMermaidSVG', () => {
  it('renders a sankey diagram to SVG', () => {
    const svg = renderMermaidSVG(ENERGY)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(() => renderMermaidSVG(ENERGY)).not.toThrow()
    expect(renderMermaidSVG(ENERGY)).toContain('sankey-node')
  })

  it('accepts the sankey-beta header', () => {
    expect(renderMermaidSVG(ENERGY)).toContain('sankey-link')
  })

  it('accepts the plain sankey header', () => {
    const svg = renderMermaidSVG('sankey\nA,B,1')
    expect(svg).toContain('sankey-link')
  })

  it('emits one bar per node', () => {
    const svg = renderMermaidSVG(ENERGY)
    expect(svg.match(/class="sankey-node/g)).toHaveLength(5)
  })

  it('emits one ribbon per link', () => {
    const svg = renderMermaidSVG(ENERGY)
    expect(svg.match(/class="sankey-link/g)).toHaveLength(4)
  })

  it('renders every node label', () => {
    const svg = renderMermaidSVG(ENERGY)
    for (const label of ['Coal', 'Gas', 'Electricity', 'Homes', 'Industry']) {
      expect(svg).toContain(label)
    }
  })

  it('emits an accessible <title> per ribbon', () => {
    expect(renderMermaidSVG(ENERGY)).toContain('<title>Coal → Electricity: 120</title>')
  })

  it('emits an accessible <title> per node', () => {
    expect(renderMermaidSVG(ENERGY)).toContain('<title>Coal: 120</title>')
  })

  it('tags ribbons with data attributes', () => {
    const svg = renderMermaidSVG(ENERGY)
    expect(svg).toContain('data-source="Coal"')
    expect(svg).toContain('data-target="Electricity"')
    expect(svg).toContain('data-value="120"')
  })

  it('tags nodes with data attributes', () => {
    expect(renderMermaidSVG(ENERGY)).toContain('data-node="Electricity"')
  })

  it('declares a colour variable per node', () => {
    const svg = renderMermaidSVG(ENERGY)
    for (const i of [0, 1, 2, 3, 4]) {
      expect(svg).toContain(`--sankey-color-${i}`)
    }
  })

  it('maps node 0 onto the theme accent', () => {
    expect(renderMermaidSVG(ENERGY)).toContain('--sankey-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(ENERGY, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    const svg = renderMermaidSVG(ENERGY, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('escapes XML special characters in node ids', () => {
    const svg = renderMermaidSVG('sankey\n"A & <B>",target,1')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders an empty sankey without throwing', () => {
    const svg = renderMermaidSVG('sankey-beta')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('renders a single link', () => {
    const svg = renderMermaidSVG('sankey\nA,B,1')
    expect(svg.match(/class="sankey-node/g)).toHaveLength(2)
    expect(svg.match(/class="sankey-link/g)).toHaveLength(1)
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(ENERGY)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(ENERGY)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(ENERGY)).toThrow(/not supported for sankey/)
  })
})

describe('sankey layout', () => {
  it('positions every node', () => {
    expect(layout(ENERGY).nodes).toHaveLength(5)
  })

  it('builds one ribbon per link', () => {
    expect(layout(ENERGY).links).toHaveLength(4)
  })

  it('assigns depth 0 to pure sources', () => {
    const chart = layout(ENERGY)
    expect(chart.nodes.find(n => n.id === 'Coal')!.depth).toBe(0)
    expect(chart.nodes.find(n => n.id === 'Gas')!.depth).toBe(0)
  })

  it('pushes a node right of everything that feeds it', () => {
    const chart = layout(ENERGY)
    const coal = chart.nodes.find(n => n.id === 'Coal')!
    const electricity = chart.nodes.find(n => n.id === 'Electricity')!
    const homes = chart.nodes.find(n => n.id === 'Homes')!
    expect(electricity.depth).toBeGreaterThan(coal.depth)
    expect(homes.depth).toBeGreaterThan(electricity.depth)
    expect(electricity.x).toBeGreaterThan(coal.x)
    expect(homes.x).toBeGreaterThan(electricity.x)
  })

  it('lines up nodes of the same depth in one column', () => {
    const chart = layout(ENERGY)
    const sources = chart.nodes.filter(n => n.depth === 0)
    expect(new Set(sources.map(n => n.x)).size).toBe(1)
  })

  it('sizes a node bar from the flow through it', () => {
    const chart = layout(ENERGY)
    const coal = chart.nodes.find(n => n.id === 'Coal')!
    const gas = chart.nodes.find(n => n.id === 'Gas')!
    // Coal carries 120 and gas 80, so coal must be taller
    expect(coal.height).toBeGreaterThan(gas.height)
    expect(coal.height / gas.height).toBeCloseTo(120 / 80, 1)
  })

  it('takes a node value as the larger of inflow and outflow', () => {
    const chart = layout(ENERGY)
    expect(chart.nodes.find(n => n.id === 'Electricity')!.value).toBe(200)
  })

  it('sizes a ribbon proportionally to its value', () => {
    const chart = layout(ENERGY)
    const fromCoal = chart.links.find(l => l.source === 'Coal')!
    const fromGas = chart.links.find(l => l.source === 'Gas')!
    expect(fromCoal.thickness / fromGas.thickness).toBeCloseTo(120 / 80, 1)
  })

  it('fills a node bar exactly with the ribbons leaving it', () => {
    const chart = layout(ENERGY)
    const electricity = chart.nodes.find(n => n.id === 'Electricity')!
    const outgoing = chart.links.filter(l => l.source === 'Electricity')
    const total = outgoing.reduce((sum, l) => sum + l.thickness, 0)
    expect(total).toBeCloseTo(electricity.height, 1)
  })

  it('does not overlap stacked bars in a column', () => {
    const chart = layout(ENERGY)
    const column = chart.nodes.filter(n => n.depth === 0).sort((a, b) => a.y - b.y)
    for (let i = 1; i < column.length; i++) {
      const prev = column[i - 1]!
      expect(column[i]!.y).toBeGreaterThanOrEqual(prev.y + prev.height)
    }
  })

  it('keeps every node inside the canvas', () => {
    const chart = layout(ENERGY)
    for (const node of chart.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(chart.width)
      expect(node.y + node.height).toBeLessThanOrEqual(chart.height)
    }
  })

  it('inherits the ribbon colour from its source node', () => {
    const chart = layout(ENERGY)
    const coal = chart.nodes.find(n => n.id === 'Coal')!
    const fromCoal = chart.links.find(l => l.source === 'Coal')!
    expect(fromCoal.colorIndex).toBe(coal.colorIndex)
  })

  it('emits a closed ribbon path', () => {
    const chart = layout(ENERGY)
    for (const link of chart.links) {
      expect(link.path).toMatch(/^M[\d.,-]+ C/)
      expect(link.path).toEndWith('Z')
    }
  })

  it('returns an empty layout for an empty diagram', () => {
    const chart = layout('sankey-beta')
    expect(chart.nodes).toEqual([])
    expect(chart.links).toEqual([])
  })

  it('widens the canvas as the chain gets longer', () => {
    const short = layout('sankey\nA,B,1')
    const long = layout('sankey\nA,B,1\nB,C,1\nC,D,1')
    expect(long.width).toBeGreaterThan(short.width)
  })

  it('lays out a cyclic graph without hanging', () => {
    const chart = layout('sankey\nA,B,1\nB,C,1\nC,A,1')
    expect(chart.nodes).toHaveLength(3)
    expect(chart.links).toHaveLength(3)
  })

  it('places leftmost labels left of the bar and the rest to the right', () => {
    const chart = layout(ENERGY)
    const coal = chart.nodes.find(n => n.id === 'Coal')!
    const homes = chart.nodes.find(n => n.id === 'Homes')!
    expect(coal.labelAnchor).toBe('start')
    expect(homes.labelAnchor).toBe('end')
    expect(homes.labelX).toBeLessThan(homes.x)
  })
})
