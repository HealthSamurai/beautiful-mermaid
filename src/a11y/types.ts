// ============================================================================
// Accessibility metadata types
//
// Mermaid lets any diagram carry a screen-reader title and description:
//
//   accTitle: Quarterly revenue
//   accDescr: Revenue grew in every quarter of 2024.
//
//   accDescr {
//     A longer description
//     spanning several lines.
//   }
//
// These are not drawn. They become the SVG's <title> and <desc>, which is
// what assistive technology reads instead of trying to interpret the shapes.
// ============================================================================

/** Accessibility metadata lifted out of a diagram source. */
export interface AccessibilityInfo {
  /** Short label for the diagram, from `accTitle:` */
  title?: string
  /** Longer explanation, from `accDescr:` or `accDescr { ... }` */
  description?: string
}

/** Result of stripping accessibility metadata from a diagram source. */
export interface AccessibilityResult extends AccessibilityInfo {
  /** The diagram body with the metadata lines removed */
  body: string
}
