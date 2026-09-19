import type { BranchInfo } from '@latchops/schema';
import type { StatusInfo } from '../parsers/status-parser.js';

/**
 * Build the schema `BranchInfo` from parsed porcelain v2 branch headers.
 *
 * All branch data comes from `git status --branch` headers, so no additional
 * `git branch -vv` call is required for correctness (that output is retained
 * only as a raw display field on the snapshot).
 */
export function toBranchInfo(status: StatusInfo): BranchInfo {
  const info: BranchInfo = {
    head: status.branch.head,
    oid: status.branch.oid,
  };

  if (status.branch.upstream) {
    info.upstream = status.branch.upstream;
  }

  if (status.branch.ahead !== undefined && status.branch.behind !== undefined) {
    info.aheadBehind = {
      ahead: status.branch.ahead,
      behind: status.branch.behind,
    };
  }

  return info;
}
