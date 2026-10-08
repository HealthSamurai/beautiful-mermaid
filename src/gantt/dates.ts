// ============================================================================
// Gantt — date parsing, duration arithmetic and axis formatting
//
// No Date-library dependency and no locale lookups: everything is computed in
// UTC epoch milliseconds so the rendered SVG is deterministic on every machine.
//
//   parseGanttDate('2024-01-31', 'YYYY-MM-DD')  → epoch ms
//   addDuration(t, '2w')                        → t + 14 days
//   formatGanttDate(t, '%b %Y')                 → "Jan 2024"
//
// Supported `dateFormat` tokens: YYYY, YY, MM, M, DD, D, HH, H, mm, ss.
// Anything else in the pattern is treated as a literal separator, so
// "DD/MM/YYYY", "YYYY-MM" and "YYYY-MM-DDTHH:mm:ss" all work.
//
// Supported `axisFormat` directives are the d3-time subset Mermaid users
// actually write: %Y %y %m %b %B %d %e %H %M %S %q %%.
// ============================================================================

/** One day in milliseconds — the base unit of gantt layout arithmetic. */
export const DAY_MS = 86_400_000

/** Default `dateFormat` when the diagram does not declare one. */
export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/** Tokens recognised in a `dateFormat` pattern, longest first so YYYY wins over YY. */
const DATE_TOKENS: Array<{ token: string; re: string; field: DateField }> = [
  { token: 'YYYY', re: '(\\d{4})', field: 'year' },
  { token: 'YY', re: '(\\d{2})', field: 'year2' },
  { token: 'MM', re: '(\\d{1,2})', field: 'month' },
  { token: 'DD', re: '(\\d{1,2})', field: 'day' },
  { token: 'HH', re: '(\\d{1,2})', field: 'hour' },
  { token: 'mm', re: '(\\d{1,2})', field: 'minute' },
  { token: 'ss', re: '(\\d{1,2})', field: 'second' },
  { token: 'M', re: '(\\d{1,2})', field: 'month' },
  { token: 'D', re: '(\\d{1,2})', field: 'day' },
  { token: 'H', re: '(\\d{1,2})', field: 'hour' },
]

type DateField = 'year' | 'year2' | 'month' | 'day' | 'hour' | 'minute' | 'second'

interface CompiledFormat {
  re: RegExp
  fields: DateField[]
}

const formatCache = new Map<string, CompiledFormat>()

/** Compile a `dateFormat` pattern into a capturing regex plus field order. */
function compileDateFormat(format: string): CompiledFormat {
  const cached = formatCache.get(format)
  if (cached) return cached

  const fields: DateField[] = []
  let source = '^'
  let i = 0

  outer: while (i < format.length) {
    for (const t of DATE_TOKENS) {
      if (format.startsWith(t.token, i)) {
        source += t.re
        fields.push(t.field)
        i += t.token.length
        continue outer
      }
    }
    // Literal character — escape it for the regex
    source += format[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    i += 1
  }
  source += '$'

  const compiled: CompiledFormat = { re: new RegExp(source), fields }
  formatCache.set(format, compiled)
  return compiled
}

/**
 * Parse a date string according to a Mermaid `dateFormat` pattern.
 *
 * Falls back to a plain ISO read (`YYYY-MM-DD` / `YYYY-MM` / `YYYY`) when the
 * value does not match the declared pattern, which is what authors expect when
 * they mix an explicit date into a diagram with an unusual dateFormat.
 *
 * @returns epoch milliseconds (UTC), or `null` when the value is not a date
 */
export function parseGanttDate(value: string, format: string = DEFAULT_DATE_FORMAT): number | null {
  const text = value.trim()
  if (!text) return null

  const direct = matchWithFormat(text, format)
  if (direct !== null) return direct

  // ISO-ish fallbacks, most specific first
  for (const fallback of ['YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD', 'YYYY-MM', 'YYYY']) {
    if (fallback === format) continue
    const parsed = matchWithFormat(text, fallback)
    if (parsed !== null) return parsed
  }
  return null
}

function matchWithFormat(text: string, format: string): number | null {
  const { re, fields } = compileDateFormat(format)
  const m = text.match(re)
  if (!m) return null

  let year = 1970
  let month = 1
  let day = 1
  let hour = 0
  let minute = 0
  let second = 0

  fields.forEach((field, idx) => {
    const raw = Number(m[idx + 1])
    switch (field) {
      case 'year': year = raw; break
      // Two-digit years: 00–68 → 2000s, 69–99 → 1900s (the POSIX convention)
      case 'year2': year = raw <= 68 ? 2000 + raw : 1900 + raw; break
      case 'month': month = raw; break
      case 'day': day = raw; break
      case 'hour': hour = raw; break
      case 'minute': minute = raw; break
      case 'second': second = raw; break
    }
  })

  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

/** True when the token can be read as a date under the given format. */
export function isDateLike(value: string, format: string = DEFAULT_DATE_FORMAT): boolean {
  return parseGanttDate(value, format) !== null
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** A parsed `30d` / `2w` / `18mo` style duration. */
export interface GanttDuration {
  amount: number
  unit: 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'mo' | 'y'
}

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|mo|M|y)$/

/**
 * Parse a duration token such as `30d`, `2w`, `0d`, `6mo`, `1y`, `12h`.
 * `M` is accepted as the Mermaid/dayjs spelling of "month".
 *
 * @returns the parsed duration, or `null` when the token is not a duration
 */
export function parseDuration(value: string): GanttDuration | null {
  const m = value.trim().match(DURATION_RE)
  if (!m) return null
  const unit = m[2] === 'M' ? 'mo' : (m[2] as GanttDuration['unit'])
  return { amount: Number(m[1]), unit }
}

/** True when the token is a duration literal (`30d`, `2w`, …). */
export function isDurationLike(value: string): boolean {
  return parseDuration(value) !== null
}

/**
 * Add a duration to an epoch timestamp.
 * Months and years advance the calendar field (so `1mo` from Jan 31 lands in
 * February), everything smaller is plain millisecond arithmetic.
 */
export function addDuration(from: number, duration: GanttDuration): number {
  const { amount, unit } = duration
  switch (unit) {
    case 'ms': return from + amount
    case 's': return from + amount * 1000
    case 'm': return from + amount * 60_000
    case 'h': return from + amount * 3_600_000
    case 'd': return from + amount * DAY_MS
    case 'w': return from + amount * 7 * DAY_MS
    case 'mo': return shiftMonths(from, amount)
    case 'y': return shiftMonths(from, amount * 12)
  }
}

/** Advance by whole calendar months, clamping the day to the target month. */
function shiftMonths(from: number, months: number): number {
  const d = new Date(from)
  const day = d.getUTCDate()
  const target = new Date(from)
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + Math.round(months))
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, daysInTarget))
  return target.getTime()
}

