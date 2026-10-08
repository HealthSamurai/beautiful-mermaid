import type {
  QuadrantAxis, QuadrantDiagram, QuadrantLabels, QuadrantPoint, QuadrantPointStyles,
} from './types.ts'

// ============================================================================
// Quadrant chart parser
//
// Parses Mermaid `quadrantChart` syntax into a QuadrantDiagram.
//
// Directives (all keywords case-insensitive):
//   quadrantChart
//   title <text>
//   x-axis <left> --> <right>        — right end optional
//   y-axis <bottom> --> <top>        — top end optional
//   quadrant-1 <text>                — top-right, then anticlockwise
//   quadrant-2 <text>                — top-left
//   quadrant-3 <text>                — bottom-left
//   quadrant-4 <text>                — bottom-right
//
// Points — `label: [x, y]` with both coordinates in 0..1:
//   Microsoft: [0.75, 0.75]
//   "Point: with a colon": [1, 0]
//   Campaign A:::class1: [0.3, 0.6]
//   Campaign B: [0.3, 0.6] radius: 10, color: #ff0000
//
// Coordinates outside 0..1 are an error, matching upstream, because a point
// outside the unit square has no meaning on this chart.
// ============================================================================

/** Style names upstream accepts on a point, mapped to our camelCase fields. */
const STYLE_NAMES: Record<string, keyof QuadrantPointStyles> = {
  radius: 'radius',
  color: 'color',
  'stroke-color': 'strokeColor',
  'stroke-width': 'strokeWidth',
}

/**
 * Parse a Mermaid quadrantChart from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 *
 * @throws When a point coordinate is outside 0..1, or a style value is
 *         malformed — both mirroring upstream error messages.
 */
export function parseQuadrantDiagram(lines: string[]): QuadrantDiagram {
  let title: string | undefined
  const xAxis: QuadrantAxis = {}
  const yAxis: QuadrantAxis = {}
  const quadrants: QuadrantLabels = {}
  const points: QuadrantPoint[] = []

  for (const line of lines) {
    // Header line
    if (/^quadrantChart\b/i.test(line)) continue

    // Accessibility metadata — accepted and ignored
    if (/^acc(Title|Descr)\b/i.test(line)) continue

    // title <text> — upstream keeps the quotes here, so we do too
    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = titleMatch[1]!.trim()
      continue
    }

    // x-axis / y-axis, with an optional second end after `-->`
    const axisMatch = line.match(/^([xy])-axis\s+(.+)$/i)
    if (axisMatch) {
      const axis = axisMatch[1]!.toLowerCase() === 'x' ? xAxis : yAxis
      assignAxis(axis, axisMatch[2]!.trim())
      continue
    }

    // quadrant-N <text>
    const quadrantMatch = line.match(/^quadrant-([1-4])\s+(.+)$/i)
    if (quadrantMatch) {
      const key = `q${quadrantMatch[1]}` as keyof QuadrantLabels
      quadrants[key] = unquote(quadrantMatch[2]!.trimEnd())
      continue
    }

    // label: [x, y] [styles]
    const point = parsePointLine(line)
    if (point) {
      points.push(point)
      continue
    }
  }

  return { title, xAxis, yAxis, quadrants, points }
}

// ---------------------------------------------------------------------------
// Axis
// ---------------------------------------------------------------------------

/**
 * Split an axis definition on `-->`. A trailing arrow with nothing after it
 * is kept as part of the first label (upstream appends " ⟶ "), so a
 * half-written line still renders.
 */
function assignAxis(axis: QuadrantAxis, text: string): void {
  const arrow = text.indexOf('-->')
  if (arrow < 0) {
    axis.start = unquote(text)
    return
  }

  const left = text.slice(0, arrow).trim()
  const right = text.slice(arrow + 3).trim()

  if (!right) {
    axis.start = `${unquote(left)} ⟶`
    return
  }

  axis.start = unquote(left)
  axis.end = unquote(right)
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/**
 * Parse one point line. Returns undefined when the line is not a point.
 *
 * The label is read first so that a quoted label may contain a colon; the
 * coordinates then come from the first `[...]` group after it.
 */
function parsePointLine(line: string): QuadrantPoint | undefined {
  // A quoted label may contain anything, including a colon
  const quoted = line.match(/^"([^"]*)"\s*(:::[A-Za-z_][\w-]*)?\s*:\s*\[(.+)$/)
  const bare = line.match(/^([^:[\]]+?)\s*(:::[A-Za-z_][\w-]*)?\s*:\s*\[(.+)$/)
  const match = quoted ?? bare
  if (!match) return undefined

  const label = match[1]!.trim()
  const className = match[2] ? match[2].slice(3) : ''

  // `0.75, 0.75] radius: 10, color: #f00` — coordinates, then optional styles
  const rest = match[3]!
  const close = rest.indexOf(']')
  if (close < 0) return undefined

  const coords = rest.slice(0, close).split(',').map(c => c.trim())
  if (coords.length !== 2) return undefined

  const x = Number(coords[0])
  const y = Number(coords[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined

  assertUnitRange(label, x)
  assertUnitRange(label, y)

  const styleText = rest.slice(close + 1).trim()
  const styles = styleText ? parseStyles(splitStyles(styleText)) : {}

  return { label, x, y, className, styles }
}

/** Points must sit inside the unit square — anything else has no position. */
function assertUnitRange(label: string, value: number): void {
  if (value < 0 || value > 1) {
    throw new Error(
      `point "${label}" has invalid coordinate ${value}. ` +
      `Coordinates must be between 0 and 1.`
    )
  }
}

/** Split a trailing style list on commas, dropping empty entries. */
function splitStyles(text: string): string[] {
  return text.split(',').map(s => s.trim()).filter(s => s.length > 0)
}

// ---------------------------------------------------------------------------
// Point styles
// ---------------------------------------------------------------------------

/**
 * Parse a `name: value` style list into a styles object.
 * Error messages match upstream quadrantDb.parseStyles exactly.
 *
 * @throws On an unknown style name or a value of the wrong shape.
 */
export function parseStyles(styles: readonly string[]): QuadrantPointStyles {
  const out: QuadrantPointStyles = {}

  for (const style of styles) {
    const colon = style.indexOf(':')
    if (colon < 0) continue

    const name = style.slice(0, colon).trim()
    const value = style.slice(colon + 1).trim()
    const field = STYLE_NAMES[name]

    if (!field) {
      throw new Error(`style named ${name} is not supported.`)
    }

    switch (field) {
      case 'radius': {
        const radius = Number(value)
        if (!Number.isFinite(radius)) {
          throw new Error(`value for radius ${value} is invalid, please use a valid number`)
        }
        out.radius = radius
        break
      }
      case 'color':
      case 'strokeColor': {
        if (!isHexColor(value)) {
          throw new Error(`value for ${name} ${value} is invalid, please use a valid hex code`)
        }
        out[field] = value
        break
      }
      case 'strokeWidth': {
        if (!/^\d+(?:\.\d+)?px$/.test(value)) {
          throw new Error(
            `value for stroke-width ${value} is invalid, ` +
            `please use a valid number of pixels (eg. 10px)`
          )
        }
        out.strokeWidth = value
        break
      }
    }
  }

  return out
}

/** A 3- or 6-digit hex colour, the two forms upstream accepts. */
function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}
