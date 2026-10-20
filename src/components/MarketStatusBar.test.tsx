import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketStatusBar } from './MarketStatusBar';

const cards = [
  { key: 'qqq' as const, label: 'QQQ', value: '712.30', detail: '离前高 -6.2%', tone: 'warn' as const },
  { key: 'vix' as const, label: 'VIX', value: '21.96', detail: '较昨收 +33.4% ↑', tone: 'warn' as const },
  { key: 'cnn' as const, label: 'CNN', value: '18', detail: '较上次 -10 ↓', tone: 'warn' as const },
  { key: 'important' as const, label: '今日重要', value: '2', detail: '条', tone: 'warn' as const },
  { key: 'session' as const, label: '当前时段', value: '盘中', detail: '美东交易时段', tone: 'muted' as const },
];

describe('日志页顶部实时状态条', () => {
  it('五张卡片都在，并标注数据时间', () => {
    const html = renderToStaticMarkup(
      <MarketStatusBar cards={cards} dataTime="2026-10-20T13:40:12.000Z" stale={false} />,
    );

    expect(html).toContain('data-market-status-bar="true"');
    for (const card of cards) {
      expect(html).toContain(card.label);
      expect(html).toContain(card.value);
      expect(html).toContain(card.detail);
    }
    expect(html).toContain('数据时间 21:40:12');
    expect(html).not.toContain('数据延迟');
  });

  it('数据源断开时显示「数据延迟」，上一份数字还留着', () => {
    const html = renderToStaticMarkup(
      <MarketStatusBar cards={cards} dataTime="2026-10-20T13:40:12.000Z" stale />,
    );

    expect(html).toContain('数据延迟');
    expect(html).toContain('712.30');
  });

  it('还没拿到数据时不假装有时间', () => {
    const html = renderToStaticMarkup(<MarketStatusBar cards={cards} dataTime={null} stale={false} />);

    expect(html).toContain('数据时间 暂无');
  });
});
