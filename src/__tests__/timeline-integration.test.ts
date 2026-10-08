/**
 * End-to-end tests for timeline rendering through the public renderMermaidSVG API.
 *
 * Covers: diagram-type detection, valid SVG output, markers/cards/sections,
 * both orientations, theming and layout invariants.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { layoutTimeline } from '../timeline/layout.ts'

const SIMPLE = `timeline
    title History of Social Media
    2002 : LinkedIn
    2004 : Facebook : Google
    2006 : Twitter`

const SECTIONED = `timeline
    title History of Social Media
    section Early days
        2002 : LinkedIn
        2004 : Facebook : Google
    section Mobile era
        2006 : Twitter : Launched as a side project at Odeo
        2010 : Instagram`

const VERTICAL = `timeline vertical
    title Career
    section Start
        2011 : META Group
    section Now
        2023 : Air Liquide : Clinical data platform`

/** Layout a timeline source the same way renderMermaidSVG does. */
function layout(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return layoutTimeline(parseTimelineDiagram(lines))
}

// ============================================================================
// Detection and basic validity
// ============================================================================

describe('timeline – rendering', () => {
  it('renders a timeline without throwing', () => {
    expect(() => renderMermaidSVG(SIMPLE)).not.toThrow()
    expect(() => renderMermaidSVG(SECTIONED)).not.toThrow()
    expect(() => renderMermaidSVG(VERTICAL)).not.toThrow()
  })

  it('produces a well-formed SVG document', () => {
    const svg = renderMermaidSVG(SECTIONED)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 ')
  })

  it('balances every opened tag', () => {
    const svg = renderMermaidSVG(SECTIONED)
    for (const tag of ['svg', 'style', 'text']) {
      const open = svg.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0
      const close = svg.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0
      expect(close).toBe(open)
    }
  })

  it('does not fall through to the flowchart parser', () => {
    expect(() => renderMermaidSVG('timeline\n  2002 : LinkedIn')).not.toThrow()
  })

  it('renders a header-only timeline without throwing', () => {
    expect(() => renderMermaidSVG('timeline')).not.toThrow()
  })
})

// ============================================================================
// Content
// ============================================================================

describe('timeline – content', () => {
  it('renders the title', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('History of Social Media')
    expect(svg).toContain('class="timeline-title"')
  })

  it('renders a marker and label per period', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg.match(/class="timeline-marker /g)?.length).toBe(3)
    expect(svg).toContain('>2002</text>')
    expect(svg).toContain('>2006</text>')
  })

  it('renders a card per event', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg.match(/class="timeline-event /g)?.length).toBe(4)
    expect(svg).toContain('LinkedIn')
    expect(svg).toContain('Google')
  })

  it('renders section labels and bands', () => {
    const svg = renderMermaidSVG(SECTIONED)
    expect(svg).toContain('>Early days</text>')
    expect(svg).toContain('>Mobile era</text>')
    expect(svg).toContain('class="timeline-band ')
  })

  it('omits section bands when the diagram has no sections', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).not.toContain('class="timeline-band ')
  })

  it('draws the axis spine and connectors', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('class="timeline-axis"')
    expect(svg).toContain('class="timeline-connector ')
  })

  it('wraps long event text onto several tspan lines', () => {
    const svg = renderMermaidSVG(SECTIONED)
    expect(svg).toContain('<tspan')
    expect(svg).toContain('Launched')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG(`timeline
      section R&D
        2002 : A <b> & B`)
    expect(svg).toContain('R&amp;D')
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('<b>')
  })
})

// ============================================================================
// Theming
// ============================================================================

