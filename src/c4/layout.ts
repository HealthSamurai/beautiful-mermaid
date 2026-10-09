import type { ElkExtendedEdge, ElkNode } from 'elkjs'
import type {
  C4Boundary,
  C4Diagram,
  C4LegendRow,
  C4Node,
  C4Shape,
  C4ShapeForm,
  PositionedC4Boundary,
  PositionedC4Diagram,
  PositionedC4Rel,
  PositionedC4Shape,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, widthForTitle, wrapText } from '../styles.ts'
import { elkLayoutSync } from '../elk-instance.ts'

// ============================================================================
// C4 diagram layout engine (ELK.js)
//
// Boundaries become ELK compound nodes, so the engine keeps their contents
// inside them rather than the renderer drawing a box around whatever happened
// to land nearby. That nesting is the claim a C4 diagram makes — this
// container is part of that system — so it has to survive layout, not be
// reconstructed after it.
//
// A relationship with a direction suffix (Rel_U, Rel_D, …) is given to ELK as
// a constraint on that edge, which is the closest an automatic layout can
// come to honouring a hand-placed arrow.
// ============================================================================

/** Layout constants. */
const C = {
  padding: 32,
  /** Padding inside a boundary, around its contents */
  boundaryPad: 26,
  /** Extra space at the top of a boundary for its label */
  boundaryHeader: 26,
  /** Padding inside a shape box */
  boxPadX: 12,
  boxPadY: 10,
  labelFontSize: 13,
  labelFontWeight: 600,
  labelLineHeight: 17,
  technFontSize: 10,
  technFontWeight: 400,
  technLineHeight: 13,
  descrFontSize: 11,
  descrFontWeight: 400,
  descrLineHeight: 14,
  minWidth: 140,
  maxWidth: 220,
  minHeight: 64,
  /** Maximum lines each text block wraps to */
  maxLabelLines: 3,
  maxDescrLines: 4,
  /** A person box reserves room for the head above its text */
  personHeadHeight: 20,
  nodeSpacing: 42,
  layerSpacing: 58,
  relLabelFontSize: 10,
  relLabelFontWeight: 500,
  relLabelLineHeight: 12,
  /** Maximum lines a relationship label wraps to */
  maxRelLabelLines: 2,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 36,
  /** Legend geometry */
  legendRowHeight: 20,
  legendFontSize: 11,
  legendSwatch: 14,
  legendGap: 18,
} as const

