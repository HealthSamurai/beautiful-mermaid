import { describe, expect, it } from 'bun:test'
import { parseKanbanDiagram } from '../kanban/parser.ts'
import { layoutKanban } from '../kanban/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

// ============================================================================
// Kanban board tests
//
// The KNBN-numbered cases come from
// packages/mermaid/src/diagrams/kanban/kanban.spec.ts and keep their upstream
// numbering, so a case can be traced back to the one it was ported from.
// ============================================================================

describe('kanban parser — hierarchy', () => {
  it('KNBN-1 should handle a simple root definition', () => {
    const diagram = parseKanbanDiagram('kanban\n    root')
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.label).toBe('root')
  })

  it('KNBN-2 should handle a hierarchical kanban definition', () => {
    const diagram = parseKanbanDiagram(`kanban
    root
      child1
      child2
 `)
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.label).toBe('root')
    expect(diagram.sections[0]!.items.map(i => i.label)).toEqual(['child1', 'child2'])
  })

  it('3 should handle a root definition with a shape and without an id', () => {
    const diagram = parseKanbanDiagram('kanban\n    (root)')
    expect(diagram.sections[0]!.label).toBe('root')
  })

  it('KNBN-4 should not distinguish between deeper hierarchical levels', () => {
    const diagram = parseKanbanDiagram(`kanban
    root
      child1
        leaf1
      child2`)
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.items).toHaveLength(3)
  })

  it('5 Multiple sections are ok', () => {
    const diagram = parseKanbanDiagram('kanban\n    section1\n    section2')
    expect(diagram.sections.map(s => s.label)).toEqual(['section1', 'section2'])
    expect(diagram.sections[0]!.items).toEqual([])
  })

  it('KNBN-6 real root in wrong place', () => {
    expect(() => parseKanbanDiagram(`kanban
          root
        fakeRoot
    realRootWrongPlace`)).toThrow(
      'Items without section detected, found section ("fakeRoot")'
    )
  })

  it('reports the offending label in the error', () => {
    expect(() => parseKanbanDiagram('kanban\n    a\n      b\n  oops')).toThrow(
      'found section ("oops")'
    )
  })

  it('reads a board with no indentation at all', () => {
    const diagram = parseKanbanDiagram('kanban\nTodo\nDoing')
    expect(diagram.sections.map(s => s.label)).toEqual(['Todo', 'Doing'])
  })

  it('parses a bare header as an empty board', () => {
    expect(parseKanbanDiagram('kanban').sections).toEqual([])
  })

  it('ignores anything before the header', () => {
    const diagram = parseKanbanDiagram('\n\nkanban\n  Todo')
    expect(diagram.sections).toHaveLength(1)
  })

  it('ignores comment lines', () => {
    const diagram = parseKanbanDiagram('kanban\n  %% a comment\n  Todo\n    %% another\n    card')
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.items).toHaveLength(1)
  })

  it('strips a trailing comment from a line', () => {
    const diagram = parseKanbanDiagram('kanban\n  Todo %% the backlog')
    expect(diagram.sections[0]!.label).toBe('Todo')
  })

  it('ignores blank lines between cards', () => {
    const diagram = parseKanbanDiagram('kanban\n  Todo\n\n    a\n\n    b\n')
    expect(diagram.sections[0]!.items).toHaveLength(2)
  })
})

