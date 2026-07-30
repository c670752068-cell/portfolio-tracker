import { useEffect, useMemo, useState } from 'react';
import { buildAlertHoldingOptions } from '../alertRules';
import { CASH_EQUIVALENT_SYMBOLS } from '../assetClass';
import { buildDepthPriceView } from '../depthPrice';
import { depthQuotePrice, depthQuoteSnapshot, type DepthQuote } from '../depthQuotePrice';
import { formatDisplayMoney } from '../displayCurrency';
import { formatMoney } from '../format';
import { computeFamilyPnl, type FamilyPnl } from '../familyPnl';
import { finalVerdictSymbols, isQuantAnalysisStale, lookupQuantSymbol, quantAnalysisAgeHours, quantAnalysisFreshnessText } from '../quantAnalysis';
import { findSellFamily, resolveSellStatus, type ResolvedSellStatus } from '../sellStatus';
import {
  closedQuoteText,
  formatPriceSession,
  priceSessionLabel,
  quoteSessionMismatchText,
} from '../quoteSession';
import type { DisplayCurrency, ExchangeRates, Holding, QuantAnalysisSnapshot, QuantDepthPresentation, QuantFinalVerdict, QuantFinalVerdictLayer, QuantGateResult, QuantPanicSymbolStatus, QuantSellFamily, QuantSignalStatWindow, QuantSymbolAnalysis } from '../types';
import { ValuationCard, type ValuationSettings } from './ValuationCard';

type OpportunitySide = 'buy' | 'sell';

interface ConditionLookupProps {
  snapshot: QuantAnalysisSnapshot | null;
  holdings?: Holding[];
  monitoredQuotes?: ReadonlyMap<string, DepthQuote>;
  initialSymbol?: string;
  initialSide?: OpportunitySide;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  displayCurrency?: DisplayCurrency;
  rates?: ExchangeRates;
  valuationSettings?: ValuationSettings;
}

const USD_RATES: ExchangeRates = {
  USD: 1, CNY: 1, HKD: 1, JPY: 1, EUR: 1, GBP: 1,
  updatedAt: null, source: 'fallback',
};

const DEFAULT_VALUATION_SETTINGS: ValuationSettings = {
  peApiKey: '',
  valuationAnchorStart: '2025-04-01',
  valuationAnchorEnd: '2025-04-30',
  valuationManualAnchors: {},
  valuationAtAnchorPct: 5,
  valuationNearAnchorPct: 15,
};

const RISK_ROLE_LABELS: Record<string, string> = {
  option: '期权',
  leveraged_2x: '两三倍杠杆',
  underlying: '正股/单倍 ETF',
};

const MARKET_GATES = [
  ['low_zone', '低位区'],
  ['valuation', '估值/情绪'],
] as const;

const DISCIPLINE_GATES = [
  ['position_gate', '仓位门'],
  ['batch_available', '批次'],
] as const;

function numberText(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : '暂无';
}

function integerText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : '暂无';
}

function isApplicable(gate: QuantGateResult | undefined): boolean {
  return gate?.applicable !== false;
}

function gateDetail(key: string, gate: QuantGateResult): string {
  if (key === 'low_zone') {
    return `距最近 250 个交易日高点回撤 ${numberText(gate.current_drawdown_pct, '%')}；达到 ${numberText(gate.threshold_pct, '%')} 进入低位区`;
  }
  if (key === 'position_gate') {
    return `同族仓位 ${numberText(gate.family_share_pct, '%')} / 上限 ${numberText(gate.cap_pct, '%')}`;
  }
  if (key === 'batch_available') {
    return `第 ${integerText(gate.next_batch)} 批 / 共 ${integerText(gate.batch_count)} 批`;
  }
  if (key === 'valuation') {
    const reason = String(gate.reason || '按量化系统当前估值与情绪规则判定');
    return `${reason}；CNN ${numberText(gate.cnn)}（<30 恐慌开窗）；纳指100 PE 分位 ${numberText(gate.ndx_percentile, '%')}；SOXX 分位 ${numberText(gate.soxx_percentile, '%')}；个股 PE 分位 ${numberText(gate.stock_percentile, '%')}`;
  }
  return String(gate.reason || '按量化系统当前估值与情绪规则判定');
}

function GateCard({ gateKey, label, gate }: { gateKey: string; label: string; gate: QuantGateResult }) {
  return (
    <div className="rounded-lg border border-neutral/40 p-3">
      <div className="font-semibold"><span className={gate.passed ? 'text-gain' : 'text-loss'}>{gate.passed ? '✓' : '✗'}</span> {label}</div>
      <div className="mt-1 font-mono text-xs tabular-nums text-ink-muted">{gateDetail(gateKey, gate)}</div>
    </div>
  );
}

function StatWindow({ label, stat }: { label: string; stat: QuantSignalStatWindow }) {
  return (
    <div className="rounded-lg border border-neutral/40 p-2">
      <div className="font-medium">{label}</div>
      {stat.sample_insufficient || stat.n < 20 || stat.win_rate === null ? (
        <div className="mt-1 font-mono tabular-nums text-trim">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 font-mono tabular-nums text-ink-secondary">历史成功率 {(stat.win_rate * 100).toFixed(2)}%（n={stat.n}）</div>
      )}
    </div>
  );
}

function DepthStat({ stat }: { stat: NonNullable<QuantSymbolAnalysis['depth_stats']> }) {
  const insufficient = stat.sample_insufficient || stat.n < 20 || stat.win_rate_60d === null;
  return (
    <div className="mt-3 rounded-lg border border-neutral/40 p-3 text-sm">
      <div className="font-mono font-medium tabular-nums">回撤深度 {stat.level_pct}%</div>
      {insufficient ? (
        <div className="mt-1 font-mono tabular-nums text-trim">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 font-mono tabular-nums text-ink-secondary">60 日历史成功率 {(stat.win_rate_60d! * 100).toFixed(2)}%（n={stat.n}）</div>
      )}
      <div className="mt-1 text-xs text-ink-muted">含熊市样本：{stat.bear_included ? '是' : '否'}</div>
    </div>
  );
}

