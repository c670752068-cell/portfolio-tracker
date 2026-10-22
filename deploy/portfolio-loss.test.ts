import { describe, expect, it } from 'vitest';
import { PORTFOLIO_LOSS_TIERS, portfolioDayLoss, portfolioLossAlerts } from './portfolio-loss.mjs';

const positions = [
  { symbol: 'TQQQ', qty: 215, asset_type: 'stock' },
  { symbol: 'SOXL', qty: 30, asset_type: 'stock' },
  { symbol: 'TSLL', qty: 100, asset_type: 'stock' },
  { symbol: 'NVDA', qty: 20, asset_type: 'stock' },
];
const quotes = {
  TQQQ: { price: 69.19, previousClose: 72.61 },
  SOXL: { price: 93.55, previousClose: 103.24 },
  TSLL: { price: 9.9, previousClose: 10.52 },
  NVDA: { price: 221.97, previousClose: 216.47 },
};

describe('持仓今日预估盈亏', () => {
  it('按最新价减昨收乘数量，算出金额、占比和亏得最多的三个', () => {
    const loss = portfolioDayLoss({ positions, quotes, nav: 190_000 });

    // TQQQ -735.3, SOXL -290.7, TSLL -62, NVDA +110
    expect(loss.pnl).toBeCloseTo(-978, 0);
    expect(loss.pct).toBeCloseTo(-0.51, 2);
    expect(loss.losers.map((item) => item.symbol)).toEqual(['TQQQ', 'SOXL', 'TSLL']);
    expect(loss.missing).toEqual([]);
  });

  it('没有报价的标的算不进去，单独列出来', () => {
    const loss = portfolioDayLoss({
      positions, quotes: { TQQQ: quotes.TQQQ }, nav: 190_000,
    });

    expect(loss.missing).toEqual(['SOXL', 'TSLL', 'NVDA']);
    expect(loss.pnl).toBeCloseTo(-735.3, 1);
  });

  it('没有总资产或没有持仓时算不出占比', () => {
    expect(portfolioDayLoss({ positions, quotes, nav: 0 }).pct).toBeNull();
    expect(portfolioDayLoss({ positions: [], quotes, nav: 190_000 }).pnl).toBe(0);
  });

  it('期权按合约乘数 100 算', () => {
    const loss = portfolioDayLoss({
      positions: [{ symbol: 'NVDA', qty: 2, asset_type: 'option' }],
      quotes: { NVDA: { price: 5, previousClose: 6 } },
      nav: 100_000,
    });
    expect(loss.pnl).toBeCloseTo(-200, 6);
  });
});

describe('持仓浮亏提醒', () => {
  const loss = {
    pnl: -3_450, pct: -1.8, nav: 190_000,
    losers: [{ symbol: 'TQQQ', pnl: -2000 }, { symbol: 'SOXL', pnl: -1000 }, { symbol: 'TSLL', pnl: -450 }],
    missing: [],
  };

  it('两档阈值：-2% 普通、-4% 重要', () => {
    expect(PORTFOLIO_LOSS_TIERS).toEqual([2, 4]);
    expect(portfolioLossAlerts({ loss, session: 'overnight', firedKeys: new Set(), day: '2026-10-22' })).toEqual([]);

    const [alert] = portfolioLossAlerts({
      loss: { ...loss, pct: -2.1 }, session: 'overnight', firedKeys: new Set(), day: '2026-10-22',
    });
    expect(alert).toMatchObject({ kind: 'portfolio_loss', level: 'normal', icon: '💼', category: 'position' });
    expect(alert.text).toBe('[夜盘] 持仓今日预估 -$3,450（-2.10%）· 主要来自 TQQQ、SOXL、TSLL · 可以去看看是否加仓');

    const deep = portfolioLossAlerts({
      loss: { ...loss, pct: -4.2 }, session: 'overnight', firedKeys: new Set(), day: '2026-10-22',
    });
    expect(deep.map((item) => item.level)).toEqual(['normal', 'important']);
  });

  it('每档每个交易日只报一次', () => {
    const fired = new Set(['portfolio-loss:2:2026-10-22']);
    expect(portfolioLossAlerts({
      loss: { ...loss, pct: -2.1 }, session: 'overnight', firedKeys: fired, day: '2026-10-22',
    })).toEqual([]);
  });

  it('有标的没夜盘报价时在文案里写明', () => {
    const [alert] = portfolioLossAlerts({
      loss: { ...loss, pct: -2.1, missing: ['AVL', 'IGV'] },
      session: 'overnight', firedKeys: new Set(), day: '2026-10-22',
    });
    expect(alert.text).toContain('AVL、IGV 无夜盘报价，按最后价格计算');
  });

  it('赚钱或算不出占比时不报', () => {
    expect(portfolioLossAlerts({ loss: { ...loss, pct: 1.2 }, session: 'overnight', firedKeys: new Set(), day: 'x' })).toEqual([]);
    expect(portfolioLossAlerts({ loss: { ...loss, pct: null }, session: 'overnight', firedKeys: new Set(), day: 'x' })).toEqual([]);
  });
});
