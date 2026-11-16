import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { easternText } from '../alertLog';
import { changeText } from '../indexQuotes';
import { CountUpText } from './CountUpText';
import {
  VOLATILITY_DEFAULT_KEY, buySignal, latestQuoteTime, lowerBandGap, pickVolatilityItem, pointBuyState, useVolatility,
  volatilityBuyLine,
  type BuyState, type VolatilityData, type VolatilityItem, type VolatilityPoint,
} from '../volatilityIndex';

const CHART_HEIGHT = 140;
const AXIS_TICK = { fill: 'var(--color-ink-muted)', fontSize: 10 };
const TOOLTIP_STYLE = {
  background: 'var(--color-surface-raised)',
  border: '1px solid color-mix(in srgb, var(--color-neutral) 55%, transparent)',
  borderRadius: 12, color: 'var(--color-ink-primary)', fontSize: 12,
} as const;

/** 恐慌指数涨是坏事：涨标红，跌标绿，和 VIX 卡片一致。 */
function changeTone(value: number | null): string {
  if (value === null || value === 0) return 'text-ink-muted';
  return value > 0 ? 'text-loss' : 'text-gain';
}

/** ETF 离通道下沿多远，一眼看出是擦边还是离得还远。 */
function gapText(item: VolatilityItem): string | null {
  const gap = lowerBandGap(item.underlying);
  const etf = item.underlying?.symbol;
  if (gap === null || !etf) return null;
  return gap <= 0 ? `${etf} 低于下沿 ${Math.abs(gap).toFixed(1)}%` : `${etf} 离下沿 +${gap.toFixed(1)}%`;
}

/** 格子第三行：价格优先，恐慌到线但价格没破下沿不算买点。 */
function cardStatus(item: VolatilityItem, state: BuyState, line: number): string {
  const etf = item.underlying?.symbol ?? 'ETF';
  switch (state) {
    case 'buy': return `已到买点 · ${etf} 破下沿`;
    case 'wait_price': return `≥ ${line} 但 ${etf} 未破下沿`;
    case 'wait_fear': return `${etf} 已破下沿 · 待 ≥ ${line}`;
    case 'unknown': return `≥ ${line} · ${etf} 通道暂无`;
    default: return `买点 ≥ ${line} 且 ${etf} 破下沿`;
  }
}

/** 图框标题右边那句：只有真买点才标红。 */
function boxStatus(item: VolatilityItem, state: BuyState, line: number | null): string | null {
  if (line === null) return null;
  const etf = item.underlying?.symbol ?? 'ETF';
  const gap = gapText(item);
  if (state === 'buy') return `已到买点：≥ ${line} 且 ${etf} 击穿通道下沿`;
  if (state === 'wait_price') return `波动到线，但 ${etf} 还在通道内${gap ? `（${gap}）· ` : ' · '}不是买点`;
  if (state === 'wait_fear') return `${etf} 已击穿下沿，恐慌未到 ${line}`;
  if (state === 'unknown') return `已到 ${line}，${etf} 通道数据暂缺，先不算买点`;
  return null;
}

/** 恐慌到线的那几天打点：红点 = ETF 同时击穿下沿（真买点），灰圈 = 只是波动大。 */
function buyDot(line: number | null) {
  return function BuyDot(raw: unknown) {
    const props = (raw ?? {}) as { cx?: number; cy?: number; index?: number; payload?: VolatilityPoint };
    const key = `buy-dot-${props.index ?? 0}`;
    const state = props.payload ? pointBuyState(props.payload, line) : null;
    if (state === null || typeof props.cx !== 'number' || typeof props.cy !== 'number') return <g key={key} />;
    return state === 'buy'
      ? <circle key={key} data-dot="buy" cx={props.cx} cy={props.cy} r={3} fill="var(--color-loss)" stroke="none" />
      : <circle key={key} data-dot="fear-only" cx={props.cx} cy={props.cy} r={2.5} fill="var(--color-surface-overlay)" stroke="var(--color-ink-muted)" strokeWidth={1} />;
  };
}

