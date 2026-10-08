import type {
  Relation,
  RelationshipType,
  Requirement,
  RequirementDiagram,
  RequirementDirection,
  RequirementElement,
  RequirementType,
  RiskLevel,
  VerifyType,
} from './types.ts'

// ============================================================================
// Requirement diagram parser
//
// Parses Mermaid `requirementDiagram` syntax.
//
//   requirementDiagram
//
//   requirement test_req {
//       id: 1
//       text: the test text
//       risk: high
//       verifyMethod: test
//   }
//
//   element test_entity {
//       type: simulation
//       docRef: none
//   }
//
//   test_entity - satisfies -> test_req
//
// A relationship may be written in either direction:
//
//   a - satisfies -> b     a satisfies b
//   a <- satisfies - b     b satisfies a
//
// Both forms mean the same thing; only the writing order differs, which is
// why they collapse into one Relation with src and dst swapped.
// ============================================================================

/** Keyword to requirement type, as the upstream grammar maps them. */
const REQUIREMENT_TYPES: Record<string, RequirementType> = {
  requirement: 'Requirement',
  functionalrequirement: 'Functional Requirement',
  interfacerequirement: 'Interface Requirement',
  performancerequirement: 'Performance Requirement',
  physicalrequirement: 'Physical Requirement',
  designconstraint: 'Design Constraint',
}

const RISK_LEVELS: Record<string, RiskLevel> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const VERIFY_TYPES: Record<string, VerifyType> = {
  analysis: 'Analysis',
  demonstration: 'Demonstration',
  inspection: 'Inspection',
  test: 'Test',
}

const RELATIONSHIPS: Record<string, RelationshipType> = {
  contains: 'contains',
  copies: 'copies',
  derives: 'derives',
  satisfies: 'satisfies',
  verifies: 'verifies',
  refines: 'refines',
  traces: 'traces',
}

/** `a - satisfies -> b` — source on the left. */
const ARROW_RIGHT = /^(.+?)\s*-\s*(\w+)\s*->\s*(.+)$/
/** `a <- satisfies - b` — source on the right. */
const ARROW_LEFT = /^(.+?)\s*<-\s*(\w+)\s*-\s*(.+)$/

