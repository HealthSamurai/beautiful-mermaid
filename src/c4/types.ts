// ============================================================================
// C4 diagram types
//
// Models the parsed and positioned representations of Mermaid's C4 diagrams:
// the five levels of Simon Brown's C4 model — context, container, component,
// dynamic and deployment — which all share one syntax and differ only in
// which shapes they conventionally use.
//
// A C4 diagram's value is the nesting: a container lives inside a system
// boundary, a component inside a container boundary. So boundaries are a real
// hierarchy here, not a drawing hint.
// ============================================================================

/** Which of the five C4 levels the source declared. */
export type C4Level =
  | 'C4Context'
  | 'C4Container'
  | 'C4Component'
  | 'C4Dynamic'
  | 'C4Deployment'

/**
 * Shape kind, which decides how the box is drawn.
 *
 * The `_ext` variants are the same shape drawn as external — outside the
 * scope the diagram is about — which C4 renders in grey so the reader sees
 * at once what the team does and does not control.
 */
export type C4ShapeKind =
  | 'person'
  | 'external_person'
  | 'system'
  | 'system_db'
  | 'system_queue'
  | 'external_system'
  | 'external_system_db'
  | 'external_system_queue'
  | 'container'
  | 'container_db'
  | 'container_queue'
  | 'external_container'
  | 'external_container_db'
  | 'external_container_queue'
  | 'component'
  | 'component_db'
  | 'component_queue'
  | 'external_component'
  | 'external_component_db'
  | 'external_component_queue'
  | 'node'

/** How a box is drawn, once its kind has been resolved. */
export type C4ShapeForm = 'person' | 'box' | 'database' | 'queue'

/** Boundary kind, which decides its label suffix. */
export type C4BoundaryKind =
  | 'boundary'
  | 'enterprise'
  | 'system'
  | 'container'
  | 'node'

/** Relationship kind — the suffix fixes the direction ELK is asked for. */
export type C4RelKind =
  | 'rel'
  | 'birel'
  | 'rel_u'
  | 'rel_d'
  | 'rel_l'
  | 'rel_r'
  | 'rel_b'

/** Layout direction, as a `direction` statement sets it. */
export type C4Direction = 'TB' | 'BT' | 'LR' | 'RL'

// ============================================================================
// Parsed diagram — logical structure from mermaid text
// ============================================================================

/** Parsed C4 diagram. */
export interface C4Diagram {
  /** Which of the five levels the header declared */
  level: C4Level
  /** Optional heading, from `title` or from frontmatter */
  title?: string
  /** Layout direction @default 'TB' */
  direction: C4Direction
  /** Top-level shapes and boundaries, in declaration order */
  nodes: C4Node[]
  /** Relationships in declaration order */
  relationships: C4Rel[]
}

/** One node of the hierarchy — either a shape or a boundary holding more. */
export type C4Node = C4Shape | C4Boundary

/** One box: a person, system, container, component or deployment node. */
export interface C4Shape {
  kind: 'shape'
  /** Alias, used as the id in relationships */
  alias: string
  label: string
  /** `$techn` or the positional technology field, when given */
  techn?: string
  /** `$descr` or the positional description field, when given */
  descr?: string
  /** `$sprite` — recorded but not drawn, since sprites need an icon pack */
  sprite?: string
  /** `$tags` — emitted as a data attribute for host-page styling */
  tags?: string
  /** `$link` — turns the box into a hyperlink */
  link?: string
  /** The declared shape kind, before it is resolved to a form */
  shapeKind: C4ShapeKind
  /** Inline styling from an `UpdateElementStyle` statement */
  style?: C4ElementStyle
}

/** One boundary, holding shapes and further boundaries. */
export interface C4Boundary {
  kind: 'boundary'
  alias: string
  label: string
  boundaryKind: C4BoundaryKind
  /** `$type` — overrides the suffix shown under the label */
  type?: string
  /** `$descr`, for a deployment node */
  descr?: string
  tags?: string
  link?: string
  /** Contents, in declaration order */
  children: C4Node[]
  style?: C4ElementStyle
}

/** One relationship between two aliases. */
export interface C4Rel {
  relKind: C4RelKind
  from: string
  to: string
  label: string
  techn?: string
  descr?: string
  sprite?: string
  tags?: string
  link?: string
  /** Inline styling from an `UpdateRelStyle` statement */
  style?: C4RelStyle
}

/** Styling an `UpdateElementStyle` statement may set. */
export interface C4ElementStyle {
  bgColor?: string
  fontColor?: string
  borderColor?: string
  shadowing?: boolean
  shape?: string
  legendText?: string
  legendSprite?: string
}

/** Styling an `UpdateRelStyle` statement may set. */
export interface C4RelStyle {
  textColor?: string
  lineColor?: string
  /** Label offsets, in pixels — recorded but applied only to the label */
  offsetX?: number
  offsetY?: number
}

// ============================================================================
// Positioned diagram — ready for SVG rendering
// ============================================================================

export interface PositionedC4Diagram {
  width: number
  height: number
  /** Boundaries, outermost first, so children draw over their parents */
  boundaries: PositionedC4Boundary[]
  /** Shapes in draw order */
  shapes: PositionedC4Shape[]
  /** Relationships, routed between placed boxes */
  edges: PositionedC4Rel[]
  /** Title anchor, when the diagram has one */
  title?: { text: string; x: number; y: number }
  /** Legend rows, one per shape form present */
  legend: C4LegendRow[]
}

export interface PositionedC4Shape {
  alias: string
  /** Label, wrapped to the box */
  labelLines: string[]
  /** Raw label, for the accessible <title> child */
  label: string
  /** `[Technology]` line under the label, when the shape declared one */
  technLine?: string
  /** Description lines under the technology */
  descrLines: string[]
  /** How the box is drawn */
  form: C4ShapeForm
  /** Whether the shape is outside the diagram's scope */
  external: boolean
  /** Which C4 tier the shape belongs to — drives its palette index */
  tier: 'person' | 'system' | 'container' | 'component' | 'node'
  x: number
  y: number
  width: number
  height: number
  /** Palette index */
  colorIndex: number
  tags?: string
  link?: string
  style?: C4ElementStyle
}

export interface PositionedC4Boundary {
  alias: string
  label: string
  /** Suffix under the label — `[System]`, `[Container]`, … */
  typeLabel: string
  /** Nesting depth — 0 for a top-level boundary */
  depth: number
  x: number
  y: number
  width: number
  height: number
  tags?: string
  link?: string
  style?: C4ElementStyle
}

export interface PositionedC4Rel {
  from: string
  to: string
  /** Polyline through the routed points */
  path: string
  /** Whether to draw an arrowhead at the start as well */
  bidirectional: boolean
  /** Label lines, centred on the edge */
  labelLines: string[]
  labelX: number
  labelY: number
  /** `[Technology]` line under the label, when the relationship declared one */
  technLine?: string
  style?: C4RelStyle
}

/** One row of the legend. */
export interface C4LegendRow {
  text: string
  form: C4ShapeForm
  external: boolean
  colorIndex: number
  x: number
  y: number
}
