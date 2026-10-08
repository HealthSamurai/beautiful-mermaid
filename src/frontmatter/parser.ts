import type { FrontmatterColors, FrontmatterConfig, FrontmatterResult } from './types.ts'

// ============================================================================
// Frontmatter and init-directive parser
//
// Strips the metadata Mermaid allows in front of a diagram body and
// translates the parts this library can honour.
//
//   ---
//   title: My diagram
//   config:
//     theme: dark
//     themeVariables:
//       primaryColor: "#ff0000"
//       background: "#1a1b26"
//   ---
//   flowchart LR
//
//   %%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#f00'}}}%%
//
// Only presentation settings are translated, into colour overrides that feed
// RenderOptions. Everything else is dropped rather than half-applied: a
// silently ignored layout flag is less confusing than one that only works
// sometimes.
//
// The YAML subset handled here is deliberately small (nested maps of scalars),
// because that is all a mermaid frontmatter block ever contains, and a real
// YAML parser is not worth a dependency for it.
// ============================================================================

/**
 * Mermaid theme variables mapped onto this library's colour roles.
 *
 * Mermaid has dozens of theme variables; these are the ones with an honest
 * equivalent here. The rest would need per-diagram-element theming that this
 * library intentionally does not have.
 */
const THEME_VARIABLE_MAP: Record<string, keyof FrontmatterColors> = {
  background: 'bg',
  primarycolor: 'accent',
  primarytextcolor: 'fg',
  primarybordercolor: 'border',
  linecolor: 'line',
  secondarycolor: 'surface',
  tertiarycolor: 'surface',
  textcolor: 'fg',
  mainbkg: 'surface',
  nodeborder: 'border',
}

/**
 * Built-in Mermaid theme names mapped onto bg/fg pairs.
 *
 * A host page that drives colours through RenderOptions wins over these —
 * see the merge order in renderMermaidSVG.
 */
const BUILTIN_THEMES: Record<string, FrontmatterColors> = {
  dark: { bg: '#1e1e2e', fg: '#cdd6f4' },
  neutral: { bg: '#ffffff', fg: '#333333' },
  forest: { bg: '#f4fbf4', fg: '#1b4332', accent: '#2d6a4f' },
  base: {},
  default: {},
}

/**
 * Strip frontmatter and init directives from a diagram source.
 *
 * Always returns a usable body: malformed metadata is dropped rather than
 * thrown, so a diagram with a typo in its frontmatter still renders.
 */