describe('kanban parser — nodes', () => {
  it('KNBN-7 should handle an id and type for a node definition', () => {
    const diagram = parseKanbanDiagram('kanban\n    root[The root]\n      ')
    expect(diagram.sections[0]!.id).toBe('root')
    expect(diagram.sections[0]!.label).toBe('The root')
  })

  it('KNBN-8 should handle an id and type for a child definition', () => {
    const diagram = parseKanbanDiagram('kanban\n    root\n      theId(child1)')
    expect(diagram.sections[0]!.label).toBe('root')
    const items = diagram.sections[0]!.items
    expect(items).toHaveLength(1)
    expect(items[0]!.label).toBe('child1')
    expect(items[0]!.id).toBe('theId')
  })

  it('KNBN-9 should handle a column at zero indentation', () => {
    const diagram = parseKanbanDiagram('kanban\nroot\n      theId(child1)')
    expect(diagram.sections[0]!.label).toBe('root')
    expect(diagram.sections[0]!.items[0]!.id).toBe('theId')
  })

  it('uses the label as the id when none is given', () => {
    expect(parseKanbanDiagram('kanban\n  Todo').sections[0]!.id).toBe('Todo')
  })

  it('generates an id for a node with an empty label', () => {
    const diagram = parseKanbanDiagram('kanban\n  ""')
    expect(diagram.sections[0]!.id).toMatch(/^kbn\d+$/)
  })

  it('accepts every bracket shape, ignoring the shape itself', () => {
    const sources = ['a[A]', 'b(B)', 'c((C))', 'd))D((', 'e{{E}}', 'f)F(']
    for (const source of sources) {
      const diagram = parseKanbanDiagram(`kanban\n  ${source}`)
      expect(diagram.sections[0]!.label).toBe(source[0]!.toUpperCase())
    }
  })

  it('unquotes a quoted label', () => {
    expect(parseKanbanDiagram('kanban\n  a["A label"]').sections[0]!.label).toBe('A label')
  })

  it('keeps a bracket inside a quoted label', () => {
    expect(parseKanbanDiagram('kanban\n  a["Contains [] here"]').sections[0]!.label)
      .toBe('Contains [] here')
  })

  it('treats an empty bracket body as plain text', () => {
    expect(parseKanbanDiagram('kanban\n  a[]').sections[0]!.label).toBe('a[]')
  })

  it('gives distinct generated ids', () => {
    const diagram = parseKanbanDiagram('kanban\n  ""\n    ""\n    ""')
    const ids = [diagram.sections[0]!.id, ...diagram.sections[0]!.items.map(i => i.id)]
    expect(new Set(ids).size).toBe(3)
  })
})

describe('kanban parser — decorations', () => {
  it('KNBN-13 should be possible to set an icon for the node', () => {
    const diagram = parseKanbanDiagram('kanban\n    root[The root]\n    ::icon(bomb)\n    ')
    expect(diagram.sections[0]!.id).toBe('root')
    expect(diagram.sections[0]!.label).toBe('The root')
    expect(diagram.sections[0]!.icon).toBe('bomb')
  })

  it('KNBN-14 should be possible to set classes for the node', () => {
    const diagram = parseKanbanDiagram('kanban\n    root[The root]\n    :::m-4 p-8\n    ')
    expect(diagram.sections[0]!.class).toBe('m-4 p-8')
  })

  it('KNBN-15 should be possible to set both classes and icon for the node', () => {
    const diagram = parseKanbanDiagram(
      'kanban\n    root[The root]\n    :::m-4 p-8\n    ::icon(bomb)\n    '
    )
    expect(diagram.sections[0]!.class).toBe('m-4 p-8')
    expect(diagram.sections[0]!.icon).toBe('bomb')
  })

  it('decorates a card, not its column', () => {
    const diagram = parseKanbanDiagram('kanban\n  Todo\n    card\n    ::icon(star)')
    expect(diagram.sections[0]!.icon).toBeUndefined()
    expect(diagram.sections[0]!.items[0]!.icon).toBe('star')
  })

  it('ignores a decoration with nothing above it', () => {
    expect(() => parseKanbanDiagram('kanban\n  ::icon(star)\n  Todo')).not.toThrow()
  })
})

