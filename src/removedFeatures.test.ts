import { describe, expect, it } from 'vitest';
import app from './App.tsx?raw';
import buyDecisionSection from './components/BuyDecisionSection.tsx?raw';
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

  it('has no raw buy-condition evidence block', () => {
    expect(buyDecisionSection).not.toContain('原始条件证据');
    expect(buyDecisionSection).not.toContain('市场条件满足');
    expect(buyDecisionSection).not.toContain('估值位置（参考，不参与开窗）');
  });

  it('has no conditions tab', () => {
    expect(app).not.toContain("'conditions'");
    expect(app).not.toContain('条件查询');
    expect(app).not.toContain('ConditionLookup');
  });
});
