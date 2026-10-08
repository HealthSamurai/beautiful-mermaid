import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { parseGitGraphDiagram } from '../gitgraph/parser.ts'
import { layoutGitGraph } from '../gitgraph/layout.ts'

// ============================================================================
// Git graph end-to-end tests
//
// Checks that `gitGraph` routes through the dispatcher, produces well-formed
// SVG, and that the layout gives each branch its own lane with commits in
// sequence order.
// ============================================================================

const HISTORY = `gitGraph
    commit id: "init"
    commit id: "second"
    branch develop
    checkout develop
    commit id: "feature-a"
    commit id: "feature-b"
    checkout main
    merge develop tag: "v1.0"
    commit id: "after" type: HIGHLIGHT`

function layout(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return layoutGitGraph(parseGitGraphDiagram(lines))
}

describe('gitgraph integration — renderMermaidSVG', () => {
  it('renders a git graph to SVG', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(() => renderMermaidSVG(HISTORY)).not.toThrow()
    expect(renderMermaidSVG(HISTORY)).toContain('git-commit')
  })

  it('accepts the colon form of the header', () => {
    expect(renderMermaidSVG('gitGraph:\ncommit')).toContain('git-commit')
  })

  it('emits one node per commit', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg.match(/data-commit=/g)).toHaveLength(6)
  })

  it('emits one lane per used branch', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg.match(/class="git-lane/g)).toHaveLength(2)
  })

  it('renders every branch name', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg).toContain('main')
    expect(svg).toContain('develop')
  })

  it('renders commit labels', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg).toContain('init')
    expect(svg).toContain('feature-a')
  })

  it('renders a tag chip', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg).toContain('git-tag')
    expect(svg).toContain('v1.0')
  })

  it('marks the merge commit with its type', () => {
    expect(renderMermaidSVG(HISTORY)).toContain('data-type="merge"')
  })

  it('marks a highlight commit with its type', () => {
    expect(renderMermaidSVG(HISTORY)).toContain('data-type="highlight"')
  })

  it('draws a reverse commit crossed out', () => {
    const svg = renderMermaidSVG('gitGraph\ncommit type: REVERSE')
    expect(svg).toContain('git-reverse-mark')
  })

  it('draws a cherry-pick commit with a stalk', () => {
    const svg = renderMermaidSVG(`gitGraph
      commit id: "ZERO"
      branch develop
      commit id: "A"
      checkout main
      cherry-pick id: "A"`)
    expect(svg).toContain('git-cherry-stalk')
    expect(svg).toContain('cherry-pick:A')
  })

  it('emits an accessible <title> per commit', () => {
    expect(renderMermaidSVG(HISTORY)).toContain('<title>init</title>')
  })

  it('declares a colour variable per branch', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg).toContain('--git-color-0')
    expect(svg).toContain('--git-color-1')
  })

  it('maps branch 0 onto the theme accent', () => {
    expect(renderMermaidSVG(HISTORY)).toContain('--git-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(HISTORY, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    const svg = renderMermaidSVG(HISTORY, { transparent: true })
    expect(svg).not.toContain('background:var(--bg)')
  })

  it('renders the title when given', () => {
    expect(renderMermaidSVG('gitGraph\ntitle My history\ncommit')).toContain('My history')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('gitGraph\ncommit msg: "A & <B>"')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders an empty git graph without throwing', () => {
    const svg = renderMermaidSVG('gitGraph')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
    expect(svg.match(/<g /g)?.length ?? 0).toBe(svg.match(/<\/g>/g)?.length ?? 0)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(HISTORY)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(HISTORY)).toThrow(/not supported for gitgraph/)
  })
})