describe('kanban parser — metadata', () => {
  it('reads an assignee', () => {
    const diagram = parseKanbanDiagram('kanban\n  Todo\n    a[A]@{ assigned: knsv }')
    expect(diagram.sections[0]!.items[0]!.assigned).toBe('knsv')
  })

  it('reads several fields from one block', () => {
    const diagram = parseKanbanDiagram(
      'kanban\n  Todo\n    a[A]@{ assigned: knsv, ticket: MC-1234, priority: High }'
    )
    const item = diagram.sections[0]!.items[0]!
    expect(item.assigned).toBe('knsv')
    expect(item.ticket).toBe('MC-1234')
    expect(item.priority).toBe('High')
  })

  it('reads a block written over several lines', () => {
    const diagram = parseKanbanDiagram(`kanban
  Todo
    a[A]@{
      assigned: knsv
      priority: Very High
    }`)
    // The block spans lines, so only the opening line declares the card
    expect(diagram.sections[0]!.items[0]!.label).toBe('A')
  })

  it('normalises priority capitalisation', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a@{ priority: very high }')
    expect(diagram.sections[0]!.items[0]!.priority).toBe('Very High')
  })

  it('accepts every documented priority', () => {
    for (const p of ['Very High', 'High', 'Medium', 'Low', 'Very Low']) {
      const diagram = parseKanbanDiagram(`kanban\n  T\n    a@{ priority: ${p} }`)
      expect(diagram.sections[0]!.items[0]!.priority).toBe(p as never)
    }
  })

  it('drops an unrecognised priority', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a@{ priority: urgent }')
    expect(diagram.sections[0]!.items[0]!.priority).toBeUndefined()
  })

  it('ignores an unknown key', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a[A]@{ descr: "long text" }')
    expect(diagram.sections[0]!.items[0]!.label).toBe('A')
  })

  it('lets metadata override the label', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a[A]@{ label: Real }')
    expect(diagram.sections[0]!.items[0]!.label).toBe('Real')
  })

  it('keeps a comma inside a quoted value', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a@{ assigned: "one, two" }')
    expect(diagram.sections[0]!.items[0]!.assigned).toBe('one, two')
  })

  it('reads an icon from metadata', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a@{ icon: heart }')
    expect(diagram.sections[0]!.items[0]!.icon).toBe('heart')
  })

  it('does not mistake an @{ inside quotes for a metadata block', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a["mail @{host}"]')
    expect(diagram.sections[0]!.items[0]!.label).toBe('mail @{host}')
  })

  it('reads metadata on a column', () => {
    const diagram = parseKanbanDiagram('kanban\n  todo[Todo]@{ icon: clock }')
    expect(diagram.sections[0]!.icon).toBe('clock')
  })

  it('ignores an unterminated metadata block', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a[A]@{ assigned: x')
    expect(diagram.sections[0]!.items[0]!.assigned).toBeUndefined()
  })
})

describe('kanban parser — title and styles', () => {
  it('reads a title', () => {
    expect(parseKanbanDiagram('kanban\n  title Sprint 4\n  Todo').title).toBe('Sprint 4')
  })

  it('ignores an empty title', () => {
    expect(parseKanbanDiagram('kanban\n  title\n  Todo').title).toBeUndefined()
  })

  it('applies a style to a column', () => {
    const diagram = parseKanbanDiagram(
      'kanban\n  todo[Todo]\n  style todo fill:#eee,stroke:#333'
    )
    expect(diagram.sections[0]!.style).toBe('fill:#eee;stroke:#333')
  })

  it('applies a style to a card', () => {
    const diagram = parseKanbanDiagram(
      'kanban\n  todo[Todo]\n    a[A]\n  style a fill:#eee'
    )
    expect(diagram.sections[0]!.items[0]!.style).toBe('fill:#eee')
  })

  it('keeps a comma inside a colour function', () => {
    const diagram = parseKanbanDiagram(
      'kanban\n  todo[Todo]\n  style todo fill:rgb(1, 2, 3)'
    )
    expect(diagram.sections[0]!.style).toBe('fill:rgb(1, 2, 3)')
  })

  it('rejects a style that could break out of the attribute', () => {
    const diagram = parseKanbanDiagram(
      'kanban\n  todo[Todo]\n  style todo fill:"><script>'
    )
    expect(diagram.sections[0]!.style).toBeUndefined()
  })

  it('ignores a style naming an unknown node', () => {
    expect(() => parseKanbanDiagram('kanban\n  Todo\n  style nope fill:#eee')).not.toThrow()
  })

  it('is not confused by a node called __proto__', () => {
    const diagram = parseKanbanDiagram(
      'kanban\n  __proto__[Todo]\n  style __proto__ fill:#eee'
    )
    expect(diagram.sections[0]!.style).toBe('fill:#eee')
    expect(({} as Record<string, unknown>).style).toBeUndefined()
  })
})

