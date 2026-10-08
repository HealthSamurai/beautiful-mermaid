import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourney } from '../journey/layout.ts'

// ============================================================================
// Journey end-to-end tests
//
// Checks that `journey` routes through the dispatcher, produces well-formed
// SVG, and that the score axis maps higher scores to higher positions.
// ============================================================================

const SHOPPING = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me`

function layout(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return layoutJourney(parseJourneyDiagram(lines))
}

describe('journey integration — renderMermaidSVG', () => {
  it('renders a journey to SVG', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(() => renderMermaidSVG(SHOPPING)).not.toThrow()
    expect(renderMermaidSVG(SHOPPING)).toContain('journey-marker')
  })

  it('emits one marker per task', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg.match(/class="journey-marker /g)).toHaveLength(5)
  })

  it('renders the title', () => {
    expect(renderMermaidSVG(SHOPPING)).toContain('My working day')
  })

  it('renders every section label', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toContain('Go to work')
    expect(svg).toContain('Go home')
  })

  it('renders every task label', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toContain('Make tea')
    expect(svg).toContain('Do work')
    expect(svg).toContain('Sit down')
  })

  it('renders the people involved', () => {
    expect(renderMermaidSVG(SHOPPING)).toContain('Me, Cat')
  })

  it('draws the experience curve', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toContain('class="journey-curve"')
    expect(svg).toMatch(/<polyline points="[\d.,\s]+"/)
  })

  it('draws one gridline per score level', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg.match(/class="journey-gridline"/g)).toHaveLength(5)
  })

  it('emits an accessible <title> per task', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toContain('<title>Make tea — 5/5 (Me)</title>')
  })

  it('tags markers with data attributes', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toContain('data-task="Make tea"')
    expect(svg).toContain('data-score="1"')
  })

  it('declares a colour variable per section', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toContain('--journey-color-0')
    expect(svg).toContain('--journey-color-1')
  })

  it('maps section 0 onto the theme accent', () => {
    expect(renderMermaidSVG(SHOPPING)).toContain('--journey-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(SHOPPING, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    const svg = renderMermaidSVG(SHOPPING, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('journey\nA & <B>: 4: Alice & Bob')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders a journey with no sections', () => {
    const svg = renderMermaidSVG('journey\nMake tea: 5: Me')
    expect(svg).toStartWith('<svg')
    expect(svg).toContain('Make tea')
  })

  it('renders an empty journey without throwing', () => {
    const svg = renderMermaidSVG('journey\ntitle Nothing here')
    expect(svg).toStartWith('<svg')
    expect(svg).toContain('Nothing here')
  })

  it('renders a single task without a curve', () => {
    const svg = renderMermaidSVG('journey\nOnly: 3')
    expect(svg).toContain('journey-marker')
    // The CSS rule is always emitted; what must be absent is the polyline
    expect(svg).not.toContain('<polyline')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(SHOPPING)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(SHOPPING)).toThrow(/not supported for journey/)
  })
})

describe('journey layout', () => {
  it('produces one positioned task per parsed task', () => {
    expect(layout(SHOPPING).tasks).toHaveLength(5)
  })

  it('places a higher score above a lower one', () => {
    const chart = layout(SHOPPING)
    const five = chart.tasks.find(t => t.label === 'Make tea')!
    const one = chart.tasks.find(t => t.label === 'Do work')!
    expect(five.cy).toBeLessThan(one.cy)
  })

  it('gives equal scores the same height', () => {
    const chart = layout(SHOPPING)
    const a = chart.tasks.find(t => t.label === 'Make tea')!
    const b = chart.tasks.find(t => t.label === 'Sit down')!
    expect(a.cy).toBeCloseTo(b.cy, 6)
  })

  it('advances tasks left to right', () => {
    const chart = layout(SHOPPING)
    for (let i = 1; i < chart.tasks.length; i++) {
      expect(chart.tasks[i]!.cx).toBeGreaterThan(chart.tasks[i - 1]!.cx)
    }
  })

  it('assigns the section colour index to its tasks', () => {
    const chart = layout(SHOPPING)
    expect(chart.tasks.map(t => t.colorIndex)).toEqual([0, 0, 0, 1, 1])
  })

  it('builds the curve through every marker', () => {
    const chart = layout(SHOPPING)
    expect(chart.curve.points).toHaveLength(5)
    expect(chart.curve.points[0]).toEqual({ x: chart.tasks[0]!.cx, y: chart.tasks[0]!.cy })
  })

  it('keeps every marker inside the canvas', () => {
    const chart = layout(SHOPPING)
    for (const task of chart.tasks) {
      expect(task.cx - task.radius).toBeGreaterThanOrEqual(0)
      expect(task.cy - task.radius).toBeGreaterThanOrEqual(0)
      expect(task.cx + task.radius).toBeLessThanOrEqual(chart.width)
      expect(task.cy + task.radius).toBeLessThanOrEqual(chart.height)
    }
  })

  it('omits section bands when no section is named', () => {
    expect(layout('journey\nA: 3').sections).toEqual([])
  })

  it('emits a band per named section', () => {
    expect(layout(SHOPPING).sections).toHaveLength(2)
  })

  it('widens the canvas as tasks are added', () => {
    const one = layout('journey\nA: 3')
    const three = layout('journey\nA: 3\nB: 4\nC: 5')
    expect(three.width).toBeGreaterThan(one.width)
  })

  it('reserves vertical space for the title only when present', () => {
    const titled = layout('journey\ntitle T\nA: 3')
    const untitled = layout('journey\nA: 3')
    expect(titled.height).toBeGreaterThan(untitled.height)
    expect(untitled.title).toBeUndefined()
  })

  it('omits the people label when nobody is listed', () => {
    const chart = layout('journey\nA: 3')
    expect(chart.tasks[0]!.peopleLabel).toBeUndefined()
  })

  it('wraps a long task label onto several lines', () => {
    const chart = layout('journey\nA considerably longer task label than fits: 3')
    expect(chart.tasks[0]!.lines.length).toBeGreaterThan(1)
  })

  it('maps all five score levels to distinct heights', () => {
    const chart = layout('journey\nA: 1\nB: 2\nC: 3\nD: 4\nE: 5')
    const ys = chart.tasks.map(t => t.cy)
    expect(new Set(ys).size).toBe(5)
  })
})
