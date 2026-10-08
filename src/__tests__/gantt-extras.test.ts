import { describe, expect, it } from 'bun:test'
import { parseGanttDiagram, parseTaskMeta } from '../gantt/parser.ts'
import { layoutGantt } from '../gantt/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import {
  DAY_MS, applyExcludes, isExcludedDay, parseTickInterval, weekdayIndex,
} from '../gantt/dates.ts'

// ============================================================================
// Gantt — excludes, until, progress, markers and display modes
//
// Covers the directives beyond the core subset, ported from the upstream
// ganttDb.spec.ts cases for excludes/includes/weekend/until plus the
// renderer's todayMarker and displayMode handling.
// ============================================================================

function parse(text: string) {
  return parseGanttDiagram(
    text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  )
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`)
const toIso = (epoch: number) => new Date(epoch).toISOString().slice(0, 10)

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

describe('gantt dates — excluded days', () => {
  const weekends = {
    excludes: ['weekends'], includes: [], weekend: 'saturday' as const, dateFormat: 'YYYY-MM-DD',
  }

  it('treats Saturday as excluded by default', () => {
    // 2024-01-06 is a Saturday
    expect(isExcludedDay(day('2024-01-06'), weekends)).toBe(true)
  })

  it('treats Sunday as excluded by default', () => {
    expect(isExcludedDay(day('2024-01-07'), weekends)).toBe(true)
  })

  it('does not exclude a Monday', () => {
    expect(isExcludedDay(day('2024-01-08'), weekends)).toBe(false)
  })

  it('shifts the weekend when weekend friday is declared', () => {
    const friday = { ...weekends, weekend: 'friday' as const }
    expect(isExcludedDay(day('2024-01-05'), friday)).toBe(true)  // Friday
    expect(isExcludedDay(day('2024-01-06'), friday)).toBe(true)  // Saturday
    expect(isExcludedDay(day('2024-01-07'), friday)).toBe(false) // Sunday
  })

  it('excludes a named weekday', () => {
    const calendar = { ...weekends, excludes: ['monday'] }
    expect(isExcludedDay(day('2024-01-08'), calendar)).toBe(true)
    expect(isExcludedDay(day('2024-01-09'), calendar)).toBe(false)
  })

  it('excludes a specific date', () => {
    const calendar = { ...weekends, excludes: ['2024-01-09'] }
    expect(isExcludedDay(day('2024-01-09'), calendar)).toBe(true)
  })

  it('lets includes override an exclusion', () => {
    const calendar = { ...weekends, includes: ['2024-01-06'] }
    expect(isExcludedDay(day('2024-01-06'), calendar)).toBe(false)
  })

  it('excludes nothing when excludes is empty', () => {
    const calendar = { ...weekends, excludes: [] }
    expect(isExcludedDay(day('2024-01-06'), calendar)).toBe(false)
  })

  it('matches a date written in the diagram dateFormat', () => {
    const calendar = {
      excludes: ['09/01/2024'], includes: [], weekend: 'saturday' as const, dateFormat: 'DD/MM/YYYY',
    }
    expect(isExcludedDay(day('2024-01-09'), calendar)).toBe(true)
  })

  it('pushes an end date past excluded days', () => {
    // Mon 2024-01-01 + 5 days spans one weekend, so the end moves out by two
    const end = applyExcludes(day('2024-01-01'), day('2024-01-06'), weekends)
    expect(toIso(end)).toBe('2024-01-08')
  })

  it('leaves an end alone when nothing in the span is excluded', () => {
    const end = applyExcludes(day('2024-01-01'), day('2024-01-04'), weekends)
    expect(toIso(end)).toBe('2024-01-04')
  })

  it('is a no-op with an empty calendar', () => {
    const calendar = { ...weekends, excludes: [] }
    expect(applyExcludes(day('2024-01-01'), day('2024-01-30'), calendar)).toBe(day('2024-01-30'))
  })

  it('gives up rather than looping when every day is excluded', () => {
    const everyDay = {
      excludes: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      includes: [], weekend: 'saturday' as const, dateFormat: 'YYYY-MM-DD',
    }
    const end = applyExcludes(day('2024-01-01'), day('2024-01-10'), everyDay)
    expect(end).toBe(day('2024-01-10'))
  })
})

describe('gantt dates — tick intervals', () => {
  it('parses a day interval', () => {
    expect(parseTickInterval('1day')).toEqual({ every: 1, unit: 'day' })
  })

  it('parses a multi-week interval', () => {
    expect(parseTickInterval('2week')).toEqual({ every: 2, unit: 'week' })
  })

  it('parses a month interval', () => {
    expect(parseTickInterval('3month')).toEqual({ every: 3, unit: 'month' })
  })

  it('accepts a plural unit', () => {
    expect(parseTickInterval('2weeks')).toEqual({ every: 2, unit: 'week' })
  })

  it('rejects a zero count', () => {
    expect(parseTickInterval('0day')).toBeNull()
  })

  it('rejects an unknown unit', () => {
    expect(parseTickInterval('1fortnight')).toBeNull()
  })

  it('rejects junk', () => {
    expect(parseTickInterval('nonsense')).toBeNull()
  })

  it('maps weekday names onto day indices', () => {
    expect(weekdayIndex('sunday')).toBe(0)
    expect(weekdayIndex('monday')).toBe(1)
    expect(weekdayIndex('saturday')).toBe(6)
  })

  it('rejects an unknown weekday name', () => {
    expect(weekdayIndex('someday')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('gantt parser — directives', () => {
  it('reads excludes weekends', () => {
    expect(parse('gantt\nexcludes weekends').excludes).toEqual(['weekends'])
  })

  it('reads a comma-separated excludes list', () => {
    const diagram = parse('gantt\nexcludes weekends, 2024-01-01, monday')
    expect(diagram.excludes).toEqual(['weekends', '2024-01-01', 'monday'])
  })

  it('reads a space-separated excludes list', () => {
    expect(parse('gantt\nexcludes weekends 2024-01-01').excludes)
      .toEqual(['weekends', '2024-01-01'])
  })

  it('reads includes', () => {
    expect(parse('gantt\nincludes 2024-01-06').includes).toEqual(['2024-01-06'])
  })

  it('reads weekend friday', () => {
    expect(parse('gantt\nweekend friday').weekend).toBe('friday')
  })

  it('defaults the weekend to saturday', () => {
    expect(parse('gantt\ntitle T').weekend).toBe('saturday')
  })

  it('reads weekday monday', () => {
    expect(parse('gantt\nweekday monday').weekStart).toBe(1)
  })

  it('reads weekday sunday', () => {
    expect(parse('gantt\nweekday sunday').weekStart).toBe(0)
  })

  it('defaults the week to starting on Monday', () => {
    expect(parse('gantt\ntitle T').weekStart).toBe(1)
  })

  it('reads tickInterval', () => {
    expect(parse('gantt\ntickInterval 1week').tickInterval).toBe('1week')
  })

  it('reads todayMarker off', () => {
    expect(parse('gantt\ntodayMarker off').todayMarker).toBe('off')
  })

  it('reads a todayMarker style', () => {
    expect(parse('gantt\ntodayMarker stroke:red,stroke-width:3px').todayMarker)
      .toBe('stroke:red,stroke-width:3px')
  })

  it('reads displayMode compact', () => {
    expect(parse('gantt\ndisplayMode compact').compact).toBe(true)
  })

  it('defaults displayMode to normal', () => {
    expect(parse('gantt\ntitle T').compact).toBe(false)
  })

  it('reads inclusiveEndDates', () => {
    expect(parse('gantt\ninclusiveEndDates').inclusiveEndDates).toBe(true)
  })

  it('reads topAxis', () => {
    expect(parse('gantt\ntopAxis').topAxis).toBe(true)
  })

  it('does not mistake topAxis for a task', () => {
    expect(parse('gantt\ntopAxis\nsection S\nT :2024-01-01, 1d').tasks).toHaveLength(1)
  })
})

describe('gantt parser — until', () => {
  it('classifies an until statement', () => {
    expect(parseTaskMeta('after a, until b').until).toEqual(['b'])
  })

  it('classifies several until ids', () => {
    expect(parseTaskMeta('until b c').until).toEqual(['b', 'c'])
  })

  it('ends a task when the referenced task starts', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      First  :a, 2024-01-01, 10d
      Later  :b, 2024-03-01, 5d
      Filler :c, after a, until b`)
    const filler = diagram.tasks.find(t => t.id === 'c')!
    expect(toIso(filler.start)).toBe('2024-01-11')
    expect(toIso(filler.end)).toBe('2024-03-01')
  })

  it('takes the earliest start among several until targets', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :a, 2024-01-01, 1d
      B :b, 2024-05-01, 1d
      C :c, 2024-03-01, 1d
      D :d, after a, until b c`)
    expect(toIso(diagram.tasks.find(t => t.id === 'd')!.end)).toBe('2024-03-01')
  })

  it('records the until ids on the task', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :a, 2024-01-01, 1d
      B :b, after a, until a`)
    expect(diagram.tasks.find(t => t.id === 'b')!.until).toEqual(['a'])
  })

  it('falls back to a duration when the until id is unknown', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :a, 2024-01-01, until nope`)
    expect(diagram.tasks[0]!.end).toBeGreaterThan(diagram.tasks[0]!.start)
  })
})

describe('gantt parser — progress', () => {
  it('classifies a progress token', () => {
    expect(parseTaskMeta('2024-01-01, 30d, 60%').progress).toBe(0.6)
  })

  it('records progress on the task', () => {
    const diagram = parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2024-01-01, 30d, 25%')
    expect(diagram.tasks[0]!.progress).toBe(0.25)
  })

  it('leaves progress undefined when not given', () => {
    const diagram = parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2024-01-01, 30d')
    expect(diagram.tasks[0]!.progress).toBeUndefined()
  })

  it('clamps progress above 100%', () => {
    expect(parseTaskMeta('2024-01-01, 30d, 150%').progress).toBe(1)
  })

  it('accepts a fractional percentage', () => {
    expect(parseTaskMeta('2024-01-01, 30d, 12.5%').progress).toBe(0.125)
  })

  it('does not treat a progress token as the task id', () => {
    expect(parseTaskMeta('2024-01-01, 30d, 60%').id).toBeUndefined()
  })
})

describe('gantt parser — vert tasks', () => {
  it('marks a vert task', () => {
    const diagram = parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nCutover :vert, 2024-03-01')
    expect(diagram.tasks[0]!.vertical).toBe(true)
  })

  it('gives a vert task zero duration', () => {
    const diagram = parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nCutover :vert, 2024-03-01')
    expect(diagram.tasks[0]!.start).toBe(diagram.tasks[0]!.end)
  })

  it('does not treat a vert task as a milestone', () => {
    const diagram = parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nCutover :vert, 2024-03-01')
    expect(diagram.tasks[0]!.milestone).toBe(false)
  })
})

describe('gantt parser — excludes applied to schedules', () => {
  it('stretches a duration past a weekend', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends
      section S
      Work :2024-01-01, 5d`)
    // Mon + 5 working days crosses Sat/Sun, so the end is pushed out two days
    expect(toIso(diagram.tasks[0]!.end)).toBe('2024-01-08')
  })

  it('leaves an explicit end date alone', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends
      section S
      Work :2024-01-01, 2024-01-06`)
    expect(toIso(diagram.tasks[0]!.end)).toBe('2024-01-06')
  })

  it('does not stretch anything without excludes', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      Work :2024-01-01, 5d`)
    expect(toIso(diagram.tasks[0]!.end)).toBe('2024-01-06')
  })

  it('honours includes while stretching', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends
      includes 2024-01-06
      section S
      Work :2024-01-01, 5d`)
    // Saturday is worked, so the 5-day span ends on it and Sunday is never
    // reached — the task keeps its nominal end instead of being pushed out
    expect(toIso(diagram.tasks[0]!.end)).toBe('2024-01-06')
  })

  it('extends an explicit end by a day with inclusiveEndDates', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      inclusiveEndDates
      section S
      Work :2024-01-01, 2024-01-05`)
    expect(toIso(diagram.tasks[0]!.end)).toBe('2024-01-06')
  })
})

