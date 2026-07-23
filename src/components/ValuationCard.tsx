import { useEffect, useMemo, useState } from 'react';
import { computeIndexAnchor, computeStock5yMean } from '../peBasis';
import { PeRateLimitError, resolvePeSnapshot, type PeHistoryPayload, type PeSnapshot } from '../peData';
import { formatDisplayMoney } from '../displayCurrency';
import type { AppSettings, DisplayCurrency, ExchangeRates } from '../types';
import { resolveValuationBasis } from '../valuationBasis';

export type ValuationSettings = Pick<
  AppSettings,
  | 'peApiKey'
  | 'valuationAnchorStart'
  | 'valuationAnchorEnd'
  | 'valuationManualAnchors'
  | 'valuationAtAnchorPct'
  | 'valuationNearAnchorPct'
>;

interface ValuationCardProps {
  symbol: string;
  history: PeHistoryPayload | null;
  settings: ValuationSettings;
  alphaSnapshot?: PeSnapshot | null;
  currentPrice?: number | null;
  priceSource?: 'holding' | 'monitored' | 'unavailable';
  displayCurrency?: DisplayCurrency;
  rates?: ExchangeRates;
}

const USD_RATES: ExchangeRates = {
  USD: 1,
  CNY: 1,
  HKD: 1,
  JPY: 1,
  EUR: 1,
  GBP: 1,
  updatedAt: null,
  source: 'fallback',
};

const ZONE_VIEW = {
  at_anchor: {
    label: '已进入锚点区',
    panel: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/25',
    badge: 'bg-emerald-600 text-white',
  },
  near_anchor: {
    label: '接近锚点',
    panel: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/25',
    badge: 'bg-amber-500 text-slate-950',
  },
  far: {
    label: '远离锚点',
    panel: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900',
    badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  },
  unknown: {
    label: '暂无',
    panel: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900',
    badge: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
  },
} as const;

function metricLabel(metric: PeHistoryPayload['metric'] | null): string {
  return metric === 'ttm_pe' ? 'TTM PE' : metric === 'forward_pe' ? '远期 PE' : 'PE';
}

function peText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '暂无' : value.toFixed(2);
}

function signedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '暂无';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

function relativeMeanText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '当前相对均值 暂无';
  if (value === 0) return '当前等于均值';
  return `当前${value < 0 ? '低于' : '高于'}均值 ${Math.abs(value).toFixed(2)}%`;
}

function sourceText(
  history: PeHistoryPayload | null,
  entrySource: string | undefined,
  snapshot: PeSnapshot | null,
): string {
  if (history && entrySource) {
    return `数据：量化系统（${metricLabel(history.metric)}）· 原始源 ${entrySource}`;
  }
  if (snapshot?.source === 'alphavantage') {
    return '数据：Alpha Vantage（远期 PE）';
  }
  return '数据：暂无';
}

function StockValuation({
  symbol,
  metric,
  current,
  series,
  seriesStart,
  source,
  priceText,
  priceSource,
}: {
  symbol: string;
  metric: PeHistoryPayload['metric'] | null;
  current: number | null;
  series: PeHistoryPayload['symbols'][string]['series'];
  seriesStart: string;
  source: string;
  priceText: string;
  priceSource: ValuationCardProps['priceSource'];
}) {
  const result = computeStock5yMean(series, current);
  const markerPosition = result.deviationPct === null
    ? null
    : Math.max(0, Math.min(100, 50 + result.deviationPct));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="font-semibold" data-price-source={priceSource}>
        {symbol} · {priceText} · {metricLabel(metric)} {peText(result.current)}
      </div>
      <div className="mt-2 text-sm">
        5 年均值 {peText(result.mean5y)} · {relativeMeanText(result.deviationPct)}
      </div>
      <div
        aria-label="当前相对 5 年均值位置"
        className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-emerald-200 via-slate-300 to-rose-200 dark:from-emerald-900 dark:via-slate-600 dark:to-rose-900"
      >
        <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-4 w-px -translate-y-1/2 bg-slate-700 dark:bg-slate-200" />
        {markerPosition !== null && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600"
            style={{ left: `${markerPosition}%` }}
          />
        )}
      </div>
      <div className="mt-2 text-xs text-slate-500">
        {source}{seriesStart ? ` · 序列起始 ${seriesStart}` : ' · 历史序列暂无'}
      </div>
      {result.sampleMonths > 0 && result.sampleMonths < 24 && (
        <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          样本仅 {result.sampleMonths} 个月，参考价值有限
        </div>
      )}
    </div>
  );
}

