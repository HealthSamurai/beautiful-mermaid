import type {
  GitBranch, GitCommit, GitCommitType, GitGraphDiagram, GitGraphDirection,
} from './types.ts'

// ============================================================================
// Git graph parser
//
// Parses Mermaid `gitGraph` syntax by REPLAYING it: `commit` means "append to
// whatever branch is checked out", so the parser keeps a current branch and a
// head per branch and builds the history as it reads.
//
// Statements:
//   gitGraph[ TB|BT|LR][:]
//   title <text>
//   commit                                  — auto id, normal type
//   commit "a message"                      — shorthand message
//   commit id:"X" msg:"m" tag:"T" type:REVERSE
//   branch <name>[ order: N]                — creates, does NOT check out
//   checkout <name> / switch <name>         — moves HEAD
//   merge <name>[ id:"X"][ tag:"T"][ type:...]
//   cherry-pick id:"X"[ parent:"P"][ tag:"T"]
//
// Commit option keys may appear in any order, which is why they are scanned
// rather than matched positionally.
// ============================================================================

/** Mermaid's implicit starting branch. */
const DEFAULT_BRANCH = 'main'

/** Commit types accepted after `type:`. */
const COMMIT_TYPES: Record<string, GitCommitType> = {
  NORMAL: 'normal',
  REVERSE: 'reverse',
  HIGHLIGHT: 'highlight',
  MERGE: 'merge',
  CHERRY_PICK: 'cherry-pick',
}

/**
 * Parse a Mermaid gitGraph from preprocessed lines.
 * Lines should already be trimmed and comment-stripped (as index.ts does).
 */
export function parseGitGraphDiagram(lines: string[]): GitGraphDiagram {
  let title: string | undefined
  let direction: GitGraphDirection = 'LR'

  const branches: GitBranch[] = [{ name: DEFAULT_BRANCH, order: 0 }]
  const branchNames = new Set<string>([DEFAULT_BRANCH])
  const commits: GitCommit[] = []

  /** Head commit id per branch — the parent for the next commit on it. */
  const heads = new Map<string, string>()
  let currentBranch = DEFAULT_BRANCH
  let seq = 0

  /** Register a commit, advancing the head of its branch. */
  const addCommit = (commit: GitCommit) => {
    commits.push(commit)
    heads.set(commit.branch, commit.id)
  }

  for (const line of lines) {
    // Header line — `gitGraph`, `gitGraph:`, `gitGraph TB:`
    const header = line.match(/^gitGraph\b\s*(TB|BT|LR)?\s*:?\s*(.*)$/i)
    if (header) {
      if (header[1]) direction = header[1].toUpperCase() as GitGraphDirection
      const rest = header[2]?.trim()
      if (rest) {
        const inlineTitle = rest.match(/^title\s+(.+)$/i)
        if (inlineTitle) title = inlineTitle[1]!.trim()
      }
      continue
    }

    // Accessibility metadata — accepted and ignored
    if (/^acc(Title|Descr)\b/i.test(line)) continue

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = titleMatch[1]!.trim()
      continue
    }

    // branch <name> [order: N] — creates the branch but leaves HEAD alone
    const branchMatch = line.match(/^branch\s+(.+)$/i)
    if (branchMatch) {
      const { name, order } = parseBranchDef(branchMatch[1]!.trim())
      if (name && !branchNames.has(name)) {
        branchNames.add(name)
        branches.push({ name, order: order ?? branches.length })
        // A new branch starts at the current HEAD
        const head = heads.get(currentBranch)
        if (head) heads.set(name, head)
      }
      continue
    }

    // checkout / switch <name> — moves HEAD
    const checkoutMatch = line.match(/^(?:checkout|switch)\s+(.+)$/i)
    if (checkoutMatch) {
      const name = unquote(checkoutMatch[1]!.trim())
      if (branchNames.has(name)) currentBranch = name
      continue
    }

    // merge <branch> [options] — two parents, lands on the current branch
    const mergeMatch = line.match(/^merge\s+(.+)$/i)
    if (mergeMatch) {
      const rest = mergeMatch[1]!.trim()
      const sourceBranch = unquote(rest.split(/\s+/)[0] ?? '')
      const options = parseCommitOptions(rest.slice(sourceBranch.length))

      const intoHead = heads.get(currentBranch)
      const fromHead = heads.get(sourceBranch)
      const parents = [intoHead, fromHead].filter((p): p is string => !!p)

      addCommit({
        id: options.id ?? `${seq}-${sourceBranch}`,
        message: options.message ?? '',
        seq: seq++,
        type: options.type ?? 'merge',
        tags: options.tags,
        parents,
        branch: currentBranch,
      })
      continue
    }

    // cherry-pick id:"X" [parent:"P"] [tag:"T"]
    const cherryMatch = line.match(/^cherry-pick\s+(.+)$/i)
    if (cherryMatch) {
      const options = parseCommitOptions(cherryMatch[1]!)
      const sourceId = options.id
      if (!sourceId) continue

      // Upstream records provenance in the tag when no explicit tag is given
      const tags = options.hasExplicitTag
        ? options.tags
        : [options.parent ? `cherry-pick:${sourceId}|parent:${options.parent}` : `cherry-pick:${sourceId}`]

      const head = heads.get(currentBranch)

      addCommit({
        id: `${seq}-cherry-pick`,
        message: '',
        seq: seq++,
        type: 'cherry-pick',
        tags,
        parents: head ? [head] : [],
        branch: currentBranch,
      })
      continue
    }

    // commit [options]
    const commitMatch = line.match(/^commit\b\s*(.*)$/i)
    if (commitMatch) {
      const options = parseCommitOptions(commitMatch[1] ?? '')
      const head = heads.get(currentBranch)

      addCommit({
        id: options.id ?? String(seq),
        message: options.message ?? '',
        seq: seq++,
        type: options.type ?? 'normal',
        tags: options.tags,
        parents: head ? [head] : [],
        branch: currentBranch,
      })
      continue
    }
  }

  return { title, direction, branches, commits, currentBranch }
}

