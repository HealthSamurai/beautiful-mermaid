import { describe, expect, it } from 'bun:test'
import { parseGitGraphDiagram } from '../gitgraph/parser.ts'

// ============================================================================
// Git graph parser tests
//
// The upstream-parity block ports
// packages/mermaid/src/diagrams/git/gitGraph.spec.ts, which asserts on the
// replayed history (commit count, current branch, parents) rather than on a
// statement list — so these tests check the same simulation.
// ============================================================================

/** Preprocess like src/index.ts does before handing lines to the parser. */
function lines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
}

function parse(text: string) {
  return parseGitGraphDiagram(lines(text))
}

describe('gitgraph parser — basics', () => {
  it('handles a gitGraph definition', () => {
    const graph = parse('gitGraph:\n commit\n')
    expect(graph.commits).toHaveLength(1)
    expect(graph.currentBranch).toBe('main')
    expect(graph.direction).toBe('LR')
    expect(graph.branches).toHaveLength(1)
  })

  it('handles direction top to bottom', () => {
    const graph = parse('gitGraph TB:\ncommit\n')
    expect(graph.commits).toHaveLength(1)
    expect(graph.direction).toBe('TB')
  })

  it('handles direction bottom to top', () => {
    const graph = parse('gitGraph BT:\ncommit\n')
    expect(graph.commits).toHaveLength(1)
    expect(graph.direction).toBe('BT')
  })

  it('checks out a branch', () => {
    const graph = parse('gitGraph:\nbranch new\ncheckout new\n')
    expect(graph.commits).toHaveLength(0)
    expect(graph.currentBranch).toBe('new')
  })

  it('switches a branch', () => {
    const graph = parse('gitGraph:\nbranch new\nswitch new\n')
    expect(graph.commits).toHaveLength(0)
    expect(graph.currentBranch).toBe('new')
  })

  it('does not check out on branch creation alone', () => {
    const graph = parse('gitGraph:\nbranch new\ncommit\n')
    expect(graph.currentBranch).toBe('main')
    expect(graph.commits[0]!.branch).toBe('main')
  })

  it('adds commits to the checked out branch', () => {
    const graph = parse('gitGraph:\nbranch new\ncheckout new\ncommit\ncommit\n')
    expect(graph.commits).toHaveLength(2)
    expect(graph.currentBranch).toBe('new')
    expect(graph.commits.every(c => c.branch === 'new')).toBe(true)
    // The second commit descends from the first
    expect(graph.commits[1]!.parents).toEqual([graph.commits[0]!.id])
  })

  it('handles commit with a shorthand message', () => {
    const graph = parse('gitGraph:\ncommit "a commit"\n')
    expect(graph.commits).toHaveLength(1)
    expect(graph.commits[0]!.message).toBe('a commit')
    expect(graph.currentBranch).toBe('main')
  })

  it('handles a merge that is a noop', () => {
    const graph = parse(`gitGraph:
      commit
      branch newbranch
      checkout newbranch
      commit
      commit
      merge main`)
    expect(graph.commits).toHaveLength(4)
    expect(graph.currentBranch).toBe('newbranch')
  })

  it('handles a merge with two parents', () => {
    const graph = parse(`gitGraph:
      commit
      branch newbranch
      checkout newbranch
      commit
      commit
      checkout main
      commit
      merge newbranch`)
    expect(graph.commits).toHaveLength(5)
    expect(graph.currentBranch).toBe('main')

    const merge = graph.commits[4]!
    expect(merge.type).toBe('merge')
    expect(merge.parents).toHaveLength(2)
    expect(merge.branch).toBe('main')
  })

  it('generates an array of known branches', () => {
    const graph = parse(`gitGraph:
      commit
      branch b1
      checkout b1
      commit
      commit
      branch b2`)
    expect(graph.branches).toHaveLength(3)
    expect(graph.branches.map(b => b.name)).toEqual(['main', 'b1', 'b2'])
  })
})

