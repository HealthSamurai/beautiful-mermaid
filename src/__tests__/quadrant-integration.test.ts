import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parseQuadrantDiagram } from '../quadrant/parser.ts'
import { layoutQuadrant } from '../quadrant/layout.ts'

// ============================================================================
// Quadrant chart end-to-end tests
//
// Checks that `quadrantChart` routes through the dispatcher, produces
// well-formed SVG, and that unit-square coordinates land in the right
// quadrant once mapped to SVG space (where y is flipped).
// ============================================================================

const PLATFORMS = `quadrantChart
    title Reach and engagement of campaigns
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 We should expand
    quadrant-2 Need to promote
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.57, 0.69]
    Campaign D: [0.78, 0.34]`

function layout(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return layoutQuadrant(parseQuadrantDiagram(lines))
}

describe('quadrant integration — renderMermaidSVG', () => {
  it('renders a quadrant chart to SVG', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(() => renderMermaidSVG(PLATFORMS)).not.toThrow()
    expect(renderMermaidSVG(PLATFORMS)).toContain('quadrant-point')
  })

  it('emits four quadrant backgrounds', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg.match(/class="quadrant-bg/g)).toHaveLength(4)
  })

  it('tags each background with its quadrant number', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    for (const n of [1, 2, 3, 4]) {
      expect(svg).toContain(`data-quadrant="${n}"`)
    }
  })

  it('emits one marker per point', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg.match(/class="quadrant-point"/g)).toHaveLength(4)
  })

  it('renders the title', () => {
    expect(renderMermaidSVG(PLATFORMS)).toContain('Reach and engagement of campaigns')
  })

  it('renders every quadrant label', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg).toContain('We should expand')
    expect(svg).toContain('Need to promote')
    expect(svg).toContain('Re-evaluate')
    expect(svg).toContain('May be improved')
  })

  it('renders every axis end label', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg).toContain('Low Reach')
    expect(svg).toContain('High Reach')
    expect(svg).toContain('Low Engagement')
    expect(svg).toContain('High Engagement')
  })

  it('renders every point label', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    for (const label of ['Campaign A', 'Campaign B', 'Campaign C', 'Campaign D']) {
      expect(svg).toContain(label)
    }
  })

  it('draws the crosshair', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg.match(/class="quadrant-crosshair"/g)).toHaveLength(2)
  })

  it('emits an accessible <title> per point', () => {
    expect(renderMermaidSVG(PLATFORMS)).toContain('<title>Campaign A (0.3, 0.6)</title>')
  })

  it('tags points with data attributes', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg).toContain('data-point="Campaign A"')
    expect(svg).toContain('data-x="0.3"')
    expect(svg).toContain('data-y="0.6"')
  })

  it('declares a colour variable per quadrant', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    for (const i of [0, 1, 2, 3]) {
      expect(svg).toContain(`--quadrant-color-${i}`)
    }
  })

  it('maps quadrant 1 onto the theme accent', () => {
    expect(renderMermaidSVG(PLATFORMS)).toContain('--quadrant-color-0: var(--accent')
  })

  it('applies an inline point colour override', () => {
    const svg = renderMermaidSVG('quadrantChart\nA: [0.5, 0.5] color: #ff0000')
    expect(svg).toContain('fill:#ff0000')
  })

  it('applies an inline radius override', () => {
    const svg = renderMermaidSVG('quadrantChart\nA: [0.5, 0.5] radius: 20')
    expect(svg).toContain('r="20"')
  })

  it('emits a point class name as an extra CSS class', () => {
    const svg = renderMermaidSVG('quadrantChart\nA:::highlight: [0.5, 0.5]')
    expect(svg).toContain('class="quadrant-point highlight"')
  })

  it('leaves unstyled points free of an inline style attribute', () => {
    const svg = renderMermaidSVG('quadrantChart\nA: [0.5, 0.5]')
    expect(svg).toContain('class="quadrant-point"')
    expect(svg).not.toContain('style="fill')
  })

  it('supports transparent backgrounds', () => {
    const svg = renderMermaidSVG(PLATFORMS, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('quadrantChart\n"A & <B>": [0.5, 0.5]')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders an empty chart without throwing', () => {
    const svg = renderMermaidSVG('quadrantChart\ntitle Nothing here')
    expect(svg).toStartWith('<svg')
    expect(svg).toContain('Nothing here')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(PLATFORMS)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(PLATFORMS)).toThrow(/not supported for quadrant/)
  })
})

