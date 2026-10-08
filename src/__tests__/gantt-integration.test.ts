/**
 * End-to-end tests for gantt rendering through the public renderMermaidSVG API.
 *
 * Covers: diagram-type detection, valid SVG output, bars/milestones/sections,
 * axis labels, data attributes, theming and layout invariants.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseGanttDiagram } from '../gantt/parser.ts'
import { layoutGantt } from '../gantt/layout.ts'

const SIMPLE = `gantt
    title Карьера
    dateFormat YYYY-MM-DD
    section Работа
    META Group :done, 2011-05-01, 2019-12-31
    Air Liquide :active, 2023-09-01, 2026-10-07`

const FULL = `gantt
    title Project plan
    dateFormat YYYY-MM-DD
    axisFormat %b %Y
    section Design
    Research   :done, res1, 2024-01-01, 30d
    Wireframes :done, wf1, after res1, 2w
    section Build
    Backend    :active, be1, 2024-03-01, 2024-06-15
    Frontend   :crit, fe1, after be1, 45d
    Launch     :milestone, m1, 2024-08-01, 0d`

/** Layout a gantt source the same way renderMermaidSVG does. */
function layout(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return layoutGantt(parseGanttDiagram(lines))
}

// ============================================================================
// Detection and basic validity
// ============================================================================

describe('gantt – rendering', () => {
  it('renders the acceptance example without throwing', () => {
    expect(() => renderMermaidSVG(SIMPLE)).not.toThrow()
  })

  it('produces a well-formed SVG document', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 ')
  })

  it('balances every opened tag', () => {
    const svg = renderMermaidSVG(FULL)
    for (const tag of ['svg', 'style', 'text', 'title']) {
      const open = svg.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0
      const close = svg.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0
      expect(close).toBe(open)
    }
  })

  it('does not fall through to the flowchart parser', () => {
    // The flowchart parser throws "Invalid mermaid header" on a gantt source
    expect(() => renderMermaidSVG('gantt\n  section S\n  A :2024-01-01, 1d')).not.toThrow()
  })

  it('renders a header-only gantt without throwing', () => {
    expect(() => renderMermaidSVG('gantt')).not.toThrow()
  })
})

// ============================================================================
// Content
// ============================================================================

