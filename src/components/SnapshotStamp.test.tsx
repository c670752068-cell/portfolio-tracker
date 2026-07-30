import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot } from '../types';
import { SnapshotStamp } from './SnapshotStamp';

describe('SnapshotStamp', () => {
  it('shows the one App-owned analysis snapshot timestamp at the page top', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T08:49:24.092951-04:00',
      rule_version: '2.7', disclaimer: '', context: {}, symbols: {},
    } as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<SnapshotStamp snapshot={snapshot} />);

    expect(html).toContain('统一量化快照 2026-07-30 08:49');
    expect(html).not.toContain('T08:49:24');
  });
});
