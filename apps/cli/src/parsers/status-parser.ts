/**
 * Parse git status --porcelain=v2 --branch output.
 *
 * Format reference:
 * - Branch headers: # branch.oid, # branch.head, # branch.upstream, # branch.ab
 * - Ordinary changed entries: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 * - Renamed/copied entries: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><tab><origPath>
 * - Unmerged entries: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 * - Untracked entries: ? <path>
 * - Ignored entries: ! <path>
 */

export interface StatusInfo {
  branch: {
    oid: string;
    head: string;
    upstream?: string;
    ahead?: number;
    behind?: number;
  };
  isDetachedHead: boolean;
  unmergedPaths: string[];
  stagedFiles: string[];
  modifiedFiles: string[];
  untrackedFiles: string[];
}

export function parseStatus(status: string): StatusInfo {
  const lines = status.split('\n').filter(line => line.length > 0);

  const result: StatusInfo = {
    branch: {
      oid: '',
      head: '',
    },
    isDetachedHead: false,
    unmergedPaths: [],
    stagedFiles: [],
    modifiedFiles: [],
    untrackedFiles: [],
  };

  for (const line of lines) {
    // Branch headers
    if (line.startsWith('# branch.oid ')) {
      result.branch.oid = line.slice('# branch.oid '.length);
    } else if (line.startsWith('# branch.head ')) {
      result.branch.head = line.slice('# branch.head '.length);
      result.isDetachedHead = result.branch.head === '(detached)';
    } else if (line.startsWith('# branch.upstream ')) {
      result.branch.upstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/# branch\.ab \+(\d+) -(\d+)/);
      if (match) {
        result.branch.ahead = parseInt(match[1], 10);
        result.branch.behind = parseInt(match[2], 10);
      }
    }
    // Unmerged entries (conflicts)
    else if (line.startsWith('u ')) {
      const path = parseUnmergedLine(line);
      if (path) {
        result.unmergedPaths.push(path);
      }
    }
    // Ordinary changed entries
    else if (line.startsWith('1 ')) {
      const parsed = parseOrdinaryLine(line);
      if (parsed) {
        if (parsed.staged) {
          result.stagedFiles.push(parsed.path);
        }
        if (parsed.modified) {
          result.modifiedFiles.push(parsed.path);
        }
      }
    }
    // Renamed/copied entries
    else if (line.startsWith('2 ')) {
      const parsed = parseRenamedLine(line);
      if (parsed) {
        result.stagedFiles.push(parsed.path);
      }
    }
    // Untracked entries
    else if (line.startsWith('? ')) {
      result.untrackedFiles.push(line.slice(2));
    }
  }

  return result;
}

function parseUnmergedLine(line: string): string | null {
  // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
  const parts = line.split(' ');
  if (parts.length >= 11) {
    // Path is everything after the 10th space-separated element
    return parts.slice(10).join(' ');
  }
  return null;
}

function parseOrdinaryLine(line: string): { path: string; staged: boolean; modified: boolean } | null {
  // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
  const parts = line.split(' ');
  if (parts.length >= 9) {
    const xy = parts[1];
    const path = parts.slice(8).join(' ');

    // X is index status (staged), Y is worktree status (modified)
    const staged = xy[0] !== '.';
    const modified = xy[1] !== '.';

    return { path, staged, modified };
  }
  return null;
}

function parseRenamedLine(line: string): { path: string; origPath: string } | null {
  // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><tab><origPath>
  const tabIndex = line.indexOf('\t');
  if (tabIndex !== -1) {
    const beforeTab = line.slice(0, tabIndex).split(' ');
    const origPath = line.slice(tabIndex + 1);
    const path = beforeTab[beforeTab.length - 1];
    return { path, origPath };
  }
  return null;
}
