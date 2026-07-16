import { describe, expect, it } from 'vitest';
import { dedupeImportIssues } from './importIssues';

describe('import issue presentation', () => {
  it('deduplicates repeated option-detail advice by field and reason', () => {
    const repeated = {
      field: 'MSFU 期权增强',
      reason: '缺少 Delta 和到期日',
      priority: 'required' as const,
    };

    expect(dedupeImportIssues([
      repeated,
      repeated,
      { ...repeated, reason: '缺少 Gamma' },
    ])).toEqual([
      repeated,
      { ...repeated, reason: '缺少 Gamma' },
    ]);
  });
});
