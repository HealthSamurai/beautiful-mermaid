import { describe, expect, it } from 'bun:test'
import { parseMindmapDiagram } from '../mindmap/parser.ts'

// ============================================================================
// Mindmap parser tests
//
// The upstream-parity block ports
// packages/mermaid/src/diagrams/mindmap/mindmap.spec.ts, keeping its MMP-N
// case numbering so the two suites can be compared line by line.
//
// Unlike the other parsers this one takes raw text: indentation carries the
// hierarchy, so it must not be trimmed.
// ============================================================================

function parse(text: string) {
  return parseMindmapDiagram(text)
}

/** The root node, asserted to exist — most cases are about its shape. */
function root(text: string) {
  const diagram = parse(text)
  if (!diagram.root) throw new Error('expected a root node')
  return diagram.root
}

describe('mindmap parser — hierarchy', () => {
  it('MMP-1 handles a simple root definition', () => {
    expect(root('mindmap\n    root').descr).toBe('root')
  })

  it('MMP-2 handles a hierarchical mindmap definition', () => {
    const mm = root(`mindmap
    root
      child1
      child2
 `)
    expect(mm.descr).toBe('root')
    expect(mm.children).toHaveLength(2)
    expect(mm.children[0]!.descr).toBe('child1')
    expect(mm.children[1]!.descr).toBe('child2')
  })

  it('3 handles a root with a shape and no id', () => {
    expect(root('mindmap\n    (root)').descr).toBe('root')
  })

  it('MMP-4 handles a deeper hierarchical definition', () => {
    const mm = root(`mindmap
    root
      child1
        leaf1
      child2`)
    expect(mm.descr).toBe('root')
    expect(mm.children).toHaveLength(2)
    expect(mm.children[0]!.descr).toBe('child1')
    expect(mm.children[0]!.children[0]!.descr).toBe('leaf1')
    expect(mm.children[1]!.descr).toBe('child2')
  })

  it('5 rejects multiple roots', () => {
    expect(() => parse('mindmap\n    root\n    fakeRoot')).toThrow(
      'There can be only one root. No parent could be found for ("fakeRoot")'
    )
  })

  it('MMP-6 rejects a real root in the wrong place', () => {
    expect(() => parse(`mindmap
          root
        fakeRoot
    realRootWrongPlace`)).toThrow(
      'There can be only one root. No parent could be found for ("fakeRoot")'
    )
  })
})

describe('mindmap parser — nodes', () => {
  it('MMP-7 handles an id and a rect shape', () => {
    const mm = root('mindmap\n    root[The root]\n      ')
    expect(mm.nodeId).toBe('root')
    expect(mm.descr).toBe('The root')
    expect(mm.shape).toBe('rect')
  })

  it('MMP-8 handles an id and a rounded shape on a child', () => {
    const mm = root('mindmap\n    root\n      theId(child1)')
    expect(mm.descr).toBe('root')
    expect(mm.children).toHaveLength(1)
    expect(mm.children[0]!.descr).toBe('child1')
    expect(mm.children[0]!.nodeId).toBe('theId')
    expect(mm.children[0]!.shape).toBe('rounded')
  })

  it('MMP-9 handles an unindented root with an indented child', () => {
    const mm = root('mindmap\nroot\n      theId(child1)')
    expect(mm.descr).toBe('root')
    expect(mm.children).toHaveLength(1)
    expect(mm.children[0]!.nodeId).toBe('theId')
    expect(mm.children[0]!.shape).toBe('rounded')
  })

  it('MMP-10 parses the circle shape', () => {
    const mm = root('mindmap\n root((the root))\n ')
    expect(mm.descr).toBe('the root')
    expect(mm.children).toHaveLength(0)
    expect(mm.shape).toBe('circle')
  })

  it('MMP-11 parses the cloud shape', () => {
    const mm = root('mindmap\n root)the root(\n')
    expect(mm.descr).toBe('the root')
    expect(mm.children).toHaveLength(0)
    expect(mm.shape).toBe('cloud')
  })

  it('MMP-12 parses the bang shape', () => {
    const mm = root('mindmap\n root))the root((\n')
    expect(mm.descr).toBe('the root')
    expect(mm.children).toHaveLength(0)
    expect(mm.shape).toBe('bang')
  })

  it('MMP-12-a parses the hexagon shape', () => {
    const mm = root('mindmap\n root{{the root}}\n')
    expect(mm.shape).toBe('hexagon')
    expect(mm.descr).toBe('the root')
    expect(mm.children).toHaveLength(0)
  })
})

