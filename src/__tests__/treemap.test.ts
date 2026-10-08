import { describe, expect, it } from 'bun:test'
import { parseTreemapDiagram, compileClass } from '../treemap/parser.ts'
import { formatValue, layoutTreemap, squarify, totalValue } from '../treemap/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

// ============================================================================
// Treemap tests
//
// The buildHierarchy cases come from
// packages/mermaid/src/diagrams/treemap/utils.test.ts, restated against this
// parser: upstream builds the hierarchy from an already-tokenised flat list,
// so the equivalent here is the indented source that would produce it.
// ============================================================================

/** The parsed shape, stripped of empty fields, so a case reads as a tree. */
function tree(text: string): unknown {
  const simplify = (nodes: ReturnType<typeof parseTreemapDiagram>['nodes']): unknown[] =>
    nodes.map(node => node.children.length > 0
      ? { name: node.name, children: simplify(node.children) }
      : node.value !== undefined
        ? { name: node.name, value: node.value }
        : { name: node.name, children: [] })
  return simplify(parseTreemapDiagram(text).nodes)
}

describe('treemap parser — hierarchy', () => {
  it('should convert an indented source into a hierarchical structure', () => {
    expect(tree(`treemap-beta
"Root"
    "Branch 1"
        "Leaf 1.1": 10
        "Leaf 1.2": 15
    "Branch 2"
        "Leaf 2.1": 20
        "Leaf 2.2": 25
        "Leaf 2.3": 30`)).toEqual([
      {
        name: 'Root',
        children: [
          {
            name: 'Branch 1',
            children: [
              { name: 'Leaf 1.1', value: 10 },
              { name: 'Leaf 1.2', value: 15 },
            ],
          },
          {
            name: 'Branch 2',
            children: [
              { name: 'Leaf 2.1', value: 20 },
              { name: 'Leaf 2.2', value: 25 },
              { name: 'Leaf 2.3', value: 30 },
            ],
          },
        ],
      },
    ])
  })

  it('should handle empty input', () => {
    expect(tree('treemap-beta')).toEqual([])
  })

  it('should handle only root nodes', () => {
    expect(tree('treemap-beta\n"Root 1"\n"Root 2"')).toEqual([
      { name: 'Root 1', children: [] },
      { name: 'Root 2', children: [] },
    ])
  })

  it('should handle complex nesting levels', () => {
    expect(tree(`treemap-beta
"Root"
  "Level 1"
    "Level 2"
      "Leaf 1": 10
    "Level 2 again"
      "Leaf 2": 20`)).toEqual([
      {
        name: 'Root',
        children: [
          {
            name: 'Level 1',
            children: [
              { name: 'Level 2', children: [{ name: 'Leaf 1', value: 10 }] },
              { name: 'Level 2 again', children: [{ name: 'Leaf 2', value: 20 }] },
            ],
          },
        ],
      },
    ])
  })

  it('does not care what the indentation step is', () => {
    const two = tree('treemap-beta\n"A"\n  "B": 1')
    const eight = tree('treemap-beta\n"A"\n        "B": 1')
    expect(two).toEqual(eight)
  })

  it('closes a leaf, so a sibling at a deeper indent is not its child', () => {
    expect(tree('treemap-beta\n"A"\n  "B": 1\n    "C": 2')).toEqual([
      { name: 'A', children: [{ name: 'B', value: 1 }, { name: 'C', value: 2 }] },
    ])
  })

  it('accepts the plain treemap header', () => {
    expect(tree('treemap\n"A": 1')).toEqual([{ name: 'A', value: 1 }])
  })

  it('ignores anything before the header', () => {
    expect(tree('\n\ntreemap-beta\n"A": 1')).toEqual([{ name: 'A', value: 1 }])
  })

  it('ignores comment lines and blank lines', () => {
    expect(tree('treemap-beta\n%% a note\n\n"A": 1\n')).toEqual([{ name: 'A', value: 1 }])
  })
})

