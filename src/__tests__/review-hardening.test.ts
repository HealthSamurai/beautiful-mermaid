import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseGanttDiagram } from '../gantt/parser.ts'
import { addDuration, parseDuration } from '../gantt/dates.ts'

// ============================================================================
// Review hardening — untrusted input must not escape its SVG context
//
// A diagram body is author-supplied text that ends up inside an SVG served to
// a reader. Every case here is a concrete way that text used to leave the
// context it was written into: a CSS value becoming a network request, a
// `$link` becoming script execution, a duration becoming an exception.
//
// These are regression tests, not style preferences: each one failed before
// the accompanying fix.
// ============================================================================

function parse(text: string) {
  return parseGanttDiagram(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  )
}

// ---------------------------------------------------------------------------
// CSS value injection
//
// classDef/style values land in `fill`/`stroke` attributes. `url(...)` there
// is a live fetch, so a diagram could phone home or pull a tracking pixel
// just by being rendered. Colours are the only thing these slots need.
// ---------------------------------------------------------------------------

describe('style values cannot carry url() or expressions', () => {
  const EVIL = 'url(http://evil.example/pixel.png)'

  it('drops a url() fill from a flowchart classDef', () => {
    const svg = renderMermaidSVG(`graph TD\n  A --> B\n  classDef e fill:${EVIL}\n  class A e`)
    expect(svg).not.toContain('evil.example')
  })

  it('drops a url() fill from a flowchart style statement', () => {
    const svg = renderMermaidSVG(`graph TD\n  A --> B\n  style A fill:${EVIL}`)
    expect(svg).not.toContain('evil.example')
  })

  it('drops a url() stroke from linkStyle', () => {
    const svg = renderMermaidSVG(`graph TD\n  A --> B\n  linkStyle 0 stroke:${EVIL}`)
    expect(svg).not.toContain('evil.example')
  })

  it('drops a CSS expression() from a classDef stroke', () => {
    const svg = renderMermaidSVG(
      `graph TD\n  A --> B\n  classDef e stroke:expression(alert(1))\n  class A e`
    )
    expect(svg).not.toContain('expression(')
  })

  it('drops a url() fill from a kanban classDef', () => {
    const svg = renderMermaidSVG(`kanban\n  c1[Col]\n    t1[T]:::e\n  classDef e fill:${EVIL}`)
    expect(svg).not.toContain('evil.example')
  })

  it('drops a url() fill from a block style statement', () => {
    const svg = renderMermaidSVG(`block-beta\n  A\n  style A fill:${EVIL}`)
    expect(svg).not.toContain('evil.example')
  })

  it('drops a url() fill from a treemap classDef', () => {
    const svg = renderMermaidSVG(`treemap-beta\n  "r"\n    "a": 5:::e\n  classDef e fill:${EVIL}`)
    expect(svg).not.toContain('evil.example')
  })

  it('drops a url() bgColor from C4 UpdateElementStyle', () => {
    const svg = renderMermaidSVG(
      `C4Context\n  Person(a, "A")\n  UpdateElementStyle(a, $bgColor="${EVIL}")`
    )
    expect(svg).not.toContain('evil.example')
  })

  it('drops a url() lineColor from C4 UpdateRelStyle', () => {
    const svg = renderMermaidSVG(
      `C4Context\n  Person(a,"A")\n  Person(b,"B")\n  Rel(a,b,"r")\n` +
      `  UpdateRelStyle(a, b, $lineColor="${EVIL}")`
    )
    expect(svg).not.toContain('evil.example')
  })

  it('still honours ordinary colour values', () => {
    const svg = renderMermaidSVG(`graph TD\n  A --> B\n  style A fill:#ff0000,stroke:red`)
    expect(svg).toContain('#ff0000')
  })

  it('still honours var() and color-mix() theme references', () => {
    const svg = renderMermaidSVG(`graph TD\n  A --> B\n  style A fill:var(--bg)`)
    expect(svg).toContain('var(--bg)')
  })
})

// ---------------------------------------------------------------------------
// C4 $link
//
// The only renderer that emits an <a href>. A `javascript:` URL there runs on
// click in any SVG embedded inline in a page.
// ---------------------------------------------------------------------------

describe('C4 $link only accepts safe URL schemes', () => {
  const linkOf = (url: string) =>
    renderMermaidSVG(`C4Context\n  Person(a, "A", "d", $link="${url}")`).match(/<a href="([^"]*)"/)?.[1]

  it('rejects a javascript: URL', () => {
    const svg = renderMermaidSVG(`C4Context\n  Person(a, "A", "d", $link="javascript:alert(1)")`)
    expect(svg).not.toContain('javascript:')
  })

  it('rejects a javascript: URL whatever the case', () => {
    const svg = renderMermaidSVG(`C4Context\n  Person(a, "A", "d", $link="JaVaScRiPt:alert(1)")`)
    expect(svg.toLowerCase()).not.toContain('javascript:')
  })

  it('rejects a javascript: URL padded with whitespace or control characters', () => {
    const svg = renderMermaidSVG(`C4Context\n  Person(a, "A", "d", $link="  java\tscript:alert(1)")`)
    expect(svg.toLowerCase().replace(/\s/g, '')).not.toContain('javascript:')
  })

  it('rejects vbscript: and data: URLs', () => {
    expect(linkOf('vbscript:msgbox')).toBeUndefined()
    expect(linkOf('data:text/html,<b>x</b>')).toBeUndefined()
  })

  it('keeps http, https, mailto and relative links', () => {
    expect(linkOf('https://example.com/x')).toBe('https://example.com/x')
    expect(linkOf('http://example.com/x')).toBe('http://example.com/x')
    expect(linkOf('mailto:a@example.com')).toBe('mailto:a@example.com')
    expect(linkOf('/docs/x')).toBe('/docs/x')
  })
})