describe('gantt – content', () => {
  it('renders the title', () => {
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('Карьера')
    expect(svg).toContain('class="gantt-title"')
  })

  it('renders section labels', () => {
    const svg = renderMermaidSVG(FULL)
    expect(svg).toContain('>Design</text>')
    expect(svg).toContain('>Build</text>')
    expect(svg).toContain('class="gantt-section-label"')
  })

  it('renders one bar per non-milestone task', () => {
    const svg = renderMermaidSVG(FULL)
    const bars = svg.match(/class="gantt-bar /g)?.length ?? 0
    expect(bars).toBe(4)
  })

  it('renders a diamond path for a milestone', () => {
    const svg = renderMermaidSVG(FULL)
    expect(svg).toContain('class="gantt-milestone gantt-default"')
    expect(svg).toContain('>Launch</text>')
  })

  it('applies the status class to each bar', () => {
    const svg = renderMermaidSVG(FULL)
    expect(svg).toContain('gantt-bar gantt-done')
    expect(svg).toContain('gantt-bar gantt-active')
    expect(svg).toContain('gantt-bar gantt-crit')
  })

  it('renders axis labels using the declared axisFormat', () => {
    const svg = renderMermaidSVG(FULL)
    expect(svg).toContain('class="gantt-axis-label"')
    expect(svg).toContain('>Jan 2024<')
  })

  it('picks a sensible default axis format when none is declared', () => {
    // A 15-year span should fall back to bare years
    const svg = renderMermaidSVG(SIMPLE)
    expect(svg).toContain('>2013<')
    expect(svg).toContain('>2025<')
  })

  it('emits task id, start and end as data attributes', () => {
    const svg = renderMermaidSVG(FULL)
    expect(svg).toContain('data-task="be1"')
    expect(svg).toContain('data-start="2024-03-01"')
    expect(svg).toContain('data-end="2024-06-15"')
    expect(svg).toContain('data-task="m1"')
  })

  it('escapes XML special characters in labels', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      section R&D
      A <b> & B :2024-01-01, 30d`)
    expect(svg).toContain('R&amp;D')
    expect(svg).toContain('&lt;b&gt;')
    expect(svg).not.toContain('<b>')
  })
})

// ============================================================================
// Theming
// ============================================================================

describe('gantt – theming', () => {
  it('uses the provided bg/fg CSS variables', () => {
    const svg = renderMermaidSVG(SIMPLE, { bg: '#1a1b26', fg: '#a9b1d6' })
    expect(svg).toContain('--bg:#1a1b26')
    expect(svg).toContain('--fg:#a9b1d6')
  })

  it('passes the accent through to the status palette', () => {
    const svg = renderMermaidSVG(SIMPLE, { accent: '#7aa2f7' })
    expect(svg).toContain('--accent:#7aa2f7')
    expect(svg).toContain('--_gantt-accent: var(--accent')
  })

  it('omits the background style when transparent', () => {
    const svg = renderMermaidSVG(SIMPLE, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('hardcodes no literal colors in the drawn elements', () => {
    const svg = renderMermaidSVG(SIMPLE)
    // Literal hex values live only in the <style> blocks (theme vars + the
    // shared chart accent fallback). The drawn elements must be var()-driven.
    const body = svg.slice(svg.lastIndexOf('</style>'))
    expect(body).not.toMatch(/#[0-9a-fA-F]{6}/)
  })

  it('applies the requested font family', () => {
    const svg = renderMermaidSVG(SIMPLE, { font: 'Roboto' })
    expect(svg).toContain(`font-family: 'Roboto'`)
  })
})

// ============================================================================
// Layout invariants
// ============================================================================

describe('gantt – layout', () => {
  it('orders bars chronologically along the x axis', () => {
    const p = layout(FULL)
    const research = p.bars.find(b => b.label === 'Research')!
    const backend = p.bars.find(b => b.label === 'Backend')!
    expect(research.x).toBeLessThan(backend.x)
  })

  it('maps a longer task to a wider bar', () => {
    const p = layout(FULL)
    const wireframes = p.bars.find(b => b.label === 'Wireframes')!
    const backend = p.bars.find(b => b.label === 'Backend')!
    expect(backend.width).toBeGreaterThan(wireframes.width)
  })

  it('keeps every element inside the canvas', () => {
    const p = layout(FULL)
    for (const bar of p.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0)
      expect(bar.x + bar.width).toBeLessThanOrEqual(p.width)
      expect(bar.y + bar.height).toBeLessThanOrEqual(p.height)
    }
    for (const m of p.milestones) {
      expect(m.cx + m.radius).toBeLessThanOrEqual(p.width)
      expect(m.cy + m.radius).toBeLessThanOrEqual(p.height)
    }
  })

  it('gives each task its own row', () => {
    const p = layout(FULL)
    const centers = [...p.bars.map(b => b.y + b.height / 2), ...p.milestones.map(m => m.cy)]
    expect(new Set(centers).size).toBe(centers.length)
  })

  it('puts a short task label outside its bar and a long one inside', () => {
    const p = layout(FULL)
    expect(p.bars.find(b => b.label === 'Backend')!.labelOutside).toBe(false)
    expect(p.bars.find(b => b.label === 'Wireframes')!.labelOutside).toBe(true)
  })

  it('alternates the section band tint', () => {
    const p = layout(FULL)
    expect(p.sections.map(s => s.alternate)).toEqual([false, true])
  })

  it('generates axis ticks that stay within the plot area', () => {
    const p = layout(FULL)
    expect(p.axis.ticks.length).toBeGreaterThan(1)
    for (const tick of p.axis.ticks) {
      expect(tick.x).toBeGreaterThanOrEqual(p.plotArea.x)
      expect(tick.x).toBeLessThanOrEqual(p.plotArea.x + p.plotArea.width)
    }
  })

  it('keeps axis labels from colliding on a long span', () => {
    // 30 years of tasks must not produce one tick per month
    const p = layout(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :1995-01-01, 2025-01-01`)
    const gaps = p.axis.ticks.slice(1).map((t, i) => t.x - p.axis.ticks[i]!.x)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(50)
  })

  it('still produces a positive canvas for an empty diagram', () => {
    const p = layout('gantt')
    expect(p.width).toBeGreaterThan(0)
    expect(p.height).toBeGreaterThan(0)
    expect(p.bars).toHaveLength(0)
  })

  it('gives a one-day task a visible minimum width', () => {
    const p = layout(`gantt
      dateFormat YYYY-MM-DD
      section S
      Long  :2024-01-01, 2024-12-31
      Short :2024-06-01, 1d`)
    expect(p.bars[1]!.width).toBeGreaterThanOrEqual(4)
  })
})
