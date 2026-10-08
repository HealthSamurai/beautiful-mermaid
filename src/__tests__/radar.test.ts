import { describe, expect, it } from 'bun:test'
import { parseRadarDiagram } from '../radar/parser.ts'
import { closedRoundCurve, layoutRadar, relativeRadius } from '../radar/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

// ============================================================================
// Radar chart tests
//
// Ported from packages/mermaid/src/diagrams/radar/radar.spec.ts, including
// the relativeRadius and closedRoundCurve cases, whose expected paths are
// upstream's inline snapshots verbatim.
// ============================================================================

function parse(text: string) {
  return parseRadarDiagram(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  )
}

describe('radar parser — structure', () => {
  it('should handle a simple radar definition', () => {
    const diagram = parse('radar-beta\naxis A,B,C\ncurve mycurve{1,2,3}')
    expect(diagram.axes.map(a => a.name)).toEqual(['A', 'B', 'C'])
    expect(diagram.curves).toHaveLength(1)
    expect(diagram.curves[0]!.entries).toEqual([1, 2, 3])
  })

  it('should handle diagram with data and title', () => {
    const diagram = parse(`radar-beta
      title Radar diagram
      axis A["Axis A"], B["Axis B"] ,C["Axis C"]
      curve mycurve["My Curve"]{1,2,3}`)

    expect(diagram.title).toBe('Radar diagram')
    expect(diagram.axes).toEqual([
      { name: 'A', label: 'Axis A' },
      { name: 'B', label: 'Axis B' },
      { name: 'C', label: 'Axis C' },
    ])
    expect(diagram.curves).toEqual([
      { name: 'mycurve', label: 'My Curve', entries: [1, 2, 3] },
    ])
    expect(diagram.options).toEqual({
      graticule: 'circle',
      max: null,
      min: 0,
      showLegend: true,
      ticks: 5,
    })
  })

  it('should handle a radar diagram with options', () => {
    const diagram = parse(`radar-beta
      ticks 10
      showLegend false
      graticule polygon
      min 1
      max 10`)

    expect(diagram.options).toEqual({
      graticule: 'polygon',
      max: 10,
      min: 1,
      showLegend: false,
      ticks: 10,
    })
  })

  it('should handle curve with detailed data in any order', () => {
    const diagram = parse('radar-beta\naxis A,B,C\ncurve mycurve{ C: 3, A: 1, B: 2 }')
    expect(diagram.curves[0]!.entries).toEqual([1, 2, 3])
  })

  it('should handle radar diagram with comments', () => {
    const diagram = parse(`radar-beta
      %% This is a comment
      axis A,B,C
      %% This is another comment
      curve mycurve{1,2,3}`)
    expect(diagram.curves[0]!.entries).toEqual([1, 2, 3])
  })

  it('should accept the colon form of the header', () => {
    const diagram = parse('radar-beta:\naxis A,B,C\ncurve mycurve{1,2,3}')
    expect(diagram.axes).toHaveLength(3)
  })

  it('should limit the number of ticks to MAX_TICKS', () => {
    for (const [ticks, expected] of [[12, 12], [32, 32], [33, 32]] as const) {
      expect(parse(`radar-beta\nticks ${ticks}`).options.ticks).toBe(expected)
    }
  })

  it('defaults a curve label to its name', () => {
    expect(parse('radar-beta\naxis A\ncurve c{1}').curves[0]!.label).toBe('c')
  })

  it('defaults an axis label to its name', () => {
    expect(parse('radar-beta\naxis A').axes[0]!.label).toBe('A')
  })

  it('reads axes declared over several lines', () => {
    const diagram = parse('radar-beta\naxis A,B\naxis C\ncurve c{1,2,3}')
    expect(diagram.axes.map(a => a.name)).toEqual(['A', 'B', 'C'])
    expect(diagram.curves[0]!.entries).toEqual([1, 2, 3])
  })

  it('does not duplicate a repeated axis', () => {
    expect(parse('radar-beta\naxis A,B\naxis A').axes).toHaveLength(2)
  })

  it('pads a curve with too few values', () => {
    expect(parse('radar-beta\naxis A,B,C\ncurve c{1}').curves[0]!.entries).toEqual([1, 0, 0])
  })

  it('trims a curve with too many values', () => {
    expect(parse('radar-beta\naxis A,B\ncurve c{1,2,3,4}').curves[0]!.entries).toEqual([1, 2])
  })

  it('reads several curves', () => {
    const diagram = parse('radar-beta\naxis A,B\ncurve one{1,2}\ncurve two{3,4}')
    expect(diagram.curves.map(c => c.name)).toEqual(['one', 'two'])
  })

  it('fills a missing key with the chart minimum', () => {
    expect(parse('radar-beta\naxis A,B,C\ncurve c{ A: 1 }').curves[0]!.entries).toEqual([1, 0, 0])
  })

  it('accepts decimal values', () => {
    expect(parse('radar-beta\naxis A,B\ncurve c{1.5, 2.25}').curves[0]!.entries).toEqual([1.5, 2.25])
  })

  it('accepts negative values', () => {
    expect(parse('radar-beta\naxis A,B\ncurve c{-1, 2}').curves[0]!.entries).toEqual([-1, 2])
  })

  it('reads an axis label containing a comma', () => {
    const diagram = parse('radar-beta\naxis A["one, two"], B')
    expect(diagram.axes.map(a => a.label)).toEqual(['one, two', 'B'])
  })

  it('ignores a curve with no braces', () => {
    expect(parse('radar-beta\naxis A\ncurve broken').curves).toHaveLength(0)
  })

  it('ignores an invalid graticule', () => {
    expect(parse('radar-beta\ngraticule hexagon').options.graticule).toBe('circle')
  })

  it('ignores a zero tick count', () => {
    expect(parse('radar-beta\nticks 0').options.ticks).toBe(5)
  })

  it('reads showLegend true', () => {
    expect(parse('radar-beta\nshowLegend true').options.showLegend).toBe(true)
  })

  it('reads a title on its own line', () => {
    expect(parse('radar-beta\ntitle My radar').title).toBe('My radar')
  })

  it('parses a bare header', () => {
    const diagram = parse('radar-beta')
    expect(diagram.axes).toEqual([])
    expect(diagram.curves).toEqual([])
  })
})

