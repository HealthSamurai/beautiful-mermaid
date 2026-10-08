import { describe, expect, it } from 'bun:test'
import { parseFrontmatter } from '../frontmatter/parser.ts'
import { renderMermaidSVG } from '../index.ts'

// ============================================================================
// Frontmatter and init-directive tests
//
// Covers stripping the metadata Mermaid allows in front of a diagram body,
// the colour overrides it can carry, and the rule that explicit
// RenderOptions beat anything written inside the diagram.
// ============================================================================

describe('frontmatter parser — stripping', () => {
  it('removes a frontmatter block from the body', () => {
    const result = parseFrontmatter('---\ntitle: T\n---\nflowchart LR\n  A --> B')
    expect(result.body).toBe('flowchart LR\n  A --> B')
  })

  it('reads the title', () => {
    expect(parseFrontmatter('---\ntitle: My diagram\n---\npie\n"a": 1').title).toBe('My diagram')
  })

  it('strips quotes around a title', () => {
    expect(parseFrontmatter('---\ntitle: "Quoted title"\n---\npie').title).toBe('Quoted title')
  })

  it('strips single quotes around a title', () => {
    expect(parseFrontmatter("---\ntitle: 'Quoted title'\n---\npie").title).toBe('Quoted title')
  })

  it('leaves a body without frontmatter untouched', () => {
    const text = 'flowchart LR\n  A --> B'
    const result = parseFrontmatter(text)
    expect(result.body).toBe(text)
    expect(result.title).toBeUndefined()
  })

  it('ignores a --- that is not on the first line', () => {
    const text = 'flowchart LR\n---\ntitle: nope\n---'
    expect(parseFrontmatter(text).body).toBe(text)
  })

  it('removes an init directive from the body', () => {
    const result = parseFrontmatter("%%{init: {'theme': 'dark'}}%%\nflowchart LR\n  A --> B")
    expect(result.body).toBe('flowchart LR\n  A --> B')
  })

  it('removes an init directive placed after the header', () => {
    const result = parseFrontmatter("flowchart LR\n%%{init: {'theme': 'dark'}}%%\n  A --> B")
    expect(result.body).not.toContain('init')
    expect(result.body).toContain('flowchart LR')
  })

  it('handles both frontmatter and an init directive', () => {
    const result = parseFrontmatter(
      "---\ntitle: T\n---\n%%{init: {'theme': 'dark'}}%%\nflowchart LR"
    )
    expect(result.title).toBe('T')
    expect(result.body).toBe('flowchart LR')
  })

  it('ignores a YAML comment', () => {
    const result = parseFrontmatter('---\ntitle: T # a comment\n---\npie')
    expect(result.title).toBe('T')
  })

  it('tolerates an empty frontmatter block', () => {
    const result = parseFrontmatter('---\n\n---\nflowchart LR')
    expect(result.body).toBe('flowchart LR')
    expect(result.title).toBeUndefined()
  })

  it('handles CRLF line endings', () => {
    const result = parseFrontmatter('---\r\ntitle: T\r\n---\r\nflowchart LR')
    expect(result.title).toBe('T')
    expect(result.body.trim()).toBe('flowchart LR')
  })
})

describe('frontmatter parser — theme variables', () => {
  it('maps primaryColor onto the accent', () => {
    const result = parseFrontmatter(`---
config:
  themeVariables:
    primaryColor: "#ff0000"
---
pie`)
    expect(result.colors.accent).toBe('#ff0000')
  })

  it('maps background onto bg', () => {
    const result = parseFrontmatter(`---
config:
  themeVariables:
    background: "#1a1b26"
---
pie`)
    expect(result.colors.bg).toBe('#1a1b26')
  })

  it('maps lineColor onto line', () => {
    const result = parseFrontmatter(`---
config:
  themeVariables:
    lineColor: "#888888"
---
pie`)
    expect(result.colors.line).toBe('#888888')
  })

  it('reads theme variables from an init directive', () => {
    const result = parseFrontmatter(
      "%%{init: {'themeVariables': {'primaryColor': '#00ff00'}}}%%\npie"
    )
    expect(result.colors.accent).toBe('#00ff00')
  })

  it('applies a named theme as a baseline', () => {
    const result = parseFrontmatter("%%{init: {'theme': 'dark'}}%%\npie")
    expect(result.colors.bg).toBeDefined()
    expect(result.colors.fg).toBeDefined()
  })

  it('lets an explicit variable beat the named theme', () => {
    const result = parseFrontmatter(
      "%%{init: {'theme': 'dark', 'themeVariables': {'background': '#abcdef'}}}%%\npie"
    )
    expect(result.colors.bg).toBe('#abcdef')
  })

  it('accepts a 3-digit hex colour', () => {
    const result = parseFrontmatter("%%{init: {'themeVariables': {'primaryColor': '#f00'}}}%%\npie")
    expect(result.colors.accent).toBe('#f00')
  })

  it('accepts an rgb() colour', () => {
    const result = parseFrontmatter(
      "%%{init: {'themeVariables': {'primaryColor': 'rgb(255,0,0)'}}}%%\npie"
    )
    expect(result.colors.accent).toBe('rgb(255,0,0)')
  })

  it('accepts a colour keyword', () => {
    const result = parseFrontmatter("%%{init: {'themeVariables': {'primaryColor': 'red'}}}%%\npie")
    expect(result.colors.accent).toBe('red')
  })

  it('rejects a value that could break out of a style attribute', () => {
    const result = parseFrontmatter(
      '%%{init: {"themeVariables": {"primaryColor": "red;background:url(x)"}}}%%\npie'
    )
    expect(result.colors.accent).toBeUndefined()
  })

  it('ignores an unknown theme variable', () => {
    const result = parseFrontmatter(
      "%%{init: {'themeVariables': {'someUnknownThing': '#ff0000'}}}%%\npie"
    )
    expect(result.colors).toEqual({})
  })

  it('ignores an unknown named theme', () => {
    const result = parseFrontmatter("%%{init: {'theme': 'nonexistent'}}%%\npie")
    expect(result.colors).toEqual({})
  })

  it('does not treat a nested key named theme as a theme setting', () => {
    const result = parseFrontmatter(`---
config:
  themeVariables:
    theme: dark
---
pie`)
    expect(result.colors).toEqual({})
  })
})

