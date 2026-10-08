import type {
  PositionedRelation,
  PositionedRequirementDiagram,
  PositionedRequirementNode,
  RelationshipType,
} from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT, estimateTextWidth } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'
import { REQUIREMENT_METRICS as R } from './layout.ts'

// ============================================================================
// Requirement diagram SVG renderer
//
// Renders a positioned requirement diagram to an SVG string. Requirements and
// elements take different palette indices, so the two halves of a
// traceability picture — what is asked for, and what provides it — are
// distinguishable at a glance.
//
// Render order (back to front):
//   1. Edges and their labels
//   2. Boxes
//   3. Box text
//   4. Title
// ============================================================================

const RADIUS = 5

/** Arrowhead marker ids, one per line style. */
const MARKER_SOLID = 'req-arrow-solid'
const MARKER_DASHED = 'req-arrow-dashed'

/**
 * Relationships drawn with a solid line.
 *
 * `contains` and `copies` assert a structural fact about the model, so they
 * take the solid line that composition takes elsewhere in SysML; the rest are
 * derived claims and get a dashed one.
 */
const SOLID: ReadonlySet<RelationshipType> = new Set(['contains', 'copies'])

/**
 * Render a positioned requirement diagram as a self-contained SVG string.
 */
export function renderRequirementSvg(
  chart: PositionedRequirementDiagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set(chart.nodes.map(n => n.colorIndex))

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(requirementStyles(colorIndices, colors.accent, colors.bg))
  parts.push(arrowMarkers())

  for (const edge of chart.edges) {
    parts.push(...renderEdge(edge))
  }

  for (const node of chart.nodes) {
    parts.push(...renderNode(node))
  }

  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${R.titleFontSize}" font-weight="${R.titleFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="req-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Draw one box: its rectangle, its header rule, its name and its rows. */
function renderNode(node: PositionedRequirementNode): string[] {
  const parts: string[] = []
  const { x, y, width: w, height: h } = node

  const classes = ['req-node', `req-${node.kind}`, `req-fill-${node.colorIndex}`]
  if (node.classes.length > 0) {
    classes.push(...node.classes.map(c => escapeXml(c)))
  }
  const style = node.style ? ` style="${escapeXml(node.style)}"` : ''

  parts.push(
    `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ` +
    `rx="${RADIUS}" ry="${RADIUS}" class="${classes.join(' ')}"${style} ` +
    `data-name="${escapeXml(node.name)}" data-kind="${node.kind}">` +
    `<title>${escapeXml(tooltip(node))}</title></rect>`
  )

  // A rule under the header, so the name is separated from the fields
  if (node.rows.length > 0) {
    parts.push(
      `<line x1="${r(x)}" y1="${r(y + node.headerHeight)}" ` +
      `x2="${r(x + w)}" y2="${r(y + node.headerHeight)}" class="req-rule"/>`
    )
  }

  // «requirement» — the stereotype, centred above the name
  parts.push(
    `<text x="${r(x + w / 2)}" y="${r(y + R.boxPadY + R.stereotypeHeight / 2)}" ` +
    `text-anchor="middle" font-size="${R.stereotypeFontSize}" ` +
    `font-weight="${R.stereotypeFontWeight}" dy="${TEXT_BASELINE_SHIFT}" ` +
    `class="req-stereotype">\u00AB${escapeXml(node.stereotype)}\u00BB</text>`
  )

  const nameTop = y + R.boxPadY + R.stereotypeHeight
  for (const [index, line] of node.nameLines.entries()) {
    parts.push(
      `<text x="${r(x + w / 2)}" ` +
      `y="${r(nameTop + index * R.nameLineHeight + R.nameLineHeight / 2)}" ` +
      `text-anchor="middle" font-size="${R.nameFontSize}" ` +
      `font-weight="${R.nameFontWeight}" dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="req-name">${escapeXml(line)}</text>`
    )
  }

  const rowTop = y + node.headerHeight + R.bodyGap
  for (const [index, row] of node.rows.entries()) {
    parts.push(
      `<text x="${r(x + R.boxPadX)}" ` +
      `y="${r(rowTop + index * R.rowHeight + R.rowHeight / 2)}" ` +
      `font-size="${R.rowFontSize}" font-weight="${R.rowFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="req-row">` +
      `<tspan class="req-row-label">${escapeXml(row.label)}: </tspan>` +
      `${escapeXml(row.value)}</text>`
    )
  }

  return parts
}

/**
 * Accessible description of a box.
 *
 * The rows are spelled out, because a reader who cannot see the box still
 * needs the risk and the verification method — those are the parts a
 * requirement is audited against.
 */
function tooltip(node: PositionedRequirementNode): string {
  const head = `${node.stereotype}: ${node.name}`
  if (node.rows.length === 0) return head
  return `${head} (${node.rows.map(row => `${row.label}: ${row.value}`).join(', ')})`
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** Draw one relationship: its line, its arrowhead and its label. */
function renderEdge(edge: PositionedRelation): string[] {
  const solid = SOLID.has(edge.type)
  const marker = solid ? MARKER_SOLID : MARKER_DASHED

  const parts: string[] = [
    `<path d="${edge.path}" class="req-edge req-edge-${edge.type}` +
    `${solid ? '' : ' req-edge-derived'}" marker-end="url(#${marker})" ` +
    `data-relation="${edge.type}" data-src="${escapeXml(edge.src)}" ` +
    `data-dst="${escapeXml(edge.dst)}">` +
    `<title>${escapeXml(`${edge.src} ${edge.type} ${edge.dst}`)}</title></path>`,
  ]

  // A chip behind the label, so the text stays readable over the line
  const width = estimateTextWidth(
    edge.label.text, R.edgeLabelFontSize, R.edgeLabelFontWeight,
  ) + 8
  const height = R.edgeLabelFontSize + 5

  parts.push(
    `<rect x="${r(edge.label.x - width / 2)}" y="${r(edge.label.y - height / 2)}" ` +
    `width="${r(width)}" height="${r(height)}" rx="3" ry="3" class="req-edge-label-bg"/>`
  )
  parts.push(
    `<text x="${r(edge.label.x)}" y="${r(edge.label.y)}" text-anchor="middle" ` +
    `font-size="${R.edgeLabelFontSize}" font-weight="${R.edgeLabelFontWeight}" ` +
    `dy="${TEXT_BASELINE_SHIFT}" class="req-edge-label">` +
    `${escapeXml(edge.label.text)}</text>`
  )

  return parts
}

/** Arrowhead markers — one open and one filled, matching the line styles. */
function arrowMarkers(): string {
  const path = 'M0,0 L10,5 L0,10 z'
  return (
    `<defs>` +
    `<marker id="${MARKER_SOLID}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="${path}" class="req-arrowhead"/></marker>` +
    `<marker id="${MARKER_DASHED}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="${path}" class="req-arrowhead req-arrowhead-open"/></marker>` +
    `</defs>`
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Build the requirement diagram stylesheet.
 *
 * Index 0 is requirements and index 1 is elements, so the palette says which
 * side of the traceability a box is on.
 */
function requirementStyles(
  colorIndices: Set<number>,
  themeAccent?: string,
  bgColor?: string,
): string {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const sorted = [...colorIndices].sort((a, b) => a - b)

  const varDefs: string[] = []
  const rules: string[] = []

  for (const idx of sorted) {
    // Index 0 resolves through var(--accent) so live theme switching works
    const value = idx === 0
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : getSeriesColor(idx, accentHex, bgColor)
    varDefs.push(`    --req-color-${idx}: ${value};`)
    rules.push(
      `  .req-fill-${idx} { ` +
      `fill: color-mix(in srgb, var(--req-color-${idx}) 8%, var(--bg)); ` +
      `stroke: color-mix(in srgb, var(--req-color-${idx}) 45%, var(--bg)); }`
    )
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .req-node { stroke-width: 1.5; }
  .req-rule { stroke: var(--_inner-stroke); stroke-width: 1; }
  .req-stereotype { fill: var(--_text-muted); }
  .req-name { fill: var(--_text); }
  .req-row { fill: var(--_text); }
  .req-row-label { fill: var(--_text-sec); }
  .req-edge { fill: none; stroke: var(--_line); stroke-width: 1.5; }
  .req-edge-derived { stroke-dasharray: 5 3; }
  .req-arrowhead { fill: var(--_arrow); stroke: none; }
  .req-arrowhead-open { fill: var(--bg); stroke: var(--_arrow); stroke-width: 1.5; }
  .req-edge-label-bg { fill: var(--bg); stroke: none; }
  .req-edge-label { fill: var(--_text-sec); }
  .req-title { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

/** Round to two decimals, keeping paths short without visible drift. */
function r(value: number): number {
  return Math.round(value * 100) / 100
}