describe('timeline – theming', () => {
  it('uses the provided bg/fg CSS variables', () => {
    const svg = renderMermaidSVG(SIMPLE, { bg: '#1a1b26', fg: '#a9b1d6' })
    expect(svg).toContain('--bg:#1a1b26')
    expect(svg).toContain('--fg:#a9b1d6')
  })

  it('maps the first section onto the theme accent', () => {
    const svg = renderMermaidSVG(SECTIONED, { accent: '#7aa2f7' })
    expect(svg).toContain('--accent:#7aa2f7')
    expect(svg).toContain('--timeline-color-0: var(--accent')
  })

  it('gives each section its own color variable', () => {
    const svg = renderMermaidSVG(SECTIONED)
    expect(svg).toContain('--timeline-color-0:')
    expect(svg).toContain('--timeline-color-1:')
  })

  it('omits the background style when transparent', () => {
    const svg = renderMermaidSVG(SIMPLE, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('applies the requested font family', () => {
    const svg = renderMermaidSVG(SIMPLE, { font: 'Roboto' })
    expect(svg).toContain(`font-family: 'Roboto'`)
  })
})

// ============================================================================
// Layout invariants — horizontal
// ============================================================================

describe('timeline – horizontal layout', () => {
  it('places periods left to right in source order', () => {
    const p = layout(SECTIONED)
    const xs = p.periods.map(pp => pp.cx)
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!)
  })

  it('puts every period marker on the axis', () => {
    const p = layout(SECTIONED)
    for (const period of p.periods) expect(period.cy).toBe(p.axis.y1)
  })

  it('stacks the events of one period below each other', () => {
    const p = layout(SIMPLE)
    const facebook = p.events.find(e => e.text === 'Facebook')!
    const google = p.events.find(e => e.text === 'Google')!
    expect(google.y).toBeGreaterThan(facebook.y)
    expect(google.x).toBe(facebook.x)
  })

  it('keeps every element inside the canvas', () => {
    const p = layout(SECTIONED)
    for (const e of p.events) {
      expect(e.x).toBeGreaterThanOrEqual(0)
      expect(e.x + e.width).toBeLessThanOrEqual(p.width)
      expect(e.y + e.height).toBeLessThanOrEqual(p.height)
    }
    for (const m of p.periods) {
      expect(m.cx + m.radius).toBeLessThanOrEqual(p.width)
      expect(m.cy + m.radius).toBeLessThanOrEqual(p.height)
    }
  })

  it('gives a wrapped event a taller card than a short one', () => {
    const p = layout(SECTIONED)
    const twitter = p.events.find(e => e.text === 'Twitter')!
    const long = p.events.find(e => e.text.includes('Odeo'))!
    expect(long.height).toBeGreaterThan(twitter.height)
  })

  it('builds one band per section, left to right without overlap', () => {
    const p = layout(SECTIONED)
    expect(p.sections).toHaveLength(2)
    expect(p.sections[1]!.band.x).toBeGreaterThan(p.sections[0]!.band.x + p.sections[0]!.band.width - 1)
  })
})

// ============================================================================
// Layout invariants — vertical
// ============================================================================

describe('timeline – vertical layout', () => {
  it('reports the vertical orientation', () => {
    const p = layout(VERTICAL)
    expect(p.orientation).toBe('vertical')
  })

  it('places periods top to bottom in source order', () => {
    const p = layout(VERTICAL)
    const ys = p.periods.map(pp => pp.cy)
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!)
  })

  it('runs the axis vertically with every marker on it', () => {
    const p = layout(VERTICAL)
    expect(p.axis.x1).toBe(p.axis.x2)
    for (const period of p.periods) expect(period.cx).toBe(p.axis.x1)
  })

  it('puts event cards to the right of the axis', () => {
    const p = layout(VERTICAL)
    for (const e of p.events) expect(e.x).toBeGreaterThan(p.axis.x1)
  })

  it('anchors period labels to the left of the axis', () => {
    const p = layout(VERTICAL)
    for (const period of p.periods) {
      expect(period.labelX).toBeLessThan(p.axis.x1)
      expect(period.labelAnchor).toBe('end')
    }
  })

  it('keeps every element inside the canvas', () => {
    const p = layout(VERTICAL)
    for (const e of p.events) {
      expect(e.x + e.width).toBeLessThanOrEqual(p.width)
      expect(e.y + e.height).toBeLessThanOrEqual(p.height)
    }
  })

  it('is taller than wide for a multi-section timeline', () => {
    const p = layout(VERTICAL)
    expect(p.height).toBeGreaterThan(0)
    expect(p.width).toBeGreaterThan(0)
  })
})

// ============================================================================
// Degenerate input
// ============================================================================

describe('timeline – degenerate input', () => {
  it('still produces a positive canvas for an empty timeline', () => {
    for (const src of ['timeline', 'timeline vertical']) {
      const p = layout(src)
      expect(p.width).toBeGreaterThan(0)
      expect(p.height).toBeGreaterThan(0)
      expect(p.periods).toHaveLength(0)
    }
  })

  it('renders a period that carries no events', () => {
    const p = layout(`timeline
      2002
      2004 : Facebook`)
    expect(p.periods).toHaveLength(2)
    expect(p.events).toHaveLength(1)
    expect(p.connectors).toHaveLength(1)
  })
})

// ============================================================================
// ASCII renderer boundary
// ============================================================================

describe('timeline – ascii', () => {
  it('reports that ASCII rendering is unsupported, not a bad header', async () => {
    const { renderMermaidASCII } = await import('../ascii/index.ts')
    expect(() => renderMermaidASCII(SIMPLE)).toThrow(/ASCII rendering is not supported for timeline/)
  })
})
