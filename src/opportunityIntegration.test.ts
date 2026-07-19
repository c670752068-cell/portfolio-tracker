import { describe, expect, it } from 'vitest';
import source from './App.tsx?raw';

describe('opportunity overview integration', () => {
  it('reuses the already-loaded quant snapshot on the dashboard', () => {
    expect(source).toContain('<OpportunityOverview snapshot={quantAnalysis} compact');
    expect(source).not.toContain('fetchQuantAnalysis(getServerQuantAnalysisUrl());');
  });
});
