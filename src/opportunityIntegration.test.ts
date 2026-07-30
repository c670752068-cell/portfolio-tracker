import { describe, expect, it } from 'vitest';
import source from './App.tsx?raw';

describe('server-owned final verdict integration', () => {
  it('uses the already-loaded quant snapshot for the sole dashboard conclusion', () => {
    expect(source).toContain('<DecisionStatusBar snapshot={quantAnalysis}');
    expect(source).not.toContain('<OpportunityOverview snapshot={quantAnalysis} compact');
    expect(source).not.toContain('<FearComfortBanner context={quantAnalysis?.context}');
    expect(source).not.toContain('fetchQuantAnalysis(getServerQuantAnalysisUrl());');
  });
});