// ---------------------------------------------------------------------------
// Statement details
// ---------------------------------------------------------------------------

/** `newbranch` or `newbranch order: 3`, with optional quotes around the name. */
function parseBranchDef(text: string): { name: string; order?: number } {
  const withOrder = text.match(/^(.+?)\s+order\s*:\s*(\d+)\s*$/i)
  if (withOrder) {
    return { name: unquote(withOrder[1]!.trim()), order: Number(withOrder[2]) }
  }
  return { name: unquote(text) }
}

/** Options gathered from a commit-like statement, in any order. */
interface CommitOptions {
  id?: string
  message?: string
  type?: GitCommitType
  parent?: string
  tags: string[]
  /** True when the source wrote `tag:` at all, even as an empty string */
  hasExplicitTag: boolean
}

/**
 * Scan `key:"value"` pairs out of a statement tail.
 *
 * A bare quoted string with no key is the commit message shorthand, so
 * `commit "a commit"` and `commit msg:"a commit"` mean the same thing.
 */
function parseCommitOptions(text: string): CommitOptions {
  const out: CommitOptions = { tags: [], hasExplicitTag: false }
  const trimmed = text.trim()
  if (!trimmed) return out

  // Keyed options: id:"X", msg:"m", tag:"T", type:REVERSE, parent:"P"
  const keyed = /\b(id|msg|message|tag|type|parent)\s*:\s*(?:"([^"]*)"|([A-Za-z_][\w-]*))/gi
  let consumedAny = false

  for (const match of trimmed.matchAll(keyed)) {
    consumedAny = true
    const key = match[1]!.toLowerCase()
    const value = match[2] ?? match[3] ?? ''

    switch (key) {
      case 'id':
        out.id = value
        break
      case 'msg':
      case 'message':
        out.message = value
        break
      case 'tag':
        out.hasExplicitTag = true
        // `tag:""` explicitly means "no tag"
        if (value) out.tags.push(value)
        break
      case 'type':
        out.type = COMMIT_TYPES[value.toUpperCase()]
        break
      case 'parent':
        out.parent = value
        break
    }
  }

  // Shorthand message — only when no keyed option claimed the line
  if (!consumedAny) {
    const bare = trimmed.match(/^"([^"]*)"\s*$/)
    if (bare) out.message = bare[1]!
  }

  return out
}

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
  const quoted = text.match(/^"(.*)"$/)
  return quoted ? quoted[1]! : text
}
