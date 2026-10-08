/**
 * Tests for the gantt parser and its date/duration arithmetic.
 *
 * Covers: directives (title, dateFormat, axisFormat), sections, task metadata
 * classification (tags, ids, dates, durations, `after` dependencies), schedule
 * resolution, milestones, and the dateFormat / axisFormat helpers.
 */
import { describe, it, expect } from 'bun:test'
import { parseGanttDiagram, parseTaskMeta } from '../gantt/parser.ts'
import {
  DAY_MS, addDuration, formatGanttDate, isDateLike, isDurationLike,
  parseDuration, parseGanttDate, startOfMonth, startOfQuarter, startOfWeek, startOfYear,
} from '../gantt/dates.ts'

/** Helper to parse — preprocesses text the same way index.ts does */
function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseGanttDiagram(lines)
}

/** Readable ISO day for assertions */
function day(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10)
}

// ============================================================================
// Directives
// ============================================================================

describe('parseGanttDiagram – directives', () => {
  it('parses title, dateFormat and axisFormat', () => {
    const d = parse(`gantt
      title My Roadmap
      dateFormat YYYY-MM-DD
      axisFormat %b %Y
      section S
      A :2024-01-01, 10d`)
    expect(d.title).toBe('My Roadmap')
    expect(d.dateFormat).toBe('YYYY-MM-DD')
    expect(d.axisFormat).toBe('%b %Y')
  })

  it('defaults dateFormat to YYYY-MM-DD and leaves axisFormat unset', () => {
    const d = parse(`gantt
      section S
      A :2024-01-01, 10d`)
    expect(d.dateFormat).toBe('YYYY-MM-DD')
    expect(d.axisFormat).toBeUndefined()
  })

  it('strips surrounding quotes from the title', () => {
    const d = parse(`gantt
      title "Quoted title"
      section S
      A :2024-01-01, 1d`)
    expect(d.title).toBe('Quoted title')
  })

  it('accepts and ignores excludes / todayMarker / tickInterval', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends
      todayMarker off
      tickInterval 1week
      section S
      A :2024-01-01, 10d`)
    expect(d.tasks).toHaveLength(1)
    expect(d.tasks[0]!.label).toBe('A')
  })

  it('ignores a %% comment at the end of a line', () => {
    const d = parse(`gantt
      title Plan %% the heading
      section S
      A :2024-01-01, 10d %% first task`)
    expect(d.title).toBe('Plan')
    expect(d.tasks[0]!.label).toBe('A')
  })
})

// ============================================================================
// Sections
// ============================================================================

describe('parseGanttDiagram – sections', () => {
  it('groups tasks into their sections in source order', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section Design
      A :2024-01-01, 10d
      B :2024-01-11, 10d
      section Build
      C :2024-02-01, 10d`)
    expect(d.sections).toHaveLength(2)
    expect(d.sections[0]!.title).toBe('Design')
    expect(d.sections[0]!.tasks.map(t => t.label)).toEqual(['A', 'B'])
    expect(d.sections[1]!.title).toBe('Build')
    expect(d.sections[1]!.tasks.map(t => t.label)).toEqual(['C'])
  })

  it('puts tasks declared before any section into an unnamed section', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      Loose :2024-01-01, 5d
      section Named
      Inside :2024-02-01, 5d`)
    expect(d.sections[0]!.title).toBe('')
    expect(d.sections[0]!.tasks[0]!.label).toBe('Loose')
    expect(d.sections[1]!.title).toBe('Named')
  })

  it('records the owning section title on each task', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section Phase one
      A :2024-01-01, 5d`)
    expect(d.tasks[0]!.section).toBe('Phase one')
  })
})

// ============================================================================
// Task metadata classification
// ============================================================================

describe('parseTaskMeta – metadata classification', () => {
  it('classifies tag, id, start and end date', () => {
    const m = parseTaskMeta('done, des1, 2024-01-01, 2024-02-15')
    expect(m.tags).toEqual(['done'])
    expect(m.id).toBe('des1')
    expect(day(m.startDate!)).toBe('2024-01-01')
    expect(day(m.endDate!)).toBe('2024-02-15')
  })

  it('classifies a dependency and a duration', () => {
    const m = parseTaskMeta('active, dev1, after des1, 30d')
    expect(m.tags).toEqual(['active'])
    expect(m.id).toBe('dev1')
    expect(m.after).toEqual(['des1'])
    expect(m.duration).toBe('30d')
  })

  it('accepts several dependencies in one after clause', () => {
    const m = parseTaskMeta('after a b c, 5d')
    expect(m.after).toEqual(['a', 'b', 'c'])
  })

  it('handles metadata with no tag and no id', () => {
    const m = parseTaskMeta('2024-01-01, 10d')
    expect(m.tags).toEqual([])
    expect(m.id).toBeUndefined()
    expect(day(m.startDate!)).toBe('2024-01-01')
    expect(m.duration).toBe('10d')
  })

  it('collects several tags', () => {
    const m = parseTaskMeta('crit, active, x1, 2024-01-01, 3d')
    expect(m.tags).toEqual(['crit', 'active'])
    expect(m.id).toBe('x1')
  })
})