describe('treemap parser — nodes', () => {
  it('reads an unquoted name', () => {
    expect(parseTreemapDiagram('treemap-beta\nPayroll: 400').nodes[0]).toMatchObject({
      name: 'Payroll', value: 400,
    })
  })

  it('reads a quoted name', () => {
    expect(parseTreemapDiagram('treemap-beta\n"Payroll": 400').nodes[0]!.name).toBe('Payroll')
  })

  it('keeps a colon inside a quoted name', () => {
    const node = parseTreemapDiagram('treemap-beta\n"Q1: revenue": 10').nodes[0]!
    expect(node.name).toBe('Q1: revenue')
    expect(node.value).toBe(10)
  })

  it('keeps a %% inside a quoted name', () => {
    expect(parseTreemapDiagram('treemap-beta\n"Up 50%% YoY": 10').nodes[0]!.name)
      .toBe('Up 50%% YoY')
  })

  it('strips a trailing comment outside quotes', () => {
    expect(parseTreemapDiagram('treemap-beta\n"A": 10 %% a note').nodes[0]!.value).toBe(10)
  })

  it('reads a decimal value', () => {
    expect(parseTreemapDiagram('treemap-beta\n"A": 1.5').nodes[0]!.value).toBe(1.5)
  })

  it('reads a value written with thousands separators', () => {
    expect(parseTreemapDiagram('treemap-beta\n"A": 1,250').nodes[0]!.value).toBe(1250)
  })

  it('reads a negative value', () => {
    expect(parseTreemapDiagram('treemap-beta\n"A": -5').nodes[0]!.value).toBe(-5)
  })

  it('treats a node without a value as a section', () => {
    expect(parseTreemapDiagram('treemap-beta\n"A"').nodes[0]!.value).toBeUndefined()
  })

  it('treats a non-numeric value as part of the name', () => {
    const node = parseTreemapDiagram('treemap-beta\nRatio: high').nodes[0]!
    expect(node.value).toBeUndefined()
    expect(node.name).toBe('Ratio: high')
  })

  it('reads a class selector', () => {
    expect(parseTreemapDiagram('treemap-beta\n"A": 10:::big').nodes[0]!.classSelector)
      .toBe('big')
  })

  it('reads a class selector on a section', () => {
    expect(parseTreemapDiagram('treemap-beta\n"A":::big').nodes[0]).toMatchObject({
      name: 'A', classSelector: 'big',
    })
  })

  it('reads a classDef', () => {
    expect(parseTreemapDiagram('treemap-beta\nclassDef big fill:#f9f\n"A": 1').classes.get('big'))
      .toBe('fill:#f9f')
  })

  it('accumulates several classDefs for one name', () => {
    const diagram = parseTreemapDiagram(
      'treemap-beta\nclassDef big fill:#f9f\nclassDef big stroke:#333\n"A": 1'
    )
    expect(diagram.classes.get('big')).toBe('fill:#f9f,stroke:#333')
  })

  it('reads a title', () => {
    expect(parseTreemapDiagram('treemap-beta\ntitle Budget\n"A": 1').title).toBe('Budget')
  })

  it('ignores an empty title', () => {
    expect(parseTreemapDiagram('treemap-beta\ntitle\n"A": 1').title).toBeUndefined()
  })
})

describe('treemap parser — compileClass', () => {
  it('turns commas into semicolons', () => {
    expect(compileClass('fill:#f9f,stroke:#333')).toBe('fill:#f9f;stroke:#333')
  })

  it('keeps a comma inside a colour function', () => {
    expect(compileClass('fill:rgb(1, 2, 3)')).toBe('fill:rgb(1, 2, 3)')
  })

  it('rejects a value that could break out of the attribute', () => {
    expect(compileClass('fill:"><script>')).toBeUndefined()
  })

  it('returns undefined for an empty body', () => {
    expect(compileClass(' , ')).toBeUndefined()
  })
})

describe('treemap layout — totalValue', () => {
  const parse = (text: string) => parseTreemapDiagram(`treemap-beta\n${text}`).nodes[0]!

  it('is a leaf\'s own value', () => {
    expect(totalValue(parse('"A": 10'))).toBe(10)
  })

  it('sums a section\'s children', () => {
    expect(totalValue(parse('"A"\n  "B": 10\n  "C": 15'))).toBe(25)
  })

  it('sums recursively', () => {
    expect(totalValue(parse('"A"\n  "B"\n    "C": 10\n    "D": 5\n  "E": 1'))).toBe(16)
  })

  it('clamps a negative leaf to zero, since a negative area is meaningless', () => {
    expect(totalValue(parse('"A"\n  "B": 10\n  "C": -5'))).toBe(10)
  })

  it('is zero for a section with no valued leaves', () => {
    expect(totalValue(parse('"A"\n  "B"'))).toBe(0)
  })
})