describe('gantt parser — compact rows', () => {
  it('gives each task its own row by default', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 5d
      B :2024-02-01, 5d`)
    expect(diagram.tasks.map(t => t.row)).toEqual([0, 1])
  })

  it('shares a row between non-overlapping tasks in compact mode', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      displayMode compact
      section S
      A :2024-01-01, 5d
      B :2024-02-01, 5d`)
    expect(diagram.tasks.map(t => t.row)).toEqual([0, 0])
  })

  it('keeps overlapping tasks on separate rows in compact mode', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      displayMode compact
      section S
      A :2024-01-01, 30d
      B :2024-01-05, 30d`)
    expect(diagram.tasks.map(t => t.row)).toEqual([0, 1])
  })

  it('does not share rows across sections', () => {
    const diagram = parse(`gantt
      dateFormat YYYY-MM-DD
      displayMode compact
      section One
      A :2024-01-01, 5d
      section Two
      B :2024-02-01, 5d`)
    expect(diagram.tasks.map(t => t.row)).toEqual([0, 1])
  })
})

// ---------------------------------------------------------------------------
// Layout and rendering
// ---------------------------------------------------------------------------

describe('gantt layout — extras', () => {
  it('shortens the chart in compact mode', () => {
    const source = `gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 5d
      B :2024-02-01, 5d
      C :2024-03-01, 5d`
    const normal = layoutGantt(parse(source))
    const compact = layoutGantt(parse(source.replace('gantt', 'gantt\n displayMode compact')))
    expect(compact.height).toBeLessThan(normal.height)
  })

  it('computes a progress overlay narrower than its bar', () => {
    const chart = layoutGantt(parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2024-01-01, 30d, 50%'))
    const bar = chart.bars[0]!
    expect(bar.progressWidth).toBeGreaterThan(0)
    expect(bar.progressWidth).toBeLessThan(bar.width)
  })

  it('gives no progress overlay without a progress token', () => {
    const chart = layoutGantt(parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2024-01-01, 30d'))
    expect(chart.bars[0]!.progressWidth).toBe(0)
  })

  it('positions a vert marker across the whole plot', () => {
    const chart = layoutGantt(parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 60d
      Cutover :vert, 2024-02-01`))
    expect(chart.verticals).toHaveLength(1)
    const v = chart.verticals[0]!
    expect(v.y1).toBe(chart.plotArea.y)
    expect(v.y2).toBe(chart.plotArea.y + chart.plotArea.height)
  })

  it('does not draw a vert task as a bar', () => {
    const chart = layoutGantt(parse(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 60d
      Cutover :vert, 2024-02-01`))
    expect(chart.bars).toHaveLength(1)
  })

  it('omits the today marker for a chart that is entirely in the past', () => {
    const chart = layoutGantt(parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2001-01-01, 30d'))
    expect(chart.todayMarker).toBeUndefined()
  })

  it('places a today marker on a chart spanning today', () => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10)
    const chart = layoutGantt(parse(`gantt\ndateFormat YYYY-MM-DD\nsection S\nT :${start}, 60d`))
    expect(chart.todayMarker).toBeDefined()
    expect(chart.todayMarker!.x).toBeGreaterThan(chart.plotArea.x)
  })

  it('suppresses the today marker with todayMarker off', () => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10)
    const chart = layoutGantt(parse(
      `gantt\ndateFormat YYYY-MM-DD\ntodayMarker off\nsection S\nT :${start}, 60d`
    ))
    expect(chart.todayMarker).toBeUndefined()
  })

  it('turns a todayMarker declaration into an inline style', () => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10)
    const chart = layoutGantt(parse(
      `gantt\ndateFormat YYYY-MM-DD\ntodayMarker stroke:red,stroke-width:3px\nsection S\nT :${start}, 60d`
    ))
    expect(chart.todayMarker!.style).toBe('stroke:red;stroke-width:3px')
  })

  it('rejects a todayMarker style that could escape the attribute', () => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10)
    const chart = layoutGantt(parse(
      `gantt\ndateFormat YYYY-MM-DD\ntodayMarker stroke:"><script>\nsection S\nT :${start}, 60d`
    ))
    expect(chart.todayMarker!.style).toBeUndefined()
  })

  it('honours an explicit tickInterval', () => {
    const chart = layoutGantt(parse(`gantt
      dateFormat YYYY-MM-DD
      tickInterval 1month
      axisFormat %b
      section S
      T :2024-01-01, 180d`))
    // Six months in the span, so six or seven monthly ticks
    expect(chart.axis.ticks.length).toBeGreaterThanOrEqual(6)
    expect(chart.axis.ticks[0]!.time).toBe(chart.axis.ticks[0]!.time)
  })

  it('snaps tickInterval ticks to month boundaries', () => {
    const chart = layoutGantt(parse(`gantt
      dateFormat YYYY-MM-DD
      tickInterval 1month
      section S
      T :2024-01-15, 120d`))
    for (const tick of chart.axis.ticks) {
      expect(new Date(tick.time).getUTCDate()).toBe(1)
    }
  })

  it('falls back to the automatic axis for an invalid tickInterval', () => {
    const chart = layoutGantt(parse(`gantt
      dateFormat YYYY-MM-DD
      tickInterval nonsense
      section S
      T :2024-01-01, 180d`))
    expect(chart.axis.ticks.length).toBeGreaterThan(0)
  })

  it('adds a second axis with topAxis', () => {
    const chart = layoutGantt(parse('gantt\ndateFormat YYYY-MM-DD\ntopAxis\nsection S\nT :2024-01-01, 30d'))
    expect(chart.bottomAxis).toBeDefined()
    expect(chart.bottomAxis!.ticks).toHaveLength(chart.axis.ticks.length)
  })

  it('has no second axis without topAxis', () => {
    const chart = layoutGantt(parse('gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2024-01-01, 30d'))
    expect(chart.bottomAxis).toBeUndefined()
  })

  it('grows the canvas to fit the second axis', () => {
    const source = 'gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2024-01-01, 30d'
    const plain = layoutGantt(parse(source))
    const withAxis = layoutGantt(parse(source.replace('gantt', 'gantt\ntopAxis')))
    expect(withAxis.height).toBeGreaterThan(plain.height)
  })
})