// ============================================================================
// Schedule resolution
// ============================================================================

describe('parseGanttDiagram – schedule resolution', () => {
  it('resolves an explicit start and end date', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :done, 2011-05-01, 2019-12-31`)
    const t = d.tasks[0]!
    expect(day(t.start)).toBe('2011-05-01')
    expect(day(t.end)).toBe('2019-12-31')
  })

  it('resolves a day duration', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 30d`)
    expect(day(d.tasks[0]!.end)).toBe('2024-01-31')
  })

  it('resolves a week duration', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 2w`)
    expect(day(d.tasks[0]!.end)).toBe('2024-01-15')
  })

  it('resolves a month duration on the calendar', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-15, 2mo`)
    expect(day(d.tasks[0]!.end)).toBe('2024-03-15')
  })

  it('starts an "after" task when its dependency ends', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      First  :a1, 2024-01-01, 10d
      Second :after a1, 5d`)
    expect(day(d.tasks[1]!.start)).toBe('2024-01-11')
    expect(day(d.tasks[1]!.end)).toBe('2024-01-16')
  })

  it('starts after the latest of several dependencies', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :a1, 2024-01-01, 10d
      B :b1, 2024-01-01, 40d
      C :after a1 b1, 5d`)
    expect(day(d.tasks[2]!.start)).toBe('2024-02-10')
  })

  it('chains a task with no start onto the previous task', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 10d
      B :5d`)
    expect(day(d.tasks[1]!.start)).toBe('2024-01-11')
    expect(day(d.tasks[1]!.end)).toBe('2024-01-16')
  })

  it('assigns generated ids when none are written', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 1d
      B :2024-01-02, 1d`)
    expect(d.tasks.map(t => t.id)).toEqual(['task1', 'task2'])
  })

  it('keeps explicit ids', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :done, alpha, 2024-01-01, 1d`)
    expect(d.tasks[0]!.id).toBe('alpha')
  })
})

// ============================================================================
// Status and milestones
// ============================================================================

describe('parseGanttDiagram – status and milestones', () => {
  it('maps tags to a dominant status, crit winning over active and done', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :done, 2024-01-01, 1d
      B :active, 2024-01-01, 1d
      C :crit, 2024-01-01, 1d
      D :crit, active, 2024-01-01, 1d
      E :2024-01-01, 1d`)
    expect(d.tasks.map(t => t.status)).toEqual(['done', 'active', 'crit', 'crit', 'default'])
  })

  it('marks milestones and collapses them to a single instant', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      Launch :milestone, m1, 2024-04-01, 0d`)
    const t = d.tasks[0]!
    expect(t.milestone).toBe(true)
    expect(t.start).toBe(t.end)
    expect(day(t.start)).toBe('2024-04-01')
  })

  it('parses a milestone without an explicit duration', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      GA :milestone, 2024-06-01`)
    expect(d.tasks[0]!.milestone).toBe(true)
    expect(day(d.tasks[0]!.start)).toBe('2024-06-01')
  })
})

// ============================================================================
// Alternative date formats
// ============================================================================

