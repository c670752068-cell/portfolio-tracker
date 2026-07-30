import { describe, expect, it } from 'vitest';
import source from './App.tsx?raw';

describe('server-owned final verdict integration', () => {
  it('uses the already-loaded quant snapshot for the sole dashboard conclusion', () => {
    expect(source).toContain('<DecisionStatusBar snapshot={quantAnalysis}');
    expect(source).not.toContain('<OpportunityOverview snapshot={quantAnalysis} compact');
    expect(source).not.toContain('<FearComfortBanner context={quantAnalysis?.context}');
    expect(source).not.toContain('fetchQuantAnalysis(getServerQuantAnalysisUrl());');
  });

  it('renders the full final-verdict strip only inside the dashboard tab', () => {
    const dashboardStart = source.indexOf("{tab === 'dashboard' && (");
    const statusBar = source.indexOf('<DecisionStatusBar snapshot={quantAnalysis}');
    const holdingsStart = source.indexOf("{tab === 'holdings' && (");

    expect(dashboardStart).toBeGreaterThan(-1);
    expect(statusBar).toBeGreaterThan(dashboardStart);
    expect(statusBar).toBeLessThan(holdingsStart);
    expect(source.match(/<DecisionStatusBar snapshot=\{quantAnalysis\}/g)).toHaveLength(1);
  });
});
