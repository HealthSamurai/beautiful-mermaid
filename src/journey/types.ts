// ============================================================================
// User journey types
//
// Models the parsed and positioned representations of a Mermaid `journey`
// diagram: an ordered list of tasks, each with a satisfaction score (1-5)
// and the people involved, grouped into sections.
//
// A journey is read left to right: sections are phases of the experience,
// tasks are steps within a phase, and the score line connecting them shows
// how the experience rises and falls.
// ============================================================================

// ============================================================================
// Parsed journey — logical structure from mermaid text
// ============================================================================

/** Parsed journey diagram. */
export interface JourneyDiagram {
  /** Optional diagram title */
  title?: string
  /** Sections in source order. Tasks before any `section` land in an unnamed one. */
  sections: JourneySection[]
  /** All tasks in source order, flattened across sections */
  tasks: JourneyTask[]
  /** Every distinct person mentioned, in first-appearance order */
  actors: string[]
}

/** A named phase of the journey, drawn as a band above its tasks. */
export interface JourneySection {
  /** Section label — empty string for tasks declared before the first `section` */
  title: string
  /** Tasks belonging to this section, in source order */
  tasks: JourneyTask[]
}

/** One step of the journey. */
export interface JourneyTask {
  /** Task label (the text before the `:`) */
  task: string
  /** Satisfaction score, clamped to 1..5 */
  score: number
  /**
   * People involved. Mirrors upstream quirks exactly:
   *   `A task: 5: Alice, Bob` → ['Alice', 'Bob']
   *   `C task: 5`             → []        (no colon at all)
   *   `E task: 5:`            → ['']      (trailing colon, nothing after)
   */
  people: string[]
  /** Title of the owning section ('' when none) */
  section: string
}

// ============================================================================
// Positioned journey — ready for SVG rendering
// ============================================================================

export interface PositionedJourney {
  width: number
  height: number
  /** Title text and position (if present) */
  title?: { text: string; x: number; y: number }
  /** Horizontal gridlines, one per score level (1..5) */
  scoreLines: PositionedScoreLine[]
  /** Section bands above their tasks (empty when the diagram has no sections) */
  sections: PositionedJourneySection[]
  /** Task markers positioned by score */
  tasks: PositionedJourneyTask[]
  /** Polyline through every task marker, showing the experience curve */
  curve: { points: { x: number; y: number }[] }
}

export interface PositionedJourneySection {
  /** Section label ('' when unnamed — then no label is drawn) */
  title: string
  /** Label anchor, centred over the section's tasks */
  labelX: number
  labelY: number
  /** Band covering all tasks of this section */
  band: { x: number; y: number; width: number; height: number }
  /** Palette index — same generator as xychart series */
  colorIndex: number
}

export interface PositionedJourneyTask {
  /** Task label, wrapped to the column width */
  lines: string[]
  /** Raw task label, for the accessible <title> child */
  label: string
  /** Satisfaction score */
  score: number
  /** People involved, already formatted for display */
  people: string[]
  /** Marker centre — y encodes the score */
  cx: number
  cy: number
  radius: number
  /** Task label block, below the marker */
  labelX: number
  labelY: number
  /** People label, below the task label (omitted when nobody is listed) */
  peopleLabel?: { text: string; x: number; y: number }
  /** Palette index of the owning section */
  colorIndex: number
}

export interface PositionedScoreLine {
  /** Score this line marks (1..5) */
  score: number
  y: number
  x1: number
  x2: number
  /** Axis label at the left edge */
  labelX: number
}
