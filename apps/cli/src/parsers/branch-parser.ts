import type { BranchInfo } from '@latchops/schema';
import type { StatusInfo } from './status-parser.js';

/**
 * Parse branch information from git branch -vv and status info.
 */
export function parseBranches(
  branchOutput: string,
  statusBranch: StatusInfo['branch']
): BranchInfo {
  const result: BranchInfo = {
    head: statusBranch.head,
    oid: statusBranch.oid,
  };

  if (statusBranch.upstream) {
    result.upstream = statusBranch.upstream;
  }

  if (statusBranch.ahead !== undefined && statusBranch.behind !== undefined) {
    result.aheadBehind = {
      ahead: statusBranch.ahead,
      behind: statusBranch.behind,
    };
  }

  return result;
}