describe('gitgraph layout — horizontal (LR)', () => {
  it('positions every commit', () => {
    expect(layout(HISTORY).commits).toHaveLength(6)
  })

  it('gives each used branch its own lane', () => {
    const chart = layout(HISTORY)
    expect(chart.branches).toHaveLength(2)
    const ys = chart.branches.map(b => b.line.y1)
    expect(new Set(ys).size).toBe(2)
  })

  it('omits a lane for a branch with no commits', () => {
    const chart = layout('gitGraph\ncommit\nbranch unused')
    expect(chart.branches).toHaveLength(1)
  })

  it('advances commits rightwards in sequence order', () => {
    const chart = layout(HISTORY)
    for (let i = 1; i < chart.commits.length; i++) {
      expect(chart.commits[i]!.cx).toBeGreaterThan(chart.commits[i - 1]!.cx)
    }
  })

  it('puts commits of one branch on the same row', () => {
    const chart = layout(HISTORY)
    const develop = chart.commits.filter(c => ['feature-a', 'feature-b'].includes(c.id))
    expect(new Set(develop.map(c => c.cy)).size).toBe(1)
  })

  it('puts commits of different branches on different rows', () => {
    const chart = layout(HISTORY)
    const init = chart.commits.find(c => c.id === 'init')!
    const featureA = chart.commits.find(c => c.id === 'feature-a')!
    expect(init.cy).not.toBe(featureA.cy)
  })

  it('builds a connector per parent-child pair', () => {
    const chart = layout(HISTORY)
    // 5 single-parent links plus the merge's second parent
    expect(chart.edges).toHaveLength(6)
  })

  it('keeps every commit inside the canvas', () => {
    const chart = layout(HISTORY)
    for (const commit of chart.commits) {
      expect(commit.cx - commit.radius).toBeGreaterThanOrEqual(0)
      expect(commit.cy - commit.radius).toBeGreaterThanOrEqual(0)
      expect(commit.cx + commit.radius).toBeLessThanOrEqual(chart.width)
      expect(commit.cy + commit.radius).toBeLessThanOrEqual(chart.height)
    }
  })

  it('inherits the commit colour from its branch', () => {
    const chart = layout(HISTORY)
    const main = chart.branches.find(b => b.name === 'main')!
    const init = chart.commits.find(c => c.id === 'init')!
    expect(init.colorIndex).toBe(main.colorIndex)
  })

  it('places a tag chip above its commit', () => {
    const chart = layout(HISTORY)
    expect(chart.tags).toHaveLength(1)
    const tag = chart.tags[0]!
    const merge = chart.commits.find(c => c.type === 'merge')!
    expect(tag.y).toBeLessThan(merge.cy)
  })

  it('sizes a tag chip to its text', () => {
    const short = layout('gitGraph\ncommit tag: "v1"')
    const long = layout('gitGraph\ncommit tag: "release-candidate-1"')
    expect(long.tags[0]!.width).toBeGreaterThan(short.tags[0]!.width)
  })

  it('falls back to the commit id when there is no message', () => {
    const chart = layout('gitGraph\ncommit id: "abc"')
    expect(chart.commits[0]!.label).toBe('abc')
  })

  it('prefers the message over the id as the label', () => {
    const chart = layout('gitGraph\ncommit id: "abc" msg: "a message"')
    expect(chart.commits[0]!.label).toBe('a message')
  })

  it('widens the canvas as commits are added', () => {
    const few = layout('gitGraph\ncommit')
    const many = layout('gitGraph\ncommit\ncommit\ncommit\ncommit')
    expect(many.width).toBeGreaterThan(few.width)
  })

  it('returns an empty layout for a bare header', () => {
    const chart = layout('gitGraph')
    expect(chart.commits).toEqual([])
    expect(chart.edges).toEqual([])
  })
})

describe('gitgraph layout — vertical (TB / BT)', () => {
  it('runs lanes as columns in TB', () => {
    const chart = layout('gitGraph TB:\ncommit\nbranch b\ncheckout b\ncommit')
    expect(chart.direction).toBe('TB')
    const xs = chart.branches.map(b => b.line.x1)
    expect(new Set(xs).size).toBe(2)
  })

  it('advances commits downwards in TB', () => {
    const chart = layout('gitGraph TB:\ncommit\ncommit\ncommit')
    for (let i = 1; i < chart.commits.length; i++) {
      expect(chart.commits[i]!.cy).toBeGreaterThan(chart.commits[i - 1]!.cy)
    }
  })

  it('advances commits upwards in BT', () => {
    const chart = layout('gitGraph BT:\ncommit\ncommit\ncommit')
    for (let i = 1; i < chart.commits.length; i++) {
      expect(chart.commits[i]!.cy).toBeLessThan(chart.commits[i - 1]!.cy)
    }
  })

  it('keeps every commit inside the canvas in TB', () => {
    const chart = layout('gitGraph TB:\ncommit\nbranch b\ncheckout b\ncommit\ncommit')
    for (const commit of chart.commits) {
      expect(commit.cx - commit.radius).toBeGreaterThanOrEqual(0)
      expect(commit.cy - commit.radius).toBeGreaterThanOrEqual(0)
      expect(commit.cx + commit.radius).toBeLessThanOrEqual(chart.width)
      expect(commit.cy + commit.radius).toBeLessThanOrEqual(chart.height)
    }
  })

  it('renders a TB graph to valid SVG', () => {
    const svg = renderMermaidSVG('gitGraph TB:\ncommit\nbranch b\ncheckout b\ncommit')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })
})
