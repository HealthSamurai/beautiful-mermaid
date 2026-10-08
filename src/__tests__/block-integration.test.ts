import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { layoutBlockDiagram } from '../block/layout.ts'

// ============================================================================
// Block diagram end-to-end tests
//
// Checks that `block-beta` routes through the dispatcher, that the grid places
// blocks in reading order with the declared spans, and that the SVG is
// well-formed for every shape.
// ============================================================================

const ARCHITECTURE = `block-beta
  columns 3
  frontend["Frontend"]
  gateway["API Gateway"]
  cache(("Cache"))
  block:services["Services"]
    columns 2
    auth["Auth"]
    billing["Billing"]
  end
  router{"Router"}
  db[("Postgres")]
  frontend --> gateway
  gateway -- "rpc" --> services`

function layout(text: string) {
  return layoutBlockDiagram(parseBlockDiagram(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  ))
}

describe('block integration — renderMermaidSVG', () => {
  it('renders a block diagram to SVG', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(renderMermaidSVG(ARCHITECTURE)).toContain('block-shape')
  })

  it('accepts the plain block header', () => {
    expect(renderMermaidSVG('block\ncolumns 2\na["A"]\nb["B"]')).toContain('block-shape')
  })

  it('emits one shape per block', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    // Seven leaves plus the composite that holds two of them
    expect(svg.match(/data-block=/g)).toHaveLength(8)
  })

  it('renders every label', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    for (const label of ['Frontend', 'API Gateway', 'Cache', 'Auth', 'Billing', 'Postgres']) {
      expect(svg).toContain(label)
    }
  })

  it('tags each shape with its kind', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    expect(svg).toContain('data-shape="square"')
    expect(svg).toContain('data-shape="circle"')
    expect(svg).toContain('data-shape="diamond"')
    expect(svg).toContain('data-shape="cylinder"')
    expect(svg).toContain('data-shape="composite"')
  })

  it('renders edges with arrowheads', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    expect(svg).toContain('block-edge')
    expect(svg).toContain('marker-end')
  })

  it('renders an edge label', () => {
    expect(renderMermaidSVG(ARCHITECTURE)).toContain('rpc')
  })

  it('renders a thick edge with its own class', () => {
    expect(renderMermaidSVG('block\nA ==> B')).toContain('block-edge-thick')
  })

  it('renders a dotted edge with its own class', () => {
    expect(renderMermaidSVG('block\nA -.-> B')).toContain('block-edge-dotted')
  })

  it('declares a colour variable per nesting depth', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    expect(svg).toContain('--block-color-0')
    expect(svg).toContain('--block-color-1')
  })

  it('maps depth 0 onto the theme accent', () => {
    expect(renderMermaidSVG(ARCHITECTURE)).toContain('--block-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(ARCHITECTURE, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    expect(renderMermaidSVG(ARCHITECTURE, { transparent: true })).not.toContain('background:var(--bg)')
  })

  it('renders the title when given', () => {
    expect(renderMermaidSVG('block-beta\ntitle My layout\na["A"]')).toContain('My layout')
  })

  it('applies an inline style statement', () => {
    const svg = renderMermaidSVG('block\nB["Styled"]\nstyle B fill:#f9f,stroke:#333')
    expect(svg).toContain('style="fill:#f9f;stroke:#333"')
  })

  it('rejects a style that could escape the attribute', () => {
    const svg = renderMermaidSVG('block\nB["X"]\nstyle B fill:"><script>alert(1)</script>')
    expect(svg).not.toContain('<script>')
  })

  it('emits class names as CSS classes', () => {
    const svg = renderMermaidSVG('block\nmc["Memcache"]\nclass mc black')
    expect(svg).toContain('black')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('block\na["A & <B>"]')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('draws nothing for a space', () => {
    const svg = renderMermaidSVG('block\ncolumns 3\nspace\na["A"]\nspace')
    expect(svg).not.toContain('data-shape="space"')
    expect(svg.match(/data-block=/g)).toHaveLength(1)
  })

  it('renders an empty block diagram without throwing', () => {
    const svg = renderMermaidSVG('block-beta')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
    expect(svg.match(/<g /g)?.length ?? 0).toBe(svg.match(/<\/g>/g)?.length ?? 0)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(ARCHITECTURE)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(ARCHITECTURE)).toThrow(/not supported for block/)
  })

  it('renders every shape without throwing', () => {
    const svg = renderMermaidSVG(`block-beta
      columns 4
      s1["square"]
      s2("round")
      s3(("circle"))
      s4{"diamond"}
      s5{{"hexagon"}}
      s6(["stadium"])
      s7[["subroutine"]]
      s8[("cylinder")]
      s9[/"lean right"/]
      s10[\\"lean left"\\]
      s11[/"trapezoid"\\]
      s12[\\"inv trapezoid"/]
      a1<["right"]>(right)
      a2<["both"]>(up, down)`)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
    expect(svg.match(/data-block=/g)).toHaveLength(14)
  })
})

