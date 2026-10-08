// ============================================================================
// Timeline types
//
// Models the parsed and positioned representations of a Mermaid `timeline`
// diagram: an ordered list of periods, each carrying zero or more events,
// optionally grouped into sections.
//
// Unlike gantt, a timeline has no dates — a period is just a label, and the
// order of declaration is the order on the axis.
// ============================================================================

/** Axis orientation. Horizontal is the Mermaid default. */
export type TimelineOrientation = 'horizontal' | 'vertical'

// ============================================================================
// Parsed timeline — logical structure from mermaid text
// ============================================================================

/** Parsed timeline diagram. */
export interface TimelineDiagram {
  /** Optional diagram title */
  title?: string
  /** Axis orientation — `timeline vertical` opts into the vertical layout */
  orientation: TimelineOrientation
  /** Sections in source order. Periods before any `section` land in an unnamed one. */
  sections: TimelineSection[]
  /** All periods in source order, flattened across sections */
  periods: TimelinePeriod[]
}

/** A named group of periods, drawn as a band behind them. */
export interface TimelineSection {
  /** Section label — empty string for periods declared before the first `section` */
  title: string
  /** Periods belonging to this section, in source order */
  periods: TimelinePeriod[]
}

/** One point on the axis: a label plus the events that happened there. */
export interface TimelinePeriod {
  /** Period label (the text before the first `:`) */
  label: string
  /** Events recorded at this period, in source order */
  events: string[]
  /** Title of the owning section ('' when none) */
  section: string
}

// ============================================================================
// Positioned timeline — ready for SVG rendering
// ============================================================================

export interface PositionedTimeline {
  width: number
  height: number
  /** Orientation this layout was computed for */
  orientation: TimelineOrientation
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** The axis spine running through every period marker */
  axis: { x1: number; y1: number; x2: number; y2: number }
  /** Section bands behind their periods (empty when the diagram has no sections) */
  sections: PositionedTimelineSection[]
  /** Period markers with their labels */
  periods: PositionedPeriod[]
  /** Event cards, each linked to its period by a connector */
  events: PositionedEvent[]
  /** Connector lines from a period marker to its first event */
  connectors: TimelineConnector[]
}

export interface PositionedTimelineSection {
  /** Section label ('' when unnamed — then no label is drawn) */
  title: string
  /** Label anchor */
  labelX: number
  labelY: number
  /** Text anchor for the label */
  labelAnchor: 'start' | 'middle' | 'end'
  /** Band covering all periods of this section */
  band: { x: number; y: number; width: number; height: number }
  /** Index of the section, used to pick its color from the palette */
  colorIndex: number
}

export interface PositionedPeriod {
  /** Period label */
  label: string
  /** Marker (dot) center on the axis */
  cx: number
  cy: number
  /** Marker radius */
  radius: number
  /** Label anchor position */
  labelX: number
  labelY: number
  /** Text anchor for the label */
  labelAnchor: 'start' | 'middle' | 'end'
  /** Index of the owning section, for coloring */
  colorIndex: number
}

export interface PositionedEvent {
  /** Event text */
  text: string
  /** Card rectangle */
  x: number
  y: number
  width: number
  height: number
  /** Text anchor position inside the card */
  labelX: number
  labelY: number
  /** Text anchor for the label */
  labelAnchor: 'start' | 'middle' | 'end'
  /** Index of the owning section, for coloring */
  colorIndex: number
}

export interface TimelineConnector {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Index of the owning section, for coloring */
  colorIndex: number
}
