// ============================================================================
// beautiful-mermaid — public API
//
// Renders Mermaid diagrams to styled SVG strings.
// Framework-agnostic, no DOM required. Pure TypeScript.
//
// Supported diagram types:
//   - Flowcharts (graph TD / flowchart LR)
//   - State diagrams (stateDiagram-v2)
//   - Sequence diagrams (sequenceDiagram)
//   - Class diagrams (classDiagram)
//   - ER diagrams (erDiagram)
//   - Gantt charts (gantt)
//   - Timelines (timeline)
//   - Pie charts (pie)
//   - User journeys (journey)
//   - Quadrant charts (quadrantChart)
//   - Mindmaps (mindmap)
//   - Sankey diagrams (sankey / sankey-beta)
//   - Git graphs (gitGraph)
//
// Theming uses CSS custom properties (--bg, --fg, + optional enrichment).
// See src/theme.ts for the full variable system.
//
// Usage:
//   import { renderMermaidSVG } from 'beautiful-mermaid'
//   const svg = renderMermaidSVG('graph TD\n  A --> B')
// ============================================================================

export type { RenderOptions, MermaidGraph, PositionedGraph } from './types.ts'
export type { DiagramColors, ThemeName } from './theme.ts'
export { fromShikiTheme, THEMES, DEFAULTS } from './theme.ts'
export { parseMermaid } from './parser.ts'
export { renderMermaidASCII, renderMermaidAscii } from './ascii/index.ts'
export type { AsciiRenderOptions } from './ascii/index.ts'

