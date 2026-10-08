import { describe, expect, it } from 'bun:test'
import { parseBlockDiagram } from '../block/parser.ts'

// ============================================================================
// Block diagram parser tests
//
// Ported from packages/mermaid/src/diagrams/block/parser/block.spec.ts,
// keeping the upstream assertions on block count, id, label, type, width and
// nesting.
// ============================================================================

function parse(text: string) {
  return parseBlockDiagram(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  )
}

describe('block parser — nodes', () => {
  it('a diagram with a node', () => {
    const { blocks } = parse('block-beta\nid')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.id).toBe('id')
    expect(blocks[0]!.label).toBe('id')
  })

  it('a node with a square shape and a label', () => {
    const { blocks } = parse('block\nid["A label"]')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.id).toBe('id')
    expect(blocks[0]!.label).toBe('A label')
    expect(blocks[0]!.shape).toBe('square')
  })

  it('a diagram with multiple nodes', () => {
    const { blocks } = parse('block\nid1\nid2')
    expect(blocks).toHaveLength(2)
    expect(blocks.map(b => b.id)).toEqual(['id1', 'id2'])
    expect(blocks.every(b => b.shape === 'na')).toBe(true)
  })

  it('a diagram with three nodes', () => {
    const { blocks } = parse('block\nid1\nid2\nid3')
    expect(blocks).toHaveLength(3)
    expect(blocks.map(b => b.label)).toEqual(['id1', 'id2', 'id3'])
  })

  it('a labelled node next to a bare one', () => {
    const { blocks } = parse('block\nid["A label"]\nid2')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.shape).toBe('square')
    expect(blocks[1]!.shape).toBe('na')
  })

  it('does not duplicate a repeated id', () => {
    const { blocks } = parse('block\nid1\nid1')
    expect(blocks).toHaveLength(1)
  })

  it('reads several blocks from one line', () => {
    const { blocks } = parse('block\ncolumns 2\na["A"] b["B"]')
    expect(blocks.map(b => b.id)).toEqual(['a', 'b'])
  })

  it('keeps a label containing spaces intact', () => {
    const { blocks } = parse('block\na["one two three"]')
    expect(blocks[0]!.label).toBe('one two three')
  })
})

describe('block parser — shapes', () => {
  const SHAPES: [string, string][] = [
    ['id["t"]', 'square'],
    ['id("t")', 'round'],
    ['id(("t"))', 'circle'],
    ['id((("t")))', 'doublecircle'],
    ['id{"t"}', 'diamond'],
    ['id{{"t"}}', 'hexagon'],
    ['id(["t"])', 'stadium'],
    ['id[["t"]]', 'subroutine'],
    ['id[("t")]', 'cylinder'],
    ['id[/"t"/]', 'lean_right'],
    ['id[\\"t"\\]', 'lean_left'],
    ['id[/"t"\\]', 'trapezoid'],
    ['id[\\"t"/]', 'inv_trapezoid'],
  ]

  for (const [source, shape] of SHAPES) {
    it(`reads ${shape}`, () => {
      const { blocks } = parse(`block\n${source}`)
      expect(blocks[0]!.shape).toBe(shape as never)
      expect(blocks[0]!.label).toBe('t')
    })
  }

  it('reads an unquoted label', () => {
    const { blocks } = parse('block\nid[plain]')
    expect(blocks[0]!.label).toBe('plain')
  })
})

describe('block parser — columns', () => {
  it('a diagram with column statements', () => {
    const diagram = parse('block\ncolumns 2\nblock1["Block 1"]')
    expect(diagram.columns).toBe(2)
    expect(diagram.blocks).toHaveLength(1)
  })

  it('a diagram without column statements', () => {
    const diagram = parse('block\nblock1["Block 1"]')
    expect(diagram.columns).toBe(-1)
  })

  it('a diagram with auto column statements', () => {
    const diagram = parse('block\ncolumns auto\nblock1["Block 1"]')
    expect(diagram.columns).toBe(-1)
  })

  it('blocks next to each other', () => {
    const diagram = parse('block\ncolumns 2\nblock1["Block 1"]\nblock2["Block 2"]')
    expect(diagram.columns).toBe(2)
    expect(diagram.blocks).toHaveLength(2)
  })

  it('blocks on top of each other', () => {
    const diagram = parse('block\ncolumns 1\nblock1["Block 1"]\nblock2["Block 2"]')
    expect(diagram.columns).toBe(1)
    expect(diagram.blocks).toHaveLength(2)
  })

  it('rejects a zero column count', () => {
    expect(parse('block\ncolumns 0\na').columns).toBe(-1)
  })
})