describe('radar layout — relativeRadius', () => {
  it('should calculate relative radius', () => {
    expect(relativeRadius(5, 0, 10, 100)).toBe(50)
  })

  it('should handle min value', () => {
    expect(relativeRadius(0, 0, 10, 100)).toBe(0)
  })

  it('should handle max value', () => {
    expect(relativeRadius(10, 0, 10, 100)).toBe(100)
  })

  it('should clip values below min', () => {
    expect(relativeRadius(-5, 0, 10, 100)).toBe(0)
  })

  it('should clip values above max', () => {
    expect(relativeRadius(15, 0, 10, 100)).toBe(100)
  })

  it('should handle negative min', () => {
    expect(relativeRadius(5, -10, 10, 100)).toBe(75)
  })

  it('collapses a zero-width domain onto the centre', () => {
    expect(relativeRadius(5, 5, 5, 100)).toBe(0)
  })
})

describe('radar layout — closedRoundCurve', () => {
  const SQUARE = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ]

  it('should construct a polygon if tension is 0', () => {
    expect(closedRoundCurve(SQUARE, 0)).toBe(
      'M0,0 C0,0 100,0 100,0 C100,0 100,100 100,100 C100,100 0,100 0,100 C0,100 0,0 0,0 Z'
    )
  })

  it('should construct a simple round curve', () => {
    expect(closedRoundCurve([{ x: 0, y: 0 }, { x: 100, y: 100 }], 0.5)).toBe(
      'M0,0 C0,0 100,100 100,100 C100,100 0,0 0,0 Z'
    )
  })

  it('should construct a closed round curve', () => {
    expect(closedRoundCurve(SQUARE, 0.5)).toBe(
      'M0,0 C50,-50 50,-50 100,0 C150,50 150,50 100,100 ' +
      'C50,150 50,150 0,100 C-50,50 -50,50 0,0 Z'
    )
  })

  it('returns an empty path for no points', () => {
    expect(closedRoundCurve([], 0.5)).toBe('')
  })
})