describe('quadrant layout', () => {
  it('produces one positioned point per parsed point', () => {
    expect(layout(PLATFORMS).points).toHaveLength(4)
  })

  it('numbers quadrants the way Mermaid does', () => {
    const chart = layout(PLATFORMS)
    expect(chart.quadrants.map(q => q.number)).toEqual([1, 2, 3, 4])
  })

  it('puts quadrant 1 top-right and quadrant 3 bottom-left', () => {
    const chart = layout(PLATFORMS)
    const q1 = chart.quadrants.find(q => q.number === 1)!
    const q3 = chart.quadrants.find(q => q.number === 3)!
    expect(q1.rect.x).toBeGreaterThan(q3.rect.x)
    expect(q1.rect.y).toBeLessThan(q3.rect.y)
  })

  it('flips the y axis so a high value sits near the top', () => {
    const chart = layout('quadrantChart\nLow: [0.5, 0.1]\nHigh: [0.5, 0.9]')
    const low = chart.points.find(p => p.label === 'Low')!
    const high = chart.points.find(p => p.label === 'High')!
    expect(high.cy).toBeLessThan(low.cy)
  })

  it('maps increasing x to the right', () => {
    const chart = layout('quadrantChart\nLeft: [0.1, 0.5]\nRight: [0.9, 0.5]')
    const left = chart.points.find(p => p.label === 'Left')!
    const right = chart.points.find(p => p.label === 'Right')!
    expect(right.cx).toBeGreaterThan(left.cx)
  })

  it('places the centre point exactly on the crosshair', () => {
    const chart = layout('quadrantChart\nMid: [0.5, 0.5]')
    expect(chart.points[0]!.cx).toBeCloseTo(chart.crosshair.vertical.x, 6)
    expect(chart.points[0]!.cy).toBeCloseTo(chart.crosshair.horizontal.y, 6)
  })

  it('keeps every point inside the plot square', () => {
    const chart = layout(PLATFORMS)
    for (const point of chart.points) {
      expect(point.cx).toBeGreaterThanOrEqual(chart.plot.x)
      expect(point.cx).toBeLessThanOrEqual(chart.plot.x + chart.plot.width)
      expect(point.cy).toBeGreaterThanOrEqual(chart.plot.y)
      expect(point.cy).toBeLessThanOrEqual(chart.plot.y + chart.plot.height)
    }
  })

  it('places the corner points at the plot corners', () => {
    const chart = layout('quadrantChart\nBL: [0, 0]\nTR: [1, 1]')
    const bl = chart.points.find(p => p.label === 'BL')!
    const tr = chart.points.find(p => p.label === 'TR')!
    expect(bl.cx).toBeCloseTo(chart.plot.x, 6)
    expect(bl.cy).toBeCloseTo(chart.plot.y + chart.plot.height, 6)
    expect(tr.cx).toBeCloseTo(chart.plot.x + chart.plot.width, 6)
    expect(tr.cy).toBeCloseTo(chart.plot.y, 6)
  })

  it('emits one axis label per declared end', () => {
    expect(layout(PLATFORMS).axisLabels).toHaveLength(4)
  })

  it('emits no axis labels when none are declared', () => {
    expect(layout('quadrantChart\nA: [0.5, 0.5]').axisLabels).toEqual([])
  })

  it('widens the canvas for a long side axis label', () => {
    const short = layout('quadrantChart\nx-axis a --> b')
    const long = layout('quadrantChart\nx-axis a considerably longer label --> b')
    expect(long.width).toBeGreaterThan(short.width)
  })

  it('reserves vertical space for the title only when present', () => {
    const titled = layout('quadrantChart\ntitle T\nA: [0.5, 0.5]')
    const untitled = layout('quadrantChart\nA: [0.5, 0.5]')
    expect(titled.height).toBeGreaterThan(untitled.height)
    expect(untitled.title).toBeUndefined()
  })

  it('honours a per-point radius override', () => {
    const chart = layout('quadrantChart\nA: [0.5, 0.5] radius: 15')
    expect(chart.points[0]!.radius).toBe(15)
  })

  it('places the point label clear of its marker', () => {
    const chart = layout('quadrantChart\nA: [0.5, 0.5]')
    const point = chart.points[0]!
    expect(point.labelX).toBeGreaterThan(point.cx + point.radius)
  })
})
