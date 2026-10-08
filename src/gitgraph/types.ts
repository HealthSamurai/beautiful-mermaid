// ============================================================================
// Git graph types
//
// Models the parsed and positioned representations of a Mermaid `gitGraph`:
// a commit history built by replaying commit/branch/checkout/merge/cherry-pick
// statements in source order, the way git itself would.
//
// Parsing is therefore a simulation, not a transcription: `commit` means
// "append to whatever branch is checked out", so the parser tracks a current
// branch and a head per branch as it goes.
// ============================================================================

/** Layout direction. LR is the Mermaid default. */
export type GitGraphDirection = 'LR' | 'TB' | 'BT'

/**
 * Commit kind, which decides how the node is drawn.
 *
 *   normal      — a plain commit
 *   reverse     — a revert, drawn crossed out
 *   highlight   — drawn emphasised
 *   merge       — two parents, drawn as a ring
 *   cherry-pick — copied from elsewhere, drawn as a cherry
 */
export type GitCommitType = 'normal' | 'reverse' | 'highlight' | 'merge' | 'cherry-pick'

// ============================================================================
// Parsed git graph — logical structure from mermaid text
// ============================================================================

/** Parsed git graph. */
export interface GitGraphDiagram {
  /** Optional diagram title */
  title?: string
  /** Layout direction from the header line */
  direction: GitGraphDirection
  /** Branches in creation order, `main` always first */
  branches: GitBranch[]
  /** Commits in creation order */
  commits: GitCommit[]
  /** Branch checked out when parsing finished */
  currentBranch: string
}

/** A branch, with the display order Mermaid assigns it. */
export interface GitBranch {
  name: string
  /** Lane order — explicit `order:` wins, else creation order */
  order: number
}

/** One commit in the replayed history. */
export interface GitCommit {
  /** Commit id — explicit `id:` or an auto-generated sequence id */
  id: string
  /** Commit message from `commit "text"` or `msg:`, empty when absent */
  message: string
  /** Sequence number in creation order */
  seq: number
  type: GitCommitType
  /** Tags from `tag:"..."`, plus the cherry-pick provenance tag */
  tags: string[]
  /** Parent commit ids — two for a merge commit */
  parents: string[]
  /** Branch this commit lives on */
  branch: string
}

// ============================================================================
// Positioned git graph — ready for SVG rendering
// ============================================================================

export interface PositionedGitGraph {
  width: number
  height: number
  direction: GitGraphDirection
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** Branch lanes with their labels */
  branches: PositionedGitBranch[]
  /** Commit nodes in draw order */
  commits: PositionedGitCommit[]
  /** Connectors from a parent commit to a child commit */
  edges: GitGraphEdge[]
  /** Tag labels attached to commits */
  tags: PositionedGitTag[]
}

export interface PositionedGitBranch {
  name: string
  /** The lane line this branch's commits sit on */
  line: { x1: number; y1: number; x2: number; y2: number }
  /** Branch name label at the start of the lane */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
  /** Palette index — one colour per branch */
  colorIndex: number
}

export interface PositionedGitCommit {
  id: string
  /** Label shown under the node — the message, or the id when there is none */
  label: string
  type: GitCommitType
  cx: number
  cy: number
  radius: number
  /** Commit label anchor */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
  /** Palette index of the owning branch */
  colorIndex: number
}

export interface GitGraphEdge {
  /** Path from the parent node to the child node */
  path: string
  /** Palette index of the child commit's branch */
  colorIndex: number
}

export interface PositionedGitTag {
  text: string
  x: number
  y: number
  /** Tag chip box, sized to the text */
  width: number
  height: number
  /** Palette index of the tagged commit's branch */
  colorIndex: number
}