describe('radar layout — placement', () => {
  const CHART = `radar-beta
    axis A,B,C,D
    curve one{1,2,3,4}
    curve two{4,3,2,1}`

  it('puts the first axis at twelve o\'clock', () => {
    const chart = layoutRadar(parse(CHART))
    const first = chart.spokes[0]!
    expect(first.x2).toBeCloseTo(chart.center.cx, 5)
    expect(first.y2).toBeLessThan(chart.center.cy)
  })

  it('spreads axes evenly around the circle', () => {
    const chart = layoutRadar(parse(CHART))
    const angles = chart.spokes.map(s =>
      Math.atan2(s.y2 - chart.center.cy, s.x2 - chart.center.cx))
    // Four axes, so a quarter turn apart
    for (let i = 1; i < angles.length; i++) {
      const delta = angles[i]! - angles[i - 1]!
      expect(Math.abs(delta)).toBeCloseTo(Math.PI / 2, 5)
    }
  })

  it('builds one ring per tick', () => {
    expect(layoutRadar(parse('radar-beta\nticks 7\naxis A,B,C\ncurve c{1,2,3}')).rings)
      .toHaveLength(7)
  })

  it('marks only the outermost ring as outer', () => {
    const rings = layoutRadar(parse(CHART)).rings
    expect(rings.filter(r => r.outer)).toHaveLength(1)
    expect(rings[rings.length - 1]!.outer).toBe(true)
  })

  it('builds one point per axis for each curve', () => {
    const chart = layoutRadar(parse(CHART))
    expect(chart.curves).toHaveLength(2)
    expect(chart.curves.every(c => c.points.length === 4)).toBe(true)
  })

  it('maps the largest value onto the outer radius', () => {
    const chart = layoutRadar(parse(CHART))
    const point = chart.curves[0]!.points[3]!
    const distance = Math.hypot(point.x - chart.center.cx, point.y - chart.center.cy)
    expect(distance).toBeCloseTo(chart.center.radius, 5)
  })

  it('takes the max from the data when none is declared', () => {
    const chart = layoutRadar(parse('radar-beta\naxis A,B\ncurve c{2,4}'))
    const outer = chart.curves[0]!.points[1]!
    expect(Math.hypot(outer.x - chart.center.cx, outer.y - chart.center.cy))
      .toBeCloseTo(chart.center.radius, 5)
  })

  it('honours a declared max', () => {
    const chart = layoutRadar(parse('radar-beta\nmax 10\naxis A,B\ncurve c{5,5}'))
    const point = chart.curves[0]!.points[0]!
    expect(Math.hypot(point.x - chart.center.cx, point.y - chart.center.cy))
      .toBeCloseTo(chart.center.radius / 2, 5)
  })

  it('puts a value at the minimum on the centre', () => {
    const chart = layoutRadar(parse('radar-beta\nmin 1\nmax 5\naxis A,B\ncurve c{1,5}'))
    const point = chart.curves[0]!.points[0]!
    expect(point.x).toBeCloseTo(chart.center.cx, 5)
    expect(point.y).toBeCloseTo(chart.center.cy, 5)
  })

  it('builds a legend row per curve', () => {
    expect(layoutRadar(parse(CHART)).legend).toHaveLength(2)
  })

  it('omits the legend when switched off', () => {
    expect(layoutRadar(parse(`radar-beta\nshowLegend false\n${CHART.split('\n').slice(1).join('\n')}`)).legend)
      .toHaveLength(0)
  })

  it('narrows the canvas without a legend', () => {
    const withLegend = layoutRadar(parse(CHART))
    const without = layoutRadar(parse(`radar-beta\nshowLegend false\naxis A,B,C,D\ncurve one{1,2,3,4}\ncurve two{4,3,2,1}`))
    expect(without.width).toBeLessThan(withLegend.width)
  })

  it('gives each curve its own colour index', () => {
    expect(layoutRadar(parse(CHART)).curves.map(c => c.colorIndex)).toEqual([0, 1])
  })

  it('keeps every point inside the canvas', () => {
    const chart = layoutRadar(parse(CHART))
    for (const curve of chart.curves) {
      for (const point of curve.points) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(chart.width)
        expect(point.y).toBeLessThanOrEqual(chart.height)
      }
    }
  })

  it('handles an empty diagram', () => {
    const chart = layoutRadar(parse('radar-beta'))
    expect(chart.curves).toEqual([])
    expect(chart.spokes).toEqual([])
    expect(chart.width).toBeGreaterThan(0)
  })
})