describe('block parser — composites', () => {
  it('compound blocks', () => {
    const { blocks } = parse('block\nblock\n aBlock["ABlock"]\n bBlock["BBlock"]\nend')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.children).toHaveLength(2)
    expect(blocks[0]!.id).toBeDefined()
    expect(blocks[0]!.label).toBe('')
    expect(blocks[0]!.shape).toBe('composite')

    const [aBlock, bBlock] = blocks[0]!.children
    expect(aBlock!.label).toBe('ABlock')
    expect(aBlock!.shape).toBe('square')
    expect(bBlock!.label).toBe('BBlock')
    expect(bBlock!.shape).toBe('square')
  })

  it('compound blocks of compound blocks', () => {
    const { blocks } = parse(`block
      block
        aBlock["ABlock"]
        block
          bBlock["BBlock"]
        end
      end`)

    expect(blocks[0]!.children).toHaveLength(2)
    expect(blocks[0]!.shape).toBe('composite')

    const aBlock = blocks[0]!.children[0]!
    const secondComposite = blocks[0]!.children[1]!
    const bBlock = secondComposite.children[0]!

    expect(aBlock.label).toBe('ABlock')
    expect(aBlock.shape).toBe('square')
    expect(secondComposite.children).toHaveLength(1)
    expect(secondComposite.label).toBe('')
    expect(secondComposite.shape).toBe('composite')
    expect(bBlock.label).toBe('BBlock')
    expect(bBlock.shape).toBe('square')
  })

  it('compound blocks with title', () => {
    const { blocks } = parse(`block
      block:compoundBlock["Compound block"]
        columns 1
        block2["Block 2"]
      end`)

    expect(blocks).toHaveLength(1)
    const compound = blocks[0]!
    expect(compound.id).toBe('compoundBlock')
    expect(compound.label).toBe('Compound block')
    expect(compound.shape).toBe('composite')
    expect(compound.children).toHaveLength(1)
    expect(compound.columns).toBe(1)

    const block2 = compound.children[0]!
    expect(block2.id).toBe('block2')
    expect(block2.label).toBe('Block 2')
    expect(block2.shape).toBe('square')
  })

  it('blocks mixed with compound blocks', () => {
    const { blocks } = parse(`block
      columns 1
      block1["Block 1"]
      block
        columns 2
        block2["Block 2"]
        block3["Block 3"]
      end`)

    expect(blocks).toHaveLength(2)
    const compound = blocks[1]!
    expect(compound.children).toHaveLength(2)
    expect(compound.children[0]!.id).toBe('block2')
    expect(compound.children[0]!.shape).toBe('square')
  })

  it('gives each anonymous composite a distinct id', () => {
    const { blocks } = parse('block\nblock\n a\nend\nblock\n b\nend')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.id).not.toBe(blocks[1]!.id)
  })

  it('tolerates a missing end', () => {
    const { blocks } = parse('block\nblock\n a["A"]')
    expect(blocks[0]!.children).toHaveLength(1)
  })

  it('ignores a stray end', () => {
    const { blocks } = parse('block\na["A"]\nend')
    expect(blocks).toHaveLength(1)
  })
})

describe('block parser — widths and spaces', () => {
  it('blocks with different widths', () => {
    const { blocks } = parse('block\ncolumns 3\none["One Slot"]\ntwo["Two slots"]:2')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.widthInColumns).toBe(1)
    expect(blocks[1]!.widthInColumns).toBe(2)
  })

  it('empty blocks', () => {
    const { blocks } = parse('block\ncolumns 3\nspace\nmiddle["In the middle"]\nspace')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]!.shape).toBe('space')
    expect(blocks[2]!.shape).toBe('space')
    expect(blocks[1]!.label).toBe('In the middle')
  })

  it('a space spanning several columns', () => {
    const { blocks } = parse('block\ncolumns 3\nspace:2\na["A"]')
    expect(blocks[0]!.shape).toBe('space')
    expect(blocks[0]!.widthInColumns).toBe(2)
  })

  it('does not read a colon inside a label as a span', () => {
    const { blocks } = parse('block\na["Ratio 3:1"]')
    expect(blocks[0]!.label).toBe('Ratio 3:1')
    expect(blocks[0]!.widthInColumns).toBe(1)
  })
})

describe('block parser — arrow blocks', () => {
  it('Arrow blocks', () => {
    const { blocks } = parse(`block
      columns 3
      block1["Block 1"]
      blockArrow<["&nbsp;"]>(right)
      block2["Block 2"]`)

    expect(blocks).toHaveLength(3)
    expect(blocks[1]!.id).toBe('blockArrow')
    expect(blocks[1]!.shape).toBe('block_arrow')
    expect(blocks[1]!.directions).toContain('right')
    expect(blocks[2]!.label).toBe('Block 2')
    expect(blocks[2]!.shape).toBe('square')
  })

  it('Arrow blocks with multiple points', () => {
    const { blocks } = parse(`block
      columns 1
      A
      blockArrow<["&nbsp;"]>(up, down)
      block
        columns 3
        B
        C
        D
      end`)

    expect(blocks).toHaveLength(3)
    const arrow = blocks[1]!
    expect(arrow.shape).toBe('block_arrow')
    expect(arrow.directions).toContain('up')
    expect(arrow.directions).toContain('down')
    expect(arrow.directions).not.toContain('right')
  })

  it('ignores an unknown direction', () => {
    const { blocks } = parse('block\nar<["x"]>(sideways)')
    expect(blocks[0]!.directions).toEqual([])
  })
})