function usdPrice(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const FINAL_LAYER_LABELS: Record<string, string> = {
  gates_six: '六关',
  entry_gate_1x: '1x 入场门',
  sleeve_borrow: '板块额度',
  buy_plan_conditions: '计划条件',
  panic_window: '恐慌窗口',
};
const FINAL_LAYER_ORDER = Object.keys(FINAL_LAYER_LABELS);

/**
 * This deliberately performs no gate calculation. It only turns the backend's
 * explicit pass/block/unknown lists into the five fixed presentation rows so
 * older snapshots remain explainable while the exported detailed layer list
 * is rolling out.
 */
function finalVerdictLayers(verdict: QuantFinalVerdict): QuantFinalVerdictLayer[] {
  const detailed = new Map((verdict.layers ?? []).map((layer) => [layer.layer, layer]));
  const blockers = new Map((verdict.blocking_layers ?? []).map((layer) => [layer.layer, layer.reason]));
  const passes = new Set(verdict.passing_layers ?? []);
  const unknowns = new Set(verdict.unknown_layers ?? []);

  return FINAL_LAYER_ORDER.map((layer) => {
    const detail = detailed.get(layer);
    if (detail) return { ...detail, label: detail.label || FINAL_LAYER_LABELS[layer] };
    const reason = blockers.get(layer);
    if (reason) return { layer, label: FINAL_LAYER_LABELS[layer], state: 'failed', passed: false, reason };
    if (passes.has(layer)) return { layer, label: FINAL_LAYER_LABELS[layer], state: 'passed', passed: true, reason: '后端标记为已通过。' };
    return {
      layer,
      label: FINAL_LAYER_LABELS[layer],
      state: 'unknown',
      passed: null,
      reason: unknowns.has(layer) ? '后端标记为待判定。' : '后端未提供该层明细。',
    };
  });
}

function finalVerdictStatusLabel(snapshot: QuantAnalysisSnapshot | null, symbol: string): string {
  const verdict = snapshot ? finalVerdictSymbols(snapshot)[symbol] : undefined;
  if (!verdict) return `⚪ ${symbol} · 等待最终裁决`;
  if (verdict.verdict === 'BUY') return `🟣 ${symbol} · 条件完整`;
  if (verdict.verdict === 'NO_BUY') return `⚪ ${symbol} · 不买`;
  return `⚪ ${symbol} · 无法判定`;
}

function FinalVerdictPanel({ verdict }: { verdict: QuantFinalVerdict | undefined }) {
  if (!verdict) {
    return <div className="mb-4 rounded-xl border border-neutral/40 bg-surface-overlay/35 p-3 text-sm text-ink-muted">最终裁决待下一份量化快照生成；页面不会自行把单个门槛拼成结论。</div>;
  }
  const title = verdict.verdict === 'NO_BUY'
    ? '最终结论：不买'
    : verdict.verdict === 'BUY'
      ? '最终结论：条件完整'
      : '最终结论：数据不足，无法判定';
  const layers = finalVerdictLayers(verdict);
  return (
    <section className="mb-4 rounded-xl border border-neutral/40 bg-surface-overlay/35 p-3" aria-label="最终裁决（后端唯一结论）">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink-primary">最终裁决（后端唯一结论）</h3>
          <p className="mt-1 text-sm font-semibold text-ink-primary">{title}</p>
        </div>
        <span className="rounded-full bg-neutral/25 px-2 py-1 font-mono text-[11px] tabular-nums text-ink-secondary">{verdict.symbol}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{verdict.single_sentence ?? '后端未提供结论说明。'}</p>
      <p className="mt-2 text-xs text-ink-muted">任何一层否决 = 不买</p>
      {verdict.is_silence_by_rule && <p className="mt-1 text-xs text-ink-muted">这是规则的结论，不是系统故障。</p>}
      {verdict.data_stale && <p className="mt-1 font-mono text-xs tabular-nums text-trim">数据 {verdict.data_as_of ?? '暂无'}（落后 {verdict.data_stale_days} 天）</p>}
      <div className="mt-3 space-y-2">
        {layers.map((layer) => <FinalVerdictLayerCard key={layer.layer} layer={layer} />)}
      </div>
      {verdict.symbol === 'SOXL' && <p className="mt-3 text-xs leading-relaxed text-ink-muted">约每 5 年一次，长期静默正常。</p>}
    </section>
  );
}

function FinalVerdictLayerCard({ layer }: { layer: QuantFinalVerdictLayer }) {
  const state = layer.state ?? (layer.passed === true ? 'passed' : layer.passed === false ? 'failed' : 'unknown');
  const stateText = state === 'passed' ? '通过' : state === 'failed' ? '未通过' : state === 'not_applicable' ? '不适用' : '待判定';
  const stateClass = state === 'passed'
    ? 'border-gain/40 bg-gain/10 text-gain'
    : state === 'failed'
      ? 'border-loss/40 bg-loss/10 text-loss'
      : 'border-neutral/40 bg-surface-base text-ink-secondary';
  const label = layer.label || FINAL_LAYER_LABELS[layer.layer] || layer.layer;
  return (
    <div className={`rounded-lg border px-3 py-2 ${stateClass}`}>
      <div className="grid gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-center">
        <div className="flex items-center justify-between gap-2 sm:block">
          <span className="font-medium">{label}</span>
          <span className="ml-2 text-xs font-semibold">{stateText}</span>
        </div>
        <p className="min-w-0 text-xs leading-relaxed text-ink-secondary">{layer.reason || '后端未提供细节。'}</p>
        <div className="font-mono text-[11px] tabular-nums text-ink-primary">
          {layer.benchmark && typeof layer.trigger_price === 'number' ? `${layer.benchmark} → ${usdPrice(layer.trigger_price)}` : typeof layer.gap_pp === 'number' ? `还差 ${layer.gap_pp.toFixed(2)} 点` : '—'}
        </div>
      </div>
    </div>
  );
}

const DEPTH_STYLE = {
  ready: {
    panel: 'border-gain/40 bg-gain/10',
    badge: 'bg-gain text-surface-base',
    progress: 'accent-gain',
  },
  near: {
    panel: 'border-trim/40 bg-trim/10',
    badge: 'bg-trim text-ink-primary',
    progress: 'accent-trim',
  },
  far: {
    panel: 'border-neutral/40 bg-surface-overlay/50',
    badge: 'bg-neutral/30 text-ink-secondary',
    progress: 'accent-neutral',
  },
} as const;

function DepthHighlight({
  analysis,
  presentation,
  title,
  quotePrice,
  quote,
}: {
  analysis: QuantSymbolAnalysis;
  presentation: QuantDepthPresentation | undefined;
  title: string;
  quotePrice: number | null;
  quote: ReturnType<typeof depthQuoteSnapshot>;
}) {
  const depth = analysis.depth_window;
  if (!depth?.applicable) return null;
  if (!presentation) {
    return <div className="rounded-lg border border-neutral/40 p-3 text-sm text-ink-muted">深度位展示状态待下一份快照生成。</div>;
  }
  const style = DEPTH_STYLE[presentation.status];
  const badge = presentation.status === 'ready'
    ? '深度位 ✓ 已达标'
    : presentation.status === 'near'
      ? `深度位 接近 · 还差 ${presentation.gap_pct.toFixed(2)} 点`
      : '深度位 未达标';
  const prices = buildDepthPriceView(depth, quotePrice, {
    currentPrice: depth.current_price ?? null,
    highPrice: depth.high_price ?? null,
    thresholdPrice: depth.threshold_price ?? null,
  });
  const priceSession = prices.source === 'derived'
    ? formatPriceSession(quote?.session, quote?.priceTime || quote?.timestamp)
    : priceSessionLabel(depth.price_session);
  const mismatch = quoteSessionMismatchText(depth.price_session, quote);
  const closedText = closedQuoteText(
    quote?.session ?? depth.price_session,
    quote?.regularMarketPrice ?? quote?.price ?? prices.currentPrice,
  );
  const priceNote = depth.price_note?.startsWith('夜盘价格暂无')
    ? '夜盘价格暂无（数据源不覆盖）'
    : depth.price_note;
  return (
    <div className={`min-w-0 overflow-hidden rounded-lg border p-3 text-sm ${style.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{title}</div>
        <span className={`rounded-full px-3 py-1 font-mono text-xs font-bold tabular-nums ${style.badge}`}>{badge}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div><span className="block text-xs text-ink-muted">当前回撤</span><strong className="font-mono text-2xl tabular-nums">{numberText(depth.current_pct, '%')}</strong></div>
        <div><span className="block text-xs text-ink-muted">阈值</span><strong className="font-mono text-2xl tabular-nums">{numberText(depth.threshold_pct, '%')}</strong></div>
      </div>
      {closedText && (
        <div className="mt-3 rounded-lg bg-surface-raised/70 p-2 font-mono text-xs tabular-nums text-ink-secondary">
          {closedText}
        </div>
      )}
      {!closedText && prices.source !== 'unavailable' && prices.currentPrice !== null && prices.highPrice !== null && prices.thresholdPrice !== null && (
        <div className="mt-3 rounded-lg bg-surface-raised/70 p-2 text-xs text-ink-secondary">
          现价 {usdPrice(prices.currentPrice)}{priceSession && `（${priceSession}）`} · 高点 {prices.source === 'derived' ? '~' : ''}{usdPrice(prices.highPrice)} · 阈值价 {prices.source === 'derived' ? '~' : ''}{usdPrice(prices.thresholdPrice)}
          {prices.source === 'derived' && (
            <div className="mt-1 text-ink-muted">
              <div>价格由行情代理现价与量化回撤反推，与量化取价时段（{priceSessionLabel(depth.price_session)}）可能有偏差</div>
              <div>高点为反推值，会随现价与量化回撤的更新时差而小幅变动；量化系统提供真实高点后此处将改为固定值。</div>
            </div>
          )}
        </div>
      )}
      {priceNote && <div className="mt-2 text-xs text-ink-muted">{priceNote}</div>}
      {mismatch && <div className="mt-2 text-xs text-trim">{mismatch}</div>}
      <div className="mt-3 flex min-w-0 items-center gap-3">
        <progress aria-label="深度位进度" className={`h-3 min-w-0 flex-1 ${style.progress}`} max={100} value={presentation.progress_pct} />
        {presentation.status === 'ready' && <span className="font-mono text-xs font-semibold tabular-nums">超出 {presentation.excess_pct.toFixed(2)} 点</span>}
      </div>
      {!closedText && priceSessionLabel(depth.price_session) && <div className="mt-2 text-xs text-ink-muted">取价时段：{priceSessionLabel(depth.price_session)}</div>}
      <div className={`mt-3 font-mono tabular-nums ${depth.sample_insufficient || depth.win_rate_60d === null ? 'text-ink-muted opacity-70' : 'text-buy'}`}>
        {depth.sample_insufficient || depth.win_rate_60d === null
          ? `60 日样本不足（n=${depth.n}）`
          : <><strong className="text-xl">60 日胜率 {(depth.win_rate_60d * 100).toFixed(2)}%</strong><span className="ml-2 text-xs">（n={depth.n}）</span></>}
      </div>
    </div>
  );
}

type ValuationPositionKind = 'pe' | 'indicator' | 'cnn';

function ValuationPosition({
  label,
  value,
  kind,
}: {
  label: string;
  value: unknown;
  kind: ValuationPositionKind;
}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return <div className="rounded-lg bg-surface-overlay/50 p-3 text-sm text-ink-muted">{label} 暂无</div>;
  }
  const position = Math.max(0, Math.min(100, value));
  const zone = position < 30 ? 'low' : position > 70 ? 'high' : 'neutral';
  const marker = zone === 'low'
    ? 'bg-gain'
    : zone === 'high'
      ? 'bg-loss'
      : 'bg-neutral';
  const suffix = kind === 'cnn' ? '' : '%';
  const lowerTime = Math.max(0, 100 - position);
  const interpretation = kind === 'pe'
    ? `分位 ${position.toFixed(2)}% = 当前 PE 低于过去约 ${lowerTime.toFixed(0)}% 的时间`
    : kind === 'indicator'
      ? `分位 ${position.toFixed(2)}% = 当前指标低于过去约 ${lowerTime.toFixed(0)}% 的时间`
      : `CNN ${position.toFixed(2)} / 100，数值越低代表市场情绪越恐慌`;
  return (
    <div className="rounded-lg bg-surface-overlay/50 p-3">
      <div className="font-mono text-sm font-medium tabular-nums">{label} {position.toFixed(2)}{suffix}</div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={position}
        data-zone={zone}
        className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-gain/20 via-neutral/40 to-loss/20"
      >
        <span
          aria-hidden="true"
          className={`absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded ${marker}`}
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="mt-2 font-mono text-xs tabular-nums text-ink-muted">{interpretation}</div>
    </div>
  );
}

function ReferenceInfo({ gate }: { gate: QuantGateResult | undefined }) {
  if (!gate) return null;
  const stockOnly = gate.reference_only === true;
  const rows = stockOnly
    ? [{ label: '个股 PE 分位', value: gate.stock_percentile, kind: 'pe' as const }]
    : [
        { label: 'CNN', value: gate.cnn, kind: 'cnn' as const },
        { label: '纳指100 PE 分位', value: gate.ndx_percentile, kind: 'pe' as const },
        { label: 'SOXX 分位', value: gate.soxx_percentile, kind: 'indicator' as const },
      ];
  return (
    <div className="rounded-lg border border-neutral/40 p-3">
      <div className="font-semibold">估值位置（参考，不参与开窗）</div>
      <div className="mt-3 grid gap-2">
        {rows.map((row) => <ValuationPosition key={row.label} {...row} />)}
      </div>
    </div>
  );
}

function BuyConditions({ analysis }: { analysis: QuantSymbolAnalysis }) {
  const gates = analysis.gates ?? {};
  const marketGates = MARKET_GATES
    .map(([key, label]) => ({ key, label, gate: gates[key] ?? { passed: false } }))
    .filter((item) => isApplicable(item.gate));
  const marketPassed = marketGates.filter((item) => item.gate.passed).length;
  const lowZone = gates.low_zone;
  return (
    <details className="mt-3 rounded-lg border border-neutral/40 p-3">
      <summary className="cursor-pointer font-semibold">六关原始证据（仅作证据，不单独构成结论）</summary>
      <div className="mt-3 space-y-3">
        {marketGates.length > 0 && <div className="flex items-center justify-between gap-3">
        <strong className="font-mono tabular-nums">市场条件满足 {marketPassed}/{marketGates.length}</strong>
        <span className="text-xs text-ink-muted">市场判断</span>
        </div>}
        {marketGates.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
        {marketGates.map((item) => <GateCard key={item.key} gateKey={item.key} label={item.label} gate={item.gate} />)}
        </div>}
        {lowZone && !isApplicable(lowZone) && !analysis.depth_window?.applicable && (
        <div className="rounded-lg border border-neutral/40 p-3 text-sm text-ink-secondary">
          <div className="font-semibold">价格回撤参考</div>
          <div className="mt-1 font-mono text-xs tabular-nums text-ink-muted">距最近 250 个交易日高点回撤 {numberText(lowZone.current_drawdown_pct, '%')}，不参与个股市场条件计数。</div>
        </div>
        )}
        <ReferenceInfo gate={gates.valuation} />
        <details className="rounded-lg border border-neutral/40 p-3">
        <summary className="cursor-pointer font-semibold">纪律闸门（决定允许买多少），不是行情判断</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DISCIPLINE_GATES.map(([key, label]) => {
            const gate = gates[key] ?? { passed: false };
            return isApplicable(gate) ? <GateCard key={key} gateKey={key} label={label} gate={gate} /> : null;
          })}
        </div>
        </details>
      </div>
    </details>
  );
}

function ObservationBadge({ visible }: { visible: boolean }) {
  return visible ? <span className="ml-1 text-trim">（观察期，未正式生效）</span> : null;
}

function nullableUsdPrice(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatMoney(value) : '暂无';
}

function OneXEntryGate({ status }: { status: QuantPanicSymbolStatus }) {
  const gate = status.entry_gate;
  if (!gate) {
    return <div className="mt-3 rounded-lg border border-neutral/40 bg-surface-overlay/40 p-3 text-xs text-ink-muted">1× 基准判定待下一次量化快照生成。</div>;
  }
  const stateClass = gate.available && gate.passed ? 'border-gain/50 bg-gain/10 text-gain' : 'border-trim/50 bg-trim/10 text-trim';
  const decisionLabel = gate.price_basis === 'close' ? '闭市价' : '判定价';
  const referenceLabel = gate.reference_session ? priceSessionLabel(gate.reference_session) : '扩展时段';
  return (
    <div className="mt-3 rounded-lg border border-neutral/40 bg-surface-overlay/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>1× 基准判定</strong>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${stateClass}`}>
          {!gate.available ? '不可判定' : gate.passed ? '条件已满足' : '条件未满足'}
        </span>
      </div>
      {!gate.available ? <p className="mt-2 text-xs text-ink-muted">{gate.reason}</p> : <>
        <div className="mt-3 grid gap-2 font-mono text-xs tabular-nums sm:grid-cols-2">
          <div><span className="text-ink-muted">判定基准</span> {gate.benchmark} {decisionLabel} {nullableUsdPrice(gate.decision_close)}</div>
          <div><span className="text-ink-muted">自高点回撤</span> {numberText(gate.drawdown.current_pct, '%')}{gate.drawdown.required_pct === null ? '（不适用）' : ` / 阈值 ${numberText(gate.drawdown.required_pct, '%')}`}</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {gate.moving_averages.map((movingAverage) => <span key={movingAverage.period} className={`rounded-md px-2 py-1 font-mono text-xs tabular-nums ${movingAverage.touched ? 'bg-gain/10 text-gain' : 'bg-surface-base text-ink-secondary'}`}>
            MA{movingAverage.period} {movingAverage.touched ? '已触及' : `还差 ${movingAverage.gap_pct.toFixed(2)}%`}
          </span>)}
        </div>
        {gate.reference_price !== null && <div className="mt-2 text-xs text-ink-muted">{referenceLabel}价 {nullableUsdPrice(gate.reference_price)}（仅展示，不改变条件）</div>}
        <p className="mt-2 text-xs text-ink-muted">{gate.reason}</p>
      </>}
    </div>
  );
}

function ReviewCheckpointStrip({ snapshot }: { snapshot: QuantAnalysisSnapshot }) {
  const checkpoint = snapshot.review_checkpoint;
  if (!checkpoint) return null;
  return (
    <div className={`rounded-xl border p-3 text-sm ${checkpoint.stale ? 'border-trim/40 bg-trim/10' : 'border-neutral/40 bg-surface-raised'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>定时审查：{checkpoint.label}</strong>
        <span className="font-mono text-xs tabular-nums text-ink-muted">美股交易日 {checkpoint.us_trading_day}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-ink-secondary">
        <span>{checkpoint.stale ? '刷新未完成，保留上一份快照' : `本次已通知 ${checkpoint.notifications_sent} 条`}</span>
        <span>下一检查点 {checkpoint.next_at}</span>
        {checkpoint.error && <span className="text-trim">{checkpoint.error}</span>}
      </div>
    </div>
  );
}

function PanicWindowStatus({ status }: { status: QuantPanicSymbolStatus }) {
  return (
    <div className="mb-4 min-w-0 overflow-hidden rounded-lg border border-neutral/40 bg-surface-overlay/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{status.display.title}</strong>
        <span className="rounded-full bg-neutral/20 px-2 py-1 text-xs font-semibold text-ink-secondary">{status.display.state_label}</span>
      </div>
      <OneXEntryGate status={status} />
      <div className={`mt-3 rounded-lg border p-3 ${status.panic.open ? 'border-loss/60 bg-loss/15' : 'border-neutral/40 bg-surface-overlay/50'}`}>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.panic.open ? 'bg-loss text-surface-base' : 'bg-neutral/30 text-ink-secondary'}`}>
          恐慌位 {status.panic.open ? '✓ 已触发' : '✗ 未触发'}
        </span>
        <div className="mt-2 text-xs text-ink-secondary">{status.panic.explanation}</div>
        {status.panic.triggered_session && <div className="mt-1 text-xs font-medium">触发时段：{priceSessionLabel(status.panic.triggered_session)}</div>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <progress className="h-2 flex-1 accent-loss" max={100} value={status.target.progress_pct} />
        <span className="font-mono text-xs font-semibold tabular-nums">{status.display.progress_text}</span>
      </div>
      {status.stop_reason && <div className="mt-2 text-xs text-ink-muted">停止原因：{status.stop_reason}</div>}
    </div>
  );
}

function signedPct(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

function SellWindow({
  item,
  status,
  pnl,
  displayCurrency,
  rates,
  audit,
}: {
  item: QuantSellFamily;
  status: ResolvedSellStatus;
  pnl: FamilyPnl;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  audit: Record<string, unknown>;
}) {
  const repairText = item.repair.display_text || (item.repair.window_open
    ? '市场修复状态已完成；盈利闸门数据尚未生成，当前不显示减仓提示'
    : item.repair.status === 'repairing'
      ? `卖出窗口未开启：深跌修复期内，耐心持有（基准日 ${item.repair.base_date || '暂无'}）`
      : '修复期状态暂不可用，当前不生成卖出动作');
  const steps = item.playbook.sell_steps;
  const firstStep = steps[0];
  const hasKnownLoss = pnl.pnlPct !== null && pnl.pnlPct < 0;
  const isCompleteLoss = pnl.coverage === 'complete' && hasKnownLoss;
  const isPartialLoss = pnl.coverage === 'partial' && hasKnownLoss;
  const isPartialGain = pnl.coverage === 'partial' && pnl.pnlPct !== null && pnl.pnlPct >= 0;
  const hasUnknownOptionCost = pnl.unknownCostHoldings.some((label) => label.includes('（期权'));
  const hasUnknownNonOptionCost = pnl.unknownCostHoldings.some((label) => !label.includes('（期权'));
  const unknownCostGuidance = [
    hasUnknownOptionCost ? '期权成本需用「补充期权详情」导入' : '',
    hasUnknownNonOptionCost ? '请在持仓表补填买入价' : '',
  ].filter(Boolean).join('；');
  const gateActionable = item.profit_gate
    ? item.profit_gate.verdict === 'ladder_active'
    : !hasKnownLoss;
  const repairActionable = item.repair.actionable
    ?? (item.repair.window_open && gateActionable);
  const activeStep = gateActionable && pnl.pnlPct !== null
    ? steps.find((step) => pnl.pnlPct! >= step.gain_min_pct && pnl.pnlPct! < step.gain_max_pct)
    : undefined;
  const belowFirst = !hasKnownLoss && pnl.pnlPct !== null && firstStep && pnl.pnlPct < firstStep.gain_min_pct;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="rounded-lg border border-neutral/40 p-3">
        <div className="font-semibold">本族当前盈亏</div>
        <div className="mt-2 grid gap-2 font-mono tabular-nums sm:grid-cols-3">
          <div>
            <div>市值 {formatDisplayMoney(pnl.marketValue, displayCurrency, rates)}</div>
            {pnl.coverage === 'partial' && <div className="mt-1 text-xs text-ink-muted">
              其中已计成本 {formatDisplayMoney(pnl.costedMarketValue, displayCurrency, rates)} · 未计成本 {formatDisplayMoney(pnl.uncostedMarketValue, displayCurrency, rates)}
            </div>}
          </div>
          {pnl.coverage === 'unavailable'
            ? <div className="text-ink-muted">成本未知</div>
            : <>
              <div>成本 {formatDisplayMoney(pnl.costBasis, displayCurrency, rates)}</div>
              <div className={pnl.pnl >= 0 ? 'text-gain' : 'text-loss'}>
                浮盈亏 {formatDisplayMoney(pnl.pnl, displayCurrency, rates)}（{pnl.pnlPct! >= 0 ? '+' : '-'}{Math.abs(pnl.pnlPct!).toFixed(2)}%{pnl.coverage === 'partial' ? ` · 基于已计成本部分 ${formatDisplayMoney(pnl.costedMarketValue, displayCurrency, rates)}` : ''}）
              </div>
            </>}
        </div>
        {pnl.coverage !== 'complete' && <p className="mt-2 font-mono text-xs font-medium tabular-nums text-trim">
          {pnl.unknownCostHoldings.length} 个持仓成本未知（{unknownCostGuidance}），未计入本次盈亏：{pnl.unknownCostHoldings.join('、')}
        </p>}
      </div>
      {item.profit_gate && (
        <div className={`rounded-lg border p-3 ${gateActionable ? 'border-gain/40 bg-gain/10' : 'border-neutral/50 bg-surface-overlay/50'}`}>
          <div className="text-xs font-medium text-ink-muted">当前结论</div>
          <div className="mt-1 font-semibold">{item.profit_gate.verdict_text}</div>
        </div>
      )}
      {status.state !== 'none' && (
        <div className={`rounded-lg border p-3 ${status.state === 'window_open' ? 'border-trim/40 bg-trim/10' : 'border-neutral/40 bg-surface-overlay/50'}`}>
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <span>触发依据：{status.trigger || '量化系统卖出证据'}</span>
            {status.state === 'observation' && <span className="rounded-full bg-neutral/30 px-2 py-1 text-xs text-ink-secondary">观察期，未正式生效</span>}
          </div>
          {status.detail && <p className="mt-2 text-ink-secondary">{status.detail}</p>}
          <p className="mt-2 text-xs text-ink-muted">该判定来自量化系统的相对强弱口径（自反弹基准日涨幅 vs QQQ），与你的买入成本无关；是否盈利请看下方「本族当前盈亏」。</p>
        </div>
      )}
      <div
        data-profit-actionable={repairActionable ? 'true' : 'false'}
        className={`rounded-lg border p-3 ${repairActionable ? 'border-gain/40 bg-gain/10' : 'border-neutral/50 bg-surface-overlay/50'}`}
      >
        <div className="font-semibold">
          修复期
          <span
            className="ml-1 text-xs text-ink-muted"
            title="这是市场维度（相对 QQQ 强弱），与你的买入成本无关"
          >ⓘ</span>
        </div>
        <p className="mt-1">{repairText}</p>
        <p className="mt-2 text-xs text-ink-muted">这是市场维度（相对 QQQ 强弱），与你的买入成本无关。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral/40 p-3">
          <div className="font-semibold">知足常乐<ObservationBadge visible={item.contentment.observation} /></div>
          {!item.contentment.available ? <p className="mt-1 text-ink-muted">该持仓族暂无反弹基准对比数据。</p> : (
            <>
              <p className="mt-1 font-mono tabular-nums text-ink-muted">本标的 {numberText(item.contentment.asset_gain_pct, '%')} · QQQ {numberText(item.contentment.qqq_gain_pct, '%')} · 差距 {numberText(item.contentment.gap_vs_qqq_pct, ' 点')}</p>
              <p className={`mt-1 font-mono font-medium tabular-nums ${item.contentment.triggered && (item.contentment.actionable ?? gateActionable) ? 'text-trim' : 'text-ink-muted'}`}>{item.contentment.triggered ? ((item.contentment.actionable ?? gateActionable) ? `量化剧本参考比例 ${integerText(item.contentment.minimum_reduction_pct)}%` : '市场依据已出现，但盈利闸门未通过，不构成减仓提示') : '尚未接近或超过 QQQ，不触发该依据'}</p>
            </>
          )}
        </div>
        <div className="rounded-lg border border-neutral/40 p-3">
          <div className="font-semibold">补涨收敛<ObservationBadge visible={item.convergence.observation} /></div>
          <p className="mt-1 font-mono tabular-nums text-ink-muted">大科技追平 QQQ：{integerText(item.convergence.count)}/{integerText(item.convergence.minimum_assets)} 只</p>
          <p className={`mt-1 font-medium ${item.convergence.triggered && (item.convergence.actionable ?? gateActionable) ? 'text-trim' : 'text-ink-muted'}`}>{item.convergence.triggered ? ((item.convergence.actionable ?? gateActionable) ? `市场亢奋·量化剧本参考：${item.convergence.action.replace('，仅手动操作', '')}` : '市场依据已出现，但盈利闸门未通过，不构成减仓提示') : '尚未达到补涨收敛门槛'}</p>
        </div>
      </div>
      <div className="rounded-lg border border-neutral/40 p-3">
        <div className="font-semibold">
          止盈阶梯参考 · 剧本：{item.playbook.label || '未标注'}
          <span className="ml-1 text-xs text-ink-muted" title="只在浮盈达到最低档后适用">ⓘ</span>
        </div>
        {firstStep && <p className="mt-1 text-xs text-ink-muted">只在浮盈达到最低档 +{firstStep.gain_min_pct.toFixed(2)}% 后适用。</p>}
        {isCompleteLoss && firstStep && <p className="mt-2 rounded-lg bg-loss/10 p-3 font-mono font-medium tabular-nums text-loss">当前为浮亏 {signedPct(pnl.pnlPct!)}，止盈阶梯（最低档 +{firstStep.gain_min_pct.toFixed(2)}%）尚未适用。下方阶梯仅作参考，不构成减仓提示。</p>}
        {isPartialLoss && <p className="mt-2 rounded-lg bg-trim/10 p-3 font-mono font-medium tabular-nums text-trim">已知成本部分为浮亏 {signedPct(pnl.pnlPct!)}（另有 {pnl.unknownCostHoldings.length} 个持仓成本未知）。止盈阶梯参考请以券商实际成本为准。</p>}
        {isPartialGain && <p className="mt-2 rounded-lg bg-trim/10 p-3 font-mono font-medium tabular-nums text-trim">该档位基于已计成本部分（另有 {pnl.unknownCostHoldings.length} 个持仓成本未知），实际盈利可能不同；减仓比例请以券商实际成本为准。</p>}
        {belowFirst && firstStep && <p className="mt-2 font-mono tabular-nums text-trim">距第一档 +{firstStep.gain_min_pct.toFixed(2)}% 还差 {(firstStep.gain_min_pct - pnl.pnlPct!).toFixed(2)} 点{pnl.coverage === 'partial' ? '（基于已计成本部分）' : ''}</p>}
        {!item.playbook.available ? <p className="mt-1 text-ink-muted">该持仓族尚未配置止盈剧本。</p> : (
          <>
            <ul className={`mt-2 space-y-1 font-mono tabular-nums text-ink-secondary ${gateActionable ? '' : 'opacity-40 grayscale'}`}>
              {steps.map((step) => {
                const active = activeStep === step;
                return <li data-active={active ? 'true' : undefined} className={active ? 'rounded bg-gain/15 px-2 py-1 font-semibold text-gain' : ''} key={`${step.gain_min_pct}-${step.gain_max_pct}`}>盈利 {step.gain_min_pct.toFixed(2)}%{step.gain_max_pct >= 999 ? '+' : `–${step.gain_max_pct.toFixed(2)}%`}：减总仓 {step.sell_position_pct.toFixed(2)}%</li>;
              })}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">优先顺序：{item.playbook.risk_first_order.map((role) => RISK_ROLE_LABELS[role] || role).join(' → ')}</p>
          </>
        )}
      </div>
      <div className="rounded-lg border border-neutral/40 p-3">
        <div className="font-semibold">近期卖出信号</div>
        {item.recent_signals.length === 0 ? <p className="mt-1 text-ink-muted">最近没有触发 sell 向信号。</p> : <ul className="mt-1 space-y-1 font-mono tabular-nums text-ink-secondary">{item.recent_signals.map((signal) => <li key={`${signal.name}-${signal.date}`}>{signal.label} {signal.date}</li>)}</ul>}
      </div>
      <details className="rounded-lg border border-neutral/40 p-3">
        <summary className="cursor-pointer font-semibold">原始判定数据</summary>
        <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-overlay p-3 font-mono text-xs tabular-nums">{JSON.stringify(audit, null, 2)}</pre>
        <p className="mt-2 text-xs text-ink-muted">用于核对量化系统口径；若这里显示的族数与你的预期不符，请把本块内容反馈给量化系统维护方。</p>
      </details>
      <p className="text-xs font-medium text-trim">只提醒不下单；由你在券商 App 手动执行。</p>
    </div>
  );
}

export function ConditionLookup({ snapshot, holdings = [], monitoredQuotes = new Map(), initialSymbol = '', initialSide, loading = false, error = '', onRefresh, displayCurrency = 'USD', rates = USD_RATES, valuationSettings = DEFAULT_VALUATION_SETTINGS }: ConditionLookupProps) {
  const monitoredSymbols = useMemo(() => snapshot
    ? Object.keys(snapshot.symbols).filter((item) => !CASH_EQUIVALENT_SYMBOLS.has(item.toUpperCase())).sort()
    : [], [snapshot]);
  const firstSymbol = monitoredSymbols.includes(initialSymbol.toUpperCase())
    ? initialSymbol.toUpperCase()
    : monitoredSymbols[0] || '';
  const [symbol, setSymbol] = useState(firstSymbol);
  const selectedSymbol = monitoredSymbols.includes(symbol) ? symbol : firstSymbol;
  const result = useMemo(() => snapshot && selectedSymbol ? lookupQuantSymbol(snapshot, selectedSymbol) : null, [snapshot, selectedSymbol]);
  const snapshotAgeHours = snapshot ? quantAnalysisAgeHours(snapshot.generated_at) : null;
  const sellOptions = useMemo(() => buildAlertHoldingOptions(holdings), [holdings]);
  const firstSellSymbol = sellOptions.some((item) => item.symbol === initialSymbol.toUpperCase())
    ? initialSymbol.toUpperCase()
    : sellOptions[0]?.symbol || '';
  const [sellSymbol, setSellSymbol] = useState(firstSellSymbol);
  const selectedSellSymbol = sellOptions.some((item) => item.symbol === sellSymbol)
    ? sellSymbol
    : sellOptions[0]?.symbol || '';
  const sellFamilyMatch = findSellFamily(snapshot, selectedSellSymbol);
  const sellFamily = sellFamilyMatch?.family;
  const selectedSellStatus = resolveSellStatus(snapshot, selectedSellSymbol);
  const familyPnl = sellFamily
    ? computeFamilyPnl(holdings, sellFamily.family, sellFamily.held_symbols, snapshot?.holding_costs || {})
    : null;
  const sellAudit = sellFamily ? {
    sell_ready: snapshot?.summary?.sell_ready.find((item) => item.symbol === sellFamily.family) ?? null,
    family: sellFamily.family,
    held_symbols: sellFamily.held_symbols,
    playbook_label: sellFamily.playbook.label ?? null,
    classified_symbols: sellOptions
      .map((item) => ({ symbol: item.symbol, state: resolveSellStatus(snapshot, item.symbol).state }))
      .filter((item) => item.state !== 'none'),
  } : {};
  const panicStatus = snapshot?.panic_window?.symbols[selectedSymbol];
  const depthPresentation = snapshot?.summary?.depth_states[selectedSymbol];
  const selectedHoldingQuotePrice = depthQuotePrice(holdings, new Map(), selectedSymbol);
  const selectedDepthQuotePrice = depthQuotePrice(holdings, monitoredQuotes, selectedSymbol);
  const selectedDepthQuote = depthQuoteSnapshot(holdings, monitoredQuotes, selectedSymbol);
  const selectedDepthPriceSource = selectedHoldingQuotePrice !== null
    ? 'holding'
    : selectedDepthQuotePrice !== null
      ? 'monitored'
      : 'unavailable';
  const sellStatusLabel = (optionSymbol: string, fallbackLabel: string) => {
    const status = resolveSellStatus(snapshot, optionSymbol);
    if (status.state === 'window_open') return `🟠 ${fallbackLabel} · 卖出窗口开启`;
    if (status.state === 'observation') return `⚪ ${fallbackLabel} · 观察期`;
    return `⚪ ${fallbackLabel} · 无`;
  };
  useEffect(() => {
    if (!initialSide) return;
    window.requestAnimationFrame(() => {
      document.getElementById(initialSide === 'buy' ? 'buy-condition-detail' : 'sell-window-detail')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [initialSide]);

  return (
    <section className="space-y-4">
      {snapshot && <ReviewCheckpointStrip snapshot={snapshot} />}
      <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">量化条件查询</h2>
            <p className="mt-1 text-sm text-ink-muted">从量化监控池选择标的，查看生产口径的买入条件和历史事件统计。</p>
          </div>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={loading} className="rounded-md bg-neutral/30 px-3 py-2 text-sm">{loading ? '读取中…' : '刷新快照'}</button>}
        </div>
        {snapshot && <p className="mt-2 font-mono text-xs tabular-nums text-ink-muted">{quantAnalysisFreshnessText(snapshot.generated_at)} · 盘中每 5 分钟、其他时段每 25 分钟自动更新</p>}
        <select aria-label="量化监控标的" value={selectedSymbol} onChange={(event) => setSymbol(event.target.value)} className="mt-4 w-full rounded-md border border-neutral bg-transparent px-3 py-2">
          {monitoredSymbols.map((item) => <option key={item} value={item}>{finalVerdictStatusLabel(snapshot, item)}</option>)}
        </select>
      </div>

      {error && <div className="rounded-xl border border-loss/40 bg-loss/10 p-3 text-sm text-loss">读取失败：{error}</div>}
      {!snapshot && !error && <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4 text-sm text-ink-muted">{loading ? '正在读取量化系统快照…' : '暂无量化分析快照。'}</div>}

      {snapshot && isQuantAnalysisStale(snapshot.generated_at) && (
        <div className="rounded-xl border border-trim/40 bg-trim/10 p-3 font-mono text-sm tabular-nums text-trim">量化分析数据 {snapshotAgeHours === null ? '时间未知' : `${snapshotAgeHours} 小时前`}，可能过期。</div>
      )}

      {snapshot && result && !result.found && (
        <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4">
          <div className="font-semibold">{result.symbol || '该代码'} 不在量化监控池，无判定数据</div>
          <div className="mt-2 text-sm text-ink-muted">池内代码：{result.monitoredSymbols.join('、')}</div>
        </div>
      )}

      {snapshot && result?.found && (
        <>
          <div id="buy-condition-detail" className="scroll-mt-4 rounded-xl border border-neutral/40 bg-surface-raised p-4">
            <FinalVerdictPanel verdict={finalVerdictSymbols(snapshot)[result.symbol]} />
            <details className="mb-4 rounded-lg border border-neutral/40 bg-surface-overlay/25 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink-primary">量化原始证据（不单独构成结论）</summary>
              <div className="mt-3">
                {panicStatus?.applicable
                  ? <PanicWindowStatus status={panicStatus} />
                  : <DepthHighlight analysis={result.analysis} presentation={depthPresentation} title="深度买入窗口（个股）" quotePrice={selectedDepthQuotePrice} quote={selectedDepthQuote} />}
              </div>
            </details>
            <ValuationCard
              symbol={result.symbol}
              history={snapshot.pe_history ?? null}
              settings={valuationSettings}
              currentPrice={selectedDepthQuotePrice}
              priceSource={selectedDepthPriceSource}
              displayCurrency={displayCurrency}
              rates={rates}
            />
            <h3 className="text-lg font-semibold">{result.symbol} 原始条件证据</h3>
            {!result.analysis.available ? (
              <p className="mt-3 text-trim">当前无可用判定：{result.analysis.error || '数据未生成'}</p>
            ) : <BuyConditions analysis={result.analysis} />}
          </div>

          <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4">
            <h3 className="font-semibold">历史事件统计</h3>
            {Object.keys(result.analysis.signal_stats || {}).length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">当前没有可展示的历史事件样本。</p>
            ) : Object.entries(result.analysis.signal_stats || {}).map(([name, stats]) => (
              <div key={name} className="mt-3">
                <div className="text-sm font-medium">{name}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <StatWindow label="5 日" stat={stats.d5} />
                  <StatWindow label="20 日" stat={stats.d20} />
                  <StatWindow label="60 日" stat={stats.d60} />
                </div>
              </div>
            ))}
            {result.analysis.depth_stats && <DepthStat stat={result.analysis.depth_stats} />}
            <p className="mt-3 text-xs font-medium text-trim">历史统计不代表未来收益；概率禁止相乘。</p>
          </div>
          <div className="rounded-xl border border-neutral/40 bg-surface-overlay/50 p-3 text-xs text-ink-muted">{snapshot.disclaimer}</div>
        </>
      )}

      {snapshot && (
        <div id="sell-window-detail" className="scroll-mt-4 rounded-xl border border-neutral/40 bg-surface-raised p-4">
          <h3 className="text-lg font-semibold">卖出窗口</h3>
          {snapshot.sell?.shadow && <p className="mt-1 text-sm font-medium text-trim">量化卖出模块当前为观察期，全部信号均未正式生效</p>}
          <p className="mt-1 text-sm text-ink-muted">从当前持仓选择标的，查看量化系统给出的修复期、知足常乐、补涨收敛与止盈阶梯依据。</p>
          <select aria-label="卖出持仓标的" value={selectedSellSymbol} onChange={(event) => setSellSymbol(event.target.value)} className="mt-3 w-full rounded-md border border-neutral bg-transparent px-3 py-2">
            {sellOptions.length === 0 && <option value="">暂无可用持仓</option>}
            {sellOptions.map((item) => <option key={item.symbol} value={item.symbol}>{sellStatusLabel(item.symbol, item.label)}</option>)}
          </select>
          {sellFamilyMatch?.multipleHeldMatches && <p className="mt-2 text-xs font-medium text-trim">该标的同时属于多个族，已按市值最大者展示</p>}
          {!snapshot.sell ? <p className="mt-3 text-sm text-ink-muted">卖出窗口快照尚未生成，请刷新量化快照。</p> : !sellFamily || !familyPnl ? <p className="mt-3 text-sm text-ink-muted">未持有，无卖出窗口可查。</p> : <SellWindow item={sellFamily} status={selectedSellStatus} pnl={familyPnl} displayCurrency={displayCurrency} rates={rates} audit={sellAudit} />}
        </div>
      )}
    </section>
  );
}
