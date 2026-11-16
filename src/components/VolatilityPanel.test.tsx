import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VolatilityPanel } from './VolatilityPanel';
import type { VolatilityData, VolatilityItem } from '../volatilityIndex';

// Recharts 3 挂载后才画图，静态渲染展开不了图表内部：换成替身，看图表里放了什么、传了什么。真实效果在浏览器里验。
vi.mock('recharts', () => {
  const nothing = () => null;
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div className="recharts-responsive-container">{children}</div>,
    LineChart: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
    CartesianGrid: nothing,
    Line: nothing,
    Tooltip: nothing,
    XAxis: nothing,
    YAxis: nothing,
    ReferenceLine: ({ y, stroke, strokeDasharray, ifOverflow, label }: {
      y: number; stroke: string; strokeDasharray: string; ifOverflow: string; label: { value: ReactNode };
    }) => <g data-buy-line={y} data-stroke={stroke} data-dash={strokeDasharray} data-overflow={ifOverflow}>{label.value}</g>,
  };
});

const item = (overrides: Partial<VolatilityItem>): VolatilityItem => ({
  key: 'VXSMH', name: '半导体', symbol: '^VXSMH', price: 65.89, changePercent: 43.8,
  quoteTime: '2026-11-05T21:02:02.000Z',
  series: [{ date: '2026-11-04', close: 45.82 }, { date: '2026-11-05', close: 65.89 }],
  ...overrides,
});
const data: VolatilityData = {
  time: '2026-11-05T21:30:00.000Z',
  items: [
    item({}),
    item({ key: 'VXN', name: '纳指', symbol: '^VXN', price: 38.26, changePercent: -2.5 }),
    item({ key: 'VIX', name: '标普', symbol: '^VIX', price: null, changePercent: null }),
  ],
};
const render = (props: Partial<Parameters<typeof VolatilityPanel>[0]> = {}) => renderToStaticMarkup(
  <VolatilityPanel data={data} stale={false} {...props} />,
);

describe('日志页的恐慌指数', () => {
  it('报价条：三个指数的当前值和涨跌', () => {
    const html = render();

    expect(html).toContain('data-volatility-panel="true"');
    for (const key of ['VXSMH', 'VXN', 'VIX']) expect(html).toContain(`data-volatility-symbol="${key}"`);
    expect(html).toContain('65.89');
    expect(html).toContain('+43.80%');
    expect(html).toContain('38.26');
    expect(html).toContain('-2.50%');
    expect(html).toContain('暂无');
  });

  it('恐慌指数涨是坏事：涨标红，跌标绿，和 VIX 卡片一致', () => {
    const html = render();

    expect(html).toMatch(/text-loss[^>]*>\+43\.80%/);
    expect(html).toMatch(/text-gain[^>]*>-2\.50%/);
  });

  it('默认看 VXSMH 一年日线，按钮标明选中', () => {
    const html = render();

    expect(html).toContain('data-volatility-chart="VXSMH"');
    expect(html).toContain('VXSMH 半导体恐慌指数 · 一年日线');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-volatility-symbol="VXSMH"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-volatility-symbol="VXN"/);
    expect(html).toContain('recharts');
  });

  it('标明数据时间和来源', () => {
    const html = render();

    expect(html).toContain('数据时间 美东 11-05 16:02');
    expect(html).toContain('Yahoo');
    expect(html).toContain('Cboe');
    expect(html).not.toContain('数据延迟');
  });

  it('断开太久标「数据延迟」，上一份数字还留着', () => {
    const html = render({ stale: true });

    expect(html).toContain('数据延迟');
    expect(html).toContain('65.89');
  });

  it('没有日线写「走势暂无」，不画空图', () => {
    const html = render({ data: { ...data, items: [item({ series: [] })] } });

    expect(html).toContain('走势暂无');
    expect(html).not.toContain('recharts');
  });

  it('还没数据时显示读取中，失败时说清楚', () => {
    expect(render({ data: null })).toContain('恐慌指数读取中');
    expect(render({ data: null, failed: true })).toContain('恐慌指数读取失败，稍后自动重试');
  });

  describe('买点线', () => {
    const only = (overrides: Partial<VolatilityItem>) => ({ ...data, items: [item(overrides)] });

    it('走势图上有一条横着的虚线，标明买点数值', () => {
      const html = render();

      expect(html).toContain('data-buy-line="55"');
      expect(html).toContain('data-dash="5 5"');
      expect(html).toContain('data-stroke="var(--color-loss)"');
      expect(html).toContain('买点 55');
    });

    it('走势还没碰到线也要把线画出来', () => {
      const html = render({
        data: only({ key: 'VXN', name: '纳指', symbol: '^VXN', price: 25, series: [{ date: '2026-11-04', close: 20 }, { date: '2026-11-05', close: 25 }] }),
      });

      expect(html).toContain('data-buy-line="30"');
      expect(html).toContain('data-overflow="extendDomain"');
      expect(html).toContain('买点 30');
    });

    const smh = (zScore: number, close = 300, lowerBand = 280) => ({
      symbol: 'SMH', asOf: '2026-11-05', close, lowerBand, zScore,
    });

    it('恐慌到线且 SMH 击穿通道下沿：格子和图都变红，写明已到买点', () => {
      const html = render({ data: only({ underlying: smh(-1.8, 270, 280) }) });

      expect(html).toMatch(/data-volatility-symbol="VXSMH"[^>]*bg-loss\/10/);
      expect(html).toContain('已到买点 · SMH 破下沿');
      expect(html).toContain('SMH 低于下沿 3.6%');
      expect(html).toMatch(/data-volatility-box="true"[^>]*bg-loss\/10/);
      expect(html).toContain('已到买点：≥ 55 且 SMH 击穿通道下沿');
    });

    it('恐慌到线但 SMH 还在通道里（只是波动大）：不变红，写明不是买点和离下沿多远', () => {
      const html = render({ data: only({ underlying: smh(-0.4, 308, 280) }) });

      expect(html).not.toContain('bg-loss/10');
      expect(html).toContain('≥ 55 但 SMH 未破下沿');
      expect(html).toContain('SMH 离下沿 +10.0%');
      expect(html).toContain('波动到线，但 SMH 还在通道内（SMH 离下沿 +10.0%）· 不是买点');
      expect(html).not.toContain('已到买点');
    });

    it('SMH 已破下沿但恐慌没到线：写明在等恐慌，不标红', () => {
      const html = render({ data: only({ price: 40, underlying: smh(-1.6, 275, 280) }) });

      expect(html).not.toContain('bg-loss/10');
      expect(html).toContain('SMH 已破下沿 · 待 ≥ 55');
    });

    it('没到线：不变红，写清两个条件', () => {
      const html = render({ data: only({ price: 40, underlying: smh(0.3) }) });

      expect(html).not.toContain('bg-loss/10');
      expect(html).toContain('买点 ≥ 55 且 SMH 破下沿');
      expect(html).not.toContain('已到买点');
    });

    it('通道数据缺：到线也不算买点，不标红', () => {
      const html = render();

      expect(html).not.toContain('bg-loss/10');
      expect(html).toContain('ETF 通道暂无');
      expect(html).not.toContain('已到买点');
    });

    it('图下说明红点和灰圈的意思', () => {
      const html = render({ data: only({ underlying: smh(-0.4) }) });

      expect(html).toContain('红点：≥ 55 且 SMH 击穿 200 日均线 −1.5σ 通道下沿，才算买点');
      expect(html).toContain('灰圈：只是波动到线，SMH 价格没破下沿，不买');
    });
  });
});