describe('gitgraph parser — commit options', () => {
  it('auto-generates an id when none is given', () => {
    const graph = parse('gitGraph:\ncommit\ncommit')
    expect(graph.commits[0]!.id).not.toBe(graph.commits[1]!.id)
  })

  it('handles a custom commit id only', () => {
    const graph = parse('gitGraph:\ncommit id: "Alpha"')
    expect(graph.commits[0]!.id).toBe('Alpha')
    expect(graph.commits[0]!.type).toBe('normal')
  })

  it('handles a custom commit tag only', () => {
    const graph = parse('gitGraph:\ncommit tag: "v1.0.0"')
    expect(graph.commits[0]!.tags).toEqual(['v1.0.0'])
  })

  it('handles commit type HIGHLIGHT', () => {
    expect(parse('gitGraph:\ncommit type: HIGHLIGHT').commits[0]!.type).toBe('highlight')
  })

  it('handles commit type REVERSE', () => {
    expect(parse('gitGraph:\ncommit type: REVERSE').commits[0]!.type).toBe('reverse')
  })

  it('handles commit type NORMAL', () => {
    expect(parse('gitGraph:\ncommit type: NORMAL').commits[0]!.type).toBe('normal')
  })

  it('handles a custom commit message via msg:', () => {
    expect(parse('gitGraph:\ncommit msg: "msg only"').commits[0]!.message).toBe('msg only')
  })

  it('handles id and tag together', () => {
    const commit = parse('gitGraph:\ncommit id: "A" tag: "T"').commits[0]!
    expect(commit.id).toBe('A')
    expect(commit.tags).toEqual(['T'])
  })

  it('handles type and tag together', () => {
    const commit = parse('gitGraph:\ncommit type: REVERSE tag: "T"').commits[0]!
    expect(commit.type).toBe('reverse')
    expect(commit.tags).toEqual(['T'])
  })

  it('handles id, type, tag and msg together', () => {
    const commit = parse('gitGraph:\ncommit id: "A" type: HIGHLIGHT tag: "T" msg: "m"').commits[0]!
    expect(commit.id).toBe('A')
    expect(commit.type).toBe('highlight')
    expect(commit.tags).toEqual(['T'])
    expect(commit.message).toBe('m')
  })

  it('accepts commit options in any order', () => {
    const commit = parse('gitGraph:\ncommit type: HIGHLIGHT tag: "T" msg: "m" id: "A"').commits[0]!
    expect(commit.id).toBe('A')
    expect(commit.type).toBe('highlight')
    expect(commit.tags).toEqual(['T'])
    expect(commit.message).toBe('m')
  })

  it('records the sequence number in creation order', () => {
    const graph = parse('gitGraph:\ncommit\ncommit\ncommit')
    expect(graph.commits.map(c => c.seq)).toEqual([0, 1, 2])
  })
})

describe('gitgraph parser — branches', () => {
  it('handles three straight commits', () => {
    const graph = parse('gitGraph:\ncommit\ncommit\ncommit')
    expect(graph.commits).toHaveLength(3)
    expect(graph.branches).toHaveLength(1)
  })

  it('allows quoted branch names', () => {
    const graph = parse('gitGraph:\nbranch "feature/x"\ncheckout "feature/x"')
    expect(graph.branches.map(b => b.name)).toEqual(['main', 'feature/x'])
    expect(graph.currentBranch).toBe('feature/x')
  })

  it('allows _-./ characters in branch names', () => {
    const graph = parse('gitGraph:\nbranch my-branch_1.0/x')
    expect(graph.branches[1]!.name).toBe('my-branch_1.0/x')
  })

  it('allows branch names starting with numbers', () => {
    const graph = parse('gitGraph:\nbranch 1.0.0')
    expect(graph.branches[1]!.name).toBe('1.0.0')
  })

  it('handles a branch with an explicit order', () => {
    const graph = parse('gitGraph:\nbranch b1 order: 3')
    expect(graph.branches[1]).toEqual({ name: 'b1', order: 3 })
  })

  it('defaults a branch order to its creation position', () => {
    const graph = parse('gitGraph:\nbranch b1\nbranch b2')
    expect(graph.branches.map(b => b.order)).toEqual([0, 1, 2])
  })

  it('starts a new branch at the current head', () => {
    const graph = parse('gitGraph:\ncommit\nbranch feature\ncheckout feature\ncommit')
    expect(graph.commits[1]!.parents).toEqual([graph.commits[0]!.id])
  })

  it('ignores a checkout of an unknown branch', () => {
    const graph = parse('gitGraph:\ncheckout nope\ncommit')
    expect(graph.currentBranch).toBe('main')
  })

  it('does not duplicate a re-declared branch', () => {
    const graph = parse('gitGraph:\nbranch b1\nbranch b1')
    expect(graph.branches).toHaveLength(2)
  })
})

