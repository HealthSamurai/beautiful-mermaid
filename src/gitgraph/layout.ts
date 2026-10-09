import type {
  GitGraphDiagram, GitGraphEdge, PositionedGitBranch, PositionedGitCommit,
  PositionedGitGraph, PositionedGitTag,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, widthForTitle } from '../styles.ts'

// ============================================================================
// Git graph layout engine
//
// One lane per branch, one slot per commit in sequence order. In LR the lanes
// are rows and commits advance rightwards; in TB/BT the lanes are columns and
// commits advance down or up.
//
// Only branches that actually carry a commit get a lane, so a declared but
// unused branch costs no space.
// ============================================================================

/** Layout constants. */
const G = {
  padding: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 42,
  /** Distance between commit slots along the time axis */
  commitStride: 62,
  /** Distance between branch lanes */
  laneStride: 56,
  /** Commit node radius */
  radius: 10,
  branchFontSize: 13,
  branchFontWeight: 600,
  commitFontSize: 11,
  commitFontWeight: 400,
  tagFontSize: 10,
  tagFontWeight: 500,
  /** Gap between a commit node and its label */
  labelGap: 16,
  /** Gap between a commit node and its tag chip */
  tagGap: 18,
  /** Horizontal padding inside a tag chip */
  tagPadX: 6,
  tagHeight: 16,
} as const

/**
 * Lay out a parsed git graph: assign each branch a lane and each commit a
 * slot from its sequence number, then connect parents to children.
 */
export function layoutGitGraph(
  diagram: GitGraphDiagram,
  _options: RenderOptions = {},
): PositionedGitGraph {
  const vertical = diagram.direction !== 'LR'

  // Only branches with commits get a lane, ordered by their declared order
  const used = new Set(diagram.commits.map(c => c.branch))
  const lanes = diagram.branches
    .filter(b => used.has(b.name))
    .sort((a, b) => a.order - b.order)

  const laneIndex = new Map(lanes.map((b, i) => [b.name, i]))
  const colorIndex = new Map(lanes.map((b, i) => [b.name, i]))

  // Commit slots follow sequence order, so time reads consistently
  const slot = new Map(diagram.commits.map((c, i) => [c.id, i]))

  return vertical
    ? layoutVertical(diagram, lanes, laneIndex, colorIndex, slot)
    : layoutHorizontal(diagram, lanes, laneIndex, colorIndex, slot)
}

// ============================================================================
// Horizontal layout (LR) — lanes are rows, commits advance rightwards
// ============================================================================

function layoutHorizontal(
  diagram: GitGraphDiagram,
  lanes: readonly { name: string }[],
  laneIndex: Map<string, number>,
  colorIndex: Map<string, number>,
  slot: Map<string, number>,
): PositionedGitGraph {
  const hasTitle = !!diagram.title

  // Branch labels sit in a left gutter, which grows to fit the widest name
  const gutter = lanes.reduce(
    (max, b) => Math.max(max, estimateTextWidth(b.name, G.branchFontSize, G.branchFontWeight)),
    0,
  )
  const laneLeft = G.padding + (gutter > 0 ? gutter + G.labelGap : 0)
  const top = G.padding + (hasTitle ? G.titleHeight : 0) + G.tagGap

  const slotCount = Math.max(1, diagram.commits.length)
  const laneRight = laneLeft + slotCount * G.commitStride
  const width = widthForTitle(
    laneRight + G.padding,
    diagram.title,
    G.titleFontSize,
    G.titleFontWeight,
    G.padding,
  )
  const height = top + Math.max(1, lanes.length) * G.laneStride + G.labelGap + G.padding

  const laneY = (name: string) => top + (laneIndex.get(name) ?? 0) * G.laneStride + G.laneStride / 2
  const commitX = (id: string) => laneLeft + ((slot.get(id) ?? 0) + 0.5) * G.commitStride

  const positionedBranches: PositionedGitBranch[] = lanes.map(branch => {
    const y = laneY(branch.name)
    return {
      name: branch.name,
      line: { x1: laneLeft, y1: y, x2: laneRight, y2: y },
      labelX: laneLeft - G.labelGap,
      labelY: y,
      labelAnchor: 'end' as const,
      colorIndex: colorIndex.get(branch.name) ?? 0,
    }
  })

  const commits: PositionedGitCommit[] = diagram.commits.map(commit => {
    const cx = commitX(commit.id)
    const cy = laneY(commit.branch)
    return {
      id: commit.id,
      label: commit.message || commit.id,
      type: commit.type,
      cx,
      cy,
      radius: G.radius,
      labelX: cx,
      labelY: cy + G.radius + G.labelGap,
      labelAnchor: 'middle' as const,
      colorIndex: colorIndex.get(commit.branch) ?? 0,
    }
  })

  const edges = buildEdges(diagram, id => commitX(id), id => laneY(branchOf(diagram, id)), colorIndex)
  const tags = buildTags(diagram, id => commitX(id), id => laneY(branchOf(diagram, id)) - G.tagGap, colorIndex)

  return {
    width: Math.round(width),
    height: Math.round(height),
    direction: diagram.direction,
    title: diagram.title
      ? { text: diagram.title, x: width / 2, y: G.padding + G.titleFontSize }
      : undefined,
    branches: positionedBranches,
    commits,
    edges,
    tags,
  }
}

// ============================================================================
// Vertical layout (TB / BT) — lanes are columns, commits advance down or up
// ============================================================================