function IndexValuation({
  symbol,
  indexKey,
  approximate,
  metric,
  current,
  series,
  source,
  settings,
  priceText,
  priceSource,
}: {
  symbol: string;
  indexKey: string;
  approximate: boolean;
  metric: PeHistoryPayload['metric'] | null;
  current: number | null;
  series: PeHistoryPayload['symbols'][string]['series'];
  source: string;
  settings: ValuationSettings;
  priceText: string;
  priceSource: ValuationCardProps['priceSource'];
}) {
  const manualAnchor = (settings.valuationManualAnchors as Record<string, number | undefined>)[indexKey];
  const result = computeIndexAnchor(
    series,
    current,
    { start: settings.valuationAnchorStart, end: settings.valuationAnchorEnd },
    manualAnchor,
    {
      atAnchorPct: settings.valuationAtAnchorPct,
      nearAnchorPct: settings.valuationNearAnchorPct,
    },
  );
  const view = ZONE_VIEW[result.zone];
  const progress = result.gapPct === null
    ? null
    : Math.max(0, Math.min(100, result.gapPct / Math.max(settings.valuationNearAnchorPct, 1) * 100));
  const anchorDate = result.anchorDate ? `（${result.anchorDate}）` : manualAnchor ? '（手动录入）' : '';
  return (
    <div data-zone={result.zone} className={`rounded-lg border p-3 ${view.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold" data-price-source={priceSource}>
          {symbol} · {priceText} · 基准指数 {indexKey} · {metricLabel(metric)} {peText(result.current)}
        </div>
        <div className="flex items-center gap-2">
          {approximate && <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">近似基准</span>}
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${view.badge}`}>{view.label}</span>
        </div>
      </div>
      <div className="mt-2 text-sm">
        锚点 {peText(result.anchorPe)}{anchorDate} · 距锚点 {signedPercent(result.gapPct)}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        {progress !== null && <div aria-hidden="true" className="h-full bg-current text-indigo-500" style={{ width: `${progress}%` }} />}
      </div>
      <div className="mt-2 text-xs text-slate-500">
        {source} · 锚点：{manualAnchor ? '手动录入' : result.anchorPe !== null ? '序列自动计算' : '暂无'}
      </div>
    </div>
  );
}

export function ValuationCard({
  symbol,
  history,
  settings,
  alphaSnapshot = null,
  currentPrice = null,
  priceSource = 'unavailable',
  displayCurrency = 'USD',
  rates = USD_RATES,
}: ValuationCardProps) {
  const basis = useMemo(() => resolveValuationBasis(symbol), [symbol]);
  const quantEntry = basis ? history?.symbols[basis.peSymbol] : undefined;
  const [fetchedFallback, setFetchedFallback] = useState<{
    symbol: string;
    snapshot: PeSnapshot | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    if (!basis || quantEntry || alphaSnapshot || !settings.peApiKey.trim()) return;
    let cancelled = false;
    resolvePeSnapshot(basis.peSymbol, null, settings.peApiKey)
      .then((snapshot) => {
        if (!cancelled) {
          setFetchedFallback({ symbol: basis.peSymbol, snapshot, error: '' });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFetchedFallback({
          symbol: basis.peSymbol,
          snapshot: null,
          error: error instanceof PeRateLimitError
            ? error.message
            : error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [alphaSnapshot, basis, quantEntry, settings.peApiKey]);

  if (!basis) return null;
  const fallback = alphaSnapshot
    ?? (fetchedFallback?.symbol === basis.peSymbol ? fetchedFallback.snapshot : null);
  const fallbackError = fetchedFallback?.symbol === basis.peSymbol
    ? fetchedFallback.error
    : '';
  const metric = quantEntry && history
    ? history.metric
    : fallback?.forwardPe !== null && fallback?.forwardPe !== undefined
      ? 'forward_pe'
      : null;
  const current = quantEntry
    ? quantEntry.current
    : metric === 'forward_pe'
      ? fallback?.forwardPe ?? null
      : null;
  const series = quantEntry?.series ?? [];
  const source = sourceText(history && quantEntry ? history : null, quantEntry?.source, fallback);
  const priceText = currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0
    ? formatDisplayMoney(currentPrice, displayCurrency, rates)
    : '股价暂无';

  return (
    <div className="mb-4">
      <h3 className="mb-2 font-semibold">估值基准</h3>
      {basis.kind === 'stock_5y_mean' ? (
        <StockValuation
          symbol={symbol}
          metric={metric}
          current={current}
          series={series}
          seriesStart={quantEntry?.series_start ?? ''}
          source={source}
          priceText={priceText}
          priceSource={priceSource}
        />
      ) : (
        <IndexValuation
          symbol={symbol}
          indexKey={basis.indexKey ?? basis.peSymbol}
          approximate={basis.approximate === true}
          metric={metric}
          current={current}
          series={series}
          source={source}
          settings={settings}
          priceText={priceText}
          priceSource={priceSource}
        />
      )}
      {fallbackError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{fallbackError}</p>}
    </div>
  );
}
