import type { PositionedGitCommit, PositionedGitGraph } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'

// ============================================================================
// Git graph SVG renderer
//
// Renders a positioned git graph to an SVG string. Each branch gets its own
// palette index from the xychart generator, so a branch reads as one colour
// family from its lane line through its commits to its tags.
//
// Render order (back to front):
//   1. Branch lane lines
//   2. Parent-child connectors
//   3. Commit nodes (+ accessible <title>)
//   4. Commit labels
//   5. Tag chips
//   6. Branch name labels
//   7. Title
// ============================================================================

const FONT = {
  titleSize: 18,
  titleWeight: 600,
  branchSize: 13,
  branchWeight: 600,
  commitSize: 11,
  commitWeight: 400,
  tagSize: 10,
  tagWeight: 500,
} as const

/**
 * Render a positioned git graph as a self-contained SVG string.
 */
export function renderGitGraphSvg(
  chart: PositionedGitGraph,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set<number>([
    ...chart.branches.map(b => b.colorIndex),
    ...chart.commits.map(c => c.colorIndex),
    ...chart.edges.map(e => e.colorIndex),
    ...chart.tags.map(t => t.colorIndex),
  ])

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(gitGraphStyles(colorIndices, colors.accent, colors.bg))

  // 1. Branch lane lines
  for (const branch of chart.branches) {
    parts.push(
      `<line x1="${r(branch.line.x1)}" y1="${r(branch.line.y1)}" ` +
      `x2="${r(branch.line.x2)}" y2="${r(branch.line.y2)}" ` +
      `class="git-lane git-stroke-${branch.colorIndex}"/>`
    )
  }

  // 2. Connectors
  for (const edge of chart.edges) {
    parts.push(`<path d="${edge.path}" class="git-edge git-stroke-${edge.colorIndex}"/>`)
  }

  // 3. Commit nodes
  for (const commit of chart.commits) {
    parts.push(commitNode(commit))
  }

  // 4. Commit labels
  for (const commit of chart.commits) {
    parts.push(
      `<text x="${r(commit.labelX)}" y="${r(commit.labelY)}" text-anchor="${commit.labelAnchor}" ` +
      `font-size="${FONT.commitSize}" font-weight="${FONT.commitWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="git-commit-label">${escapeXml(commit.label)}</text>`
    )
  }

  // 5. Tag chips
  for (const tag of chart.tags) {
    parts.push(
      `<rect x="${r(tag.x)}" y="${r(tag.y)}" width="${r(tag.width)}" height="${r(tag.height)}" ` +
      `rx="3" ry="3" class="git-tag git-tag-${tag.colorIndex}"/>`
    )
    parts.push(
      `<text x="${r(tag.x + tag.width / 2)}" y="${r(tag.y + tag.height / 2)}" text-anchor="middle" ` +
      `font-size="${FONT.tagSize}" font-weight="${FONT.tagWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="git-tag-label">${escapeXml(tag.text)}</text>`
    )
  }

  // 6. Branch name labels
  for (const branch of chart.branches) {
    parts.push(
      `<text x="${r(branch.labelX)}" y="${r(branch.labelY)}" text-anchor="${branch.labelAnchor}" ` +
      `font-size="${FONT.branchSize}" font-weight="${FONT.branchWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="git-branch-label git-text-${branch.colorIndex}">` +
      `${escapeXml(branch.name)}</text>`
    )
  }

  // 7. Title
  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${FONT.titleSize}" font-weight="${FONT.titleWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="git-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Commit nodes
// ---------------------------------------------------------------------------

/**
 * Draw a commit node for its type:
 *   normal      — filled dot
 *   highlight   — larger dot with a heavy ring
 *   reverse     — dot crossed out
 *   merge       — hollow ring
 *   cherry-pick — small circle with a stalk
 */
function commitNode(commit: PositionedGitCommit): string {
  const cls = `git-commit git-commit-${commit.type} git-fill-${commit.colorIndex}`
  const data = `data-commit="${escapeXml(commit.id)}" data-type="${commit.type}"`
  const title = `<title>${escapeXml(commit.id)}${commit.label !== commit.id ? `: ${escapeXml(commit.label)}` : ''}</title>`
  const { cx, cy, radius } = commit

  switch (commit.type) {
    case 'merge':
      return (
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}" ` +
        `class="${cls} git-stroke-${commit.colorIndex}" ${data}>${title}</circle>`
      )
    case 'highlight':
      return (
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius + 2)}" ` +
        `class="${cls} git-stroke-${commit.colorIndex}" ${data}>${title}</circle>`
      )
    case 'reverse': {
      const d = radius * 0.7
      return (
        `<g class="git-commit-group" ${data}>${title}` +
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}" class="${cls}"/>` +
        `<line x1="${r(cx - d)}" y1="${r(cy - d)}" x2="${r(cx + d)}" y2="${r(cy + d)}" class="git-reverse-mark"/>` +
        `<line x1="${r(cx - d)}" y1="${r(cy + d)}" x2="${r(cx + d)}" y2="${r(cy - d)}" class="git-reverse-mark"/>` +
        `</g>`
      )
    }
    case 'cherry-pick':
      return (
        `<g class="git-commit-group" ${data}>${title}` +
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius * 0.7)}" class="${cls}"/>` +
        `<line x1="${r(cx)}" y1="${r(cy - radius * 0.7)}" x2="${r(cx + radius * 0.8)}" y2="${r(cy - radius * 1.5)}" ` +
        `class="git-cherry-stalk git-stroke-${commit.colorIndex}"/>` +
        `</g>`
      )
    case 'normal':
    default:
      return (
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}" class="${cls}" ${data}>${title}</circle>`
      )
  }
}

// ============================================================================
// Git-graph-specific CSS
//
// One `--git-color-N` custom property per branch. Index 0 resolves to
// var(--accent) so a host page swapping the theme accent recolours the first
// branch live; later indices come from the shared palette generator.
// ============================================================================

function gitGraphStyles(colorIndices: Set<number>, themeAccent?: string, bgColor?: string): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --git-color-${idx}: ${value};`)
    rules.push(`  .git-fill-${idx} { fill: var(--git-color-${idx}); }`)
    rules.push(`  .git-stroke-${idx} { stroke: var(--git-color-${idx}); }`)
    rules.push(`  .git-text-${idx} { fill: var(--git-color-${idx}); }`)
    rules.push(
      `  .git-tag-${idx} { fill: color-mix(in srgb, var(--git-color-${idx}) 15%, var(--bg)); ` +
      `stroke: color-mix(in srgb, var(--git-color-${idx}) 40%, var(--bg)); }`
    )
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .git-lane { stroke-width: 2; opacity: 0.3; stroke-linecap: round; }
  .git-edge { fill: none; stroke-width: 2; opacity: 0.6; stroke-linecap: round; }
  .git-commit { stroke-width: 0; }
  .git-commit-merge { fill: var(--bg); stroke-width: 3; }
  .git-commit-highlight { stroke-width: 3; stroke: var(--bg); }
  .git-commit-label { fill: var(--_text-sec); }
  .git-reverse-mark { stroke: var(--bg); stroke-width: 2; stroke-linecap: round; }
  .git-cherry-stalk { stroke-width: 1.5; stroke-linecap: round; }
  .git-tag { stroke-width: 1; }
  .git-tag-label { fill: var(--_text); }
  .git-branch-label { font-weight: 600; }
  .git-title { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r(n: number): string {
  return String(Math.round(n * 10) / 10)
}