describe('radar integration — renderMermaidSVG', () => {
  const CHART = `radar-beta
    title Capability
    axis Speed, Power, Range
    curve proto["Prototype"]{3,4,2}
    curve ship["Shipped"]{5,2,4}`

  it('renders a radar chart to SVG', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(renderMermaidSVG(CHART)).toContain('radar-ring')
  })

  it('accepts the plain radar header', () => {
    expect(renderMermaidSVG('radar\naxis A,B,C\ncurve c{1,2,3}')).toContain('radar-ring')
  })

  it('renders one area and one outline per curve', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg.match(/class="radar-area/g)).toHaveLength(2)
    expect(svg.match(/class="radar-line/g)).toHaveLength(2)
  })

  it('renders a dot per data point', () => {
    expect(renderMermaidSVG(CHART).match(/class="radar-dot/g)).toHaveLength(6)
  })

  it('renders every axis label', () => {
    const svg = renderMermaidSVG(CHART)
    for (const label of ['Speed', 'Power', 'Range']) expect(svg).toContain(label)
  })

  it('renders the legend labels', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toContain('Prototype')
    expect(svg).toContain('Shipped')
  })

  it('omits legend swatches when the legend is off', () => {
    const svg = renderMermaidSVG(`radar-beta\nshowLegend false\naxis A,B\ncurve c{1,2}`)
    // The CSS rule is always emitted; what must be absent is the swatch itself
    expect(svg).not.toContain('<rect')
  })

  it('renders a polygon graticule with straight rings', () => {
    const svg = renderMermaidSVG('radar-beta\ngraticule polygon\naxis A,B,C\ncurve c{1,2,3}')
    const rings = [...svg.matchAll(/<path d="([^"]*)" class="radar-ring/g)].map(m => m[1]!)
    expect(rings.length).toBeGreaterThan(0)
    // A polygon ring is lines only — no elliptical arc command
    expect(rings.every(d => !/[aA]\d/.test(d))).toBe(true)
    expect(rings.every(d => d.includes('L'))).toBe(true)
  })

  it('renders a circle graticule with arcs', () => {
    const svg = renderMermaidSVG('radar-beta\naxis A,B,C\ncurve c{1,2,3}')
    const firstRing = svg.match(/<path d="([^"]*)" class="radar-ring/)![1]!
    expect(firstRing).toMatch(/a\d/)
  })

  it('emits an accessible title per data point', () => {
    expect(renderMermaidSVG(CHART)).toContain('<title>Prototype — Speed: 3</title>')
  })

  it('declares a colour variable per curve', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toContain('--radar-color-0')
    expect(svg).toContain('--radar-color-1')
  })

  it('maps curve 0 onto the theme accent', () => {
    expect(renderMermaidSVG(CHART)).toContain('--radar-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(CHART, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    expect(renderMermaidSVG(CHART, { transparent: true })).not.toContain('background:var(--bg)')
  })

  it('renders the title', () => {
    expect(renderMermaidSVG(CHART)).toContain('Capability')
  })

  it('takes a title from frontmatter', () => {
    const svg = renderMermaidSVG('---\ntitle: From meta\n---\nradar-beta\naxis A,B\ncurve c{1,2}')
    expect(svg).toContain('From meta')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('radar-beta\naxis A["A & <B>"]\ncurve c{1}')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders an empty radar chart without throwing', () => {
    const svg = renderMermaidSVG('radar-beta')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(CHART)).toThrow(/not supported for radar/)
  })
})
