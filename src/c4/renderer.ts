import type {
  PositionedC4Boundary,
  PositionedC4Diagram,
  PositionedC4Rel,
  PositionedC4Shape,
} from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml, safeCssValue, safeLinkUrl } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'
import { C4_METRICS as C } from './layout.ts'

// ============================================================================
// C4 diagram SVG renderer
//
// Renders a positioned C4 diagram to an SVG string. Each C4 tier — person,
// system, container, component, deployment node — takes a fixed palette
// index, so colour means the same thing in every C4 diagram the library
// draws; external shapes are drained of colour instead of given their own,
// because "outside our control" is an absence, not another category.
//
// Render order (back to front):
//   1. Boundaries, outermost first
//   2. Relationships and their labels
//   3. Shapes and their text
//   4. Legend
//   5. Title
// ============================================================================

const RADIUS = 5

const MARKER_END = 'c4-arrow-end'
const MARKER_START = 'c4-arrow-start'

/**
 * Render a positioned C4 diagram as a self-contained SVG string.
 */
export function renderC4Svg(
  chart: PositionedC4Diagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
): string {
  const parts: string[] = []

  const colorIndices = new Set(chart.shapes.map(s => s.colorIndex))

  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false))
  parts.push(c4Styles(colorIndices, colors.accent, colors.bg))
  parts.push(arrowMarkers())

  // 1. Boundaries, shallowest first so a nested one draws over its parent
  for (const boundary of [...chart.boundaries].sort((a, b) => a.depth - b.depth)) {
    parts.push(...renderBoundary(boundary))
  }

  for (const edge of chart.edges) {
    parts.push(...renderEdge(edge))
  }

  for (const shape of chart.shapes) {
    parts.push(...renderShape(shape))
  }

  for (const row of chart.legend) {
    parts.push(
      `<rect x="${r(row.x)}" y="${r(row.y - C.legendSwatch / 2)}" ` +
      `width="${C.legendSwatch}" height="${C.legendSwatch}" rx="3" ry="3" ` +
      `class="c4-legend-swatch c4-fill-${row.colorIndex}` +
      `${row.external ? ' c4-external' : ''}"/>`
    )
    parts.push(
      `<text x="${r(row.x + C.legendSwatch + 7)}" y="${r(row.y)}" ` +
      `font-size="${C.legendFontSize}" dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="c4-legend-label">${escapeXml(row.text)}</text>`
    )
  }

  if (chart.title) {
    parts.push(
      `<text x="${r(chart.title.x)}" y="${r(chart.title.y)}" text-anchor="middle" ` +
      `font-size="${C.titleFontSize}" font-weight="${C.titleFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="c4-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

/** Draw one boundary: a dashed outline with its label at the top. */
function renderBoundary(boundary: PositionedC4Boundary): string[] {
  const { x, y, width: w, height: h } = boundary
  const style = inlineStyle(boundary.style)

  const parts: string[] = [
    `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ` +
    `rx="${RADIUS}" ry="${RADIUS}" class="c4-boundary"${style} ` +
    `data-alias="${escapeXml(boundary.alias)}"` +
    `${boundary.tags ? ` data-tags="${escapeXml(boundary.tags)}"` : ''}>` +
    `<title>${escapeXml(`${boundary.label} [${boundary.typeLabel}]`)}</title></rect>`,
  ]

  parts.push(
    `<text x="${r(x + 12)}" y="${r(y + C.boundaryHeader / 2)}" ` +
    `font-size="${C.labelFontSize}" font-weight="${C.labelFontWeight}" ` +
    `dy="${TEXT_BASELINE_SHIFT}" class="c4-boundary-label">` +
    `${escapeXml(boundary.label)}` +
    `<tspan class="c4-boundary-type"> [${escapeXml(boundary.typeLabel)}]</tspan>` +
    `</text>`
  )

  return parts
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Draw one shape: its outline, then its label, technology and description. */
function renderShape(shape: PositionedC4Shape): string[] {
  const parts: string[] = []
  const { x, y, width: w, height: h } = shape

  const classes = [
    'c4-shape',
    `c4-form-${shape.form}`,
    `c4-fill-${shape.colorIndex}`,
  ]
  if (shape.external) classes.push('c4-external')

  const style = inlineStyle(shape.style)
  const data =
    `data-alias="${escapeXml(shape.alias)}" data-tier="${shape.tier}"` +
    `${shape.tags ? ` data-tags="${escapeXml(shape.tags)}"` : ''}`

  const title = `<title>${escapeXml(tooltip(shape))}</title>`
  const common = `class="${classes.join(' ')}"${style} ${data}`

  // A person gets a head above the body, which is the C4 convention and the
  // fastest way to tell an actor from a system at a glance.
  const head = shape.form === 'person' ? C.personHeadHeight : 0

  switch (shape.form) {
    case 'person': {
      const radius = C.personHeadHeight / 2 - 1
      parts.push(
        `<g ${common}>${title}` +
        `<circle cx="${r(x + w / 2)}" cy="${r(y + radius + 2)}" r="${r(radius)}"/>` +
        `<rect x="${r(x)}" y="${r(y + head)}" width="${r(w)}" ` +
        `height="${r(h - head)}" rx="${RADIUS}" ry="${RADIUS}"/>` +
        `</g>`
      )
      break
    }

    case 'database': {
      // A cylinder: a body with an elliptical cap
      const ry = Math.min(h / 6, 11)
      const d = [
        `M${r(x)},${r(y + ry)}`,
        `A${r(w / 2)},${r(ry)} 0 0 1 ${r(x + w)},${r(y + ry)}`,
        `L${r(x + w)},${r(y + h - ry)}`,
        `A${r(w / 2)},${r(ry)} 0 0 1 ${r(x)},${r(y + h - ry)}`,
        'Z',
      ].join(' ')
      parts.push(
        `<g ${common}>${title}<path d="${d}"/>` +
        `<path d="M${r(x)},${r(y + ry)} A${r(w / 2)},${r(ry)} 0 0 0 ${r(x + w)},${r(y + ry)}" ` +
        `class="c4-rule"/></g>`
      )
      break
    }

    case 'queue': {
      // A horizontal cylinder, which is how C4 draws a message queue
      const rx = Math.min(w / 8, 14)
      const d = [
        `M${r(x + rx)},${r(y)}`,
        `L${r(x + w - rx)},${r(y)}`,
        `A${r(rx)},${r(h / 2)} 0 0 1 ${r(x + w - rx)},${r(y + h)}`,
        `L${r(x + rx)},${r(y + h)}`,
        `A${r(rx)},${r(h / 2)} 0 0 1 ${r(x + rx)},${r(y)}`,
        'Z',
      ].join(' ')
      parts.push(
        `<g ${common}>${title}<path d="${d}"/>` +
        `<path d="M${r(x + w - rx)},${r(y)} A${r(rx)},${r(h / 2)} 0 0 0 ${r(x + w - rx)},${r(y + h)}" ` +
        `class="c4-rule"/></g>`
      )
      break
    }

    default:
      parts.push(
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ` +
        `rx="${RADIUS}" ry="${RADIUS}" ${common}>${title}</rect>`
      )
  }

  // Text, centred as a block in the space below the head
  const textHeight =
    shape.labelLines.length * C.labelLineHeight +
    (shape.technLine ? C.technLineHeight : 0) +
    shape.descrLines.length * C.descrLineHeight

  let cursor = y + head + (h - head - textHeight) / 2
  const cx = x + w / 2

  for (const line of shape.labelLines) {
    parts.push(
      `<text x="${r(cx)}" y="${r(cursor + C.labelLineHeight / 2)}" ` +
      `text-anchor="middle" font-size="${C.labelFontSize}" ` +
      `font-weight="${C.labelFontWeight}" dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="c4-label">${escapeXml(line)}</text>`
    )
    cursor += C.labelLineHeight
  }

  if (shape.technLine) {
    parts.push(
      `<text x="${r(cx)}" y="${r(cursor + C.technLineHeight / 2)}" ` +
      `text-anchor="middle" font-size="${C.technFontSize}" ` +
      `font-weight="${C.technFontWeight}" dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="c4-techn">${escapeXml(shape.technLine)}</text>`
    )
    cursor += C.technLineHeight
  }

  for (const line of shape.descrLines) {
    parts.push(
      `<text x="${r(cx)}" y="${r(cursor + C.descrLineHeight / 2)}" ` +
      `text-anchor="middle" font-size="${C.descrFontSize}" ` +
      `font-weight="${C.descrFontWeight}" dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="c4-descr">${escapeXml(line)}</text>`
    )
    cursor += C.descrLineHeight
  }

  // A link wraps everything the shape drew, so the whole box is clickable.
  // Only non-executable schemes survive: a `javascript:` $link would otherwise
  // run in the page embedding this SVG.
  const href = safeLinkUrl(shape.link)
  if (href) {
    return [
      `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer">`,
      ...parts,
      '</a>',
    ]
  }

  return parts
}