describe('parseGanttDiagram – date formats', () => {
  it('honours a DD/MM/YYYY dateFormat', () => {
    const d = parse(`gantt
      dateFormat DD/MM/YYYY
      section S
      A :01/03/2024, 10d`)
    expect(day(d.tasks[0]!.start)).toBe('2024-03-01')
  })

  it('honours a YYYY-MM dateFormat', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM
      section S
      A :2024-03, 1mo`)
    expect(day(d.tasks[0]!.start)).toBe('2024-03-01')
    expect(day(d.tasks[0]!.end)).toBe('2024-04-01')
  })
})

// ============================================================================
// Date helpers
// ============================================================================

describe('gantt dates – parsing', () => {
  it('parses an ISO date to a UTC epoch', () => {
    expect(day(parseGanttDate('2024-02-29', 'YYYY-MM-DD')!)).toBe('2024-02-29')
  })

  it('parses a two-digit year with the POSIX pivot', () => {
    expect(new Date(parseGanttDate('99-01-01', 'YY-MM-DD')!).getUTCFullYear()).toBe(1999)
    expect(new Date(parseGanttDate('24-01-01', 'YY-MM-DD')!).getUTCFullYear()).toBe(2024)
  })

  it('falls back to ISO when the value does not match the declared format', () => {
    expect(day(parseGanttDate('2024-05-06', 'DD/MM/YYYY')!)).toBe('2024-05-06')
  })

  it('rejects non-dates', () => {
    expect(parseGanttDate('not-a-date')).toBeNull()
    expect(parseGanttDate('2024-13-01')).toBeNull()
    expect(isDateLike('30d')).toBe(false)
    expect(isDateLike('2024-01-01')).toBe(true)
  })

  it('parses time components', () => {
    const t = parseGanttDate('2024-01-01 06:30:00', 'YYYY-MM-DD HH:mm:ss')!
    expect(new Date(t).getUTCHours()).toBe(6)
    expect(new Date(t).getUTCMinutes()).toBe(30)
  })
})

describe('gantt dates – durations', () => {
  it('parses every supported unit', () => {
    expect(parseDuration('30d')).toEqual({ amount: 30, unit: 'd' })
    expect(parseDuration('2w')).toEqual({ amount: 2, unit: 'w' })
    expect(parseDuration('6mo')).toEqual({ amount: 6, unit: 'mo' })
    expect(parseDuration('1y')).toEqual({ amount: 1, unit: 'y' })
    expect(parseDuration('12h')).toEqual({ amount: 12, unit: 'h' })
    expect(parseDuration('3M')).toEqual({ amount: 3, unit: 'mo' })
  })

  it('rejects non-durations', () => {
    expect(parseDuration('after x')).toBeNull()
    expect(parseDuration('2024-01-01')).toBeNull()
    expect(isDurationLike('0d')).toBe(true)
    expect(isDurationLike('abc')).toBe(false)
  })

  it('adds durations with calendar-aware months', () => {
    const jan31 = Date.UTC(2024, 0, 31)
    expect(day(addDuration(jan31, { amount: 1, unit: 'mo' }))).toBe('2024-02-29')
    expect(day(addDuration(jan31, { amount: 1, unit: 'd' }))).toBe('2024-02-01')
    expect(addDuration(jan31, { amount: 1, unit: 'w' })).toBe(jan31 + 7 * DAY_MS)
    expect(day(addDuration(jan31, { amount: 1, unit: 'y' }))).toBe('2025-01-31')
  })
})

describe('gantt dates – axis formatting', () => {
  const t = Date.UTC(2024, 2, 7, 14, 5, 9) // 2024-03-07 14:05:09 UTC

  it('formats the supported d3 directives', () => {
    expect(formatGanttDate(t, '%Y')).toBe('2024')
    expect(formatGanttDate(t, '%y')).toBe('24')
    expect(formatGanttDate(t, '%m')).toBe('03')
    expect(formatGanttDate(t, '%b')).toBe('Mar')
    expect(formatGanttDate(t, '%B')).toBe('March')
    expect(formatGanttDate(t, '%d')).toBe('07')
    expect(formatGanttDate(t, '%e')).toBe('7')
    expect(formatGanttDate(t, '%H:%M:%S')).toBe('14:05:09')
    expect(formatGanttDate(t, '%q')).toBe('1')
  })

  it('combines directives with literal text', () => {
    expect(formatGanttDate(t, '%b %Y')).toBe('Mar 2024')
    expect(formatGanttDate(t, 'Q%q %Y')).toBe('Q1 2024')
    expect(formatGanttDate(t, '100%%')).toBe('100%')
  })
})

describe('gantt dates – calendar boundaries', () => {
  it('finds the start of week, month, quarter and year', () => {
    const wed = Date.UTC(2024, 4, 15) // Wednesday 2024-05-15
    expect(day(startOfWeek(wed))).toBe('2024-05-13') // Monday
    expect(day(startOfMonth(wed))).toBe('2024-05-01')
    expect(day(startOfQuarter(wed))).toBe('2024-04-01')
    expect(day(startOfYear(wed))).toBe('2024-01-01')
  })
})

// ============================================================================
// Robustness
// ============================================================================

describe('parseGanttDiagram – robustness', () => {
  it('returns an empty diagram for a bare header', () => {
    const d = parse('gantt')
    expect(d.tasks).toHaveLength(0)
    expect(d.sections).toHaveLength(0)
  })

  it('ignores lines without a colon', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      this line has no metadata
      A :2024-01-01, 1d`)
    expect(d.tasks).toHaveLength(1)
  })

  it('swaps a reversed date range instead of producing a negative bar', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-06-01, 2024-01-01`)
    expect(day(d.tasks[0]!.start)).toBe('2024-01-01')
    expect(day(d.tasks[0]!.end)).toBe('2024-06-01')
  })

  it('tolerates an unknown dependency id by chaining onto the previous task', () => {
    const d = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 10d
      B :after nosuchtask, 5d`)
    expect(day(d.tasks[1]!.start)).toBe('2024-01-11')
  })
})