describe('kanban layout', () => {
  const BOARD = `kanban
  todo[Todo]
    a[Alpha]
    b[Beta]
  doing[Doing]
    c[Gamma]`

  it('places columns left to right', () => {
    const chart = layoutKanban(parseKanbanDiagram(BOARD))
    expect(chart.columns).toHaveLength(2)
    expect(chart.columns[1]!.x).toBeGreaterThan(chart.columns[0]!.x)
  })

  it('gives every column the same width', () => {
    const chart = layoutKanban(parseKanbanDiagram(BOARD))
    expect(chart.columns[0]!.width).toBe(chart.columns[1]!.width)
  })

  it('gives every column the same height, so they share a bottom edge', () => {
    const chart = layoutKanban(parseKanbanDiagram(BOARD))
    const bottoms = chart.columns.map(c => c.y + c.height)
    expect(new Set(bottoms).size).toBe(1)
  })

  it('stacks cards down a column', () => {
    const chart = layoutKanban(parseKanbanDiagram(BOARD))
    const [first, second] = chart.columns[0]!.cards
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height)
  })

  it('keeps cards inside their column', () => {
    const chart = layoutKanban(parseKanbanDiagram(BOARD))
    for (const column of chart.columns) {
      for (const card of column.cards) {
        expect(card.x).toBeGreaterThanOrEqual(column.x)
        expect(card.x + card.width).toBeLessThanOrEqual(column.x + column.width)
        expect(card.y).toBeGreaterThanOrEqual(column.y + column.headerHeight)
      }
    }
  })

  it('gives each column its own colour index', () => {
    expect(layoutKanban(parseKanbanDiagram(BOARD)).columns.map(c => c.colorIndex))
      .toEqual([0, 1])
  })

  it('passes the column colour down to its cards', () => {
    const chart = layoutKanban(parseKanbanDiagram(BOARD))
    expect(chart.columns[1]!.cards[0]!.colorIndex).toBe(1)
  })

  it('wraps a long card label onto several lines', () => {
    const chart = layoutKanban(parseKanbanDiagram(
      'kanban\n  T\n    a[A card label long enough that it cannot fit on one line at all]'
    ))
    expect(chart.columns[0]!.cards[0]!.lines.length).toBeGreaterThan(1)
  })

  it('grows a wrapped card taller', () => {
    const short = layoutKanban(parseKanbanDiagram('kanban\n  T\n    a[A]'))
    const long = layoutKanban(parseKanbanDiagram(
      'kanban\n  T\n    a[A card label long enough that it cannot fit on one line]'
    ))
    expect(long.columns[0]!.cards[0]!.height)
      .toBeGreaterThan(short.columns[0]!.cards[0]!.height)
  })

  it('builds a chip for an assignee and a ticket', () => {
    const chart = layoutKanban(parseKanbanDiagram(
      'kanban\n  T\n    a[A]@{ assigned: knsv, ticket: MC-1 }'
    ))
    expect(chart.columns[0]!.cards[0]!.chips.map(c => c.kind)).toEqual(['assigned', 'ticket'])
  })

  it('builds no chips for a bare card', () => {
    const chart = layoutKanban(parseKanbanDiagram('kanban\n  T\n    a[A]'))
    expect(chart.columns[0]!.cards[0]!.chips).toEqual([])
  })

  it('adds an id chip only when showIds is set', () => {
    const diagram = parseKanbanDiagram('kanban\n  T\n    a[A]')
    expect(layoutKanban(diagram).columns[0]!.cards[0]!.chips).toHaveLength(0)
    expect(layoutKanban({ ...diagram, showIds: true }).columns[0]!.cards[0]!.chips
      .map(c => c.text)).toEqual(['a'])
  })

  it('makes a card with chips taller than one without', () => {
    const plain = layoutKanban(parseKanbanDiagram('kanban\n  T\n    a[A]'))
    const chipped = layoutKanban(parseKanbanDiagram('kanban\n  T\n    a[A]@{ assigned: x }'))
    expect(chipped.columns[0]!.cards[0]!.height)
      .toBeGreaterThan(plain.columns[0]!.cards[0]!.height)
  })

  it('keeps chips inside the card', () => {
    const chart = layoutKanban(parseKanbanDiagram(
      'kanban\n  T\n    a[A]@{ assigned: a-fairly-long-name, ticket: PROJECT-12345 }'
    ))
    const card = chart.columns[0]!.cards[0]!
    for (const chip of card.chips) {
      expect(chip.x + chip.width).toBeLessThanOrEqual(card.x + card.width)
      expect(chip.y + chip.height).toBeLessThanOrEqual(card.y + card.height)
    }
  })

  it('gives an empty column a visible height', () => {
    const chart = layoutKanban(parseKanbanDiagram('kanban\n  Todo'))
    expect(chart.columns[0]!.height).toBeGreaterThan(0)
  })

  it('reserves room for a title', () => {
    const without = layoutKanban(parseKanbanDiagram('kanban\n  Todo'))
    const withTitle = layoutKanban(parseKanbanDiagram('kanban\n  title Board\n  Todo'))
    expect(withTitle.height).toBeGreaterThan(without.height)
    expect(withTitle.title!.text).toBe('Board')
  })

  it('grows a column header for a wrapped heading', () => {
    const chart = layoutKanban(parseKanbanDiagram(
      'kanban\n  a[A column heading long enough to need two lines of its own]'
    ))
    expect(chart.columns[0]!.headerLines.length).toBeGreaterThan(1)
    expect(chart.columns[0]!.headerHeight).toBeGreaterThan(34)
  })

  it('handles an empty board', () => {
    const chart = layoutKanban(parseKanbanDiagram('kanban'))
    expect(chart.columns).toEqual([])
    expect(chart.width).toBeGreaterThan(0)
    expect(chart.height).toBeGreaterThan(0)
  })

  it('keeps every column inside the canvas', () => {
    const chart = layoutKanban(parseKanbanDiagram(BOARD))
    for (const column of chart.columns) {
      expect(column.x).toBeGreaterThanOrEqual(0)
      expect(column.x + column.width).toBeLessThanOrEqual(chart.width)
      expect(column.y + column.height).toBeLessThanOrEqual(chart.height)
    }
  })
})