/**
 * Accessible description of a shape.
 *
 * Technology and description are appended, because they are what distinguish
 * two boxes that would otherwise read as the same noun.
 */
function tooltip(shape: PositionedC4Shape): string {
  const extras: string[] = []
  if (shape.technLine) extras.push(shape.technLine)
  if (shape.descrLines.length > 0) extras.push(shape.descrLines.join(' '))
  return extras.length > 0 ? `${shape.label} — ${extras.join(' — ')}` : shape.label
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/** Draw one relationship: its line, its arrowheads and its label. */
function renderEdge(edge: PositionedC4Rel): string[] {
  // UpdateRelStyle colours are author text reaching a CSS slot, so they go
  // through the same whitelist as element styles.
  const lineColor = safeCssValue(edge.style?.lineColor)
  const lineStyle = lineColor ? ` style="stroke:${escapeXml(lineColor)}"` : ''

  const parts: string[] = [
    `<path d="${edge.path}" class="c4-edge"${lineStyle} ` +
    `marker-end="url(#${MARKER_END})"` +
    `${edge.bidirectional ? ` marker-start="url(#${MARKER_START})"` : ''} ` +
    `data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}">` +
    `<title>${escapeXml(
      `${edge.from} → ${edge.to}${edge.labelLines.length > 0 ? `: ${edge.labelLines.join(' ')}` : ''}`
    )}</title></path>`,
  ]

  const lines = [...edge.labelLines]
  if (edge.technLine) lines.push(edge.technLine)
  if (lines.length === 0) return parts

  const textColor = safeCssValue(edge.style?.textColor)
  const textStyle = textColor ? ` style="fill:${escapeXml(textColor)}"` : ''

  // A chip behind the label, so the text stays readable over the line
  const blockHeight = lines.length * C.relLabelLineHeight
  const chipWidth = Math.max(
    ...lines.map(line => line.length * C.relLabelFontSize * 0.56),
  ) + 8

  parts.push(
    `<rect x="${r(edge.labelX - chipWidth / 2)}" ` +
    `y="${r(edge.labelY - blockHeight / 2 - 2)}" width="${r(chipWidth)}" ` +
    `height="${r(blockHeight + 4)}" rx="3" ry="3" class="c4-edge-label-bg"/>`
  )

  for (const [index, line] of lines.entries()) {
    const isTechn = edge.technLine !== undefined && index === lines.length - 1
    parts.push(
      `<text x="${r(edge.labelX)}" ` +
      `y="${r(edge.labelY - blockHeight / 2 + index * C.relLabelLineHeight + C.relLabelLineHeight / 2)}" ` +
      `text-anchor="middle" font-size="${C.relLabelFontSize}" ` +
      `font-weight="${isTechn ? 400 : C.relLabelFontWeight}" ` +
      `dy="${TEXT_BASELINE_SHIFT}" ` +
      `class="${isTechn ? 'c4-edge-techn' : 'c4-edge-label'}"${textStyle}>` +
      `${escapeXml(line)}</text>`
    )
  }

  return parts
}

/** Arrowhead markers, one per end. */
function arrowMarkers(): string {
  const path = 'M0,0 L10,5 L0,10 z'
  return (
    `<defs>` +
    `<marker id="${MARKER_END}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="${path}" class="c4-arrowhead"/></marker>` +
    `<marker id="${MARKER_START}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="6" markerHeight="6" orient="auto">` +
    `<path d="${path}" class="c4-arrowhead"/></marker>` +
    `</defs>`
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Turn an element style into an inline style attribute, when it sets anything.
 *
 * `$bgColor`/`$borderColor` come from `UpdateElementStyle` as free text and
 * land in a CSS colour slot, so unsafe values are dropped rather than escaped.
 */
function inlineStyle(style: PositionedC4Shape['style']): string {
  if (!style) return ''

  const declarations: string[] = []
  const bgColor = safeCssValue(style.bgColor)
  const borderColor = safeCssValue(style.borderColor)
  if (bgColor) declarations.push(`fill:${bgColor}`)
  if (borderColor) declarations.push(`stroke:${borderColor}`)

  return declarations.length > 0 ? ` style="${escapeXml(declarations.join(';'))}"` : ''
}

/**
 * Build the C4 stylesheet.
 *
 * Tier colours are fixed indices rather than per-diagram assignments, so two
 * C4 diagrams of the same system agree on what a container looks like.
 * External shapes drop to grey, which is what the C4 notation asks for.
 */
function c4Styles(
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
    varDefs.push(`    --c4-color-${idx}: ${value};`)
    rules.push(
      `  .c4-fill-${idx} { ` +
      `fill: color-mix(in srgb, var(--c4-color-${idx}) 72%, var(--bg)); ` +
      `stroke: color-mix(in srgb, var(--c4-color-${idx}) 88%, var(--fg)); }`
    )
  }

  const varsBlock = varDefs.length > 0 ? `  svg {\n${varDefs.join('\n')}\n  }\n` : ''

  return `<style>
${varsBlock}  .c4-shape { stroke-width: 1.5; }
  .c4-external {
    fill: color-mix(in srgb, var(--fg) 22%, var(--bg)) !important;
    stroke: color-mix(in srgb, var(--fg) 45%, var(--bg)) !important;
  }
  .c4-rule { fill: none; stroke: inherit; stroke-width: 1.5; opacity: 0.55; }
  .c4-label { fill: var(--bg); }
  .c4-techn { fill: color-mix(in srgb, var(--bg) 80%, var(--fg)); }
  .c4-descr { fill: color-mix(in srgb, var(--bg) 85%, var(--fg)); }
  .c4-boundary {
    fill: none;
    stroke: var(--_text-muted);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  .c4-boundary-label { fill: var(--_text-sec); }
  .c4-boundary-type { fill: var(--_text-muted); font-weight: 400; }
  .c4-edge { fill: none; stroke: var(--_line); stroke-width: 1.5; }
  .c4-arrowhead { fill: var(--_arrow); stroke: none; }
  .c4-edge-label-bg { fill: var(--bg); stroke: none; }
  .c4-edge-label { fill: var(--_text-sec); }
  .c4-edge-techn { fill: var(--_text-muted); }
  .c4-legend-swatch { stroke-width: 1; }
  .c4-legend-label { fill: var(--_text-sec); }
  .c4-title { fill: var(--_text); }
${rules.join('\n')}
</style>`
}

/** Round to two decimals, keeping paths short without visible drift. */
function r(value: number): number {
  return Math.round(value * 100) / 100
}
