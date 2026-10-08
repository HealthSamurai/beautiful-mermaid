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
  /** Per-diagram-type settings this library honours, when any were given */
  config: FrontmatterConfig
}

/**
 * Diagram configuration recognised in a frontmatter or init block.
 *
 * Mermaid's config tree has hundreds of keys; these are the ones with a
 * visible effect in this renderer. Each is namespaced by the diagram type it
 * belongs to, exactly as Mermaid nests them:
 *
 *   config:
 *     pie:
 *       textPosition: 0.6
 *     timeline:
 *       disableMulticolor: true
 */
export interface FrontmatterConfig {
  pie?: {
    /**
     * Where percentage labels sit along the radius, 0 (centre) to 1 (edge).
     * @default 0.75
     */
    textPosition?: number
  }
  timeline?: {
    /** Draw every section in the theme accent instead of one colour each */
    disableMulticolor?: boolean
  }
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