describe('treemap layout — squarify', () => {
  const FRAME = { x: 0, y: 0, width: 100, height: 100 }

  it('returns one box per value', () => {
    expect(squarify([1, 2, 3], FRAME)).toHaveLength(3)
  })

  it('returns boxes in input order, not sorted order', () => {
    const boxes = squarify([1, 10, 1], FRAME)
    const areas = boxes.map(b => b.width * b.height)
    expect(areas[1]).toBeGreaterThan(areas[0]!)
    expect(areas[1]).toBeGreaterThan(areas[2]!)
  })

  it('makes areas proportional to values', () => {
    // Gaps shrink every cell, so compare the ratio rather than the absolute
    const boxes = squarify([1, 3], { x: 0, y: 0, width: 400, height: 400 })
    const [small, large] = boxes.map(b => b.width * b.height)
    expect(large! / small!).toBeGreaterThan(2.5)
    expect(large! / small!).toBeLessThan(3.5)
  })

  it('keeps every box inside the frame', () => {
    for (const box of squarify([5, 3, 2, 8, 1], FRAME)) {
      expect(box.x).toBeGreaterThanOrEqual(FRAME.x)
      expect(box.y).toBeGreaterThanOrEqual(FRAME.y)
      expect(box.x + box.width).toBeLessThanOrEqual(FRAME.x + FRAME.width + 0.01)
      expect(box.y + box.height).toBeLessThanOrEqual(FRAME.y + FRAME.height + 0.01)
    }
  })

  it('does not overlap boxes', () => {
    const boxes = squarify([5, 3, 2, 8, 1, 4], { x: 0, y: 0, width: 300, height: 200 })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const b = boxes[j]!
        const disjoint =
          a.x + a.width <= b.x + 0.01 || b.x + b.width <= a.x + 0.01 ||
          a.y + a.height <= b.y + 0.01 || b.y + b.height <= a.y + 0.01
        expect(disjoint).toBe(true)
      }
    }
  })

  it('keeps cells close to square for equal values', () => {
    // The point of squarifying: nine equal cells should not become slivers
    for (const box of squarify(new Array(9).fill(1), { x: 0, y: 0, width: 300, height: 300 })) {
      const ratio = Math.max(box.width / box.height, box.height / box.width)
      expect(ratio).toBeLessThan(2)
    }
  })

  it('beats slice-and-dice on aspect ratio for a skewed input', () => {
    const boxes = squarify([50, 25, 12, 6, 3, 2, 1, 1], { x: 0, y: 0, width: 400, height: 300 })
    const worst = Math.max(...boxes.map(b =>
      b.width > 0 && b.height > 0
        ? Math.max(b.width / b.height, b.height / b.width)
        : 1))
    // Slice-and-dice would put the 1 in a 400x1.5 sliver — ratio over 200
    expect(worst).toBeLessThan(12)
  })

  it('returns empty boxes when every value is zero', () => {
    for (const box of squarify([0, 0], FRAME)) {
      expect(box.width).toBe(0)
      expect(box.height).toBe(0)
    }
  })

  it('handles an empty list', () => {
    expect(squarify([], FRAME)).toEqual([])
  })

  it('handles a single value', () => {
    const [box] = squarify([1], FRAME)
    expect(box!.width).toBeGreaterThan(90)
    expect(box!.height).toBeGreaterThan(90)
  })
})

describe('treemap layout — formatValue', () => {
  it('groups thousands by default', () => {
    expect(formatValue(1234567)).toBe('1,234,567')
  })

  it('leaves a small number alone', () => {
    expect(formatValue(42)).toBe('42')
  })

  it('rounds to a whole number by default', () => {
    expect(formatValue(1234.6)).toBe('1,235')
  })

  it('honours a currency prefix', () => {
    expect(formatValue(1234, '$0,0')).toBe('$1,234')
  })

  it('honours a precision', () => {
    expect(formatValue(1234.567, ',.2')).toBe('1,234.57')
  })

  it('honours a currency prefix with a precision', () => {
    expect(formatValue(1234.5, '$,.2')).toBe('$1,234.50')
  })

  it('scales a percentage by 100', () => {
    expect(formatValue(0.42, '.0%')).toBe('42%')
  })

  it('formats without grouping when the format says nothing about it', () => {
    expect(formatValue(1234, '.1')).toBe('1234.0')
  })
})

