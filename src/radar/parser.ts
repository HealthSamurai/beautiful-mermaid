import type { RadarAxis, RadarCurve, RadarDiagram, RadarGraticule, RadarOptions } from './types.ts'

// ============================================================================
// Radar chart parser
//
// Parses Mermaid `radar-beta` syntax.
//
// Statements:
//   radar-beta[:]
//   title <text>
//   axis A, B, C                       — ids only, label defaults to the id
//   axis A["Axis A"], B["Axis B"]      — ids with labels
//   curve mycurve{1, 2, 3}             — one value per axis, in axis order
//   curve mycurve["My Curve"]{1, 2, 3}
//   curve mycurve{ C: 3, A: 1, B: 2 }  — keyed, so order does not matter
//   ticks 10 | graticule polygon | showLegend false | min 1 | max 10
//
// Axes may be declared across several `axis` lines, and a keyed curve is
// resolved against whatever axes exist when the diagram is finished, so a
// curve written before its axes still lands correctly.
// ============================================================================

/** Mermaid's defaults, reproduced exactly. */
const DEFAULT_OPTIONS: RadarOptions = {
  ticks: 5,
  graticule: 'circle',
  showLegend: true,
  min: 0,
  max: null,
}

/**
 * Upper bound on the grid ring count.
 *
 * Without it a diagram could ask for millions of rings and hang the renderer,
 * which upstream treats as a denial of service rather than a style choice.
 */
const MAX_TICKS = 32

/**
 * Parse a Mermaid radar chart from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 */
export function parseRadarDiagram(lines: string[]): RadarDiagram {
  let title: string | undefined
  const axes: RadarAxis[] = []
  const options: RadarOptions = { ...DEFAULT_OPTIONS }

  /** Curves kept in raw form until every axis is known. */
  const pending: Array<{ name: string; label: string; raw: string }> = []

  for (const raw of lines) {
    const line = stripInlineComment(raw)
    if (!line) continue

    // Header — `radar-beta`, `radar-beta:`, optionally with a trailing title
    const header = line.match(/^radar(?:-beta)?\b\s*:?\s*(.*)$/i)
    if (header) {
      const rest = header[1]!.trim()
      if (rest) {
        const inlineTitle = rest.match(/^title\s+(.+)$/i)
        if (inlineTitle) title = inlineTitle[1]!.trim()
      }
      continue
    }

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = unquote(titleMatch[1]!.trim())
      continue
    }

    // axis A, B["Label"], C
    const axisMatch = line.match(/^axis\s+(.+)$/i)
    if (axisMatch) {
      for (const entry of splitTopLevel(axisMatch[1]!)) {
        const parsed = parseNamedEntry(entry)
        if (parsed && !axes.some(a => a.name === parsed.name)) axes.push(parsed)
      }
      continue
    }

    // curve name["Label"]{values}
    const curveMatch = line.match(/^curve\s+(.+)$/i)
    if (curveMatch) {
      const rest = curveMatch[1]!.trim()
      const braceAt = rest.indexOf('{')
      if (braceAt === -1) continue

      const head = rest.slice(0, braceAt).trim()
      const body = rest.slice(braceAt + 1).replace(/\}\s*$/, '')

      const parsed = parseNamedEntry(head)
      if (!parsed) continue

      pending.push({ name: parsed.name, label: parsed.label, raw: body })
      continue
    }

    // Single-value option statements
    const option = line.match(/^(ticks|graticule|showLegend|min|max)\s+(.+)$/i)
    if (option) {
      applyOption(options, option[1]!.toLowerCase(), option[2]!.trim())
      continue
    }
  }

  // Resolve curves once the axis list is complete
  const curves: RadarCurve[] = pending.map(({ name, label, raw }) => ({
    name,
    label,
    entries: parseCurveEntries(raw, axes),
  }))

  return { title, axes, curves, options }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Apply one option statement, ignoring a value that does not make sense. */
function applyOption(options: RadarOptions, key: string, value: string): void {
  switch (key) {
    case 'ticks': {
      const ticks = Number(value)
      if (Number.isFinite(ticks) && ticks > 0) {
        options.ticks = Math.min(Math.floor(ticks), MAX_TICKS)
      }
      return
    }
    case 'graticule': {
      const style = value.toLowerCase()
      if (style === 'circle' || style === 'polygon') {
        options.graticule = style as RadarGraticule
      }
      return
    }
    case 'showlegend':
      options.showLegend = value.toLowerCase() !== 'false'
      return
    case 'min': {
      const min = Number(value)
      if (Number.isFinite(min)) options.min = min
      return
    }
    case 'max': {
      const max = Number(value)
      if (Number.isFinite(max)) options.max = max
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** Parse `name` or `name["Label"]` into an id and a display label. */
function parseNamedEntry(text: string): { name: string; label: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const withLabel = trimmed.match(/^([^[\]]+?)\s*\[\s*(.*?)\s*\]$/)
  if (withLabel) {
    const name = withLabel[1]!.trim()
    return name ? { name, label: unquote(withLabel[2]!) } : null
  }

  // A bare id doubles as its own label
  return { name: trimmed, label: trimmed }
}

/**
 * Parse the values inside a curve's braces.
 *
 * Two forms: positional (`{1, 2, 3}`) matched to axes in order, and keyed
 * (`{ C: 3, A: 1 }`) matched by axis name. A keyed form may list the axes in
 * any order and omit some, which then read as the chart minimum.
 */
function parseCurveEntries(body: string, axes: readonly RadarAxis[]): number[] {
  const parts = splitTopLevel(body)
  const keyed = parts.some(p => /^[^:]+:/.test(p))

  if (!keyed) {
    const values = parts.map(p => Number(p.trim())).map(v => (Number.isFinite(v) ? v : 0))
    // Pad or trim so every curve has exactly one entry per axis, which is
    // what keeps the shapes comparable
    return axes.map((_, i) => values[i] ?? 0)
  }

  const byName = new Map<string, number>()
  for (const part of parts) {
    const match = part.match(/^\s*(?:"([^"]*)"|([^:]+))\s*:\s*(.+)\s*$/)
    if (!match) continue
    const name = (match[1] ?? match[2] ?? '').trim()
    const value = Number(match[3]!.trim())
    if (name && Number.isFinite(value)) byName.set(name, value)
  }

  return axes.map(axis => byName.get(axis.name) ?? 0)
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Split on commas that are not inside brackets or quotes.
 *
 * Needed because an axis label may itself contain a comma:
 * `axis A["one, two"], B`.
 */
function splitTopLevel(text: string): string[] {
  const out: string[] = []
  let current = ''
  let depth = 0
  let inQuotes = false

  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }
    if (!inQuotes) {
      if ('[{('.includes(char)) depth++
      else if (']})'.includes(char)) depth--
      else if (char === ',' && depth === 0) {
        if (current.trim()) out.push(current.trim())
        current = ''
        continue
      }
    }
    current += char
  }

  if (current.trim()) out.push(current.trim())
  return out
}

/** Remove a trailing `%% comment` from a line. */
function stripInlineComment(line: string): string {
  const idx = line.indexOf('%%')
  return (idx === -1 ? line : line.slice(0, idx)).trim()
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.trim().match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text.trim()
}