describe('gantt integration — extras in SVG', () => {
  it('renders a progress overlay', () => {
    const svg = renderMermaidSVG('gantt\ndateFormat YYYY-MM-DD\nsection S\nT :2024-01-01, 30d, 60%')
    expect(svg).toContain('gantt-progress')
    expect(svg).toContain('data-progress="60"')
  })

  it('renders a vert marker', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 60d
      Cutover :vert, 2024-02-01`)
    expect(svg).toContain('gantt-vert')
    expect(svg).toContain('Cutover')
  })

  it('renders a today marker when the chart spans today', () => {
    const start = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10)
    const svg = renderMermaidSVG(`gantt\ndateFormat YYYY-MM-DD\nsection S\nT :${start}, 60d`)
    expect(svg).toContain('class="gantt-today"')
  })

  it('omits the today marker when switched off', () => {
    const start = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10)
    const svg = renderMermaidSVG(
      `gantt\ndateFormat YYYY-MM-DD\ntodayMarker off\nsection S\nT :${start}, 60d`
    )
    // The CSS rule is always emitted; what must be absent is the line itself
    expect(svg).not.toContain('class="gantt-today"')
  })

  it('renders both axes with topAxis', () => {
    const svg = renderMermaidSVG('gantt\ndateFormat YYYY-MM-DD\ntopAxis\nsection S\nT :2024-01-01, 30d')
    expect(svg.match(/class="gantt-axis-line"/g)).toHaveLength(2)
  })

  it('renders a compact chart as valid SVG', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      displayMode compact
      section S
      A :2024-01-01, 5d
      B :2024-02-01, 5d`)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('renders an excludes chart as valid SVG', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends
      weekend friday
      section S
      Work :2024-01-01, 10d`)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })

  it('does not leak directive text into the SVG', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      excludes weekends
      tickInterval 1week
      displayMode compact
      section S
      Work :2024-01-01, 10d`)
    expect(svg).not.toContain('excludes')
    expect(svg).not.toContain('tickInterval')
    expect(svg).not.toContain('displayMode')
  })

  it('renders a vert label that is not drawn as a bar label', () => {
    const svg = renderMermaidSVG(`gantt
      dateFormat YYYY-MM-DD
      section S
      A :2024-01-01, 60d
      Cutover :vert, 2024-02-01`)
    expect(svg).toContain('gantt-vert-label')
    expect(svg.match(/class="gantt-bar/g)).toHaveLength(1)
  })

  it('still renders the original career example', () => {
    const svg = renderMermaidSVG(`gantt
    title Карьера
    dateFormat YYYY-MM-DD
    section Работа
    META Group :done, 2011-05-01, 2019-12-31
    Air Liquide :active, 2023-09-01, 2026-10-07`)
    expect(svg).toStartWith('<svg')
    expect(svg).toEndWith('</svg>')
  })
})
