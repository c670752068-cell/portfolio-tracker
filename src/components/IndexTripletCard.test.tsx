import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndexTripletCard } from './IndexTripletCard';
import type { IndexQuotes } from '../indexQuotes';

const quotes: IndexQuotes = {
  session: 'regular',
  time: '2026-10-21T16:26:52.000Z',
  refreshMs: 10000,
  source: 'Yahoo Finance',
  items: [
    { key: 'nasdaq', name: '纳斯达克', symbol: '^IXIC', futures: false, price: 26687.643, changePercent: 0.9947, quoteTime: '2026-10-21T16:26:50.000Z', delayMinutes: 0 },
    { key: 'sp500', name: '标普500', symbol: '^GSPC', futures: false, price: 7748.39, changePercent: 0.4645, quoteTime: '2026-10-21T16:26:52.000Z', delayMinutes: 0 },
    { key: 'dow', name: '道琼斯', symbol: '^DJI', futures: false, price: 52644.85, changePercent: -0.2838, quoteTime: '2026-10-21T16:26:51.000Z', delayMinutes: 0 },
  ],
};

const futures: IndexQuotes = {
  ...quotes,
  session: 'post',
  refreshMs: 30000,
  items: quotes.items.map((item, index) => ({
    ...item,
    name: ['纳指期货', '标普期货', '道指期货'][index],
    futures: true,
    delayMinutes: 10,
  })),
};

describe('三大指数卡片', () => {
  it('一张卡片三行，带涨跌幅和颜色', () => {
    const html = renderToStaticMarkup(<IndexTripletCard quotes={quotes} stale={false} flash={{}} />);

    expect(html).toContain('data-index-card="true"');
    expect(html).toContain('纳斯达克');
    expect(html).toContain('标普500');
    expect(html).toContain('道琼斯');
    expect(html).toContain('+0.99%');
    expect(html).toContain('-0.28%');
    expect(html).toContain('text-gain');
    expect(html).toContain('text-loss');
    expect(html).not.toContain('期货');
  });

  it('盘后显示期货并标明延迟分钟', () => {
    const html = renderToStaticMarkup(<IndexTripletCard quotes={futures} stale={false} flash={{}} />);

    expect(html).toContain('纳指期货');
    expect(html).toContain('期货');
    expect(html).toContain('延迟 10 分钟');
  });

  it('超过 2 分钟没新数据时标「数据延迟」，旧数字还留着', () => {
    const html = renderToStaticMarkup(<IndexTripletCard quotes={quotes} stale flash={{}} />);

    expect(html).toContain('数据延迟');
    expect(html).toContain('26687.64');
  });

  it('涨跌幅变化时那一行带闪动的类名', () => {
    const html = renderToStaticMarkup(
      <IndexTripletCard quotes={quotes} stale={false} flash={{ nasdaq: 'up', dow: 'down' }} />,
    );

    expect(html).toContain('index-flash-up');
    expect(html).toContain('index-flash-down');
  });

  it('拿不到数字时写「暂无」，不画 0', () => {
    const empty: IndexQuotes = { ...quotes, items: quotes.items.map((item) => ({ ...item, price: null, changePercent: null })) };
    const html = renderToStaticMarkup(<IndexTripletCard quotes={empty} stale={false} flash={{}} />);

    expect(html).toContain('暂无');
    expect(html).not.toContain('0.00%');
  });
});
