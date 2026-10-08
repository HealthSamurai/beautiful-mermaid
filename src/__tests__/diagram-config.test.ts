import { describe, expect, it } from 'bun:test'
import { parseFrontmatter } from '../frontmatter/parser.ts'
import { parsePieDiagram } from '../pie/parser.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { layoutPie } from '../pie/layout.ts'
import { layoutTimeline } from '../timeline/layout.ts'
import { renderMermaidSVG } from '../index.ts'

// ============================================================================
// Per-diagram config tests
//
// Mermaid nests diagram settings under `config.<type>`; these are the ones
// with a visible effect in this renderer: pie textPosition and timeline
// disableMulticolor.
// ============================================================================

function lines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
}

describe('frontmatter — diagram config parsing', () => {
  it('reads pie textPosition from frontmatter', () => {
    const result = parseFrontmatter('---\nconfig:\n  pie:\n    textPosition: 0.5\n---\npie')
    expect(result.config.pie?.textPosition).toBe(0.5)
  })

  it('reads pie textPosition from an init directive', () => {
    const result = parseFrontmatter("%%{init: {'pie': {'textPosition': 0.9}}}%%\npie")
    expect(result.config.pie?.textPosition).toBe(0.9)
  })

  it('accepts textPosition at the bounds', () => {
    expect(parseFrontmatter("%%{init: {'pie': {'textPosition': 0}}}%%\npie").config.pie?.textPosition).toBe(0)
    expect(parseFrontmatter("%%{init: {'pie': {'textPosition': 1}}}%%\npie").config.pie?.textPosition).toBe(1)
  })

  it('rejects a textPosition outside 0..1', () => {
    expect(parseFrontmatter("%%{init: {'pie': {'textPosition': 5}}}%%\npie").config.pie).toBeUndefined()
  })

  it('rejects a non-numeric textPosition', () => {
    expect(parseFrontmatter("%%{init: {'pie': {'textPosition': 'middle'}}}%%\npie").config.pie)
      .toBeUndefined()
  })

  it('reads timeline disableMulticolor from frontmatter', () => {
    const result = parseFrontmatter(
      '---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\ntimeline'
    )
    expect(result.config.timeline?.disableMulticolor).toBe(true)
  })

  it('reads timeline disableMulticolor from an init directive', () => {
    const result = parseFrontmatter("%%{init: {'timeline': {'disableMulticolor': true}}}%%\ntimeline")
    expect(result.config.timeline?.disableMulticolor).toBe(true)
  })

  it('reads a false disableMulticolor', () => {
    const result = parseFrontmatter(
      '---\nconfig:\n  timeline:\n    disableMulticolor: false\n---\ntimeline'
    )
    expect(result.config.timeline?.disableMulticolor).toBe(false)
  })

  it('accepts yes as true', () => {
    const result = parseFrontmatter('---\nconfig:\n  timeline:\n    disableMulticolor: yes\n---\ntimeline')
    expect(result.config.timeline?.disableMulticolor).toBe(true)
  })

  it('leaves config empty when nothing is declared', () => {
    expect(parseFrontmatter('pie\n"a": 1').config).toEqual({})
  })

  it('does not pick up textPosition outside a pie block', () => {
    const result = parseFrontmatter('---\nconfig:\n  textPosition: 0.5\n---\npie')
    expect(result.config.pie).toBeUndefined()
  })

  it('reads both diagram blocks at once', () => {
    const result = parseFrontmatter(`---
config:
  pie:
    textPosition: 0.4
  timeline:
    disableMulticolor: true
---
pie`)
    expect(result.config.pie?.textPosition).toBe(0.4)
    expect(result.config.timeline?.disableMulticolor).toBe(true)
  })

  it('keeps config separate from colours', () => {
    const result = parseFrontmatter(`---
config:
  theme: dark
  pie:
    textPosition: 0.4
---
pie`)
    expect(result.config.pie?.textPosition).toBe(0.4)
    expect(result.colors.bg).toBeDefined()
  })
})