describe('treemap layout — placement', () => {
  const CHART = `treemap-beta
"Dev"
    "Payroll": 400
    "Cloud": 90
"Marketing"
    "Ads": 150
    "Events": 48`

  it('emits one cell per node', () => {
    // Two sections plus four leaves
    expect(layoutTreemap(parseTreemapDiagram(CHART)).cells).toHaveLength(6)
  })

  it('gives a section the sum of its children', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    expect(cells.find(c => c.name === 'Dev')!.value).toBe(490)
  })

  it('marks sections and leaves apart', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    expect(cells.find(c => c.name === 'Dev')!.isSection).toBe(true)
    expect(cells.find(c => c.name === 'Payroll')!.isSection).toBe(false)
  })

  it('records nesting depth', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    expect(cells.find(c => c.name === 'Dev')!.depth).toBe(0)
    expect(cells.find(c => c.name === 'Payroll')!.depth).toBe(1)
  })

  it('gives each top-level branch its own colour index', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    expect(cells.find(c => c.name === 'Dev')!.colorIndex).toBe(0)
    expect(cells.find(c => c.name === 'Marketing')!.colorIndex).toBe(1)
  })

  it('passes the branch colour down to the leaves', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    expect(cells.find(c => c.name === 'Ads')!.colorIndex).toBe(1)
  })

  it('makes a bigger leaf occupy more area', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    const payroll = cells.find(c => c.name === 'Payroll')!
    const cloud = cells.find(c => c.name === 'Cloud')!
    expect(payroll.width * payroll.height).toBeGreaterThan(cloud.width * cloud.height)
  })

  it('keeps a leaf inside its section', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    const dev = cells.find(c => c.name === 'Dev')!
    for (const name of ['Payroll', 'Cloud']) {
      const leaf = cells.find(c => c.name === name)!
      expect(leaf.x).toBeGreaterThanOrEqual(dev.x)
      expect(leaf.y).toBeGreaterThanOrEqual(dev.y)
      expect(leaf.x + leaf.width).toBeLessThanOrEqual(dev.x + dev.width + 0.01)
      expect(leaf.y + leaf.height).toBeLessThanOrEqual(dev.y + dev.height + 0.01)
    }
  })

  it('puts a leaf below its section header, never on top of it', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    const dev = cells.find(c => c.name === 'Dev')!
    const payroll = cells.find(c => c.name === 'Payroll')!
    expect(payroll.y).toBeGreaterThan(dev.labelY)
  })

  it('keeps every cell inside the canvas', () => {
    const chart = layoutTreemap(parseTreemapDiagram(CHART))
    for (const cell of chart.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.y).toBeGreaterThanOrEqual(0)
      expect(cell.x + cell.width).toBeLessThanOrEqual(chart.width + 0.01)
      expect(cell.y + cell.height).toBeLessThanOrEqual(chart.height + 0.01)
    }
  })

  it('drops a node with no value anywhere in its subtree', () => {
    const cells = layoutTreemap(parseTreemapDiagram(
      'treemap-beta\n"A": 10\n"Empty"\n  "Nothing"'
    )).cells
    expect(cells.map(c => c.name)).toEqual(['A'])
  })

  it('shows values on leaves by default', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    expect(cells.find(c => c.name === 'Payroll')!.valueText).toBe('400')
  })

  it('omits values when showValues is false', () => {
    const diagram = parseTreemapDiagram(CHART)
    const cells = layoutTreemap({ ...diagram, showValues: false }).cells
    expect(cells.every(c => c.valueText === undefined)).toBe(true)
  })

  it('honours a value format', () => {
    const diagram = parseTreemapDiagram('treemap-beta\n"A": 1234')
    const cells = layoutTreemap({ ...diagram, valueFormat: '$0,0' }).cells
    expect(cells[0]!.valueText).toBe('$1,234')
  })

  it('never shows a value on a section', () => {
    const cells = layoutTreemap(parseTreemapDiagram(CHART)).cells
    expect(cells.find(c => c.name === 'Dev')!.valueText).toBeUndefined()
  })

  it('wraps a long leaf label', () => {
    // Sixteen equal cells, so each is narrow enough that a long name wraps
    const leaves = Array.from({ length: 16 }, (_, i) =>
      `"A rather long leaf label number ${i}": 10`).join('\n')
    const cells = layoutTreemap(parseTreemapDiagram(`treemap-beta\n${leaves}`)).cells
    expect(cells.some(c => c.lines.length > 1)).toBe(true)
  })

  it('drops the label of a cell too small to carry one', () => {
    const cells = layoutTreemap(parseTreemapDiagram(
      'treemap-beta\n"Big": 100000\n"Tiny": 1'
    )).cells
    expect(cells.find(c => c.name === 'Tiny')!.lines).toEqual([])
  })

  it('compiles a class into an inline style', () => {
    const cells = layoutTreemap(parseTreemapDiagram(
      'treemap-beta\nclassDef big fill:#f9f,stroke:#333\n"A": 10:::big'
    )).cells
    expect(cells[0]!.style).toBe('fill:#f9f;stroke:#333')
  })

  it('leaves a cell unstyled when its class is undefined', () => {
    const cells = layoutTreemap(parseTreemapDiagram('treemap-beta\n"A": 10:::nope')).cells
    expect(cells[0]!.style).toBeUndefined()
    expect(cells[0]!.classSelector).toBe('nope')
  })

  it('reserves room for a title', () => {
    const without = layoutTreemap(parseTreemapDiagram('treemap-beta\n"A": 1'))
    const withTitle = layoutTreemap(parseTreemapDiagram('treemap-beta\ntitle T\n"A": 1'))
    expect(withTitle.height).toBeGreaterThan(without.height)
    expect(withTitle.title!.text).toBe('T')
  })

  it('handles an empty treemap', () => {
    const chart = layoutTreemap(parseTreemapDiagram('treemap-beta'))
    expect(chart.cells).toEqual([])
    expect(chart.width).toBeGreaterThan(0)
  })
})

