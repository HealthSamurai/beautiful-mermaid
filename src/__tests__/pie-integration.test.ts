import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parsePieDiagram } from '../pie/parser.ts'
import { layoutPie } from '../pie/layout.ts'

// ============================================================================
// Pie end-to-end tests
//
// Checks that `pie` routes through the dispatcher, produces well-formed SVG,
// and that the geometry adds up (angles sum to the full circle, legend rows
// match slices).
// ============================================================================

const SIMPLE = `pie title Animal adoption
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15`

const SHOW_DATA = `pie showData
    title Q1 revenue
    "Direct" : 60
    "Partners" : 40`

function layout(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return layoutPie(parsePieDiagram(lines))
}

describe('pie integration — renderMermaidSVG', () => {
  it('renders a pie chart to SVG', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(() => renderMermaidSVG(SIMPLE)).not.toThrow()
    expect(renderMermaidSVG(SIMPLE)).toContain('pie-slice')
  })

  it('emits one wedge path per non-zero slice', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg.match(/class="pie-slice/g)).toHaveLength(3)
  })

  it('renders the title', () => {
    expect(renderMermaidSVG(SIMPLE)).toContain('Animal adoption')
  })

  it('renders every legend label', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('Dogs')
    expect(svg).toContain('Cats')
    expect(svg).toContain('Rats')
  })

  it('appends values to legend labels under showData', () => {
    const svg = renderMermaidSVG(SHOW_DATA)
    expect(svg).toContain('Direct [60]')
    expect(svg).toContain('Partners [40]')
  })

  it('omits values from legend labels without showData', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).not.toContain('Dogs [386]')
  })

  it('emits an accessible <title> per slice', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('<title>Dogs: 386</title>')
  })

  it('tags slices with data attributes', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('data-label="Dogs"')
    expect(svg).toContain('data-value="386"')
  })

  it('renders percentage labels', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('pie-percent')
    // 386 of 486 is ~79%
    expect(svg).toContain('79%')
  })

  it('declares a colour variable per slice', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('--pie-color-0')
    expect(svg).toContain('--pie-color-1')
    expect(svg).toContain('--pie-color-2')
  })

  it('maps slice 0 onto the theme accent', () => {
    expect(renderMermaidSVG(SIMPLE)).toContain('--pie-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    const svg = renderMermaidSVG(SIMPLE, { accent: '#ff0000' })
    expect(svg).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    const svg = renderMermaidSVG(SIMPLE, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('escapes XML special characters in labels', () => {
    const svg = renderMermaidSVG(`pie\n"A & <B>" : 10`)
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders a one-slice pie as a full circle', () => {
    const svg = renderMermaidSVG(`pie\n"Everything" : 100`)
    expect(svg).toContain('pie-slice')
    expect(svg).toContain('100%')
  })

  it('renders an empty pie without throwing', () => {
    const svg = renderMermaidSVG('pie title Nothing here')
    expect(svg).toStartWith('<svg')
    expect(svg).toContain('Nothing here')
  })

  it('skips the wedge for a zero-value slice but keeps its legend row', () => {
    const svg = renderMermaidSVG(`pie
      "Zero" : 0
      "Rest" : 10`)
    expect(svg.match(/class="pie-slice/g)).toHaveLength(1)
    expect(svg).toContain('Zero')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<style>/g)?.length).toBe(svg.match(/<\/style>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(SIMPLE)).toThrow(/not supported for pie/)
  })
})

describe('pie layout', () => {
  it('produces one positioned slice per parsed slice', () => {
    const chart = layout(SIMPLE)
    expect(chart.slices).toHaveLength(3)
    expect(chart.legend).toHaveLength(3)
  })

  it('fractions sum to one', () => {
    const chart = layout(SIMPLE)
    const sum = chart.slices.reduce((acc, s) => acc + s.fraction, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('orders fractions by declaration, not by size', () => {
    const chart = layout(SIMPLE)
    expect(chart.slices.map(s => s.label)).toEqual(['Dogs', 'Cats', 'Rats'])
  })

  it('assigns a distinct colour index per slice', () => {
    const chart = layout(SIMPLE)
    expect(chart.slices.map(s => s.colorIndex)).toEqual([0, 1, 2])
  })

  it('keeps every slice inside the canvas', () => {
    const chart = layout(SIMPLE)
    const { cx, cy, radius } = chart.center
    expect(cx - radius).toBeGreaterThanOrEqual(0)
    expect(cy - radius).toBeGreaterThanOrEqual(0)
    expect(cx + radius).toBeLessThanOrEqual(chart.width)
    expect(cy + radius).toBeLessThanOrEqual(chart.height)
  })

  it('widens the canvas for long legend labels', () => {
    const narrow = layout(`pie\n"a" : 1`)
    const wide = layout(`pie\n"a very considerably longer label indeed" : 1`)
    expect(wide.width).toBeGreaterThan(narrow.width)
  })

  it('reserves vertical space for the title only when present', () => {
    const titled = layout(SIMPLE)
    const untitled = layout(`pie\n"Dogs" : 386\n"Cats" : 85\n"Rats" : 15`)
    expect(titled.height).toBeGreaterThan(untitled.height)
    expect(untitled.title).toBeUndefined()
  })

  it('drops the percentage label on a very thin slice', () => {
    const chart = layout(`pie
      "Big" : 1000
      "Sliver" : 1`)
    const sliver = chart.slices.find(s => s.label === 'Sliver')!
    expect(sliver.percentLabel).toBeUndefined()
  })

  it('emits valid path data for every drawn slice', () => {
    const chart = layout(SIMPLE)
    for (const slice of chart.slices) {
      expect(slice.path).toMatch(/^M[\d.,\s-]+/)
      expect(slice.path).toEndWith('Z')
    }
  })
})
