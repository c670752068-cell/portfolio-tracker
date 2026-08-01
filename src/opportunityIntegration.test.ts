import { describe, expect, it } from 'vitest';
import source from './App.tsx?raw';

describe('dashboard keeps no derived conclusion', () => {
  it('renders no verdict strip and derives no opportunity state of its own', () => {
    // The server-owned DecisionStatusBar is back on 总览 (V17 D3); what stays
    // banned is the dashboard deriving a conclusion of its own.
    expect(source).not.toContain('<OpportunityOverview snapshot={quantAnalysis} compact');
    expect(source).not.toContain('<FearComfortBanner context={quantAnalysis?.context}');
    expect(source).not.toContain('fetchQuantAnalysis(getServerQuantAnalysisUrl());');
  });
});
