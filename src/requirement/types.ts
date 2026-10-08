// ============================================================================
// Requirement diagram types
//
// Models the parsed and positioned representations of a Mermaid
// `requirementDiagram`: SysML-style requirement boxes, the design elements
// that implement them, and the traceability relationships between the two.
//
// The whole point of the diagram is traceability — being able to see which
// element satisfies which requirement — so relationships are first-class
// here rather than decoration on the boxes.
// ============================================================================

/** The six requirement kinds SysML distinguishes. */
export type RequirementType =
  | 'Requirement'
  | 'Functional Requirement'
  | 'Interface Requirement'
  | 'Performance Requirement'
  | 'Physical Requirement'
  | 'Design Constraint'

/** How much is at stake if the requirement is not met. */
export type RiskLevel = 'Low' | 'Medium' | 'High'

/** How the requirement is to be shown satisfied. */
export type VerifyType = 'Analysis' | 'Demonstration' | 'Inspection' | 'Test'

/** The seven traceability relationships. */
export type RelationshipType =
  | 'contains'
  | 'copies'
  | 'derives'
  | 'satisfies'
  | 'verifies'
  | 'refines'
  | 'traces'

/** Layout direction, as a `direction` statement sets it. */
export type RequirementDirection = 'TB' | 'BT' | 'LR' | 'RL'

// ============================================================================
// Parsed diagram — logical structure from mermaid text
// ============================================================================

/** Parsed requirement diagram. */
export interface RequirementDiagram {
  /** Optional heading, from `title` or from frontmatter */
  title?: string
  /** Layout direction @default 'TB' */
  direction: RequirementDirection
  /** Requirements by name, in declaration order */
  requirements: Map<string, Requirement>
  /** Elements by name, in declaration order */
  elements: Map<string, RequirementElement>
  /** Relationships in declaration order */
  relationships: Relation[]
  /** `classDef` declarations, by class name */
  classes: Map<string, string>
}

/** One requirement box. */
export interface Requirement {
  name: string
  type: RequirementType
  /** `id:` from the body — a tracker reference, not the node's name */
  requirementId: string
  /** `text:` from the body — the requirement statement itself */
  text: string
  risk?: RiskLevel
  verifyMethod?: VerifyType
  /** Inline CSS from a `style` statement */
  cssStyles: string[]
  /** Class names from `class` statements or a `:::name` suffix */
  classes: string[]
}

/** One design element box. */
export interface RequirementElement {
  name: string
  /** `type:` from the body — free text, e.g. "simulation" */
  type: string
  /** `docRef:` from the body — where the element is specified */
  docRef: string
  /** Inline CSS from a `style` statement */
  cssStyles: string[]
  /** Class names from `class` statements or a `:::name` suffix */
  classes: string[]
}

/** One traceability relationship. */
export interface Relation {
  type: RelationshipType
  /** Name of the source node */
  src: string
  /** Name of the destination node */
  dst: string
  /**
   * Stable id, unique even when two relationships join the same pair.
   * Shaped `<src>-<dst>-<n>`, matching upstream.
   */
  id: string
}

// ============================================================================
// Positioned diagram — ready for SVG rendering
// ============================================================================

export interface PositionedRequirementDiagram {
  width: number
  height: number
  nodes: PositionedRequirementNode[]
  edges: PositionedRelation[]
  /** Title anchor, when the diagram has one */
  title?: { text: string; x: number; y: number }
}

/**
 * One placed box.
 *
 * Requirements and elements share a shape and differ only in their header and
 * their rows, so one positioned type covers both.
 */
export interface PositionedRequirementNode {
  /** Node name, which is also its id */
  name: string
  /** Whether this is a requirement or a design element */
  kind: 'requirement' | 'element'
  /** Stereotype line above the name — «requirement» or «element» */
  stereotype: string
  /** Name, wrapped to the box */
  nameLines: string[]
  /** Body rows, each a label and a value */
  rows: { label: string; value: string }[]
  x: number
  y: number
  width: number
  height: number
  /** Height of the header band, from the top of the box */
  headerHeight: number
  /** Palette index — requirements and elements read differently */
  colorIndex: number
  /** Inline CSS compiled from `style` statements, when any */
  style?: string
  /** Class names, emitted so a host page can target the node */
  classes: string[]
}

export interface PositionedRelation {
  type: RelationshipType
  src: string
  dst: string
  id: string
  /** Polyline through the routed points */
  path: string
  /** Label anchor, centred on the edge */
  label: { text: string; x: number; y: number }
}
