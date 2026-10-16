/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';
import summarySource from './components/Summary.tsx?raw';
import themeSource from './components/ThemeControl.tsx?raw';
import valuationPanelSource from './components/ValuationPanel.tsx?raw';
import decisionWorkspaceSource from './components/DecisionWorkspace.tsx?raw';
import { readFileSync } from 'node:fs';
const styles = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

describe('header stays compact on a phone', () => {
  it('keeps tablet controls on two rows and releases sticky navigation on short landscape screens', () => {
    const header = appSource.slice(appSource.indexOf('<header'), appSource.indexOf('</header>'));
    expect(header).toContain('xl:flex-row');
    expect(header).not.toContain('md:flex-row');
    expect(header).toContain('xl:contents');
    expect(styles).toMatch(/@media \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.portfolio-header\s*\{\s*position: static/);
  });
  it('puts the theme control on the title row instead of its own full-width row', () => {
    // Measured before: the header ate 29% of a 375x812 screen because the
    // theme picker was stretched to 343px on a row of its own.
    const titleRow = appSource.indexOf('我的投资组合');
    const themeControl = appSource.indexOf('<ThemeControl />');
    const nav = appSource.indexOf('<nav');

    expect(titleRow).toBeGreaterThan(-1);
    expect(themeControl).toBeGreaterThan(titleRow);
    expect(themeControl).toBeLessThan(nav);
  });

  it('never stretches the theme control to the full row width', () => {
    expect(themeSource).toContain('w-fit');
    expect(themeSource).toContain('shrink-0');
  });

  it('六个标签：日志排在卖出和设置之间，退役页面没有回来', () => {
    expect(appSource.match(/<TabBtn/g)).toHaveLength(6);
    expect(appSource).not.toContain('label="条件查询"');
    expect(appSource).not.toContain('label={<>持仓');

    const dashboard = appSource.indexOf('label="总览"');
    const rotation = appSource.indexOf('label="板块轮动"');
    const valuation = appSource.indexOf('label="决策"');
    const calculator = appSource.indexOf('label="卖出"');
    const journal = appSource.indexOf('label="日志"');
    const settings = appSource.indexOf('label="设置"');
    expect(dashboard).toBeGreaterThan(-1);
    expect(rotation).toBeGreaterThan(dashboard);
    expect(valuation).toBeGreaterThan(rotation);
    expect(calculator).toBeGreaterThan(valuation);
    expect(journal).toBeGreaterThan(calculator);
    expect(settings).toBeGreaterThan(journal);
  });

  it('导航格子跟着标签数量一起改成 6 列，滑块宽度也是 1/6', () => {
    const nav = appSource.slice(appSource.indexOf('<nav'), appSource.indexOf('</nav>'));
    expect(nav).toContain('grid-cols-6');
    expect(nav).not.toContain('grid-cols-5');
    expect(nav).toContain('w-[calc((100%_-_0.25rem)/6)]');
    expect(nav).toContain('sm:w-[calc((100%_-_0.5rem)/6)]');
  });

  it('moves manual holdings maintenance into a collapsed section at the bottom of settings', () => {
    const settingsBranch = appSource.slice(appSource.indexOf("{tab === 'settings' && ("), appSource.indexOf("{tab === 'valuation' && ("));

    expect(settingsBranch).toContain('<summary');
    expect(settingsBranch).toContain('持仓与手动维护');
    expect(settingsBranch).toContain('<ImageImportPanel');
    expect(settingsBranch).toContain('<HoldingsTable');
    expect(settingsBranch).toContain('<SellWindowSection');
    expect(settingsBranch).toContain('<CashEditor');
    expect(appSource).not.toContain("tab === 'holdings'");
  });

  it('keeps every top-navigation destination at least 44px tall', () => {
    const tabButtonSource = appSource.slice(appSource.indexOf('function TabBtn'));
    expect(tabButtonSource).toContain('min-h-11');
  });

  it('keeps the PE history explorer on both the decision and sell pages', () => {
    const sellBranch = appSource.slice(
      appSource.indexOf("{tab === 'calculator' && privateDataState === 'ready' && ("),
      appSource.indexOf("{tab === 'settings' && ("),
    );

    expect(valuationPanelSource).toContain('<DecisionWorkspace');
    expect(decisionWorkspaceSource).toContain('<StockForwardValuationExplorer');
    expect(sellBranch).toContain('<StockForwardValuationExplorer');
  });

  it('places the slope curves before the PE valuation explorer on the decision page', () => {
    const valuation = decisionWorkspaceSource.indexOf('<StockForwardValuationExplorer');
    const slope = decisionWorkspaceSource.indexOf('<MaSlopeExplorer');

    expect(slope).toBeGreaterThan(-1);
    expect(valuation).toBeGreaterThan(slope);
  });

  it('uses a denser phone header while retaining the full desktop description', () => {
    expect(appSource).toContain('text-lg font-semibold sm:text-3xl');
    expect(appSource).toContain('三券商自动同步');
    expect(appSource).toContain('hidden sm:inline');
    expect(appSource).toContain('mb-2');
    expect(appSource).toContain('sm:mb-6');
  });

  it('groups phone utilities into one light toolbar instead of three oversized boxes', () => {
    expect(appSource).toContain('data-testid="mobile-header-tools"');
    expect(appSource).toContain('rounded-xl bg-surface-raised/75 p-0.5');
    expect(themeSource).toContain('appearance-none');
  });

  it('moves currency and the combined data sync beside the theme control on every viewport', () => {
    const titleRow = appSource.indexOf('我的投资组合');
    const currencyControl = appSource.indexOf('aria-label="显示货币"');
    const syncControl = appSource.indexOf('同步数据');
    const nav = appSource.indexOf('<nav');

    expect(currencyControl).toBeGreaterThan(titleRow);
    expect(syncControl).toBeGreaterThan(titleRow);
    expect(currencyControl).toBeLessThan(nav);
    expect(syncControl).toBeLessThan(nav);
    expect(summarySource).not.toContain('行情同步：');
    expect(summarySource).not.toContain('量化系统同步：');
    expect(summarySource).not.toContain('显示货币：');
  });

  it('does not render the automatic quant-sync success banner', () => {
    expect(appSource).not.toContain("'量化系统持仓已同步'");
    expect(appSource).not.toContain("notice.mode === 'quant' ? '撤销本次同步'");
  });
});
