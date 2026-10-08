// ============================================================================
// Frontmatter types
//
// Models the metadata Mermaid allows in front of a diagram body: a YAML
// frontmatter block and/or `%%{init: ...}%%` directives.
//
//   ---
//   title: My diagram
//   config:
//     theme: dark
//     themeVariables:
//       primaryColor: "#ff0000"
//   ---
//   flowchart LR
//     A --> B
//
// Both forms carry presentation settings that this library expresses through
// its own theme system, so they are translated into RenderOptions overrides
// rather than stored as an opaque config object.
// ============================================================================

/** Result of stripping metadata from a diagram source. */
export interface FrontmatterResult {
  /** The diagram body with the frontmatter and init directives removed */
  body: string
  /** Diagram title from `title:`, when given */
  title?: string
  /** Colour overrides translated from theme settings, when any were given */
  colors: FrontmatterColors
}

/**
 * Colour overrides recognised in a frontmatter or init block.
 *
 * Field names match the RenderOptions they feed, not the Mermaid theme
 * variable they came from — the mapping lives in the parser.
 */
export interface FrontmatterColors {
  bg?: string
  fg?: string
  line?: string
  accent?: string
  muted?: string
  surface?: string
  border?: string
}