describe('frontmatter integration — renderMermaidSVG', () => {
  it('renders a diagram with frontmatter', () => {
    const svg = renderMermaidSVG('---\ntitle: T\n---\npie\n"a": 1')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('uses the frontmatter title when the body has none', () => {
    const svg = renderMermaidSVG('---\ntitle: From frontmatter\n---\npie\n"a": 1')
    expect(svg).toContain('From frontmatter')
  })

  it('lets a body title beat the frontmatter title', () => {
    const svg = renderMermaidSVG('---\ntitle: From frontmatter\n---\npie\ntitle From body\n"a": 1')
    expect(svg).toContain('From body')
    expect(svg).not.toContain('From frontmatter')
  })

  it('applies the frontmatter title to a gantt chart', () => {
    const svg = renderMermaidSVG(`---
title: Project timeline
---
gantt
    dateFormat YYYY-MM-DD
    section Work
    Task :2024-01-01, 30d`)
    expect(svg).toContain('Project timeline')
  })

  it('applies the frontmatter title to a timeline', () => {
    const svg = renderMermaidSVG('---\ntitle: History\n---\ntimeline\n  2002 : LinkedIn')
    expect(svg).toContain('History')
  })

  it('applies the frontmatter title to a git graph', () => {
    const svg = renderMermaidSVG('---\ntitle: Releases\n---\ngitGraph\n  commit')
    expect(svg).toContain('Releases')
  })

  it('applies an init theme colour', () => {
    const svg = renderMermaidSVG(
      "%%{init: {'themeVariables': {'primaryColor': '#ff0000'}}}%%\npie\n\"a\": 1"
    )
    expect(svg).toContain('--accent:#ff0000')
  })

  it('applies a frontmatter background', () => {
    const svg = renderMermaidSVG(`---
config:
  themeVariables:
    background: "#123456"
---
pie
"a": 1`)
    expect(svg).toContain('--bg:#123456')
  })

  it('lets explicit RenderOptions beat in-diagram colours', () => {
    const svg = renderMermaidSVG(
      "%%{init: {'themeVariables': {'primaryColor': '#ff0000'}}}%%\npie\n\"a\": 1",
      { accent: '#00ff00' }
    )
    expect(svg).toContain('--accent:#00ff00')
    expect(svg).not.toContain('--accent:#ff0000')
  })

  it('does not leak the directive text into the SVG', () => {
    const svg = renderMermaidSVG("%%{init: {'theme': 'dark'}}%%\npie\n\"a\": 1")
    expect(svg).not.toContain('%%{')
    expect(svg).not.toContain('init:')
  })

  it('does not leak frontmatter keys into the SVG', () => {
    const svg = renderMermaidSVG('---\ntitle: T\nconfig:\n  theme: dark\n---\npie\n"a": 1')
    expect(svg).not.toContain('config')
    expect(svg).not.toContain('themeVariables')
  })

  it('still detects the diagram type after stripping metadata', () => {
    const svg = renderMermaidSVG('---\ntitle: T\n---\ngitGraph\n  commit')
    expect(svg).toContain('git-commit')
  })

  it('renders a flowchart with frontmatter', () => {
    const svg = renderMermaidSVG('---\ntitle: T\n---\nflowchart LR\n  A --> B')
    expect(svg).toStartWith('<svg')
    expect(svg).toContain('A')
    expect(svg).toContain('B')
  })

  it('renders a mindmap with frontmatter, keeping its indentation', () => {
    const svg = renderMermaidSVG('---\ntitle: T\n---\nmindmap\n  root\n    child')
    expect(svg).toContain('data-level="1"')
  })

  it('renders a sankey diagram with frontmatter', () => {
    const svg = renderMermaidSVG('---\ntitle: T\n---\nsankey-beta\nA,B,1')
    expect(svg).toContain('sankey-link')
  })
})