/** Inline CSS declarations are rejected when they could break out of the attribute. */
const UNSAFE_STYLE = /[<>"']/

/**
 * Parse a Mermaid requirement diagram from preprocessed lines.
 *
 * Lines are expected trimmed and comment-free, as the shared preprocessing
 * produces — nothing here is indentation-sensitive.
 */
export function parseRequirementDiagram(lines: string[]): RequirementDiagram {
  const diagram: RequirementDiagram = {
    direction: 'TB',
    requirements: new Map(),
    elements: new Map(),
    relationships: [],
    classes: new Map(),
  }

  /** The block currently open, if any — its body lines go to this node. */
  let open:
    | { kind: 'requirement'; node: Requirement }
    | { kind: 'element'; node: RequirementElement }
    | undefined

  /** Counts per src-dst pair, so parallel relationships get distinct ids. */
  const pairCounts = new Map<string, number>()

  /** Deferred, because a `class` or `style` may name a node declared later. */
  const classAssignments: { names: string[]; classes: string[] }[] = []
  const styleAssignments: { names: string[]; css: string }[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // A closing brace ends the open block, whatever else is on the line
    if (line === '}') {
      open = undefined
      continue
    }

    if (open) {
      applyBodyLine(open, line)
      continue
    }

    if (/^requirementdiagram\b/i.test(line)) continue

    const title = line.match(/^title\s+(.*)$/i)
    if (title) {
      const value = title[1]!.trim()
      if (value) diagram.title = value
      continue
    }

    const direction = line.match(/^direction\s+(TB|BT|LR|RL)\b/i)
    if (direction) {
      diagram.direction = direction[1]!.toUpperCase() as RequirementDirection
      continue
    }

    const classDef = line.match(/^classDef\s+(\S+)\s+(.+)$/i)
    if (classDef) {
      for (const name of splitNames(classDef[1]!)) {
        const existing = diagram.classes.get(name)
        const added = classDef[2]!.trim()
        diagram.classes.set(name, existing ? `${existing},${added}` : added)
      }
      continue
    }

    const classStatement = line.match(/^class\s+(\S+)\s+(\S+)\s*$/i)
    if (classStatement) {
      classAssignments.push({
        names: splitNames(classStatement[1]!),
        classes: splitNames(classStatement[2]!),
      })
      continue
    }

    const styleStatement = line.match(/^style\s+(\S+)\s+(.+)$/i)
    if (styleStatement) {
      styleAssignments.push({
        names: splitNames(styleStatement[1]!),
        css: styleStatement[2]!.trim(),
      })
      continue
    }

    const relation = parseRelation(line)
    if (relation) {
      const key = `${relation.src}-${relation.dst}`
      const index = pairCounts.get(key) ?? 0
      pairCounts.set(key, index + 1)
      diagram.relationships.push({ ...relation, id: `${key}-${index}` })
      continue
    }

    // A `name:::class` shorthand, outside any block
    const shorthand = line.match(/^(.+?):::(\S+)\s*$/)
    if (shorthand && !line.includes('{')) {
      classAssignments.push({
        names: [unquote(shorthand[1]!.trim())],
        classes: splitNames(shorthand[2]!),
      })
      continue
    }

    const declaration = parseDeclaration(line)
    if (!declaration) continue

    if (declaration.kind === 'element') {
      const node: RequirementElement = {
        name: declaration.name,
        type: '',
        docRef: '',
        cssStyles: [],
        classes: [...declaration.classes],
      }
      diagram.elements.set(node.name, node)
      if (declaration.opensBlock) open = { kind: 'element', node }
      continue
    }

    const node: Requirement = {
      name: declaration.name,
      type: declaration.type,
      requirementId: '',
      text: '',
      cssStyles: [],
      classes: [...declaration.classes],
    }
    diagram.requirements.set(node.name, node)
    if (declaration.opensBlock) open = { kind: 'requirement', node }
  }

  applyClasses(diagram, classAssignments)
  applyStyles(diagram, styleAssignments)

  return diagram
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/**
 * Read a `requirement <name> {` or `element <name> {` header.
 *
 * Returns undefined for a line that is not a declaration.
 */
function parseDeclaration(line: string):
  | { kind: 'element'; name: string; classes: string[]; opensBlock: boolean }
  | {
      kind: 'requirement'
      name: string
      type: RequirementType
      classes: string[]
      opensBlock: boolean
    }
  | undefined {
  const match = line.match(/^(\w+)\s+(.+?)\s*(\{)?\s*$/)
  if (!match) return undefined

  const keyword = match[1]!.toLowerCase()
  const opensBlock = match[3] === '{'

  // A trailing `:::class` on the declaration
  let rest = match[2]!.trim()
  const classes: string[] = []
  const styled = rest.match(/^(.+?):::(\S+)$/)
  if (styled) {
    rest = styled[1]!.trim()
    classes.push(...splitNames(styled[2]!))
  }

  const name = unquote(rest)
  if (!name) return undefined

  if (keyword === 'element') return { kind: 'element', name, classes, opensBlock }

  const type = REQUIREMENT_TYPES[keyword]
  if (!type) return undefined

  return { kind: 'requirement', name, type, classes, opensBlock }
}

/**
 * Apply one body line to the open block.
 *
 * An unrecognised key is ignored rather than rejected, so a diagram written
 * for a newer Mermaid still renders.
 */
function applyBodyLine(
  open:
    | { kind: 'requirement'; node: Requirement }
    | { kind: 'element'; node: RequirementElement },
  line: string,
): void {
  const colon = line.indexOf(':')
  if (colon < 0) return

  const key = line.slice(0, colon).trim().toLowerCase()
  const value = unquote(line.slice(colon + 1).trim())
  if (!value) return

  if (open.kind === 'requirement') {
    switch (key) {
      case 'id':
        open.node.requirementId = value
        break
      case 'text':
        open.node.text = value
        break
      case 'risk': {
        const risk = RISK_LEVELS[value.toLowerCase()]
        if (risk) open.node.risk = risk
        break
      }
      case 'verifymethod': {
        const verify = VERIFY_TYPES[value.toLowerCase()]
        if (verify) open.node.verifyMethod = verify
        break
      }
    }
    return
  }

  switch (key) {
    case 'type':
      open.node.type = value
      break
    case 'docref':
      open.node.docRef = value
      break
  }
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/**
 * Read a relationship line in either arrow direction.
 *
 * `a <- satisfies - b` is `b satisfies a`: the arrow points at the source, so
 * reading it aloud left to right still gives the right sentence.
 */
function parseRelation(line: string): Omit<Relation, 'id'> | undefined {
  const right = line.match(ARROW_RIGHT)
  if (right) {
    const type = RELATIONSHIPS[right[2]!.toLowerCase()]
    if (!type) return undefined
    return { type, src: unquote(right[1]!.trim()), dst: unquote(right[3]!.trim()) }
  }

  const left = line.match(ARROW_LEFT)
  if (left) {
    const type = RELATIONSHIPS[left[2]!.toLowerCase()]
    if (!type) return undefined
    return { type, src: unquote(left[3]!.trim()), dst: unquote(left[1]!.trim()) }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Classes and styles
// ---------------------------------------------------------------------------

/** Attach deferred `class` statements to their nodes. */
function applyClasses(
  diagram: RequirementDiagram,
  assignments: { names: string[]; classes: string[] }[],
): void {
  for (const { names, classes } of assignments) {
    for (const name of names) {
      const node = diagram.requirements.get(name) ?? diagram.elements.get(name)
      if (!node) continue
      for (const cls of classes) {
        if (!node.classes.includes(cls)) node.classes.push(cls)
      }
    }
  }
}

/** Attach deferred `style` statements to their nodes. */
function applyStyles(
  diagram: RequirementDiagram,
  assignments: { names: string[]; css: string }[],
): void {
  for (const { names, css } of assignments) {
    const declarations = splitDeclarations(css)
    if (declarations.length === 0) continue

    for (const name of names) {
      const node = diagram.requirements.get(name) ?? diagram.elements.get(name)
      if (node) node.cssStyles.push(...declarations)
    }
  }
}

/**
 * Compile a node's collected style declarations into an attribute value.
 *
 * Returns undefined when the value could break out of the attribute, since a
 * diagram is often pasted from elsewhere and should not be able to inject
 * markup into the page that renders it.
 */
export function compileStyles(declarations: string[]): string | undefined {
  if (declarations.length === 0) return undefined

  const joined = declarations.join(';')
  if (UNSAFE_STYLE.test(joined)) return undefined

  return joined
}

/** Split a style body on commas and semicolons outside a `rgb(...)` call. */
function splitDeclarations(css: string): string[] {
  const out: string[] = []
  let current = ''
  let depth = 0

  for (const char of css) {
    if (char === '(') depth++
    else if (char === ')') depth--

    if ((char === ',' || char === ';') && depth === 0) {
      out.push(current)
      current = ''
    } else {
      current += char
    }
  }
  out.push(current)

  return out.map(d => d.trim()).filter(d => d.length > 0)
}

/** Split a comma-separated name list. */
function splitNames(text: string): string[] {
  return text.split(',').map(n => unquote(n.trim())).filter(n => n.length > 0)
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}