export function parseFrontmatter(text: string): FrontmatterResult {
  const colors: FrontmatterColors = {}
  const config: FrontmatterConfig = {}
  let title: string | undefined
  let body = text

  // 1. YAML frontmatter, which must start on the very first line
  const fm = body.match(/^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (fm) {
    const parsed = parseYamlBlock(fm[1]!)
    title = parsed.title
    Object.assign(colors, parsed.colors)
    mergeConfig(config, parsed.config)
    body = body.slice(fm[0].length)
  }

  // 2. `%%{init: {...}}%%` directives, which may appear on any line
  const initPattern = /^[ \t]*%%\{\s*init\s*:\s*([\s\S]*?)\}%%[ \t]*$/gim
  const found: string[] = []

  body = body.replace(initPattern, (_match, payload: string) => {
    found.push(payload)
    return ''
  })

  for (const payload of found) {
    const parsed = parseInitPayload(payload)
    Object.assign(colors, parsed.colors)
    mergeConfig(config, parsed.config)
  }

  // Leading blank lines left behind by a stripped directive would confuse
  // the header detection, so clear them
  body = body.replace(/^(?:[ \t]*\r?\n)+/, '')

  return { body, title, colors, config }
}

// ---------------------------------------------------------------------------
// YAML frontmatter
// ---------------------------------------------------------------------------

/**
 * Parse the small YAML subset a mermaid frontmatter block uses: nested maps
 * of scalar values, indentation-delimited.
 */
function parseYamlBlock(block: string): {
  title?: string
  colors: FrontmatterColors
  config: FrontmatterConfig
} {
  const colors: FrontmatterColors = {}
  const config: FrontmatterConfig = {}
  let title: string | undefined

  // Path of keys we are currently inside, by indentation
  const path: { indent: number; key: string }[] = []

  for (const raw of block.split(/\r?\n/)) {
    const withoutComment = raw.replace(/\s+#.*$/, '')
    if (!withoutComment.trim()) continue

    const indent = withoutComment.length - withoutComment.trimStart().length
    const line = withoutComment.trim()

    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!kv) continue

    const key = kv[1]!.toLowerCase()
    const value = unquote(kv[2]!.trim())

    // Close any scopes we have dedented out of
    while (path.length > 0 && indent <= path[path.length - 1]!.indent) {
      path.pop()
    }

    // No value means this key opens a nested map
    if (!value) {
      path.push({ indent, key })
      continue
    }

    const scope = path.map(p => p.key)

    if (key === 'title' && scope.length === 0) {
      title = value
      continue
    }

    applySetting(colors, config, scope, key, value)
  }

  return { title, colors, config }
}

// ---------------------------------------------------------------------------
// Init directives
// ---------------------------------------------------------------------------

/**
 * Parse an `%%{init: ...}%%` payload.
 *
 * The payload is JSON-ish: it allows single quotes and unquoted keys, so it
 * is scanned for `key: value` pairs rather than JSON.parse'd. Nesting is
 * tracked only as far as needed to tell a themeVariables entry from a
 * top-level one.
 */
function parseInitPayload(payload: string): {
  colors: FrontmatterColors
  config: FrontmatterConfig
} {
  const colors: FrontmatterColors = {}
  const config: FrontmatterConfig = {}

  // themeVariables: { ... } — the inner block, if present
  const themeVars = payload.match(/['"]?themeVariables['"]?\s*:\s*\{([^{}]*)\}/i)
  if (themeVars) {
    for (const [, key, value] of pairs(themeVars[1]!)) {
      applySetting(colors, config, ['themevariables'], key, value)
    }
  }

  // Top-level settings, with the themeVariables block removed so its entries
  // are not read twice
  // Per-diagram blocks: pie: { ... }, timeline: { ... }
  for (const type of ['pie', 'timeline'] as const) {
    const block = payload.match(new RegExp(`['"]?${type}['"]?\\s*:\\s*\\{([^{}]*)\\}`, 'i'))
    if (!block) continue
    for (const [, key, value] of pairs(block[1]!)) {
      applySetting(colors, config, [type], key, value)
    }
  }

  const topLevel = themeVars ? payload.replace(themeVars[0], '') : payload
  for (const [, key, value] of pairs(topLevel)) {
    applySetting(colors, config, [], key, value)
  }

  return { colors, config }
}

/** Scan `key: value` pairs out of a JSON-ish fragment. */
function pairs(text: string): [string, string, string][] {
  const pattern = /['"]?([\w-]+)['"]?\s*:\s*(?:'([^']*)'|"([^"]*)"|([^,{}\s]+))/g
  const out: [string, string, string][] = []

  for (const match of text.matchAll(pattern)) {
    const key = match[1]!.toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    out.push([match[0], key, value])
  }

  return out
}

// ---------------------------------------------------------------------------
// Shared setting application
// ---------------------------------------------------------------------------

/**
 * Apply one setting, from either metadata form, onto the colour overrides.
 *
 * `scope` is the chain of enclosing keys, so a `theme` inside `config` and a
 * top-level `theme` are both recognised, while an unrelated key called
 * `theme` nested somewhere else is not mistaken for one.
 */
function applySetting(
  colors: FrontmatterColors,
  config: FrontmatterConfig,
  scope: readonly string[],
  key: string,
  value: string,
): void {
  const inThemeVariables = scope.includes('themevariables')

  if (key === 'theme' && !inThemeVariables) {
    const preset = BUILTIN_THEMES[value.toLowerCase()]
    if (preset) {
      // A named theme is a baseline: explicit variables set later win over it
      for (const [role, color] of Object.entries(preset)) {
        const field = role as keyof FrontmatterColors
        if (colors[field] === undefined) colors[field] = color
      }
    }
    return
  }

  // Per-diagram settings, recognised only inside their own block so an
  // unrelated key of the same name elsewhere is not picked up
  if (!inThemeVariables) {
    if (scope.includes('pie') && key === 'textposition') {
      const position = Number(value)
      // Outside 0..1 the labels would land off the wedge entirely
      if (Number.isFinite(position) && position >= 0 && position <= 1) {
        config.pie = { ...config.pie, textPosition: position }
      }
      return
    }
    if (scope.includes('timeline') && key === 'disablemulticolor') {
      config.timeline = { ...config.timeline, disableMulticolor: isTrue(value) }
      return
    }
    if (scope.includes('kanban') && key === 'showids') {
      config.kanban = { ...config.kanban, showIds: isTrue(value) }
      return
    }
    if (scope.includes('treemap')) {
      if (key === 'showvalues') {
        config.treemap = { ...config.treemap, showValues: isTrue(value) }
        return
      }
      if (key === 'valueformat') {
        config.treemap = { ...config.treemap, valueFormat: value }
        return
      }
    }
  }

  const role = THEME_VARIABLE_MAP[key]
  if (role && isColorValue(value)) {
    colors[role] = value
  }
}

/** Merge a parsed config block over an accumulated one, one level deep. */
function mergeConfig(target: FrontmatterConfig, source: FrontmatterConfig): void {
  if (source.pie) target.pie = { ...target.pie, ...source.pie }
  if (source.timeline) target.timeline = { ...target.timeline, ...source.timeline }
  if (source.kanban) target.kanban = { ...target.kanban, ...source.kanban }
  if (source.treemap) target.treemap = { ...target.treemap, ...source.treemap }
}

/** YAML-ish truthiness, so `true`, `yes` and `1` all read as enabled. */
function isTrue(value: string): boolean {
  return ['true', 'yes', '1', 'on'].includes(value.trim().toLowerCase())
}

/**
 * Whether a value is usable as a CSS colour.
 *
 * Hex, rgb()/hsl() and a plain colour keyword all pass; anything with a
 * character that could break out of a style attribute does not.
 */
function isColorValue(value: string): boolean {
  if (!value) return false
  if (/[;{}<>"']/.test(value)) return false
  return (
    /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ||
    /^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/.test(value) ||
    /^[a-zA-Z]+$/.test(value)
  )
}

/** Strip one layer of surrounding single or double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/) ?? text.match(/^'(.*)'$/)
  return quoted ? quoted[1]! : text
}
