import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PanicDropLog } from './PanicDropLog';
import type { PanicDrop } from '../panicDrop';

const panicDay = { date: '2026-11-05', sp500: -4.36, dow: -3.44, nasdaq: -5.52, panic: true };
const quietDay = { date: '2026-11-04', sp500: 1.58, dow: 3.03, nasdaq: 1.44, panic: false };
const open: PanicDrop = {
  asOf: '2026-11-05', windowOpen: true, anchorClose: 6900.5, recoveredOn: null, lastPanic: panicDay, days: [panicDay, quietDay],
};

describe('每日收盘记录', () => {
  it('恐慌窗口开着：写清哪天、跌多少、收回多少就关', () => {
    const html = renderToStaticMarkup(<PanicDropLog panic={open} />);

    expect(html).toContain('data-panic-log="true"');
    expect(html).toContain('恐慌性下跌 11-05');
    expect(html).toContain('标普 -4.36%');
    expect(html).toContain('标普收回 6,901 前仓位可超 30%');
  });

  it('没有恐慌：明说当前没有，并写上次是什么时候', () => {
    const html = renderToStaticMarkup(
      <PanicDropLog panic={{ ...open, windowOpen: false, anchorClose: null, recoveredOn: '2026-11-20', days: [quietDay] }} />,
    );

    expect(html).toContain('当前没有恐慌性下跌');
    expect(html).toContain('上次 11-05，11-20 已收复');
  });

  it('写明判定标准', () => {
    expect(renderToStaticMarkup(<PanicDropLog panic={open} />)).toContain('标普收盘跌 3% 以上，且道指、纳指同跌才算');
  });

  it('每天一行：标普、道指、纳指的收盘涨跌，恐慌那天标出来', () => {
    const html = renderToStaticMarkup(<PanicDropLog panic={open} />);

    expect(html).toContain('-4.36%');
    expect(html).toContain('-3.44%');
    expect(html).toContain('-5.52%');
    expect(html).toContain('+1.58%');
    expect(html).toMatch(/data-panic-day="2026-11-05"[^>]*bg-loss/);
    expect(html).not.toMatch(/data-panic-day="2026-11-04"[^>]*bg-loss/);
  });

  it('数据拿不到时说暂无，不说没有恐慌', () => {
    const html = renderToStaticMarkup(
      <PanicDropLog panic={{ asOf: null, windowOpen: null, anchorClose: null, recoveredOn: null, lastPanic: null, days: [] }} />,
    );

    expect(html).toContain('恐慌性下跌 暂无数据');
    expect(html).not.toContain('当前没有恐慌性下跌');
  });
});