function layoutVertical(
  diagram: GitGraphDiagram,
  lanes: readonly { name: string }[],
  laneIndex: Map<string, number>,
  colorIndex: Map<string, number>,
  slot: Map<string, number>,
): PositionedGitGraph {
  const hasTitle = !!diagram.title
  const bottomUp = diagram.direction === 'BT'

  const top = G.padding + (hasTitle ? G.titleHeight : 0) + G.laneStride / 2
  const laneLeft = G.padding + G.laneStride / 2

  const slotCount = Math.max(1, diagram.commits.length)
  const laneBottom = top + slotCount * G.commitStride
  const width = widthForTitle(
    laneLeft + Math.max(1, lanes.length) * G.laneStride + G.padding,
    diagram.title,
    G.titleFontSize,
    G.titleFontWeight,
    G.padding,
  )
  const height = laneBottom + G.padding

  const laneX = (name: string) => laneLeft + (laneIndex.get(name) ?? 0) * G.laneStride
  const commitY = (id: string) => {
    const index = slot.get(id) ?? 0
    // BT puts the first commit at the bottom, so time reads upwards
    const offset = bottomUp ? slotCount - 1 - index : index
    return top + (offset + 0.5) * G.commitStride - G.commitStride / 2
  }

  const positionedBranches: PositionedGitBranch[] = lanes.map(branch => {
    const x = laneX(branch.name)
    return {
      name: branch.name,
      line: { x1: x, y1: top, x2: x, y2: laneBottom },
      labelX: x,
      labelY: G.padding + (hasTitle ? G.titleHeight : 0),
      labelAnchor: 'middle' as const,
      colorIndex: colorIndex.get(branch.name) ?? 0,
    }
  })

  const commits: PositionedGitCommit[] = diagram.commits.map(commit => {
    const cx = laneX(commit.branch)
    const cy = commitY(commit.id)
    return {
      id: commit.id,
      label: commit.message || commit.id,
      type: commit.type,
      cx,
      cy,
      radius: G.radius,
      labelX: cx + G.radius + G.labelGap / 2,
      labelY: cy,
      labelAnchor: 'start' as const,
      colorIndex: colorIndex.get(commit.branch) ?? 0,
    }
  })

  const edges = buildEdges(diagram, id => laneX(branchOf(diagram, id)), id => commitY(id), colorIndex)
  const tags = buildTags(
    diagram,
    id => laneX(branchOf(diagram, id)) - G.tagGap,
    id => commitY(id),
    colorIndex,
  )

  return {
    width: Math.round(width),
    height: Math.round(height),
    direction: diagram.direction,
    title: diagram.title
      ? { text: diagram.title, x: width / 2, y: G.padding + G.titleFontSize }
      : undefined,
    branches: positionedBranches,
    commits,
    edges,
    tags,
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Branch a commit id belongs to, for positioning a parent on its own lane. */
function branchOf(diagram: GitGraphDiagram, id: string): string {
  return diagram.commits.find(c => c.id === id)?.branch ?? diagram.branches[0]!.name
}

/**
 * One connector per parent-child pair. When parent and child share a lane the
 * path is a straight line; across lanes it is a cubic bezier, which is what
 * makes a branch or merge read as a curve.
 */
function buildEdges(
  diagram: GitGraphDiagram,
  xOf: (id: string) => number,
  yOf: (id: string) => number,
  colorIndex: Map<string, number>,
): GitGraphEdge[] {
  const known = new Set(diagram.commits.map(c => c.id))
  const out: GitGraphEdge[] = []

  for (const commit of diagram.commits) {
    for (const parent of commit.parents) {
      if (!known.has(parent)) continue

      const x1 = xOf(parent)
      const y1 = yOf(parent)
      const x2 = xOf(commit.id)
      const y2 = yOf(commit.id)

      out.push({
        path: Math.abs(y1 - y2) < 0.5 || Math.abs(x1 - x2) < 0.5
          ? `M${r(x1)},${r(y1)} L${r(x2)},${r(y2)}`
          : curve(x1, y1, x2, y2),
        colorIndex: colorIndex.get(commit.branch) ?? 0,
      })
    }
  }

  return out
}

/** Tag chips, sized to their text so they never clip. */
function buildTags(
  diagram: GitGraphDiagram,
  xOf: (id: string) => number,
  yOf: (id: string) => number,
  colorIndex: Map<string, number>,
): PositionedGitTag[] {
  const out: PositionedGitTag[] = []

  for (const commit of diagram.commits) {
    for (const [i, tag] of commit.tags.entries()) {
      const textWidth = estimateTextWidth(tag, G.tagFontSize, G.tagFontWeight)
      const chipWidth = textWidth + G.tagPadX * 2

      out.push({
        text: tag,
        x: xOf(commit.id) - chipWidth / 2,
        y: yOf(commit.id) - G.tagHeight / 2 - i * (G.tagHeight + 3),
        width: chipWidth,
        height: G.tagHeight,
        colorIndex: colorIndex.get(commit.branch) ?? 0,
      })
    }
  }

  return out
}

/** A cubic bezier that leaves the parent flat and enters the child flat. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2
  return `M${r(x1)},${r(y1)} C${r(midX)},${r(y1)} ${r(midX)},${r(y2)} ${r(x2)},${r(y2)}`
}

function r(n: number): number {
  return Math.round(n * 10) / 10
}
