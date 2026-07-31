import { describe, expect, it } from 'vitest';
import source from './App.tsx?raw';

describe('dashboard keeps no derived conclusion', () => {
  it('renders no verdict strip and derives no opportunity state of its own', () => {
    // The owner removed the daily conclusion from the site; the push still
    // carries it.  The dashboard must not grow a replacement.
    expect(source).not.toContain('<DecisionStatusBar');
    expect(source).not.toContain('<OpportunityOverview snapshot={quantAnalysis} compact');
    expect(source).not.toContain('<FearComfortBanner context={quantAnalysis?.context}');
    expect(source).not.toContain('fetchQuantAnalysis(getServerQuantAnalysisUrl());');
  });
});
