import { describe, expect, it } from 'vitest';
import app from './App.tsx?raw';
import kimi from './kimi.ts?raw';

describe('removed analysis surfaces stay removed', () => {
  it('has no analysis route', () => {
    expect(app).not.toContain("'analysis'");
  });

  it('has no local risk scan heading', () => {
    expect(app).not.toContain('本地风险扫描');
  });

  it('has no analysis panel import', () => {
    expect(app).not.toContain('AnalysisPanel');
  });

  it('has no risk-list import', () => {
    expect(app).not.toContain('RiskList');
  });

  it('has no local analyzer call', () => {
    expect(app).not.toContain('analyzePortfolio');
  });

  it('has no AI portfolio-analysis export', () => {
    expect(kimi).not.toContain('analyzeWithAi');
  });

  it('keeps full screenshot portfolio parsing', () => {
    expect(kimi).toContain('export async function parsePortfolioImages');
  });

  it('keeps option-detail screenshot parsing', () => {
    expect(kimi).toContain('export async function parseOptionDetailImages');
  });

  it('keeps the screenshot import panel wired into holdings', () => {
    expect(app).toContain('ImageImportPanel');
  });

  it('keeps imported image results routed to the dashboard', () => {
    expect(app).toContain("setLastImport({ mode: 'full', result });");
  });
});