// ---------------------------------------------------------------------------
// Gantt duration overflow
//
// A duration big enough to push the timestamp past the Date range used to
// throw RangeError out of the renderer. A diagram with a silly number in it
// should still draw.
// ---------------------------------------------------------------------------

describe('gantt survives out-of-range durations', () => {
  it('renders a task with an absurd day count instead of throwing', () => {
    const svg = renderMermaidSVG(
      `gantt\n  dateFormat YYYY-MM-DD\n  section S\n  T :a1, 2024-01-01, 999999999d`
    )
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('NaN')
  })

  it('renders a task with an absurd year count instead of throwing', () => {
    const svg = renderMermaidSVG(
      `gantt\n  dateFormat YYYY-MM-DD\n  section S\n  T :a1, 2024-01-01, 99999999y`
    )
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('NaN')
  })

  it('clamps addDuration to a representable timestamp', () => {
    const t = addDuration(Date.UTC(2024, 0, 1), { amount: 1e12, unit: 'd' })
    expect(Number.isFinite(t)).toBe(true)
    expect(() => new Date(t).toISOString()).not.toThrow()
  })

  it('clamps a negative overflow the same way', () => {
    const t = addDuration(Date.UTC(2024, 0, 1), { amount: -1e12, unit: 'y' })
    expect(() => new Date(t).toISOString()).not.toThrow()
  })

  it('still rejects a non-duration token', () => {
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Gantt task metadata splitting
//
// Upstream's lexer takes the task text as `[^:\n]+` — everything up to the
// FIRST colon — and we match that. But a label is frequently written with a
// clock time in it, and splitting "Meeting 10:30" into label "Meeting 10"
// with id "30 standup" is a silently wrong diagram rather than a parse error.
// A colon that is not followed by metadata belongs to the label.
// ---------------------------------------------------------------------------

describe('gantt task labels containing a colon', () => {
  it('keeps a clock time in the label', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      Standup at 10:30 :a1, 2024-01-01, 1d`)
    expect(d.tasks).toHaveLength(1)
    expect(d.tasks[0]!.label).toBe('Standup at 10:30')
    expect(d.tasks[0]!.id).toBe('a1')
  })

  it('does not invent a task out of a trailing colon', () => {
    const d = parse(`gantt\n  dateFormat YYYY-MM-DD\n  section S\n  Just a label :`)
    expect(d.tasks).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gantt `click`
//
// Upstream accepts `click <id> href "<url>"` / `call fn()`. We do not render
// interactivity, but swallowing the line as a TASK puts a bogus bar named
// `click a1 href "https` on the chart — visible, wrong, and confusing.
// Skipping it is the honest degradation.
// ---------------------------------------------------------------------------

describe('gantt click lines are not tasks', () => {
  it('ignores click ... href', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :a1, 2024-01-01, 1d
      click a1 href "https://example.com"`)
    expect(d.tasks).toHaveLength(1)
    expect(d.tasks[0]!.label).toBe('A')
  })

  it('ignores click ... call', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :a1, 2024-01-01, 1d
      click a1 call fn("x")`)
    expect(d.tasks).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Duplicate task ids
//
// `byId` is last-write-wins, so a second task reusing an id silently steals
// every later `after`/`until` reference. Upstream keeps the FIRST binding.
// ---------------------------------------------------------------------------

describe('gantt duplicate task ids', () => {
  it('resolves after/until against the first task holding the id', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :a1, 2024-01-01, 1d
      B :a1, 2024-06-01, 1d
      C :c1, after a1, 1d`)
    const c = d.tasks.find(t => t.label === 'C')!
    // A ends 2024-01-02, so C starts there — not after the second a1.
    expect(new Date(c.start).toISOString().slice(0, 10)).toBe('2024-01-02')
  })
})

// ---------------------------------------------------------------------------
// Inline comment consistency
//
// Upstream's sequence and journey lexers skip `%%...` anywhere on a line.
// Three of our parsers rendered the comment as part of a label instead.
// ---------------------------------------------------------------------------

describe('trailing %% comments never reach the output', () => {
  it('strips an inline comment from a sequence message', () => {
    const svg = renderMermaidSVG(`sequenceDiagram\n  A->>B: hi %% note`)
    expect(svg).not.toContain('%%')
    expect(svg).not.toContain('note')
  })

  it('strips an inline comment from a journey task', () => {
    const svg = renderMermaidSVG(`journey\n  section S\n    Task: 5: Me %% note`)
    expect(svg).not.toContain('%%')
    expect(svg).not.toContain('note')
  })

  it('strips an inline comment from an ER relationship label', () => {
    const svg = renderMermaidSVG(`erDiagram\n  A ||--o{ B : has %% note`)
    expect(svg).not.toContain('%%')
    expect(svg).not.toContain('note')
  })

  it('keeps a %% that is inside a quoted sequence message', () => {
    const svg = renderMermaidSVG(`sequenceDiagram\n  A->>B: 50%% done`)
    expect(svg).toContain('50')
  })
})

// ---------------------------------------------------------------------------
// Mindmap classDef
//
// `classDef` is not mindmap syntax upstream, but agents write it anyway by
// analogy with flowcharts. Treating it as a NODE made the parser throw
// "There can be only one root", killing the whole diagram.
// ---------------------------------------------------------------------------

describe('mindmap tolerates flowchart-style classDef lines', () => {
  it('renders the mindmap instead of throwing', () => {
    const svg = renderMermaidSVG(`mindmap\n  root((r))\n    a:::urgent\n  classDef urgent fill:#f00`)
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('classDef')
  })
})