describe('kanban integration — renderMermaidSVG', () => {
  const BOARD = `kanban
  todo[Todo]
    t1[Write the parser]@{ assigned: nikolai, ticket: KBN-1, priority: High }
    t2[Write the tests]
  doing[In progress]
    d1[Design the grammar]
  done[Done]
    x1[Ship radar]`

  it('renders a kanban board to SVG', () => {
    const svg = renderMermaidSVG(BOARD)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not fall through to the flowchart parser', () => {
    expect(renderMermaidSVG(BOARD)).toContain('kanban-column')
  })

  it('renders one column rect per column', () => {
    expect(renderMermaidSVG(BOARD).match(/class="kanban-column /g)).toHaveLength(3)
  })

  it('renders one card rect per card', () => {
    expect(renderMermaidSVG(BOARD).match(/class="kanban-card /g)).toHaveLength(4)
  })

  it('renders every column heading', () => {
    const svg = renderMermaidSVG(BOARD)
    for (const label of ['Todo', 'In progress', 'Done']) expect(svg).toContain(label)
  })

  it('renders every card label', () => {
    const svg = renderMermaidSVG(BOARD)
    for (const label of ['Write the parser', 'Design the grammar', 'Ship radar']) {
      expect(svg).toContain(label)
    }
  })

  it('emits column and card ids as data attributes', () => {
    const svg = renderMermaidSVG(BOARD)
    expect(svg).toContain('data-column="todo"')
    expect(svg).toContain('data-card="t1"')
  })

  it('emits priority as a data attribute', () => {
    expect(renderMermaidSVG(BOARD)).toContain('data-priority="High"')
  })

  it('draws a stripe only for a card with a priority', () => {
    expect(renderMermaidSVG(BOARD).match(/class="kanban-stripe/g)).toHaveLength(1)
  })

  it('describes a card and its metadata in its title', () => {
    expect(renderMermaidSVG(BOARD))
      .toContain('<title>Write the parser (priority: High, assigned: nikolai, ticket: KBN-1)</title>')
  })

  it('renders chips for the assignee and the ticket', () => {
    const svg = renderMermaidSVG(BOARD)
    expect(svg).toContain('kanban-chip-assigned')
    expect(svg).toContain('kanban-chip-ticket')
  })

  it('hides ids by default', () => {
    expect(renderMermaidSVG(BOARD)).not.toContain('kanban-chip-id')
  })

  it('shows ids when frontmatter asks for them', () => {
    const svg = renderMermaidSVG(
      `---\nconfig:\n  kanban:\n    showIds: true\n---\n${BOARD}`
    )
    expect(svg).toContain('kanban-chip-id')
  })

  it('declares a colour variable per column', () => {
    const svg = renderMermaidSVG(BOARD)
    expect(svg).toContain('--kanban-color-0')
    expect(svg).toContain('--kanban-color-2')
  })

  it('maps column 0 onto the theme accent', () => {
    expect(renderMermaidSVG(BOARD)).toContain('--kanban-color-0: var(--accent')
  })

  it('honours an explicit accent colour', () => {
    expect(renderMermaidSVG(BOARD, { accent: '#ff0000' })).toContain('--accent:#ff0000')
  })

  it('supports transparent backgrounds', () => {
    expect(renderMermaidSVG(BOARD, { transparent: true })).not.toContain('background:var(--bg)')
  })

  it('renders a title from the board', () => {
    expect(renderMermaidSVG('kanban\n  title Sprint 4\n  Todo')).toContain('Sprint 4')
  })

  it('takes a title from frontmatter', () => {
    expect(renderMermaidSVG('---\ntitle: From meta\n---\nkanban\n  Todo'))
      .toContain('From meta')
  })

  it('renders an icon as a glyph', () => {
    const svg = renderMermaidSVG('kanban\n  Todo\n  ::icon(heart)')
    expect(svg).toContain('kanban-icon')
    expect(svg).toContain('\u2665')
  })

  it('falls back to a bullet for an unknown icon', () => {
    expect(renderMermaidSVG('kanban\n  Todo\n  ::icon(nonesuch)')).toContain('\u2022')
  })

  it('emits class names from a :::class line', () => {
    expect(renderMermaidSVG('kanban\n  Todo\n  :::wide bold'))
      .toContain('kanban-column kanban-column-0 wide bold')
  })

  it('emits an inline style from a style statement', () => {
    expect(renderMermaidSVG('kanban\n  todo[Todo]\n  style todo fill:#eee'))
      .toContain('style="fill:#eee"')
  })

  it('escapes XML special characters', () => {
    const svg = renderMermaidSVG('kanban\n  a["A & <B>"]')
    expect(svg).toContain('A &amp; &lt;B&gt;')
    expect(svg).not.toContain('<B>')
  })

  it('renders accTitle and accDescr', () => {
    const svg = renderMermaidSVG('kanban\n  accTitle: The board\n  accDescr: What it holds\n  Todo')
    expect(svg).toContain('<title>The board</title>')
    expect(svg).toContain('<desc>What it holds</desc>')
  })

  it('renders an empty board without throwing', () => {
    const svg = renderMermaidSVG('kanban')
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('has balanced tags', () => {
    const svg = renderMermaidSVG(BOARD)
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.match(/<\/svg>/g)).toHaveLength(1)
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length)
  })

  it('declares width, height and viewBox', () => {
    const svg = renderMermaidSVG(BOARD)
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('rejects ASCII rendering with a clear message', () => {
    expect(() => renderMermaidASCII(BOARD)).toThrow(/not supported for kanban/)
  })
})