describe('gitgraph parser — cherry-pick', () => {
  it('supports cherry-picking commits', () => {
    const graph = parse(`gitGraph
      commit id: "ZERO"
      branch develop
      commit id:"A"
      checkout main
      cherry-pick id:"A"`)
    const cherry = graph.commits[2]!
    expect(cherry.tags).toEqual(['cherry-pick:A'])
    expect(cherry.branch).toBe('main')
    expect(cherry.type).toBe('cherry-pick')
  })

  it('supports cherry-picking with a custom tag', () => {
    const graph = parse(`gitGraph
      commit id: "ZERO"
      branch develop
      commit id:"A"
      checkout main
      cherry-pick id:"A" tag:"MyTag"`)
    expect(graph.commits[2]!.tags).toEqual(['MyTag'])
  })

  it('supports cherry-picking with an explicitly empty tag', () => {
    const graph = parse(`gitGraph
      commit id: "ZERO"
      branch develop
      commit id:"A"
      checkout main
      cherry-pick id:"A" tag:""`)
    expect(graph.commits[2]!.tags).toEqual([])
  })

  it('records the parent when cherry-picking a merge commit', () => {
    const graph = parse(`gitGraph
      commit id: "ZERO"
      branch feature
      branch release
      checkout feature
      commit id: "A"
      commit id: "B"
      checkout main
      merge feature id: "M"
      checkout release
      cherry-pick id: "M" parent:"B"`)
    const cherry = graph.commits[4]!
    expect(cherry.tags).toEqual(['cherry-pick:M|parent:B'])
    expect(cherry.branch).toBe('release')
  })

  it('ignores a cherry-pick with no id', () => {
    const graph = parse('gitGraph\ncommit\ncherry-pick')
    expect(graph.commits).toHaveLength(1)
  })
})

describe('gitgraph parser — merge options', () => {
  it('accepts a custom merge id', () => {
    const graph = parse(`gitGraph
      commit
      branch feature
      checkout feature
      commit
      checkout main
      merge feature id: "M"`)
    expect(graph.commits[2]!.id).toBe('M')
  })

  it('accepts a merge tag', () => {
    const graph = parse(`gitGraph
      commit
      branch feature
      checkout feature
      commit
      checkout main
      merge feature tag: "v1"`)
    expect(graph.commits[2]!.tags).toEqual(['v1'])
  })

  it('accepts a merge type override', () => {
    const graph = parse(`gitGraph
      commit
      branch feature
      checkout feature
      commit
      checkout main
      merge feature type: HIGHLIGHT`)
    expect(graph.commits[2]!.type).toBe('highlight')
  })
})

describe('gitgraph parser — edge cases', () => {
  it('parses a bare gitGraph header', () => {
    const graph = parse('gitGraph')
    expect(graph.commits).toEqual([])
    expect(graph.branches.map(b => b.name)).toEqual(['main'])
  })

  it('parses a title on its own line', () => {
    expect(parse('gitGraph\ntitle My history\ncommit').title).toBe('My history')
  })

  it('ignores comments', () => {
    const graph = parse('gitGraph\n%% a comment\ncommit')
    expect(graph.commits).toHaveLength(1)
  })

  it('ignores accessibility metadata', () => {
    const graph = parse('gitGraph\naccTitle: t\naccDescr: d\ncommit')
    expect(graph.commits).toHaveLength(1)
    expect(graph.title).toBeUndefined()
  })

  it('leaves the first commit parentless', () => {
    expect(parse('gitGraph\ncommit').commits[0]!.parents).toEqual([])
  })

  it('is case-insensitive on keywords', () => {
    const graph = parse('GITGRAPH\nCOMMIT\nBRANCH b1\nCHECKOUT b1\nCOMMIT')
    expect(graph.commits).toHaveLength(2)
    expect(graph.currentBranch).toBe('b1')
  })

  it('defaults an untyped commit to normal', () => {
    expect(parse('gitGraph\ncommit').commits[0]!.type).toBe('normal')
  })

  it('leaves tags empty when none are given', () => {
    expect(parse('gitGraph\ncommit').commits[0]!.tags).toEqual([])
  })
})
