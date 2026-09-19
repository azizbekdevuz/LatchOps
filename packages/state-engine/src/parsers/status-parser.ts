/**
 * Parser for `git status --porcelain=v2 --branch -z`.
 *
 * The `-z` (NUL-terminated) format is used so that paths containing spaces,
 * tabs, newlines, or Unicode are preserved verbatim and never quoted. This is
 * the key hardening over the previous space-splitting parser.
 *
 * Record layout (NUL-separated):
 * - Branch headers:  `# branch.oid <oid>`, `# branch.head <name>`,
 *                    `# branch.upstream <ref>`, `# branch.ab +<a> -<b>`
 * - Ordinary (`1`):  `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
 * - Rename/copy(`2`):`2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>`
 *                    followed by a separate NUL-terminated token `<origPath>`.
 * - Unmerged (`u`):  `u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
 * - Untracked(`?`):  `? <path>`
 * - Ignored  (`!`):  `! <path>`
 */

export interface StatusBranch {
  oid: string;
  head: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface RenameEntry {
  path: string;
  origPath: string;
}

export interface StatusInfo {
  branch: StatusBranch;
  isDetachedHead: boolean;
  /** True when HEAD points at an unborn branch (no commits yet). */
  isUnbornBranch: boolean;
  unmergedPaths: string[];
  stagedFiles: string[];
  modifiedFiles: string[];
  untrackedFiles: string[];
  ignoredFiles: string[];
  renames: RenameEntry[];
}

/** Split a `-z` payload into records, dropping the trailing empty token. */
function tokenize(raw: string): string[] {
  const parts = raw.split('\0');
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

export function parseStatus(raw: string): StatusInfo {
  const info: StatusInfo = {
    branch: { oid: '', head: '' },
    isDetachedHead: false,
    isUnbornBranch: false,
    unmergedPaths: [],
    stagedFiles: [],
    modifiedFiles: [],
    untrackedFiles: [],
    ignoredFiles: [],
    renames: [],
  };

  const tokens = tokenize(raw);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length === 0) continue;

    const kind = token[0];

    if (kind === '#') {
      applyBranchHeader(token, info);
      continue;
    }

    if (kind === '1') {
      // `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` — 8 fields, then path.
      const { xy, path } = splitFieldsAndPath(token, 8);
      if (!path) continue;
      recordXy(xy, path, info);
      continue;
    }

    if (kind === '2') {
      // `2 <XY> <sub> ... <Xscore> <path>` — 9 fields, then path; origPath is the NEXT token.
      const { xy, path } = splitFieldsAndPath(token, 9);
      const origPath = tokens[i + 1] ?? '';
      i += 1; // consume the origPath token
      if (!path) continue;
      info.renames.push({ path, origPath });
      recordXy(xy, path, info);
      continue;
    }

    if (kind === 'u') {
      // `u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` — 10 fields, then path.
      const { path } = splitFieldsAndPath(token, 10);
      if (path) info.unmergedPaths.push(path);
      continue;
    }

    if (kind === '?') {
      info.untrackedFiles.push(token.slice(2));
      continue;
    }

    if (kind === '!') {
      info.ignoredFiles.push(token.slice(2));
      continue;
    }
  }

  return info;
}

function applyBranchHeader(token: string, info: StatusInfo): void {
  if (token.startsWith('# branch.oid ')) {
    const oid = token.slice('# branch.oid '.length);
    info.branch.oid = oid;
    // Porcelain v2 reports "(initial)" as the oid on an unborn branch.
    if (oid === '(initial)') info.isUnbornBranch = true;
  } else if (token.startsWith('# branch.head ')) {
    const head = token.slice('# branch.head '.length);
    info.branch.head = head;
    if (head === '(detached)') info.isDetachedHead = true;
  } else if (token.startsWith('# branch.upstream ')) {
    info.branch.upstream = token.slice('# branch.upstream '.length);
  } else if (token.startsWith('# branch.ab ')) {
    const m = token.match(/# branch\.ab \+(-?\d+) -(-?\d+)/);
    if (m) {
      info.branch.ahead = Number(m[1]);
      info.branch.behind = Number(m[2]);
    }
  }
}

/**
 * Split a record into its fixed leading fields (space-separated, none of which
 * contain spaces) and the trailing path. The path is everything after the
 * Nth space, so embedded spaces in the path are preserved.
 */
function splitFieldsAndPath(token: string, fieldCount: number): { xy: string; path: string } {
  // token[0] is the record type; fields start after the first space.
  // We need the position after `fieldCount` space-delimited fields.
  // `fieldCount` counts the leading space-delimited fields (including the
  // record-type character at index 0). The path begins immediately after the
  // `fieldCount`-th space, so embedded spaces in the path are preserved.
  let spaceSeen = 0;
  let idx = 0;
  for (; idx < token.length; idx++) {
    if (token[idx] === ' ') {
      spaceSeen += 1;
      if (spaceSeen === fieldCount) {
        // idx is at the space before the path.
        break;
      }
    }
  }
  const header = token.slice(0, idx);
  const path = token.slice(idx + 1);
  const headerParts = header.split(' ');
  // headerParts[0] is the record type; [1] is the XY status code.
  const xy = headerParts[1] ?? '';
  return { xy, path };
}

function recordXy(xy: string, path: string, info: StatusInfo): void {
  // X = staged (index) status, Y = worktree status. '.' means unmodified.
  const staged = xy[0] !== undefined && xy[0] !== '.';
  const modified = xy[1] !== undefined && xy[1] !== '.';
  if (staged) info.stagedFiles.push(path);
  if (modified) info.modifiedFiles.push(path);
}