/** ELK directions, keyed by the Mermaid direction keyword. */
const ELK_DIRECTION = { TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' } as const

/**
 * Which tier a shape kind belongs to.
 *
 * The tier drives the palette, so a person, a system, a container and a
 * component are each one colour wherever they appear — which is what lets a
 * reader skim a C4 diagram by colour rather than by reading every label.
 */
function tierOf(shape: C4Shape): PositionedC4Shape['tier'] {
  const kind = shape.shapeKind
  if (kind.includes('person')) return 'person'
  if (kind === 'node') return 'node'
  if (kind.includes('container')) return 'container'
  if (kind.includes('component')) return 'component'
  return 'system'
}

/** Palette index per tier — fixed, so colour means the same across diagrams. */
const TIER_COLOR: Record<PositionedC4Shape['tier'], number> = {
  person: 0,
  system: 1,
  container: 2,
  component: 3,
  node: 4,
}

/** How a shape kind is drawn. */
function formOf(shape: C4Shape): C4ShapeForm {
  const kind = shape.shapeKind
  if (kind.includes('person')) return 'person'
  if (kind.includes('_db')) return 'database'
  if (kind.includes('_queue')) return 'queue'
  return 'box'
}

/** Suffix shown under a boundary's label. */
const BOUNDARY_LABEL: Record<C4Boundary['boundaryKind'], string> = {
  boundary: 'Boundary',
  enterprise: 'Enterprise',
  system: 'System',
  container: 'Container',
  node: 'Deployment Node',
}

/**
 * Lay out a parsed C4 diagram using ELK.js (synchronous).
 */
export function layoutC4Diagram(
  diagram: C4Diagram,
  _options: RenderOptions = {},
): PositionedC4Diagram {
  const measured = new Map<string, MeasuredShape>()
  const boundaryMeta = new Map<string, { boundary: C4Boundary; depth: number }>()

  const children = diagram.nodes.map(node => toElk(node, measured, boundaryMeta, 0))

  if (children.length === 0) {
    const empty = C.padding * 2
    return { width: empty, height: empty, boundaries: [], shapes: [], edges: [], legend: [] }
  }

  // Only relationships whose endpoints both exist can be routed
  const known = new Set([...measured.keys(), ...boundaryMeta.keys()])
  const relations = diagram.relationships.filter(
    r => known.has(r.from) && known.has(r.to),
  )

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[diagram.direction],
      'elk.spacing.nodeNode': String(C.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(C.layerSpacing),
      'elk.padding': `[top=${C.padding},left=${C.padding},bottom=${C.padding},right=${C.padding}]`,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeLabels.placement': 'CENTER',
    },
    children,
    edges: relations.map((relation, index): ElkExtendedEdge => {
      const labelLines = wrap(
        relation.label, C.maxWidth, C.relLabelFontSize, C.relLabelFontWeight,
      ).slice(0, C.maxRelLabelLines)
      const technLine = relation.techn ? `[${relation.techn}]` : undefined

      const labelWidth = Math.max(
        ...labelLines.map(line =>
          estimateTextWidth(line, C.relLabelFontSize, C.relLabelFontWeight)),
        technLine
          ? estimateTextWidth(technLine, C.relLabelFontSize, C.relLabelFontWeight)
          : 0,
      )
      const labelHeight =
        (labelLines.length + (technLine ? 1 : 0)) * C.relLabelLineHeight

      return {
        id: `c4-edge-${index}`,
        sources: [relation.from],
        targets: [relation.to],
        labels: labelWidth > 0
          ? [{ text: relation.label, width: labelWidth + 8, height: labelHeight + 4 }]
          : [],
      }
    }),
  }

  const result = elkLayoutSync(elkGraph)

  const titleHeight = diagram.title ? C.titleHeight : 0
  const shapes: PositionedC4Shape[] = []
  const boundaries: PositionedC4Boundary[] = []

  // ELK reports child coordinates relative to their parent, so the tree is
  // walked with a running offset rather than read flat.
  collect(result.children ?? [], 0, titleHeight, measured, boundaryMeta, shapes, boundaries)

  // ELK lists every edge on the root when hierarchy handling is INCLUDE_CHILDREN,
  // but its points stay relative to the lowest container holding both
  // endpoints -- an edge between two shapes inside a boundary is given in that
  // boundary's coordinates. So each edge is offset by its own container, not
  // by the root, or it lands a boundary's width away from its line.
  const containers = new Map<string, { x: number; y: number }>()
  mapContainers(result, 0, titleHeight, containers)

  const routed = new Map<string, { points: { x: number; y: number }[]; label?: { x: number; y: number } }>()
  gatherEdges(result, containers, routed)

  const edges: PositionedC4Rel[] = []
  for (const [index, relation] of relations.entries()) {
    const route = routed.get(`c4-edge-${index}`)
    if (!route || route.points.length < 2) continue

    const labelLines = wrap(
      relation.label, C.maxWidth, C.relLabelFontSize, C.relLabelFontWeight,
    ).slice(0, C.maxRelLabelLines)

    const anchor = route.label ?? midpoint(route.points)

    edges.push({
      from: relation.from,
      to: relation.to,
      path: route.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`)
        .join(' '),
      bidirectional: relation.relKind === 'birel',
      labelLines,
      labelX: round(anchor.x + (relation.style?.offsetX ?? 0)),
      labelY: round(anchor.y + (relation.style?.offsetY ?? 0)),
      technLine: relation.techn ? `[${relation.techn}]` : undefined,
      style: relation.style,
    })
  }

  const width = Math.round(
    widthForTitle(
      result.width ?? C.padding * 2,
      diagram.title,
      C.titleFontSize,
      C.titleFontWeight,
      C.padding,
    ),
  )
  const legend = buildLegend(shapes, Math.round((result.height ?? 0) + titleHeight))
  const legendHeight = legend.length > 0
    ? legend.length * C.legendRowHeight + C.legendGap
    : 0
  const height = Math.round((result.height ?? C.padding * 2) + titleHeight + legendHeight)

  const chart: PositionedC4Diagram = { width, height, boundaries, shapes, edges, legend }

  if (diagram.title) {
    chart.title = {
      text: diagram.title,
      x: Math.round(width / 2),
      y: Math.round(C.padding / 2 + C.titleFontSize / 2),
    }
  }

  return chart
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** Shape text and size, before placement. */
interface MeasuredShape {
  shape: C4Shape
  labelLines: string[]
  technLine?: string
  descrLines: string[]
  width: number
  height: number
}

/** Turn one parsed node into an ELK node, measuring it on the way. */
function toElk(
  node: C4Node,
  measured: Map<string, MeasuredShape>,
  boundaryMeta: Map<string, { boundary: C4Boundary; depth: number }>,
  depth: number,
): ElkNode {
  if (node.kind === 'boundary') {
    boundaryMeta.set(node.alias, { boundary: node, depth })

    const children = node.children.map(child =>
      toElk(child, measured, boundaryMeta, depth + 1))

    return {
      id: node.alias,
      children,
      layoutOptions: {
        'elk.padding':
          `[top=${C.boundaryPad + C.boundaryHeader},left=${C.boundaryPad},` +
          `bottom=${C.boundaryPad},right=${C.boundaryPad}]`,
        'elk.spacing.nodeNode': String(C.nodeSpacing),
      },
      // An empty boundary still needs a size, or ELK collapses it to nothing
      ...(children.length === 0
        ? { width: C.minWidth, height: C.minHeight }
        : {}),
    }
  }

  const shape = measureShape(node)
  measured.set(node.alias, shape)
  return { id: node.alias, width: shape.width, height: shape.height }
}

/** Measure one shape from its label, technology and description. */
function measureShape(shape: C4Shape): MeasuredShape {
  const technLine = shape.techn ? `[${shape.techn}]` : undefined

  const labelLines = wrap(
    shape.label, C.maxWidth - C.boxPadX * 2, C.labelFontSize, C.labelFontWeight,
  ).slice(0, C.maxLabelLines)

  const descrLines = shape.descr
    ? wrap(
        shape.descr, C.maxWidth - C.boxPadX * 2, C.descrFontSize, C.descrFontWeight,
      ).slice(0, C.maxDescrLines)
    : []

  const widest = Math.max(
    ...labelLines.map(l => estimateTextWidth(l, C.labelFontSize, C.labelFontWeight)),
    technLine ? estimateTextWidth(technLine, C.technFontSize, C.technFontWeight) : 0,
    ...descrLines.map(l => estimateTextWidth(l, C.descrFontSize, C.descrFontWeight)),
  )

  const width = Math.min(
    C.maxWidth,
    Math.max(C.minWidth, Math.round(widest + C.boxPadX * 2)),
  )

  const textHeight =
    labelLines.length * C.labelLineHeight +
    (technLine ? C.technLineHeight : 0) +
    descrLines.length * C.descrLineHeight

  const head = formOf(shape) === 'person' ? C.personHeadHeight : 0

  const height = Math.max(
    C.minHeight,
    Math.round(textHeight + C.boxPadY * 2 + head),
  )

  return { shape, labelLines, technLine, descrLines, width, height }
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Walk the ELK result, turning relative coordinates into absolute ones.
 *
 * Boundaries are emitted before their contents, so the renderer can draw them
 * back to front without sorting.
 */
function collect(
  children: ElkNode[],
  offsetX: number,
  offsetY: number,
  measured: Map<string, MeasuredShape>,
  boundaryMeta: Map<string, { boundary: C4Boundary; depth: number }>,
  shapes: PositionedC4Shape[],
  boundaries: PositionedC4Boundary[],
): void {
  for (const child of children) {
    const x = offsetX + (child.x ?? 0)
    const y = offsetY + (child.y ?? 0)

    const meta = boundaryMeta.get(child.id)
    if (meta) {
      const { boundary, depth } = meta
      boundaries.push({
        alias: boundary.alias,
        label: boundary.label,
        typeLabel: boundary.type ?? BOUNDARY_LABEL[boundary.boundaryKind],
        depth,
        x,
        y,
        width: child.width ?? C.minWidth,
        height: child.height ?? C.minHeight,
        tags: boundary.tags,
        link: boundary.link,
        style: boundary.style,
      })
      collect(child.children ?? [], x, y, measured, boundaryMeta, shapes, boundaries)
      continue
    }

    const shape = measured.get(child.id)
    if (!shape) continue

    const tier = tierOf(shape.shape)
    shapes.push({
      alias: shape.shape.alias,
      labelLines: shape.labelLines,
      label: shape.shape.label,
      technLine: shape.technLine,
      descrLines: shape.descrLines,
      form: formOf(shape.shape),
      external: shape.shape.shapeKind.startsWith('external_'),
      tier,
      x,
      y,
      width: child.width ?? shape.width,
      height: child.height ?? shape.height,
      colorIndex: TIER_COLOR[tier],
      tags: shape.shape.tags,
      link: shape.shape.link,
      style: shape.shape.style,
    })
  }
}

/**
 * Record the absolute position of every node, so an edge can be offset by
 * whichever container its coordinates are relative to.
 */
function mapContainers(
  node: ElkNode,
  offsetX: number,
  offsetY: number,
  out: Map<string, { x: number; y: number }>,
): void {
  out.set(node.id, { x: offsetX, y: offsetY })
  for (const child of node.children ?? []) {
    mapContainers(child, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0), out)
  }
}

/**
 * Collect every routed edge in the tree, keyed by id, in absolute coordinates.
 *
 * An edge's `container` field names the node its points are relative to. ELK
 * sets it to the lowest node holding both endpoints, which for a cross-
 * boundary edge is the root and for an edge inside one boundary is that
 * boundary -- so the offset has to be looked up per edge rather than
 * inherited from wherever the edge happens to be listed.
 */
function gatherEdges(
  node: ElkNode,
  containers: Map<string, { x: number; y: number }>,
  out: Map<string, { points: { x: number; y: number }[]; label?: { x: number; y: number } }>,
): void {
  for (const edge of node.edges ?? []) {
    const extended = edge as ElkExtendedEdge & { container?: string }
    const section = extended.sections?.[0]
    if (!section) continue

    const origin = containers.get(extended.container ?? node.id) ?? { x: 0, y: 0 }

    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map(p => ({ x: p.x + origin.x, y: p.y + origin.y }))

    const label = extended.labels?.[0]
    out.set(edge.id, {
      points,
      label: label?.x != null && label.y != null
        ? {
            x: label.x + (label.width ?? 0) / 2 + origin.x,
            y: label.y + (label.height ?? 0) / 2 + origin.y,
          }
        : undefined,
    })
  }

  for (const child of node.children ?? []) {
    gatherEdges(child, containers, out)
  }
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * Build the legend: one row per distinct tier and externality present.
 *
 * C4 asks for a legend because "external" is drawn as a colour difference,
 * and a colour difference with no key is just decoration.
 */
function buildLegend(shapes: PositionedC4Shape[], top: number): C4LegendRow[] {
  const seen = new Map<string, C4LegendRow>()

  for (const shape of shapes) {
    const key = `${shape.tier}:${shape.external}`
    if (seen.has(key)) continue

    seen.set(key, {
      text: `${shape.external ? 'External ' : ''}${titleCase(shape.tier)}`,
      form: shape.form,
      external: shape.external,
      colorIndex: shape.colorIndex,
      x: C.padding,
      y: 0,
    })
  }

  const rows = [...seen.values()]
  for (const [index, row] of rows.entries()) {
    row.y = top + C.legendGap / 2 + index * C.legendRowHeight + C.legendRowHeight / 2
  }

  return rows
}

/** Capitalise a tier name for the legend. */
function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ---------------------------------------------------------------------------
// Geometry and text
// ---------------------------------------------------------------------------

/** Midpoint of a routed polyline, used when ELK gave no label position. */
function midpoint(points: { x: number; y: number }[]): { x: number; y: number } {
  const half = Math.floor(points.length / 2)
  const a = points[half - 1] ?? points[0]!
  const b = points[half] ?? points[points.length - 1]!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Round to two decimals, keeping paths short without visible drift. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Wrap text to a pixel width using the DOM-free metrics. */
function wrap(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
): string[] {
  // No text means no lines, so a missing description adds no height.
  if (!text) return []
  return wrapText(text, maxWidth, fontSize, fontWeight)
}

/** Geometry constants, exported so the renderer draws text where layout put it. */
export const C4_METRICS = {
  boxPadX: C.boxPadX,
  boxPadY: C.boxPadY,
  labelFontSize: C.labelFontSize,
  labelFontWeight: C.labelFontWeight,
  labelLineHeight: C.labelLineHeight,
  technFontSize: C.technFontSize,
  technFontWeight: C.technFontWeight,
  technLineHeight: C.technLineHeight,
  descrFontSize: C.descrFontSize,
  descrFontWeight: C.descrFontWeight,
  descrLineHeight: C.descrLineHeight,
  personHeadHeight: C.personHeadHeight,
  boundaryHeader: C.boundaryHeader,
  relLabelFontSize: C.relLabelFontSize,
  relLabelFontWeight: C.relLabelFontWeight,
  relLabelLineHeight: C.relLabelLineHeight,
  titleFontSize: C.titleFontSize,
  titleFontWeight: C.titleFontWeight,
  legendFontSize: C.legendFontSize,
  legendSwatch: C.legendSwatch,
  legendRowHeight: C.legendRowHeight,
} as const