// ---------------------------------------------------------------------------
// Axis formatting
// ---------------------------------------------------------------------------

/**
 * Format an epoch timestamp with a d3-style `axisFormat` pattern.
 *
 * Supported directives: %Y (4-digit year), %y (2-digit), %m (01–12),
 * %b (Jan), %B (January), %d (01–31), %e (1–31), %H, %M, %S, %q (quarter),
 * %% (literal percent). Unknown directives are emitted verbatim.
 */
export function formatGanttDate(epoch: number, pattern: string): string {
  const d = new Date(epoch)
  const pad = (n: number) => String(n).padStart(2, '0')

  return pattern.replace(/%(.)/g, (_, dir: string) => {
    switch (dir) {
      case 'Y': return String(d.getUTCFullYear())
      case 'y': return pad(d.getUTCFullYear() % 100)
      case 'm': return pad(d.getUTCMonth() + 1)
      case 'b': return MONTHS_SHORT[d.getUTCMonth()]!
      case 'B': return MONTHS_LONG[d.getUTCMonth()]!
      case 'd': return pad(d.getUTCDate())
      case 'e': return String(d.getUTCDate())
      case 'H': return pad(d.getUTCHours())
      case 'M': return pad(d.getUTCMinutes())
      case 'S': return pad(d.getUTCSeconds())
      case 'q': return String(Math.floor(d.getUTCMonth() / 3) + 1)
      case '%': return '%'
      default: return `%${dir}`
    }
  })
}

// ---------------------------------------------------------------------------
// Calendar helpers used by the axis tick generator
// ---------------------------------------------------------------------------

/** Start of the UTC day containing `epoch`. */
export function startOfDay(epoch: number): number {
  const d = new Date(epoch)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Start of the ISO week (Monday) containing `epoch`. */
export function startOfWeek(epoch: number): number {
  const day = startOfDay(epoch)
  const dow = new Date(day).getUTCDay() // 0 = Sunday
  const shift = (dow + 6) % 7           // Monday → 0
  return day - shift * DAY_MS
}

/** Start of the month containing `epoch`. */
export function startOfMonth(epoch: number): number {
  const d = new Date(epoch)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** Start of the calendar quarter containing `epoch`. */
export function startOfQuarter(epoch: number): number {
  const d = new Date(epoch)
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)
}

/** Start of the year containing `epoch`. */
export function startOfYear(epoch: number): number {
  return Date.UTC(new Date(epoch).getUTCFullYear(), 0, 1)
}
