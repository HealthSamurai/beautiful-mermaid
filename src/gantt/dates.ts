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
 * Widest timestamp a gantt chart will represent: the end of year 9999.
 *
 * `new Date()` reaches further, but a saturated epoch is useless on a chart —
 * the axis tick formatter produces "+275760-09" and the tick generator yields
 * NaN. Clamping to a four-digit year keeps every label printable, so a diagram
 * containing `999999999d` draws one very long bar with a readable axis instead
 * of crashing or rendering NaN.
 */
const MAX_EPOCH = Date.UTC(9999, 11, 31)

/** Narrowest timestamp, mirroring MAX_EPOCH at the start of year 0. */
const MIN_EPOCH = Date.UTC(0, 0, 1)

/** Clamp a timestamp into the range a gantt axis can label. */
function clampEpoch(epoch: number): number {
  if (Number.isNaN(epoch)) return 0
  return Math.min(MAX_EPOCH, Math.max(MIN_EPOCH, epoch))
}

/**
 * Add a duration to an epoch timestamp.
 * Months and years advance the calendar field (so `1mo` from Jan 31 lands in
 * February), everything smaller is plain millisecond arithmetic.
 *
 * The result is clamped to the representable Date range, so an absurd amount
 * yields a saturated timestamp rather than an Invalid Date downstream.
 */
export function addDuration(from: number, duration: GanttDuration): number {
  const { amount, unit } = duration
  switch (unit) {
    case 'ms': return clampEpoch(from + amount)
    case 's': return clampEpoch(from + amount * 1000)
    case 'm': return clampEpoch(from + amount * 60_000)
    case 'h': return clampEpoch(from + amount * 3_600_000)
    case 'd': return clampEpoch(from + amount * DAY_MS)
    case 'w': return clampEpoch(from + amount * 7 * DAY_MS)
    case 'mo': return shiftMonths(from, amount)
    case 'y': return shiftMonths(from, amount * 12)
  }
}

/** Advance by whole calendar months, clamping the day to the target month. */
function shiftMonths(from: number, months: number): number {
  const d = new Date(from)
  const day = d.getUTCDate()
  // Month arithmetic on a saturated Date throws, so an out-of-range shift is
  // detected on the epoch value before the calendar is touched.
  const whole = Math.round(months)
  const approx = from + whole * 30.44 * DAY_MS
  if (!Number.isFinite(approx) || approx >= MAX_EPOCH || approx <= MIN_EPOCH) return clampEpoch(approx)

  const target = new Date(from)
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + whole)
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, daysInTarget))
  return clampEpoch(target.getTime())
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

// ---------------------------------------------------------------------------
// Excluded days — the `excludes` / `includes` / `weekend` calendar
//
// Mermaid lets a diagram declare non-working days, and then stretches any task
// that is not given an explicit end date so that its DURATION counts only
// working days:
//
//   excludes weekends
//   excludes 2024-01-01, monday
//   includes 2024-01-06          — wins over the excludes above
//   weekend friday               — weekend is Fri+Sat instead of Sat+Sun
//
// A task with an explicit end date keeps it: the author stated a deadline, and
// silently moving it would be worse than showing it spanning a holiday.
// ---------------------------------------------------------------------------

/** Day on which the weekend starts, as declared by `weekend`. */
export type WeekendStart = 'friday' | 'saturday'

/** The non-working-day calendar a gantt diagram declares. */
export interface ExcludeCalendar {
  /** Raw `excludes` tokens: `weekends`, a weekday name, or a date */
  excludes: string[]
  /** Raw `includes` tokens — dates that override an exclusion */
  includes: string[]
  /** Which two days `weekends` means */
  weekend: WeekendStart
  /** `dateFormat`, so a date token is matched the way the author wrote it */
  dateFormat: string
}

/** Weekday names indexed by `Date#getUTCDay()` (0 = Sunday). */
const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
] as const

/** Upper bound on the search for a valid end date, matching Mermaid. */
const MAX_EXCLUDE_ITERATIONS = 10_000

/**
 * Whether a day is excluded from the working calendar.
 *
 * `includes` is checked first, so a single working holiday can be carved out
 * of a blanket `excludes weekends`.
 */
export function isExcludedDay(epoch: number, calendar: ExcludeCalendar): boolean {
  const { excludes, includes, weekend, dateFormat } = calendar
  if (excludes.length === 0) return false

  const iso = formatIsoDate(epoch)
  const asWritten = formatWithDateFormat(epoch, dateFormat)

  // An explicit include overrides any exclusion
  if (includes.includes(iso) || includes.includes(asWritten)) return false

  const dayName = WEEKDAY_NAMES[new Date(epoch).getUTCDay()]!

  if (excludes.includes('weekends')) {
    const weekendDays = weekend === 'friday'
      ? ['friday', 'saturday']
      : ['saturday', 'sunday']
    if (weekendDays.includes(dayName)) return true
  }

  if (excludes.includes(dayName)) return true

  return excludes.includes(iso) || excludes.includes(asWritten)
}

