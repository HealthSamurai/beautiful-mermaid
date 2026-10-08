import type { ElkExtendedEdge, ElkNode } from 'elkjs'
import type {
  PositionedRelation,
  PositionedRequirementDiagram,
  PositionedRequirementNode,
  Requirement,
  RequirementDiagram,
  RequirementElement,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { compileStyles } from './parser.ts'
import { estimateTextWidth } from '../styles.ts'
import { elkLayoutSync } from '../elk-instance.ts'

// ============================================================================
// Requirement diagram layout engine (ELK.js)
//
// Boxes are sized from their contents, then placed by ELK's layered
// algorithm, the same engine the class and flowchart diagrams use. A
// requirement diagram is a directed graph of traceability links, so the same
// layered placement that suits a class diagram suits it.
//
// Direction comes from the `direction` statement, because which way the
// arrows run is the author's claim about how the system decomposes.
// ============================================================================

/** Layout constants. */
const R = {
  padding: 36,
  /** Padding inside a box, around its text */
  boxPadX: 12,
  boxPadY: 10,
  /** Header: stereotype line plus the name */
  stereotypeHeight: 16,
  stereotypeFontSize: 10,
  stereotypeFontWeight: 500,
  nameFontSize: 14,
  nameFontWeight: 600,
  nameLineHeight: 18,
  /** One body row per declared field */
  rowHeight: 18,
  rowFontSize: 11,
  rowFontWeight: 400,
  /** Gap between the header band and the first row */
  bodyGap: 6,
  minWidth: 150,
  maxWidth: 280,
  /** Maximum lines a name wraps to */
  maxNameLines: 3,
  /** Maximum characters a row value shows before it is clipped */
  maxValueChars: 46,
  nodeSpacing: 46,
  layerSpacing: 64,
  edgeLabelFontSize: 10,
  edgeLabelFontWeight: 500,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleHeight: 36,
} as const

/** ELK directions, keyed by the Mermaid direction keyword. */
const ELK_DIRECTION = { TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' } as const

/**
 * Lay out a parsed requirement diagram using ELK.js (synchronous).
 */
export function layoutRequirementDiagram(
  diagram: RequirementDiagram,
  _options: RenderOptions = {},
): PositionedRequirementDiagram {
  const measured = measureNodes(diagram)

  if (measured.length === 0) {
    const empty = R.padding * 2
    return { width: empty, height: empty, nodes: [], edges: [] }
  }

  // Only relationships whose endpoints both exist can be routed; a dangling
  // one is dropped rather than drawn to nowhere.
  const known = new Set(measured.map(n => n.name))
  const edges = diagram.relationships.filter(r => known.has(r.src) && known.has(r.dst))

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[diagram.direction],
      'elk.spacing.nodeNode': String(R.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(R.layerSpacing),
      'elk.padding': `[top=${R.padding},left=${R.padding},bottom=${R.padding},right=${R.padding}]`,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.placement': 'CENTER',
    },
    children: measured.map(node => ({
      id: node.name,
      width: node.width,
      height: node.height,
    })),
    edges: edges.map((relation): ElkExtendedEdge => ({
      id: relation.id,
      sources: [relation.src],
      targets: [relation.dst],
      labels: [{
        text: relation.type,
        width: estimateTextWidth(
          relation.type, R.edgeLabelFontSize, R.edgeLabelFontWeight,
        ) + 10,
        height: R.edgeLabelFontSize + 6,
      }],
    })),
  }

  const result = elkLayoutSync(elkGraph)

  const titleHeight = diagram.title ? R.titleHeight : 0
  const byName = new Map(measured.map(node => [node.name, node]))
  const nodes: PositionedRequirementNode[] = []

  for (const child of result.children ?? []) {
    const node = byName.get(child.id)
    if (!node) continue
    nodes.push({
      ...node,
      x: child.x ?? 0,
      y: (child.y ?? 0) + titleHeight,
      width: child.width ?? node.width,
      height: child.height ?? node.height,
    })
  }

  const positionedEdges: PositionedRelation[] = []
  for (const [index, elkEdge] of (result.edges ?? []).entries()) {
    const relation = edges[index]
    if (!relation) continue

    const points: { x: number; y: number }[] = []
    const section = elkEdge.sections?.[0]
    if (section) {
      points.push(section.startPoint)
      for (const bend of section.bendPoints ?? []) points.push(bend)
      points.push(section.endPoint)
    }
    if (points.length < 2) continue

    const label = elkEdge.labels?.[0]
    const anchor = label?.x != null && label.y != null
      ? {
          x: label.x + (label.width ?? 0) / 2,
          y: label.y + (label.height ?? 0) / 2 + titleHeight,
        }
      : midpoint(points, titleHeight)

    positionedEdges.push({
      type: relation.type,
      src: relation.src,
      dst: relation.dst,
      id: relation.id,
      path: points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y + titleHeight)}`)
        .join(' '),
      label: { text: relation.type, x: round(anchor.x), y: round(anchor.y) },
    })
  }

  const width = Math.round(result.width ?? R.padding * 2)
  const height = Math.round((result.height ?? R.padding * 2) + titleHeight)

  const chart: PositionedRequirementDiagram = { width, height, nodes, edges: positionedEdges }

  if (diagram.title) {
    chart.title = {
      text: diagram.title,
      x: Math.round(width / 2),
      y: Math.round(R.padding / 2 + R.titleFontSize / 2),
    }
  }

  return chart
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** Node shape before placement — everything but x and y. */
type MeasuredNode = Omit<PositionedRequirementNode, 'x' | 'y'>

/**
 * Size every box from its contents.
 *
 * Requirements come before elements so that, when neither is connected to the
 * other, the requirements still read first — which is the order the diagram
 * is about.
 */
function measureNodes(diagram: RequirementDiagram): MeasuredNode[] {
  const nodes: MeasuredNode[] = []

  for (const requirement of diagram.requirements.values()) {
    nodes.push(measureNode(
      requirement.name,
      'requirement',
      requirement.type,
      requirementRows(requirement),
      requirement,
      diagram,
      0,
    ))
  }

  for (const element of diagram.elements.values()) {
    nodes.push(measureNode(
      element.name,
      'element',
      'Element',
      elementRows(element),
      element,
      diagram,
      1,
    ))
  }

  return nodes
}

/** Rows a requirement shows, skipping the fields it did not declare. */
function requirementRows(requirement: Requirement): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  if (requirement.requirementId) rows.push({ label: 'Id', value: requirement.requirementId })
  if (requirement.text) rows.push({ label: 'Text', value: requirement.text })
  if (requirement.risk) rows.push({ label: 'Risk', value: requirement.risk })
  if (requirement.verifyMethod) {
    rows.push({ label: 'Verification', value: requirement.verifyMethod })
  }
  return rows
}

/** Rows an element shows, skipping the fields it did not declare. */
function elementRows(element: RequirementElement): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  if (element.type) rows.push({ label: 'Type', value: element.type })
  if (element.docRef) rows.push({ label: 'Doc Ref', value: element.docRef })
  return rows
}

/** Measure one box: wrap its name, clip its rows, and size the result. */
function measureNode(
  name: string,
  kind: 'requirement' | 'element',
  stereotype: string,
  rows: { label: string; value: string }[],
  source: { cssStyles: string[]; classes: string[] },
  diagram: RequirementDiagram,
  colorIndex: number,
): MeasuredNode {
  const clipped = rows.map(row => ({
    label: row.label,
    value: row.value.length > R.maxValueChars
      ? `${row.value.slice(0, R.maxValueChars - 1)}\u2026`
      : row.value,
  }))

  // Width is the widest of the stereotype, the name and the rows, bounded
  const widest = Math.max(
    estimateTextWidth(stereotype, R.stereotypeFontSize, R.stereotypeFontWeight),
    estimateTextWidth(name, R.nameFontSize, R.nameFontWeight),
    ...clipped.map(row =>
      estimateTextWidth(`${row.label}: ${row.value}`, R.rowFontSize, R.rowFontWeight)),
  )
  const width = Math.min(
    R.maxWidth,
    Math.max(R.minWidth, Math.round(widest + R.boxPadX * 2)),
  )

  const nameLines = wrap(name, width - R.boxPadX * 2)
  const headerHeight =
    R.boxPadY + R.stereotypeHeight + nameLines.length * R.nameLineHeight + R.boxPadY / 2

  const height = Math.round(
    headerHeight +
    (clipped.length > 0 ? R.bodyGap + clipped.length * R.rowHeight + R.boxPadY : R.boxPadY / 2)
  )

  // Classes a node carries may also be defined with a classDef, whose body
  // becomes inline CSS alongside any `style` statement
  const fromClasses = source.classes
    .map(cls => diagram.classes.get(cls))
    .filter((css): css is string => css !== undefined)
    .flatMap(css => css.split(',').map(d => d.trim()))

  return {
    name,
    kind,
    stereotype,
    nameLines,
    rows: clipped,
    width,
    height,
    headerHeight: Math.round(headerHeight),
    colorIndex,
    style: compileStyles([...fromClasses, ...source.cssStyles]),
    classes: source.classes,
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Midpoint of a routed polyline, used when ELK gave no label position. */
function midpoint(
  points: { x: number; y: number }[],
  offsetY: number,
): { x: number; y: number } {
  const half = Math.floor(points.length / 2)
  const a = points[half - 1] ?? points[0]!
  const b = points[half] ?? points[points.length - 1]!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + offsetY }
}

/** Round to two decimals, keeping paths short without visible drift. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Wrap text to a pixel width using the DOM-free metrics. */
function wrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  const out: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (
      estimateTextWidth(candidate, R.nameFontSize, R.nameFontWeight) <= maxWidth ||
      !line
    ) {
      line = candidate
    } else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  if (out.length === 0) out.push('')

  return out.slice(0, R.maxNameLines)
}

/** Geometry constants, exported so the renderer draws text where layout put it. */
export const REQUIREMENT_METRICS = {
  boxPadX: R.boxPadX,
  boxPadY: R.boxPadY,
  stereotypeHeight: R.stereotypeHeight,
  stereotypeFontSize: R.stereotypeFontSize,
  stereotypeFontWeight: R.stereotypeFontWeight,
  nameFontSize: R.nameFontSize,
  nameFontWeight: R.nameFontWeight,
  nameLineHeight: R.nameLineHeight,
  rowHeight: R.rowHeight,
  rowFontSize: R.rowFontSize,
  rowFontWeight: R.rowFontWeight,
  bodyGap: R.bodyGap,
  edgeLabelFontSize: R.edgeLabelFontSize,
  edgeLabelFontWeight: R.edgeLabelFontWeight,
  titleFontSize: R.titleFontSize,
  titleFontWeight: R.titleFontWeight,
} as const