describe('pie — textPosition', () => {
  const PIE = 'pie\n"Dogs" : 50\n"Cats" : 50'

  it('moves percentage labels outwards', () => {
    const near = layoutPie({ ...parsePieDiagram(lines(PIE)), textPosition: 0.2 })
    const far = layoutPie({ ...parsePieDiagram(lines(PIE)), textPosition: 0.9 })

    const distance = (chart: typeof near) => {
      const label = chart.slices[0]!.percentLabel!
      return Math.hypot(label.x - chart.center.cx, label.y - chart.center.cy)
    }

    expect(distance(far)).toBeGreaterThan(distance(near))
  })

  it('puts labels at the centre with textPosition 0', () => {
    const chart = layoutPie({ ...parsePieDiagram(lines(PIE)), textPosition: 0 })
    const label = chart.slices[0]!.percentLabel!
    expect(label.x).toBeCloseTo(chart.center.cx, 5)
    expect(label.y).toBeCloseTo(chart.center.cy, 5)
  })

  it('uses its own default without a textPosition', () => {
    const chart = layoutPie(parsePieDiagram(lines(PIE)))
    const label = chart.slices[0]!.percentLabel!
    expect(label.x).not.toBeCloseTo(chart.center.cx, 5)
  })

  it('applies textPosition through renderMermaidSVG', () => {
    const plain = renderMermaidSVG(PIE)
    const moved = renderMermaidSVG(`---\nconfig:\n  pie:\n    textPosition: 0.2\n---\n${PIE}`)
    expect(moved).not.toBe(plain)
    expect(moved).toStartWith('<svg')
  })

  it('still renders every percentage wedge label', () => {
    const svg = renderMermaidSVG(`---\nconfig:\n  pie:\n    textPosition: 0.95\n---\n${PIE}`)
    // Two wedge labels plus the accessible title, which also carries a percent
    expect(svg.match(/50%/g)!.length).toBeGreaterThanOrEqual(2)
  })
})

describe('timeline — disableMulticolor', () => {
  const TIMELINE = `timeline
    section Early
      2002 : LinkedIn
    section Mobile
      2010 : Instagram`

  it('gives each section its own colour by default', () => {
    const chart = layoutTimeline(parseTimelineDiagram(lines(TIMELINE)))
    expect(chart.sections.map(s => s.colorIndex)).toEqual([0, 1])
  })

  it('collapses every section onto one colour when disabled', () => {
    const diagram = { ...parseTimelineDiagram(lines(TIMELINE)), disableMulticolor: true }
    const chart = layoutTimeline(diagram)
    expect(chart.sections.map(s => s.colorIndex)).toEqual([0, 0])
  })

  it('collapses period colours too', () => {
    const diagram = { ...parseTimelineDiagram(lines(TIMELINE)), disableMulticolor: true }
    const chart = layoutTimeline(diagram)
    expect(new Set(chart.periods.map(p => p.colorIndex)).size).toBe(1)
  })

  it('works in the vertical orientation', () => {
    const diagram = {
      ...parseTimelineDiagram(lines(TIMELINE.replace('timeline', 'timeline vertical'))),
      disableMulticolor: true,
    }
    const chart = layoutTimeline(diagram)
    expect(chart.sections.map(s => s.colorIndex)).toEqual([0, 0])
  })

  it('declares only one colour variable when disabled', () => {
    const svg = renderMermaidSVG(
      `---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\n${TIMELINE}`
    )
    expect(svg).toContain('--timeline-color-0')
    expect(svg).not.toContain('--timeline-color-1')
  })

  it('declares one colour variable per section by default', () => {
    const svg = renderMermaidSVG(TIMELINE)
    expect(svg).toContain('--timeline-color-0')
    expect(svg).toContain('--timeline-color-1')
  })

  it('renders valid SVG with the setting applied', () => {
    const svg = renderMermaidSVG(
      `---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\n${TIMELINE}`
    )
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
    expect(svg).toContain('LinkedIn')
    expect(svg).toContain('Instagram')
  })
})
