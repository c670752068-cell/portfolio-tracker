import type { ImportIssue } from './types';

export function dedupeImportIssues(issues: readonly ImportIssue[]): ImportIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.field}\u0000${issue.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