import { decodeXML } from 'entities'
import { parseMermaid } from './parser.ts'
import { layoutGraphSync } from './layout.ts'
import { renderSvg } from './renderer.ts'
import type { RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { DEFAULTS } from './theme.ts'

import { parseSequenceDiagram } from './sequence/parser.ts'
import { layoutSequenceDiagram } from './sequence/layout.ts'
import { renderSequenceSvg } from './sequence/renderer.ts'
import { parseClassDiagram } from './class/parser.ts'
import { layoutClassDiagramSync } from './class/layout.ts'
import { renderClassSvg } from './class/renderer.ts'
import { parseErDiagram } from './er/parser.ts'
import { layoutErDiagramSync } from './er/layout.ts'
import { renderErSvg } from './er/renderer.ts'
import { parseXYChart } from './xychart/parser.ts'
import { layoutXYChart } from './xychart/layout.ts'
import { renderXYChartSvg } from './xychart/renderer.ts'
import { parseGanttDiagram } from './gantt/parser.ts'
import { layoutGantt } from './gantt/layout.ts'
import { renderGanttSvg } from './gantt/renderer.ts'
import { parseTimelineDiagram } from './timeline/parser.ts'
import { layoutTimeline } from './timeline/layout.ts'
import { renderTimelineSvg } from './timeline/renderer.ts'
import { parsePieDiagram } from './pie/parser.ts'
import { layoutPie } from './pie/layout.ts'
import { renderPieSvg } from './pie/renderer.ts'
import { parseJourneyDiagram } from './journey/parser.ts'
import { layoutJourney } from './journey/layout.ts'
import { renderJourneySvg } from './journey/renderer.ts'
import { parseQuadrantDiagram } from './quadrant/parser.ts'
import { layoutQuadrant } from './quadrant/layout.ts'
import { renderQuadrantSvg } from './quadrant/renderer.ts'
import { parseMindmapDiagram } from './mindmap/parser.ts'
import { layoutMindmap } from './mindmap/layout.ts'
import { renderMindmapSvg } from './mindmap/renderer.ts'
import { parseSankeyDiagram } from './sankey/parser.ts'
import { layoutSankey } from './sankey/layout.ts'
import { renderSankeySvg } from './sankey/renderer.ts'
import { parseGitGraphDiagram } from './gitgraph/parser.ts'
import { layoutGitGraph } from './gitgraph/layout.ts'
import { renderGitGraphSvg } from './gitgraph/renderer.ts'
import { parseFrontmatter } from './frontmatter/parser.ts'
import type { FrontmatterColors, FrontmatterConfig } from './frontmatter/types.ts'
import { parseAccessibility, withAccessibility } from './a11y/parser.ts'

/**
 * Detect the diagram type from the mermaid source text.
 * Returns the type keyword used for routing to the correct pipeline.
 */
function detectDiagramType(text: string): 'flowchart' | 'sequence' | 'class' | 'er' | 'xychart' | 'gantt' | 'timeline' | 'pie' | 'journey' | 'quadrant' | 'mindmap' | 'sankey' | 'gitgraph' {
  const firstLine = text.trim().split(/[\n;]/)[0]?.trim().toLowerCase() ?? ''

  if (/^xychart(-beta)?\b/.test(firstLine)) return 'xychart'
  if (/^gantt\b/.test(firstLine)) return 'gantt'
  if (/^timeline\b/.test(firstLine)) return 'timeline'
  if (/^pie\b/.test(firstLine)) return 'pie'
  if (/^journey\b/.test(firstLine)) return 'journey'
  if (/^quadrantchart\b/.test(firstLine)) return 'quadrant'
  if (/^mindmap\b/.test(firstLine)) return 'mindmap'
  if (/^sankey(-beta)?\b/.test(firstLine)) return 'sankey'
  if (/^gitgraph\b/.test(firstLine)) return 'gitgraph'
  if (/^sequencediagram\s*$/.test(firstLine)) return 'sequence'
  if (/^classdiagram\s*$/.test(firstLine)) return 'class'
  if (/^erdiagram\s*$/.test(firstLine)) return 'er'

  // Default: flowchart/state (handled by parseMermaid internally)
  return 'flowchart'
}

/**
 * Build a DiagramColors object from render options.
 * Uses DEFAULTS for bg/fg when not provided, and passes through
 * optional enrichment colors (line, accent, muted, surface, border).
 */
function buildColors(options: RenderOptions, metaColors: FrontmatterColors = {}): DiagramColors {
  return {
    bg: options.bg ?? metaColors.bg ?? DEFAULTS.bg,
    fg: options.fg ?? metaColors.fg ?? DEFAULTS.fg,
    line: options.line ?? metaColors.line,
    accent: options.accent ?? metaColors.accent,
    muted: options.muted ?? metaColors.muted,
    surface: options.surface ?? metaColors.surface,
    border: options.border ?? metaColors.border,
  }
}

/**
 * Render Mermaid diagram text to an SVG string — synchronously.
 *
 * Uses elk.bundled.js with a direct FakeWorker bypass (no setTimeout(0) delay).
 * The ELK singleton is created lazily on first use and cached forever.
 *
 * Use this in React components with useMemo() to avoid flash:
 *   const svg = useMemo(() => renderMermaidSVG(code, opts), [code])
 *
 * @param text - Mermaid source text
 * @param options - Rendering options (colors, font, spacing)
 * @returns A self-contained SVG string
 *
 * @example
 * ```ts
 * const svg = renderMermaidSVG('graph TD\n  A --> B')
 *
 * // With theme
 * const svg = renderMermaidSVG('graph TD\n  A --> B', {
 *   bg: '#1a1b26', fg: '#a9b1d6'
 * })
 *
 * // With CSS variables (for live theme switching)
 * const svg = renderMermaidSVG('graph TD\n  A --> B', {
 *   bg: 'var(--background)', fg: 'var(--foreground)', transparent: true
 * })
 * ```
 */
export function renderMermaidSVG(
  text: string,
  options: RenderOptions = {}
): string {
  // Decode XML entities that may leak from markdown parsers (e.g. rehype-raw).
  // Without this, escapeXml() double-encodes them: &lt; → &amp;lt; → literal "&lt;" in SVG.
  text = decodeXML(text)

  // Strip YAML frontmatter and %%{init: ...}%% directives before anything
  // else looks at the text, so every diagram type gets a clean body and the
  // metadata is honoured once, in one place.
  const meta = parseFrontmatter(text)
  text = meta.body

  // Lift accTitle/accDescr out next. Every diagram type accepts them, so they
  // are handled here and spliced into the finished SVG as <title>/<desc>,
  // which keeps all fourteen parsers free of a11y concerns.
  const a11y = parseAccessibility(text)
  text = a11y.body

  return withAccessibility(
    renderDiagramBody(text, options, meta.title, meta.colors, meta.config),
    a11y,
  )
}

/**
 * Render a diagram body whose metadata has already been stripped.
 *
 * Split out from renderMermaidSVG so the metadata handling above reads as a
 * short pipeline rather than being buried on top of a fourteen-arm switch.
 */
function renderDiagramBody(
  text: string,
  options: RenderOptions,
  metaTitle: string | undefined,
  metaColors: FrontmatterColors,
  metaConfig: FrontmatterConfig,
): string {
  const meta = { title: metaTitle }

  // Explicit RenderOptions win over in-diagram metadata: the host page knows
  // its own theme, the diagram author only guessed at it.
  const colors = buildColors(options, metaColors)
  const font = options.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const diagramType = detectDiagramType(text)

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))

  switch (diagramType) {
    case 'sequence': {
      const diagram = parseSequenceDiagram(lines)
      const positioned = layoutSequenceDiagram(diagram, options)
      return renderSequenceSvg(positioned, colors, font, transparent)
    }
    case 'class': {
      const diagram = parseClassDiagram(lines)
      const positioned = layoutClassDiagramSync(diagram, options)
      return renderClassSvg(positioned, colors, font, transparent)
    }
    case 'er': {
      const diagram = parseErDiagram(lines)
      const positioned = layoutErDiagramSync(diagram, options)
      return renderErSvg(positioned, colors, font, transparent)
    }
    case 'xychart': {
      const chart = parseXYChart(lines)
      chart.title ??= meta.title
      const positioned = layoutXYChart(chart, options)
      return renderXYChartSvg(positioned, colors, font, transparent, options.interactive ?? false)
    }
    case 'gantt': {
      const diagram = parseGanttDiagram(lines)
      diagram.title ??= meta.title
      const positioned = layoutGantt(diagram, options)
      return renderGanttSvg(positioned, colors, font, transparent)
    }
    case 'timeline': {
      const diagram = parseTimelineDiagram(lines)
      diagram.title ??= meta.title
      diagram.disableMulticolor ??= metaConfig.timeline?.disableMulticolor
      const positioned = layoutTimeline(diagram, options)
      return renderTimelineSvg(positioned, colors, font, transparent)
    }
    case 'pie': {
      const diagram = parsePieDiagram(lines)
      diagram.title ??= meta.title
      diagram.textPosition ??= metaConfig.pie?.textPosition
      const positioned = layoutPie(diagram, options)
      return renderPieSvg(positioned, colors, font, transparent)
    }
    case 'journey': {
      const diagram = parseJourneyDiagram(lines)
      diagram.title ??= meta.title
      const positioned = layoutJourney(diagram, options)
      return renderJourneySvg(positioned, colors, font, transparent)
    }
    case 'quadrant': {
      const diagram = parseQuadrantDiagram(lines)
      diagram.title ??= meta.title
      const positioned = layoutQuadrant(diagram, options)
      return renderQuadrantSvg(positioned, colors, font, transparent)
    }
    case 'mindmap': {
      // Mindmap nesting comes from source indentation, so this parser gets
      // the raw text rather than the trimmed lines every other type takes.
      const diagram = parseMindmapDiagram(text)
      const positioned = layoutMindmap(diagram, options)
      return renderMindmapSvg(positioned, colors, font, transparent)
    }
    case 'sankey': {
      // A quoted CSV field may contain a `%%` sequence, so the sankey parser
      // takes raw text rather than the comment-stripped lines.
      const diagram = parseSankeyDiagram(text)
      const positioned = layoutSankey(diagram, options)
      return renderSankeySvg(positioned, colors, font, transparent)
    }
    case 'gitgraph': {
      const diagram = parseGitGraphDiagram(lines)
      diagram.title ??= meta.title
      const positioned = layoutGitGraph(diagram, options)
      return renderGitGraphSvg(positioned, colors, font, transparent)
    }
    case 'flowchart':
    default: {
      const graph = parseMermaid(text)
      const positioned = layoutGraphSync(graph, options)
      return renderSvg(positioned, colors, font, transparent)
    }
  }
}

/**
 * Render Mermaid diagram text to an SVG string — async.
 *
 * Same result as renderMermaidSVG() but returns a Promise.
 * Useful in async contexts (server handlers, data loaders, etc.)
 */
export async function renderMermaidSVGAsync(
  text: string,
  options: RenderOptions = {}
): Promise<string> {
  return renderMermaidSVG(text, options)
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/** @deprecated Use `renderMermaidSVG` */
export const renderMermaidSync = renderMermaidSVG

/** @deprecated Use `renderMermaidSVGAsync` */
export const renderMermaid = renderMermaidSVGAsync