describe('block parser — edges', () => {
  it('a diagram with multiple nodes with edges', () => {
    const diagram = parse('block\nid1["first"]  -->   id2["second"]')
    expect(diagram.blocks).toHaveLength(2)
    expect(diagram.edges).toHaveLength(1)
    expect(diagram.edges[0]!.start).toBe('id1')
    expect(diagram.edges[0]!.end).toBe('id2')
    expect(diagram.edges[0]!.arrowEnd).toBe(true)
  })

  it('an edge with a label', () => {
    const diagram = parse('block\nid1["first"]  -- "a label" -->   id2["second"]')
    expect(diagram.blocks).toHaveLength(2)
    expect(diagram.edges).toHaveLength(1)
    expect(diagram.edges[0]!.label).toBe('a label')
    expect(diagram.edges[0]!.arrowEnd).toBe(true)
  })

  it('reads a thick edge', () => {
    expect(parse('block\nA ==> B').edges[0]!.style).toBe('thick')
  })

  it('reads a dotted edge', () => {
    expect(parse('block\nA -.-> B').edges[0]!.style).toBe('dotted')
  })

  it('reads a plain edge as normal', () => {
    expect(parse('block\nA --> B').edges[0]!.style).toBe('normal')
  })

  it('reads a chain of edges', () => {
    const diagram = parse('block\nA --> B --> C')
    expect(diagram.edges).toHaveLength(2)
    expect(diagram.edges.map(e => `${e.start}>${e.end}`)).toEqual(['A>B', 'B>C'])
    expect(diagram.blocks).toHaveLength(3)
  })

  it('reads a bidirectional edge', () => {
    const edge = parse('block\nA <--> B').edges[0]!
    expect(edge.arrowStart).toBe(true)
    expect(edge.arrowEnd).toBe(true)
  })

  it('does not duplicate a block already declared', () => {
    const diagram = parse('block\nA["first"]\nA --> B')
    expect(diagram.blocks).toHaveLength(2)
    expect(diagram.blocks[0]!.label).toBe('first')
  })
})

describe('block parser — styling', () => {
  it('classDef statements applied to a block', () => {
    const diagram = parse(`block
      classDef black color:#ffffff, fill:#000000;
      mc["Memcache"]
      class mc black`)

    expect(diagram.blocks).toHaveLength(1)
    expect(diagram.blocks[0]!.classes).toContain('black')

    const black = diagram.classes.get('black')!
    expect(black.id).toBe('black')
    expect(black.styles[0]).toBe('color:#ffffff')
    expect(black.styles[1]).toBe('fill:#000000')
  })

  it('style statements applied to a block', () => {
    const diagram = parse(`block
      columns 1
      B["A wide one in the middle"]
      style B fill:#f9F,stroke:#333,stroke-width:4px`)

    expect(diagram.blocks).toHaveLength(1)
    expect(diagram.blocks[0]!.styles).toContain('fill:#f9F')
    expect(diagram.blocks[0]!.styles).toContain('stroke-width:4px')
  })

  it('applies a class to several blocks at once', () => {
    const diagram = parse('block\na\nb\nclass a,b hot')
    expect(diagram.blocks[0]!.classes).toContain('hot')
    expect(diagram.blocks[1]!.classes).toContain('hot')
  })

  it('reads the ::: class shorthand', () => {
    const diagram = parse('block\na["A"]:::hot')
    expect(diagram.blocks[0]!.classes).toContain('hot')
    expect(diagram.blocks[0]!.label).toBe('A')
  })

  it('ignores a class assigned to an unknown block', () => {
    expect(() => parse('block\na\nclass nope hot')).not.toThrow()
  })
})

describe('block parser — edge cases', () => {
  it('parses a bare header', () => {
    expect(parse('block-beta').blocks).toEqual([])
  })

  it('reads a title', () => {
    expect(parse('block-beta\ntitle My blocks\na').title).toBe('My blocks')
  })

  it('ignores comments', () => {
    expect(parse('block-beta\n%% a comment\na').blocks).toHaveLength(1)
  })

  it('works with a __proto__ property', () => {
    const diagram = parse('block\n__proto__')
    expect(diagram.blocks).toHaveLength(1)
    expect(diagram.blocks[0]!.id).toBe('__proto__')
  })

  it('works with a constructor property', () => {
    const diagram = parse('block\nconstructor')
    expect(diagram.blocks[0]!.id).toBe('constructor')
  })

  it('works with __proto__ as a class name', () => {
    expect(() =>
      parse('block\nA\nclassDef __proto__ color:#ffffff,fill:#000000;\nclass A __proto__')
    ).not.toThrow()
  })

  it('accepts the block-beta header', () => {
    expect(parse('block-beta\ncolumns 2\na\nb').blocks).toHaveLength(2)
  })

  it('does not treat the header as a composite', () => {
    const diagram = parse('block\na["A"]')
    expect(diagram.blocks[0]!.shape).toBe('square')
  })
})
