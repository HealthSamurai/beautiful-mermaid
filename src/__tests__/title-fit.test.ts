import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'

// ============================================================================
// Title fit tests
//
// Every diagram type centres its title on `width / 2`. If the canvas is sized
// only from the content, a title longer than the content bleeds past both
// edges of the viewBox and is clipped by any host that honours the viewBox.
//
// These tests measure the rendered title with the same text metrics the
// layouts use, reconstruct its horizontal extent from the real `x` and
// `text-anchor`, and assert it lands inside the canvas.
// ============================================================================

/** A title long enough to exceed the natural content width of every type. */
const LONG_TITLE = 'Quite A Long Diagram Title For Testing Canvas Width Accounting Behaviour'

/** The horizontal extent of the rendered title, in canvas coordinates. */
function titleExtent(svg: string, needle: string): { left: number; right: number; canvas: number } {
  const canvas = Number(svg.match(/viewBox="0 0 ([\d.]+) [\d.]+"/)![1])

  const tag = [...svg.matchAll(/<text\b([^>]*)>(.*?)<\/text>/gs)]
    .find(match => match[2]!.includes(needle))
  if (!tag) throw new Error(`no <text> containing ${JSON.stringify(needle)}`)

  const attrs = tag[1]!
  const body = tag[2]!.replace(/<[^>]+>/g, '')
  const x = Number(attrs.match(/\sx="([\d.-]+)"/)?.[1] ?? '0')
  const fontSize = Number(attrs.match(/font-size="([\d.]+)"/)?.[1] ?? '16')
  const fontWeight = Number(attrs.match(/font-weight="([\d.]+)"/)?.[1] ?? '400')
  const anchor = attrs.match(/text-anchor="(\w+)"/)?.[1] ?? 'start'

  const width = estimateTextWidth(body, fontSize, fontWeight)
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
  return { left, right: left + width, canvas }
}

/** Sources that carry the title in their own syntax. */
const NATIVE_TITLE: [string, string][] = [
  ['gantt', `gantt\n  title ${LONG_TITLE}\n  dateFormat YYYY-MM-DD\n  section S\n  A :a, 2024-01-01, 5d`],
  ['timeline', `timeline\n  title ${LONG_TITLE}\n  2021 : E`],
  ['pie', `pie title ${LONG_TITLE}\n  "A" : 1`],
  ['journey', `journey\n  title ${LONG_TITLE}\n  section S\n    Task: 5: Me`],
  ['quadrant', `quadrantChart\n  title ${LONG_TITLE}\n  P: [0.5, 0.5]`],
  ['radar', `radar-beta\n  title ${LONG_TITLE}\n  axis a, b, c\n  curve x{1, 2, 3}`],
  ['treemap', `treemap-beta\n  title ${LONG_TITLE}\n"R"\n    "A": 1`],
  ['c4', `C4Context\n  title ${LONG_TITLE}\n  Person(u, "U", "d")`],
]

/** Sources whose title can only arrive through YAML frontmatter. */
const FRONTMATTER_TITLE: [string, string][] = [
  ['block', `block-beta\n  A B`],
  ['gitgraph', `gitGraph\n  commit`],
  ['kanban', `kanban\n  col[Todo]\n    t[Task]`],
  ['requirement', `requirementDiagram\n  requirement r {\n  id: 1\n  text: t\n  risk: low\n  verifymethod: test\n  }`],
]

describe('title fits inside the canvas', () => {
  for (const [name, source] of NATIVE_TITLE) {
    it(`keeps a long ${name} title inside the viewBox`, () => {
      const { left, right, canvas } = titleExtent(renderMermaidSVG(source), 'Quite A Long')
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeLessThanOrEqual(canvas)
    })
  }

  for (const [name, source] of FRONTMATTER_TITLE) {
    it(`keeps a long frontmatter title inside the ${name} viewBox`, () => {
      const svg = renderMermaidSVG(`---\ntitle: ${LONG_TITLE}\n---\n${source}`)
      const { left, right, canvas } = titleExtent(svg, 'Quite A Long')
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeLessThanOrEqual(canvas)
    })
  }

  it('also fits a pathologically long title', () => {
    const huge = 'Supercalifragilistic '.repeat(15).trim()
    const svg = renderMermaidSVG(`pie title ${huge}\n  "A" : 1`)
    const { left, right, canvas } = titleExtent(svg, 'Supercalifragilistic')
    expect(left).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(canvas)
  })

  it('does not widen the canvas for a title the content already covers', () => {
    // A short title must leave the content-derived width untouched, otherwise
    // every existing diagram would silently change size.
    const withTitle = renderMermaidSVG('gantt\n  title T\n  dateFormat YYYY-MM-DD\n  section S\n  A :a, 2024-01-01, 5d')
    const without = renderMermaidSVG('gantt\n  dateFormat YYYY-MM-DD\n  section S\n  A :a, 2024-01-01, 5d')
    const widthOf = (svg: string) => svg.match(/viewBox="0 0 ([\d.]+)/)![1]
    expect(widthOf(withTitle)).toBe(widthOf(without))
  })
})

describe('widthForTitle', () => {
  it('returns the content width when there is no title', () => {
    expect(widthForTitle(300, undefined, 18, 600, 24)).toBe(300)
  })

  it('returns the content width when the title already fits', () => {
    expect(widthForTitle(600, 'T', 18, 600, 24)).toBe(600)
  })

  it('grows to the title plus padding on both sides', () => {
    const title = 'A title wider than the content'
    const expected = estimateTextWidth(title, 18, 600) + 24 * 2
    expect(widthForTitle(100, title, 18, 600, 24)).toBeCloseTo(expected, 6)
  })
})