/**
 * Push a task's end date out past any excluded days it covers.
 *
 * Walks the span one day at a time and adds a day to the end for each excluded
 * day found, so the task keeps its intended number of working days. This is
 * Mermaid's own algorithm, iteration cap included — a calendar that excludes
 * every day would otherwise loop forever.
 *
 * @returns the adjusted end, or the original when nothing is excluded
 */
export function applyExcludes(start: number, end: number, calendar: ExcludeCalendar): number {
  if (calendar.excludes.length === 0) return end

  let adjustedEnd = end
  let cursor = startOfDay(start) + DAY_MS
  let iterations = 0

  while (cursor <= adjustedEnd) {
    if (isExcludedDay(cursor, calendar)) {
      adjustedEnd += DAY_MS
      if (++iterations > MAX_EXCLUDE_ITERATIONS) return end
    }
    cursor += DAY_MS
  }

  return adjustedEnd
}

/** Format as `YYYY-MM-DD`, the form both excludes and includes always accept. */
function formatIsoDate(epoch: number): string {
  const d = new Date(epoch)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Render a timestamp back through a `dateFormat` pattern.
 *
 * Needed because `excludes 01/02/2024` under `dateFormat DD/MM/YYYY` must
 * match the same day the author meant.
 */
function formatWithDateFormat(epoch: number, pattern: string): string {
  const d = new Date(epoch)
  const pad = (n: number) => String(n).padStart(2, '0')

  return pattern.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g, token => {
    switch (token) {
      case 'YYYY': return String(d.getUTCFullYear())
      case 'YY': return pad(d.getUTCFullYear() % 100)
      case 'MM': return pad(d.getUTCMonth() + 1)
      case 'M': return String(d.getUTCMonth() + 1)
      case 'DD': return pad(d.getUTCDate())
      case 'D': return String(d.getUTCDate())
      case 'HH': return pad(d.getUTCHours())
      case 'H': return String(d.getUTCHours())
      case 'mm': return pad(d.getUTCMinutes())
      case 'ss': return pad(d.getUTCSeconds())
      default: return token
    }
  })
}

// ---------------------------------------------------------------------------
// Tick intervals
// ---------------------------------------------------------------------------

/** A parsed `tickInterval` declaration, e.g. `2week`. */
export interface TickInterval {
  every: number
  unit: 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month'
}

const TICK_INTERVAL_RE = /^([1-9]\d*)\s*(millisecond|second|minute|hour|day|week|month)s?$/i

/**
 * Parse a `tickInterval` declaration such as `1day`, `2week`, `3month`.
 *
 * @returns the parsed interval, or `null` when the token is not one — an
 *   invalid value falls back to the automatic axis rather than failing
 */
export function parseTickInterval(value: string): TickInterval | null {
  const m = value.trim().match(TICK_INTERVAL_RE)
  if (!m) return null
  return { every: Number(m[1]), unit: m[2]!.toLowerCase() as TickInterval['unit'] }
}

/** Advance one tick step from `epoch`. */
export function advanceTick(epoch: number, interval: TickInterval): number {
  const { every, unit } = interval
  switch (unit) {
    case 'millisecond': return epoch + every
    case 'second': return epoch + every * 1000
    case 'minute': return epoch + every * 60_000
    case 'hour': return epoch + every * 3_600_000
    case 'day': return epoch + every * DAY_MS
    case 'week': return epoch + every * 7 * DAY_MS
    case 'month': return shiftMonths(epoch, every)
  }
}

/**
 * Snap a timestamp back to the natural boundary of a tick unit, so ticks land
 * on round values (the 1st of a month, a Monday) rather than on the first
 * task's arbitrary start time.
 */
export function floorToTickUnit(epoch: number, interval: TickInterval, weekStart: number = 1): number {
  switch (interval.unit) {
    case 'month': return startOfMonth(epoch)
    case 'week': return startOfWeekOn(epoch, weekStart)
    case 'day': return startOfDay(epoch)
    case 'hour': {
      const d = new Date(epoch)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())
    }
    default: return epoch
  }
}

/**
 * Start of the week containing `epoch`, for a configurable first day.
 *
 * `weekday monday` through `weekday sunday` chooses which day a week starts
 * on, which moves where the weekly gridlines fall.
 */
export function startOfWeekOn(epoch: number, weekStart: number): number {
  const day = startOfDay(epoch)
  const dow = new Date(day).getUTCDay()
  const shift = (dow - weekStart + 7) % 7
  return day - shift * DAY_MS
}

/** Day index (0 = Sunday) for a `weekday` declaration. */
export function weekdayIndex(name: string): number | null {
  const idx = WEEKDAY_NAMES.indexOf(name.trim().toLowerCase() as typeof WEEKDAY_NAMES[number])
  return idx === -1 ? null : idx
}