describe('mindmap parser — decorations', () => {
  it('MMP-13 sets an icon for the node', () => {
    const mm = root('mindmap\n    root[The root]\n    ::icon(bomb)\n    ')
    expect(mm.nodeId).toBe('root')
    expect(mm.descr).toBe('The root')
    expect(mm.shape).toBe('rect')
    expect(mm.icon).toBe('bomb')
  })

  it('MMP-14 sets classes for the node', () => {
    const mm = root('mindmap\n    root[The root]\n    :::m-4 p-8\n    ')
    expect(mm.nodeId).toBe('root')
    expect(mm.descr).toBe('The root')
    expect(mm.class).toBe('m-4 p-8')
  })

  it('MMP-15 sets both classes and icon, classes first', () => {
    const mm = root('mindmap\n    root[The root]\n    :::m-4 p-8\n    ::icon(bomb)\n    ')
    expect(mm.shape).toBe('rect')
    expect(mm.class).toBe('m-4 p-8')
    expect(mm.icon).toBe('bomb')
  })

  it('MMP-16 sets both classes and icon, icon first', () => {
    const mm = root('mindmap\n    root[The root]\n    ::icon(bomb)\n    :::m-4 p-8\n    ')
    expect(mm.shape).toBe('rect')
    expect(mm.class).toBe('m-4 p-8')
    expect(mm.icon).toBe('bomb')
  })
})

describe('mindmap parser — descriptions', () => {
  it('MMP-17 allows node syntax inside a quoted description', () => {
    const mm = root('mindmap\n    root["String containing []"]\n')
    expect(mm.nodeId).toBe('root')
    expect(mm.descr).toBe('String containing []')
  })

  it('MMP-18 allows node syntax inside a child description', () => {
    const mm = root('mindmap\n    root["String containing []"]\n      child1["String containing ()"]\n')
    expect(mm.nodeId).toBe('root')
    expect(mm.descr).toBe('String containing []')
    expect(mm.children).toHaveLength(1)
    expect(mm.children[0]!.descr).toBe('String containing ()')
  })

  it('MMP-19 allows a child after a class assignment', () => {
    const mm = root(`mindmap
  root(Root)
    Child(Child)
    :::hot
      a(a)
      b[New Stuff]`)
    expect(mm.nodeId).toBe('root')
    expect(mm.descr).toBe('Root')
    expect(mm.children).toHaveLength(1)

    const child = mm.children[0]!
    expect(child.nodeId).toBe('Child')
    expect(child.class).toBe('hot')
    expect(child.children).toHaveLength(2)
    expect(child.children[0]!.nodeId).toBe('a')
    expect(child.children[1]!.nodeId).toBe('b')
  })
})

describe('mindmap parser — whitespace and comments', () => {
  it('MMP-20 tolerates meaningless empty rows', () => {
    const mm = root(`mindmap
    root

      child1

      child2
`)
    expect(mm.children).toHaveLength(2)
  })

  it('MMP-21 tolerates whole-line comments', () => {
    const mm = root(`mindmap
    root
    %% this is a comment
      child1
      child2`)
    expect(mm.children.map(c => c.descr)).toEqual(['child1', 'child2'])
  })

  it('MMP-22 tolerates comments at the end of a line', () => {
    const mm = root(`mindmap
    root
      child1 %% trailing
      child2`)
    expect(mm.children.map(c => c.descr)).toEqual(['child1', 'child2'])
  })

  it('MMP-23 ignores rows with only spaces', () => {
    const mm = root('mindmap\n    root\n      \n      child1')
    expect(mm.children).toHaveLength(1)
  })

  it('MMP-24 ignores rows above the mindmap declaration', () => {
    const mm = root('\n\nmindmap\n    root\n      child1')
    expect(mm.descr).toBe('root')
    expect(mm.children).toHaveLength(1)
  })
})

describe('mindmap parser — shape and edge cases', () => {
  it('returns no root for an empty mindmap', () => {
    expect(parse('mindmap').root).toBeUndefined()
  })

  it('returns no root when the header is missing', () => {
    expect(parse('root\n  child').root).toBeUndefined()
  })

  it('records the nesting level on every node', () => {
    const mm = root('mindmap\nroot\n  a\n    b')
    expect(mm.level).toBe(0)
    expect(mm.children[0]!.level).toBe(1)
    expect(mm.children[0]!.children[0]!.level).toBe(2)
  })

  it('uses the label as the id when no id is given', () => {
    expect(root('mindmap\n(just text)').nodeId).toBe('just text')
  })

  it('defaults the shape for a bare label', () => {
    expect(root('mindmap\nroot').shape).toBe('default')
  })

  it('treats dedenting as closing the deeper branch', () => {
    const mm = root(`mindmap
root
    a
        a1
    b`)
    expect(mm.children.map(c => c.descr)).toEqual(['a', 'b'])
    expect(mm.children[0]!.children.map(c => c.descr)).toEqual(['a1'])
  })

  it('ignores a decoration line with no node above it', () => {
    expect(() => parse('mindmap\n::icon(bomb)\nroot')).not.toThrow()
  })

  it('is case-insensitive on the header keyword', () => {
    expect(root('MindMap\nroot').descr).toBe('root')
  })

  it('keeps siblings in source order', () => {
    const mm = root('mindmap\nroot\n  c\n  a\n  b')
    expect(mm.children.map(c => c.descr)).toEqual(['c', 'a', 'b'])
  })
})