function VolatilityChart({ item }: { item: VolatilityItem }) {
  const buyLine = volatilityBuyLine(item.key);
  const etf = item.underlying?.symbol ?? null;
  if (item.series.length === 0) {
    return <p className="flex items-center justify-center text-[11px] text-ink-muted" style={{ height: CHART_HEIGHT }}>走势暂无</p>;
  }
  return (
    <div data-volatility-chart={item.key}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={{ width: 340, height: CHART_HEIGHT }}>
        <LineChart data={item.series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.18} vertical={false} />
          <XAxis dataKey="date" scale="point" tickFormatter={(value) => String(value).slice(2, 7)} minTickGap={44} tick={AXIS_TICK} interval="preserveStartEnd" />
          <YAxis width={28} tick={AXIS_TICK} domain={['auto', 'auto']} tickFormatter={(value) => Number(value).toFixed(0)} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, _name, entry) => {
              const z = (entry?.payload as VolatilityPoint | undefined)?.z;
              const zText = etf && typeof z === 'number' ? ` · ${etf} Z ${z.toFixed(2)}${z <= -1.5 ? '（破下沿）' : ''}` : '';
              return [`${Number(value).toFixed(2)}${zText}`, item.key];
            }}
            labelFormatter={(value) => `日期 ${value}`}
          />
          <Line type="linear" dataKey="close" stroke="var(--color-ink-primary)" strokeWidth={1.5} dot={buyDot(buyLine)} isAnimationActive={false} />
          {buyLine !== null && (
            <ReferenceLine
              y={buyLine}
              stroke="var(--color-loss)"
              strokeDasharray="5 5"
              ifOverflow="extendDomain"
              label={{ value: `买点 ${buyLine}`, fill: 'var(--color-loss)', fontSize: 10, position: 'insideBottomLeft' }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 日志页的恐慌指数：上面三个报价（点一下切换走势图），下面一年日线。 */
export function VolatilityPanel({ data, stale, failed = false }: {
  data: VolatilityData | null;
  stale: boolean;
  failed?: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState(VOLATILITY_DEFAULT_KEY);
  const current = pickVolatilityItem(data?.items ?? [], selectedKey);
  if (!data || !current) {
    return (
      <section
        data-volatility-panel="true"
        aria-label="恐慌指数"
        className="flex min-h-[13rem] items-center justify-center rounded-xl border border-neutral/35 bg-surface-overlay text-[11px] text-ink-muted"
      >
        {failed ? '恐慌指数读取失败，稍后自动重试' : '恐慌指数读取中…'}
      </section>
    );
  }
  const dataTime = latestQuoteTime(data.items);
  const currentLine = volatilityBuyLine(current.key);
  const currentState = buySignal(current);
  const currentBuy = currentState === 'buy';
  const currentStatus = boxStatus(current, currentState, currentLine);
  const currentEtf = current.underlying?.symbol ?? null;
  return (
    <section data-volatility-panel="true" aria-label="恐慌指数" className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        {data.items.map((item) => {
          const selected = item.key === current.key;
          const line = volatilityBuyLine(item.key);
          const state = buySignal(item);
          // 只有真买点（恐慌到线且 ETF 破下沿）才标红；只是波动大不标红
          const reached = state === 'buy';
          const gap = gapText(item);
          const border = selected ? 'border-buy/70' : reached ? 'border-loss/40' : 'border-neutral/35 hover:border-neutral/70';
          const background = reached ? 'bg-loss/10' : selected ? 'bg-buy/10' : 'bg-surface-overlay';
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={selected}
              data-volatility-symbol={item.key}
              onClick={() => setSelectedKey(item.key)}
              className={`min-w-0 rounded-xl border px-2 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-buy ${border} ${background}${reached ? ' alert-pulse' : ''}`}
            >
              <span className="block truncate text-[10px] text-ink-muted">{item.key} {item.name}</span>
              <span className="flex items-baseline justify-between gap-1 tabular-nums">
                <strong className={`text-sm font-bold ${reached ? 'text-loss' : 'text-ink-primary'}`}>{item.price === null ? '暂无' : <CountUpText text={item.price.toFixed(2)} />}</strong>
                <span className={`truncate text-[10px] font-semibold ${changeTone(item.changePercent)}`}>{changeText(item.changePercent)}</span>
              </span>
              {line !== null && (
                <span
                  data-buy-state={state}
                  className={`block truncate text-[10px] ${reached ? 'font-semibold text-loss' : state === 'none' ? 'text-ink-muted' : 'font-semibold text-ink-primary'}`}
                >
                  {cardStatus(item, state, line)}
                </span>
              )}
              {gap !== null && <span className="block truncate text-[10px] tabular-nums text-ink-muted">{gap}</span>}
            </button>
          );
        })}
      </div>
      <div
        data-volatility-box="true"
        className={`rounded-xl border px-1 pb-1 pt-1.5 ${currentBuy ? 'border-loss/40 bg-loss/10' : 'border-neutral/35 bg-surface-overlay'}`}
      >
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 px-1.5 text-[10px] text-ink-muted">
          <span className="truncate">{current.key} {current.name}恐慌指数 · 一年日线</span>
          {currentStatus !== null && (
            <strong className={`font-semibold ${currentBuy ? 'text-loss' : 'text-ink-primary'}`}>{currentStatus}</strong>
          )}
        </p>
        <VolatilityChart item={current} />
        {currentLine !== null && currentEtf !== null && (
          <p className="px-1.5 pt-0.5 text-[10px] text-ink-muted">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-loss align-middle" />
            {`红点：≥ ${currentLine} 且 ${currentEtf} 击穿 200 日均线 −1.5σ 通道下沿，才算买点`}
            <span className="mx-1">·</span>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full border border-ink-muted align-middle" />
            {`灰圈：只是波动到线，${currentEtf} 价格没破下沿，不买`}
          </p>
        )}
      </div>
      <p className="text-[10px] tabular-nums text-ink-muted" role="status">
        {stale && <span className="mr-1 rounded bg-loss/15 px-1.5 py-0.5 font-semibold text-loss">数据延迟</span>}
        {`数据时间 ${dataTime === null ? '暂无' : `美东 ${easternText(dataTime).slice(0, 11)}`} · 现价 Yahoo · 日线 Cboe`}
      </p>
    </section>
  );
}

export function VolatilitySection() {
  const { data, stale, failed } = useVolatility();
  return <VolatilityPanel data={data} stale={stale} failed={failed} />;
}