describe('treemap integration — renderMermaidSVG', () => {
  const CHART = `treemap-beta
title Budget
"Dev"
    "Payroll": 400
    "Cloud": 90
"Marketing"
    "Ads": 150`

  it('renders a treemap to SVG', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(renderMermaidSVG(CHART)).toContain('treemap-cell')
  })

  it('accepts the plain treemap header', () => {
    expect(renderMermaidSVG('treemap\n"A": 1')).toContain('treemap-cell')
  })

  it('renders one rect per cell', () => {
    expect(renderMermaidSVG(CHART).match(/class="treemap-cell/g)).toHaveLength(5)
  })

  it('renders every name', () => {
    const svg = renderMermaidSVG(CHART)
    for (const name of ['Dev', 'Payroll', 'Cloud', 'Marketing', 'Ads']) {
      expect(svg).toContain(name)
    }
  })

  it('emits name and value as data attributes', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toContain('data-name="Payroll"')
    expect(svg).toContain('data-value="400"')
  })

  it('gives a section the summed value in its data attribute', () => {
    expect(renderMermaidSVG(CHART)).toContain('data-value="490"')
  })

  it('names and values a cell in its title', () => {
    expect(renderMermaidSVG(CHART)).toContain('<title>Payroll: 400</title>')
  })

  it('distinguishes sections from leaves by class', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toContain('treemap-section ')
    expect(svg).toContain('treemap-leaf ')
  })

  it('tints by depth', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toContain('treemap-depth-0')
    expect(svg).toContain('treemap-depth-1')
  })

  it('declares a colour variable per branch', () => {
    const svg = renderMermaidSVG(CHART)
    expect(svg).toContain('--treemap-color-0')
    expect(svg).toContain('--treemap-color-1')
  })

  it('maps branch 0 onto the theme accent', () => {
    expect(renderMermaidSVG(CHART)).toContain('--treemap-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(CHART, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    expect(renderMermaidSVG(CHART, { transparent: true })).not.toContain('background:var(--bg)')
  })

  it('renders the title', () => {
    expect(renderMermaidSVG(CHART)).toContain('Budget')
  })

  it('takes a title from frontmatter', () => {
    expect(renderMermaidSVG('---\ntitle: From meta\n---\ntreemap-beta\n"A": 1'))
      .toContain('From meta')
  })

  it('hides values when frontmatter turns them off', () => {
    const svg = renderMermaidSVG(
      `---\nconfig:\n  treemap:\n    showValues: false\n---\n${CHART}`
    )
    // The CSS rule is always emitted; what must be absent is the text itself
    expect(svg).not.toContain('class="treemap-value"')
    expect(renderMermaidSVG(CHART)).toContain('class="treemap-value"')
  })

  it('honours a value format from frontmatter', () => {
    const svg = renderMermaidSVG(
      `---\nconfig:\n  treemap:\n    valueFormat: $0,0\n---\n${CHART}`
    )
    expect(svg).toContain('$400')
  })

  it('emits an inline style from a classDef', () => {
    const svg = renderMermaidSVG('treemap-beta\nclassDef big fill:#f9f\n"A": 10:::big')
    expect(svg).toContain('style="fill:#f9f"')
    expect(svg).toContain('treemap-cell treemap-leaf treemap-fill-0 treemap-depth-0 big')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('treemap-beta\n"A & <B>": 10')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders accTitle and accDescr', () => {
    const svg = renderMermaidSVG('treemap-beta\naccTitle: The budget\naccDescr: Where it goes\n"A": 1')
    expect(svg).toContain('<title>The budget</title>')
    expect(svg).toContain('<desc>Where it goes</desc>')
  })

  it('renders an empty treemap without throwing', () => {
    const svg = renderMermaidSVG('treemap-beta')
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
    expect(() => renderMermaidASCII(CHART)).toThrow(/not supported for treemap/)
  })
})
