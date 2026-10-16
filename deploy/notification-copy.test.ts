import { describe, expect, it } from 'vitest';
import {
  buildNotificationPreviewEvents,
  formatCnnPositionFloorNotification,
  formatTqqqEntryNotification,
  formatValuationNotification,
  formatVixPositionFloorNotification,
} from './notification-copy.mjs';

function sentenceCount(value: string): number {
  return value.split(/[。！？]+/u).filter((item) => item.trim()).length;
}

const previewSnapshot = {
  symbols: Object.fromEntries(Object.entries({
    NVDA: 223.96,
    TQQQ: 74.47,
    MSFT: 524.11,
    GOOG: 353.47,
    AMZN: 231.44,
    AAPL: 229.35,
    META: 772.08,
    FNGU: 36.55,
    PDD: 32.5,
  }).map(([symbol, current_price]) => [symbol, {
    market_price: { available: true, current_price, basis: 'asset' },
  }])),
};

describe('attention-first mobile notification copy', () => {
  it('keeps every preview card to one line and at most two short sentences', () => {
    const events = buildNotificationPreviewEvents(previewSnapshot);

    expect(events).toHaveLength(10);
    for (const event of events) {
      expect(event.title).not.toMatch(/SELL_ALERT|BUY_READY/);
      expect(event.body).not.toContain('\n');
      expect(event.body.length).toBeLessThanOrEqual(100);
      expect(sentenceCount(event.body)).toBeLessThanOrEqual(2);
      expect(event.body).not.toContain('只提醒不下单，请在券商 App');
      if (!/CNN|VIX/u.test(event.title)) expect(`${event.title} ${event.body}`).toMatch(/\$\d/u);
      expect(event.title).not.toContain('TSLA');
    }
    expect(events.find((event) => event.title.includes('TQQQ'))?.title).toContain('$74.47');
    expect(events.map((event) => `${event.title} ${event.body}`).join('\n')).not.toMatch(
      /接近卖点|可卖|保守兑现|中位兑现|乐观兑现|接近目标|已到目标/u,
    );
    expect(events.map((event) => event.body).join('\n')).not.toContain('$121.00');
  });

  it('encourages users at the VIX 35 and 40 position floors', () => {
    expect(formatVixPositionFloorNotification({ vix: 35, current_pct: 48, target_pct: 60 })).toEqual({
      key: 'vix-position-floor:35:60',
      title: '🟢 VIX 35.00 · 恐慌加仓',
      body: '当前总仓位 48.00%，目标 60%；不要害怕，按计划补足 12.00%。',
    });
    expect(formatVixPositionFloorNotification({ vix: 40, current_pct: 65, target_pct: 70 })).toEqual({
      key: 'vix-position-floor:40:70',
      title: '🟢 VIX 40.00 · 极恐加仓',
      body: '当前总仓位 65.00%，目标 70%；不要害怕，按计划补足 5.00%。',
    });
  });

  it('keeps the CNN 20 overall-position reminder concise', () => {
    expect(formatCnnPositionFloorNotification({ cnn_score: 20, current_pct: 48, target_pct: 60 })).toEqual({
      key: 'cnn-position-floor:20:60',
      title: '🟢 CNN 20.00 · 仓位不足',
      body: '当前总仓位 48.00%，目标 60%；请尽量补足剩余 12.00%。',
    });
  });

  it('uses 20% plus 1% normally and 35% plus 3% below CNN 15', () => {
    const base = {
      benchmark: 'QQQ', drawdown_pct: 11.25, threshold_pct: 11,
      option_position_limit_pct: 1, current_price: 74.47,
    };
    expect(formatTqqqEntryNotification({ ...base, cnn_score: 20 })).toEqual(expect.objectContaining({
      title: '🟢 TQQQ · 第一档可买 · $74.47',
      body: 'QQQ 回撤 11.25%；目标：TQQQ 总仓位 20%，期权总仓位 1%。',
    }));
    expect(formatTqqqEntryNotification({ ...base, cnn_score: 14.99 })).toEqual(expect.objectContaining({
      title: '🟢 TQQQ · 极恐可买 · $74.47',
      body: 'CNN 14.99＜15；目标：TQQQ 总仓位 35%，期权总仓位 3%。',
    }));
  });

  it('uses the website valuation zone as the complete mobile instruction', () => {
    expect(formatValuationNotification('MSFT', {
      current: 24.8, zone: 'low', icon: '🟢', label: '低估值买入',
      message: '按计划分批买入或继续持有。', available: true, stale: false,
    }, 524.11)).toEqual(expect.objectContaining({
      title: '🟢 MSFT · 低估值 · $524.11',
      body: '远期 PE 24.80；按计划分批买入或继续持有。',
    }));
    expect(formatValuationNotification('MSFT', {
      current: 24.8, zone: 'low', available: true, stale: false,
    }, null)).toBeNull();
    expect(formatValuationNotification('TSLA', {
      current: 33.2, zone: 'ultra_high', available: true, stale: false,
    }, 328.58)).toBeNull();
  });

  it('collapses every PE above 30 into one direct sell-point notification', () => {
    for (const zone of ['high', 'ultra_high']) {
      expect(formatValuationNotification('NVDA', {
        current: zone === 'high' ? 30 : 33, zone, available: true, stale: false,
      }, 223.96)).toEqual(expect.objectContaining({
        title: expect.stringContaining('NVDA · PE卖点 · $223.96'),
      }));
    }
  });
});