describe('block layout — grid placement', () => {
  it('places blocks left to right within a row', () => {
    const chart = layout('block\ncolumns 3\na["A"]\nb["B"]\nc["C"]')
    const xs = chart.blocks.map(b => b.x)
    expect(xs[1]).toBeGreaterThan(xs[0]!)
    expect(xs[2]).toBeGreaterThan(xs[1]!)
  })

  it('keeps one row on the same y', () => {
    const chart = layout('block\ncolumns 3\na["A"]\nb["B"]\nc["C"]')
    expect(new Set(chart.blocks.map(b => b.y)).size).toBe(1)
  })

  it('wraps onto a new row when the columns run out', () => {
    const chart = layout('block\ncolumns 2\na["A"]\nb["B"]\nc["C"]')
    expect(chart.blocks[2]!.y).toBeGreaterThan(chart.blocks[0]!.y)
    expect(chart.blocks[2]!.x).toBe(chart.blocks[0]!.x)
  })

  it('stacks everything in a single column', () => {
    const chart = layout('block\ncolumns 1\na["A"]\nb["B"]\nc["C"]')
    expect(new Set(chart.blocks.map(b => b.x)).size).toBe(1)
    expect(chart.blocks[1]!.y).toBeGreaterThan(chart.blocks[0]!.y)
  })

  it('puts a bare list on one row in auto mode', () => {
    const chart = layout('block\na["A"]\nb["B"]\nc["C"]')
    expect(new Set(chart.blocks.map(b => b.y)).size).toBe(1)
  })

  it('makes a spanning block wider', () => {
    const chart = layout('block\ncolumns 3\none["One"]\ntwo["Two"]:2')
    expect(chart.blocks[1]!.width).toBeGreaterThan(chart.blocks[0]!.width)
  })

  it('leaves a gap where a space was declared', () => {
    const withSpace = layout('block\ncolumns 3\nspace\na["A"]')
    const without = layout('block\ncolumns 3\na["A"]')
    expect(withSpace.blocks[0]!.x).toBeGreaterThan(without.blocks[0]!.x)
  })

  it('does not position a space as a block', () => {
    const chart = layout('block\ncolumns 3\nspace\na["A"]\nspace')
    expect(chart.blocks).toHaveLength(1)
  })

  it('nests children inside their composite', () => {
    const chart = layout('block\nblock:g["G"]\n columns 2\n x["X"]\n y["Y"]\nend')
    const group = chart.blocks.find(b => b.id === 'g')!
    const x = chart.blocks.find(b => b.id === 'x')!

    expect(x.x).toBeGreaterThanOrEqual(group.x)
    expect(x.y).toBeGreaterThanOrEqual(group.y)
    expect(x.x + x.width).toBeLessThanOrEqual(group.x + group.width)
    expect(x.y + x.height).toBeLessThanOrEqual(group.y + group.height)
  })

  it('gives children a deeper colour index', () => {
    const chart = layout('block\nblock:g["G"]\n x["X"]\nend')
    expect(chart.blocks.find(b => b.id === 'g')!.depth).toBe(0)
    expect(chart.blocks.find(b => b.id === 'x')!.depth).toBe(1)
  })

  it('keeps every block inside the canvas', () => {
    const chart = layout(ARCHITECTURE)
    for (const block of chart.blocks) {
      expect(block.x).toBeGreaterThanOrEqual(0)
      expect(block.y).toBeGreaterThanOrEqual(0)
      expect(block.x + block.width).toBeLessThanOrEqual(chart.width)
      expect(block.y + block.height).toBeLessThanOrEqual(chart.height)
    }
  })

  it('grows a block to fit a long label', () => {
    const short = layout('block\na["A"]')
    const long = layout('block\na["A considerably longer block label"]')
    expect(long.blocks[0]!.width).toBeGreaterThan(short.blocks[0]!.width)
  })

  it('wraps a label too long to widen the block further', () => {
    const chart = layout(
      'block\ncolumns 1\na["one two three four five six seven eight nine ten eleven twelve"]'
    )
    expect(chart.blocks[0]!.lines.length).toBeGreaterThan(1)
  })

  it('caps how wide one label may make a block', () => {
    const chart = layout(
      'block\ncolumns 1\na["one two three four five six seven eight nine ten eleven twelve"]'
    )
    expect(chart.blocks[0]!.width).toBeLessThan(400)
  })

  it('routes one connector per edge', () => {
    const chart = layout('block\ncolumns 3\nA --> B\nB --> C')
    expect(chart.edges).toHaveLength(2)
    expect(chart.edges.every(e => e.path.startsWith('M'))).toBe(true)
  })

  it('attaches a label to the edge that has one', () => {
    const chart = layout('block\nA -- "via" --> B')
    expect(chart.edges[0]!.label?.text).toBe('via')
    expect(chart.edges[0]!.label!.width).toBeGreaterThan(0)
  })

  it('skips an edge whose endpoint was never placed', () => {
    const chart = layout('block\nA --> B\nclass nope x')
    expect(chart.edges).toHaveLength(1)
  })

  it('returns an empty layout for a bare header', () => {
    const chart = layout('block-beta')
    expect(chart.blocks).toEqual([])
    expect(chart.edges).toEqual([])
    expect(chart.width).toBeGreaterThan(0)
  })

  it('reserves room for a title', () => {
    const plain = layout('block\na["A"]')
    const titled = layout('block\ntitle T\na["A"]')
    expect(titled.height).toBeGreaterThan(plain.height)
    expect(titled.blocks[0]!.y).toBeGreaterThan(plain.blocks[0]!.y)
  })
})
