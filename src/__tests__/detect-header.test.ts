import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

// ============================================================================
// Diagram type detection
//
// detectDiagramType() reads one line of the source and decides which of the
// nineteen pipelines renders it. Two things have to hold:
//
//   - the line it reads is the header, not whatever happens to come first:
//     frontmatter, `%%{init}%%` directives and `%%` comments all legally
//     precede it;
//   - a keyword matches its own type only, so `timelineX` is not a timeline
//     and `blocked` is not a block diagram.
//
// The type is checked through the rendered output rather than by calling the
// private detector, so these assert the routing a caller actually gets.
// ============================================================================

/** The class-name prefix each renderer stamps on its elements. */
function renderedType(svg: string): string {
  const prefixes = [...new Set([...svg.matchAll(/class="([a-z0-9]+)-/g)].map(m => m[1]))]
  return prefixes.join(',') || 'flowchart'
}

/** One minimal, valid source per diagram type, with the type it must produce. */
const SOURCES: [string, string, string][] = [
  ['flowchart', 'graph TD\n  A-->B', 'flowchart'],
  ['class', 'classDiagram\n  class A', 'class'],
  ['er', 'erDiagram\n  A ||--o{ B : has', 'er'],
  ['xychart', 'xychart-beta\n  x-axis [a]\n  bar [1]', 'xychart'],
  ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  section S\n  A :a, 2024-01-01, 5d', 'gantt'],
  ['timeline', 'timeline\n  2021 : E', 'timeline'],
  ['pie', 'pie\n  "A" : 1', 'pie'],
  ['journey', 'journey\n  section S\n    T: 5: Me', 'journey'],
  ['quadrant', 'quadrantChart\n  P: [0.5, 0.5]', 'quadrant'],
  ['mindmap', 'mindmap\n  root((R))', 'mindmap'],
  ['sankey', 'sankey-beta\nA,B,1', 'sankey'],
  ['gitgraph', 'gitGraph\n  commit', 'git'],
  ['block', 'block-beta\n  A', 'block'],
  ['radar', 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}', 'radar'],
  ['kanban', 'kanban\n  c[Todo]', 'kanban'],
  ['treemap', 'treemap-beta\n"R"\n    "A": 1', 'treemap'],
  [
    'requirement',
    'requirementDiagram\n  requirement r {\n  id: 1\n  text: t\n  risk: low\n  verifymethod: test\n  }',
    'req',
  ],
  ['c4', 'C4Context\n  Person(u, "U", "d")', 'c4'],
]

describe('diagram type detection', () => {
  for (const [name, source, expected] of SOURCES) {
    it(`routes ${name} to its own renderer`, () => {
      expect(renderedType(renderMermaidSVG(source))).toBe(expected)
    })
  }
})

describe('the header survives what may precede it', () => {
  for (const [name, source, expected] of SOURCES) {
    it(`detects ${name} behind a leading comment`, () => {
      // A commented-out note above a diagram must not change its type.
      expect(renderedType(renderMermaidSVG(`%% a leading note\n${source}`))).toBe(expected)
    })
  }

  for (const [name, source, expected] of SOURCES) {
    it(`detects ${name} behind YAML frontmatter`, () => {
      expect(renderedType(renderMermaidSVG(`---\ntitle: T\n---\n${source}`))).toBe(expected)
    })
  }

  it('detects a type behind an init directive', () => {
    const svg = renderMermaidSVG('%%{init: {"theme":"dark"}}%%\ntimeline\n  2021 : E')
    expect(renderedType(svg)).toBe('timeline')
  })

  it('detects a type behind frontmatter, a directive and a comment at once', () => {
    const svg = renderMermaidSVG(
      '---\ntitle: T\n---\n%%{init: {"theme":"dark"}}%%\n%% note\npie\n  "A" : 1',
    )
    expect(renderedType(svg)).toBe('pie')
  })

  it('detects a type behind blank lines', () => {
    expect(renderedType(renderMermaidSVG('\n\n\npie\n  "A" : 1'))).toBe('pie')
  })
})

describe('a keyword matches its own type only', () => {
  // Each of these starts with a real type keyword but is not that type, so a
  // prefix match without a word boundary would silently mis-route it.
  const IMPOSTORS = [
    'treemapish',
    'timelineX',
    'ganttish',
    'piechart',
    'blocked',
    'radarX',
    'kanbanboard',
    'C4Contextual',
  ]

  for (const header of IMPOSTORS) {
    it(`does not treat ${header} as a diagram type`, () => {
      // It falls through to the flowchart parser, which rejects the header.
      expect(() => renderMermaidSVG(`${header}\n  A-->B`)).toThrow('Invalid mermaid header')
    })
  }
})

describe('versioned and suffixed headers', () => {
  it('accepts classDiagram-v2 as a class diagram', () => {
    expect(renderedType(renderMermaidSVG('classDiagram-v2\n  class A'))).toBe('class')
  })

  it('accepts the -beta spellings', () => {
    expect(renderedType(renderMermaidSVG('sankey-beta\nA,B,1'))).toBe('sankey')
    expect(renderedType(renderMermaidSVG('treemap-beta\n"R"\n    "A": 1'))).toBe('treemap')
  })

  it('accepts the bare spellings of the -beta types', () => {
    expect(renderedType(renderMermaidSVG('sankey\nA,B,1'))).toBe('sankey')
    expect(renderedType(renderMermaidSVG('xychart\n  x-axis [a]\n  bar [1]'))).toBe('xychart')
  })

  it('accepts every C4 level', () => {
    for (const level of ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']) {
      expect(renderedType(renderMermaidSVG(`${level}\n  Person(u, "U", "d")`))).toBe('c4')
    }
  })

  it('ignores header case', () => {
    expect(renderedType(renderMermaidSVG('GANTT\n  dateFormat YYYY-MM-DD\n  section S\n  A :a, 2024-01-01, 5d'))).toBe('gantt')
    expect(renderedType(renderMermaidSVG('TimeLine\n  2021 : E'))).toBe('timeline')
  })
})
