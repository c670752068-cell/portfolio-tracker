import { useEffect, useMemo, useState } from 'react';
import { buildAlertHoldingOptions } from '../alertRules';
import { CASH_EQUIVALENT_SYMBOLS } from '../assetClass';
import { formatDisplayMoney } from '../displayCurrency';
import { computeFamilyPnl, type FamilyPnl } from '../familyPnl';
import { opportunityStatusLabel } from '../opportunityPresentation';
import { isQuantAnalysisStale, lookupQuantSymbol, quantAnalysisAgeHours, quantAnalysisFreshnessText } from '../quantAnalysis';
import { resolveSellStatus, type ResolvedSellStatus } from '../sellStatus';
import type { DisplayCurrency, ExchangeRates, Holding, QuantAnalysisSnapshot, QuantDepthPresentation, QuantGateResult, QuantPanicSymbolStatus, QuantSellFamily, QuantSignalStatWindow, QuantSymbolAnalysis } from '../types';
import { OpportunityOverview, type OpportunitySide } from './OpportunityOverview';

interface ConditionLookupProps {
  snapshot: QuantAnalysisSnapshot | null;
  holdings?: Holding[];
  initialSymbol?: string;
  initialSide?: OpportunitySide;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  displayCurrency?: DisplayCurrency;
  rates?: ExchangeRates;
}

const USD_RATES: ExchangeRates = {
  USD: 1, CNY: 1, HKD: 1, JPY: 1, EUR: 1, GBP: 1,
  updatedAt: null, source: 'fallback',
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
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="font-semibold"><span className={gate.passed ? 'text-emerald-600' : 'text-rose-600'}>{gate.passed ? '✓' : '✗'}</span> {label}</div>
      <div className="mt-1 text-xs text-slate-500">{gateDetail(gateKey, gate)}</div>
    </div>
  );
}

function StatWindow({ label, stat }: { label: string; stat: QuantSignalStatWindow }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <div className="font-medium">{label}</div>
      {stat.sample_insufficient || stat.n < 20 || stat.win_rate === null ? (
        <div className="mt-1 text-amber-700 dark:text-amber-300">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 text-slate-600 dark:text-slate-300">历史成功率 {(stat.win_rate * 100).toFixed(2)}%（n={stat.n}）</div>
      )}
    </div>
  );
}

function DepthStat({ stat }: { stat: NonNullable<QuantSymbolAnalysis['depth_stats']> }) {
  const insufficient = stat.sample_insufficient || stat.n < 20 || stat.win_rate_60d === null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
      <div className="font-medium">回撤深度 {stat.level_pct}%</div>
      {insufficient ? (
        <div className="mt-1 text-amber-700 dark:text-amber-300">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 text-slate-600 dark:text-slate-300">60 日历史成功率 {(stat.win_rate_60d! * 100).toFixed(2)}%（n={stat.n}）</div>
      )}
      <div className="mt-1 text-xs text-slate-500">含熊市样本：{stat.bear_included ? '是' : '否'}</div>
    </div>
  );
}

function sessionLabel(value: string): string {
  return ({ overnight: '夜盘', premarket: '盘前', afterhours: '盘后', regular: '盘中' } as Record<string, string>)[value] || value;
}

const DEPTH_STYLE = {
  ready: {
    panel: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/25',
    badge: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950',
    progress: 'accent-emerald-600',
  },
  near: {
    panel: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/25',
    badge: 'bg-amber-500 text-slate-950 dark:bg-amber-400',
    progress: 'accent-amber-500',
  },
  far: {
    panel: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900',
    badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
    progress: 'accent-slate-400',
  },
} as const;

function DepthHighlight({
  analysis,
  presentation,
  title,
}: {
  analysis: QuantSymbolAnalysis;
  presentation: QuantDepthPresentation | undefined;
  title: string;
}) {
  const depth = analysis.depth_window;
  if (!depth?.applicable) return null;
  if (!presentation) {
    return <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-500 dark:border-slate-700">深度位展示状态待下一份快照生成。</div>;
  }
  const style = DEPTH_STYLE[presentation.status];
  const badge = presentation.status === 'ready'
    ? '深度位 ✓ 已达标'
    : presentation.status === 'near'
      ? `深度位 接近 · 还差 ${presentation.gap_pct.toFixed(2)} 点`
      : '深度位 未达标';
  return (
    <div className={`min-w-0 overflow-hidden rounded-lg border p-3 text-sm ${style.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{title}</div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${style.badge}`}>{badge}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div><span className="block text-xs text-slate-500">当前回撤</span><strong className="text-2xl">{numberText(depth.current_pct, '%')}</strong></div>
        <div><span className="block text-xs text-slate-500">阈值</span><strong className="text-2xl">{numberText(depth.threshold_pct, '%')}</strong></div>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-3">
        <progress aria-label="深度位进度" className={`h-3 min-w-0 flex-1 ${style.progress}`} max={100} value={presentation.progress_pct} />
        {presentation.status === 'ready' && <span className="text-xs font-semibold">超出 {presentation.excess_pct.toFixed(2)} 点</span>}
      </div>
      <div className="mt-2 text-xs text-slate-500">取价时段：{sessionLabel(depth.price_session)}</div>
      <div className={`mt-3 ${depth.sample_insufficient || depth.win_rate_60d === null ? 'text-slate-400 opacity-70' : 'text-indigo-700 dark:text-indigo-300'}`}>
        {depth.sample_insufficient || depth.win_rate_60d === null
          ? `60 日样本不足（n=${depth.n}）`
          : <><strong className="text-xl">60 日胜率 {(depth.win_rate_60d * 100).toFixed(2)}%</strong><span className="ml-2 text-xs">（n={depth.n}）</span></>}
      </div>
    </div>
  );
}

function ReferenceInfo({ gate }: { gate: QuantGateResult | undefined }) {
  if (!gate) return null;
  const stockOnly = gate.reference_only === true;
  return (
    <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">参考信息（不参与开窗）</summary>
      <div className="mt-2 text-xs text-slate-500">
        {stockOnly
          ? `个股 PE 分位 ${numberText(gate.stock_percentile, '%')}`
          : `CNN ${numberText(gate.cnn)}；纳指100 PE 分位 ${numberText(gate.ndx_percentile, '%')}；SOXX 分位 ${numberText(gate.soxx_percentile, '%')}`}
      </div>
    </details>
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
    <div className="mt-3 space-y-3">
      {marketGates.length > 0 && <div className="flex items-center justify-between gap-3">
        <strong>市场条件满足 {marketPassed}/{marketGates.length}</strong>
        <span className="text-xs text-slate-500">市场判断</span>
      </div>}
      {marketGates.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
        {marketGates.map((item) => <GateCard key={item.key} gateKey={item.key} label={item.label} gate={item.gate} />)}
      </div>}
      {lowZone && !isApplicable(lowZone) && !analysis.depth_window?.applicable && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <div className="font-semibold">价格回撤参考</div>
          <div className="mt-1 text-xs text-slate-500">距最近 250 个交易日高点回撤 {numberText(lowZone.current_drawdown_pct, '%')}，不参与个股市场条件计数。</div>
        </div>
      )}
      <ReferenceInfo gate={gates.valuation} />
      <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <summary className="cursor-pointer font-semibold">纪律闸门（决定允许买多少），不是行情判断</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DISCIPLINE_GATES.map(([key, label]) => {
            const gate = gates[key] ?? { passed: false };
            return isApplicable(gate) ? <GateCard key={key} gateKey={key} label={label} gate={gate} /> : null;
          })}
        </div>
      </details>
    </div>
  );
}

function ObservationBadge({ visible }: { visible: boolean }) {
  return visible ? <span className="ml-1 text-amber-700 dark:text-amber-300">（观察期，未正式生效）</span> : null;
}

function PanicWindowStatus({ status, analysis, presentation }: { status: QuantPanicSymbolStatus; analysis: QuantSymbolAnalysis; presentation: QuantDepthPresentation | undefined }) {
  return (
    <div className="mb-4 min-w-0 overflow-hidden rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{status.display.title}</strong>
        <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800 dark:bg-rose-900/60 dark:text-rose-100">{status.display.state_label}</span>
      </div>
      <div className="mt-3"><DepthHighlight analysis={analysis} presentation={presentation} title="3 倍标的深度位" /></div>
      <div className={`mt-3 rounded-lg border p-3 ${status.panic.open ? 'border-rose-400 bg-rose-100 dark:border-rose-700 dark:bg-rose-950/40' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900'}`}>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.panic.open ? 'bg-rose-600 text-white dark:bg-rose-500' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100'}`}>
          恐慌位 {status.panic.open ? '✓ 已触发' : '✗ 未触发'}
        </span>
        <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{status.panic.explanation}</div>
        {status.panic.triggered_session && <div className="mt-1 text-xs font-medium">触发时段：{sessionLabel(status.panic.triggered_session)}</div>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <progress className="h-2 flex-1 accent-rose-600" max={100} value={status.target.progress_pct} />
        <span className="text-xs font-semibold">{status.display.progress_text}</span>
      </div>
      {status.stop_reason && <div className="mt-2 text-xs text-slate-500">停止原因：{status.stop_reason}</div>}
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
  const repairText = item.repair.window_open
    ? '修复完成，可开始分批减仓：优先减期权与两三倍杠杆，不要一次性减完'
    : item.repair.status === 'repairing'
      ? `卖出窗口未开启：深跌修复期内，耐心持有（基准日 ${item.repair.base_date || '暂无'}）`
      : '修复期状态暂不可用，当前不生成卖出动作';
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
  const activeStep = !hasKnownLoss && pnl.pnlPct !== null
    ? steps.find((step) => pnl.pnlPct! >= step.gain_min_pct && pnl.pnlPct! < step.gain_max_pct)
    : undefined;
  const belowFirst = !hasKnownLoss && pnl.pnlPct !== null && firstStep && pnl.pnlPct < firstStep.gain_min_pct;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="font-semibold">本族当前盈亏</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div>
            <div>市值 {formatDisplayMoney(pnl.marketValue, displayCurrency, rates)}</div>
            {pnl.coverage === 'partial' && <div className="mt-1 text-xs text-slate-500">
              其中已计成本 {formatDisplayMoney(pnl.costedMarketValue, displayCurrency, rates)} · 未计成本 {formatDisplayMoney(pnl.uncostedMarketValue, displayCurrency, rates)}
            </div>}
          </div>
          {pnl.coverage === 'unavailable'
            ? <div className="text-slate-500">成本未知</div>
            : <>
              <div>成本 {formatDisplayMoney(pnl.costBasis, displayCurrency, rates)}</div>
              <div className={pnl.pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                浮盈亏 {formatDisplayMoney(pnl.pnl, displayCurrency, rates)}（{pnl.pnlPct! >= 0 ? '+' : '-'}{Math.abs(pnl.pnlPct!).toFixed(2)}%{pnl.coverage === 'partial' ? ` · 基于已计成本部分 ${formatDisplayMoney(pnl.costedMarketValue, displayCurrency, rates)}` : ''}）
              </div>
            </>}
        </div>
        {pnl.coverage !== 'complete' && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          {pnl.unknownCostHoldings.length} 个持仓成本未知（{unknownCostGuidance}），未计入本次盈亏：{pnl.unknownCostHoldings.join('、')}
        </p>}
      </div>
      {status.state !== 'none' && (
        <div className={`rounded-lg border p-3 ${status.state === 'window_open' ? 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900'}`}>
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <span>触发依据：{status.trigger || '量化系统卖出证据'}</span>
            {status.state === 'observation' && <span className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-100">观察期，未正式生效</span>}
          </div>
          {status.detail && <p className="mt-2 text-slate-600 dark:text-slate-300">{status.detail}</p>}
          <p className="mt-2 text-xs text-slate-500">该判定来自量化系统的相对强弱口径（自反弹基准日涨幅 vs QQQ），与你的买入成本无关；是否盈利请看下方「本族当前盈亏」。</p>
        </div>
      )}
      <div className={`rounded-lg border p-3 ${item.repair.window_open ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
        <div className="font-semibold">{repairText}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="font-semibold">知足常乐<ObservationBadge visible={item.contentment.observation} /></div>
          {!item.contentment.available ? <p className="mt-1 text-slate-500">该持仓族暂无反弹基准对比数据。</p> : (
            <>
              <p className="mt-1 text-slate-500">本标的 {numberText(item.contentment.asset_gain_pct, '%')} · QQQ {numberText(item.contentment.qqq_gain_pct, '%')} · 差距 {numberText(item.contentment.gap_vs_qqq_pct, ' 点')}</p>
              <p className={`mt-1 font-medium ${item.contentment.triggered ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>{item.contentment.triggered ? `建议至少减仓 ${integerText(item.contentment.minimum_reduction_pct)}%` : '尚未接近或超过 QQQ，不触发该依据'}</p>
            </>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="font-semibold">补涨收敛<ObservationBadge visible={item.convergence.observation} /></div>
          <p className="mt-1 text-slate-500">大科技追平 QQQ：{integerText(item.convergence.count)}/{integerText(item.convergence.minimum_assets)} 只</p>
          <p className={`mt-1 font-medium ${item.convergence.triggered ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>{item.convergence.triggered ? `市场亢奋·${item.convergence.action.replace('，仅手动操作', '')}` : '尚未达到补涨收敛门槛'}</p>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="font-semibold">止盈阶梯参考</div>
        {isCompleteLoss && firstStep && <p className="mt-2 rounded-lg bg-rose-50 p-3 font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">当前为浮亏 {signedPct(pnl.pnlPct!)}，止盈阶梯（最低档 +{firstStep.gain_min_pct.toFixed(2)}%）尚未适用。下方阶梯仅作参考，不构成减仓提示。</p>}
        {isPartialLoss && <p className="mt-2 rounded-lg bg-amber-50 p-3 font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">已知成本部分为浮亏 {signedPct(pnl.pnlPct!)}（另有 {pnl.unknownCostHoldings.length} 个持仓成本未知）。止盈阶梯参考请以券商实际成本为准。</p>}
        {isPartialGain && <p className="mt-2 rounded-lg bg-amber-50 p-3 font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">该档位基于已计成本部分（另有 {pnl.unknownCostHoldings.length} 个持仓成本未知），实际盈利可能不同；减仓比例请以券商实际成本为准。</p>}
        {belowFirst && firstStep && <p className="mt-2 text-amber-700 dark:text-amber-300">距第一档 +{firstStep.gain_min_pct.toFixed(2)}% 还差 {(firstStep.gain_min_pct - pnl.pnlPct!).toFixed(2)} 点{pnl.coverage === 'partial' ? '（基于已计成本部分）' : ''}</p>}
        {!item.playbook.available ? <p className="mt-1 text-slate-500">该持仓族尚未配置止盈剧本。</p> : (
          <>
            <ul className={`mt-2 space-y-1 text-slate-600 dark:text-slate-300 ${isCompleteLoss ? 'opacity-40 grayscale' : ''}`}>
              {steps.map((step) => {
                const active = activeStep === step;
                return <li data-active={active ? 'true' : undefined} className={active ? 'rounded bg-emerald-100 px-2 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : ''} key={`${step.gain_min_pct}-${step.gain_max_pct}`}>盈利 {step.gain_min_pct.toFixed(2)}%{step.gain_max_pct >= 999 ? '+' : `–${step.gain_max_pct.toFixed(2)}%`}：减总仓 {step.sell_position_pct.toFixed(2)}%</li>;
              })}
            </ul>
            <p className="mt-2 text-xs text-slate-500">优先顺序：{item.playbook.risk_first_order.map((role) => RISK_ROLE_LABELS[role] || role).join(' → ')}</p>
          </>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="font-semibold">近期卖出信号</div>
        {item.recent_signals.length === 0 ? <p className="mt-1 text-slate-500">最近没有触发 sell 向信号。</p> : <ul className="mt-1 space-y-1 text-slate-600 dark:text-slate-300">{item.recent_signals.map((signal) => <li key={`${signal.name}-${signal.date}`}>{signal.label} {signal.date}</li>)}</ul>}
      </div>
      <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <summary className="cursor-pointer font-semibold">原始判定数据</summary>
        <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-3 text-xs dark:bg-slate-900">{JSON.stringify(audit, null, 2)}</pre>
        <p className="mt-2 text-xs text-slate-500">用于核对量化系统口径；若这里显示的族数与你的预期不符，请把本块内容反馈给量化系统维护方。</p>
      </details>
      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">只提醒不下单；由你在券商 App 手动执行。</p>
    </div>
  );
}

export function ConditionLookup({ snapshot, holdings = [], initialSymbol = '', initialSide, loading = false, error = '', onRefresh, displayCurrency = 'USD', rates = USD_RATES }: ConditionLookupProps) {
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
  const sellFamily = snapshot?.sell
    ? Object.values(snapshot.sell.symbols).find((item) => item.family === selectedSellSymbol || item.held_symbols.includes(selectedSellSymbol))
    : undefined;
  const selectedSellStatus = resolveSellStatus(snapshot, selectedSellSymbol);
  const familyPnl = sellFamily
    ? computeFamilyPnl(holdings, sellFamily.family, sellFamily.held_symbols, snapshot?.holding_costs || {})
    : null;
  const sellAudit = sellFamily ? {
    sell_ready: snapshot?.summary?.sell_ready.find((item) => item.symbol === sellFamily.family) ?? null,
    family: sellFamily.family,
    held_symbols: sellFamily.held_symbols,
    classified_symbols: sellOptions
      .map((item) => ({ symbol: item.symbol, state: resolveSellStatus(snapshot, item.symbol).state }))
      .filter((item) => item.state !== 'none'),
  } : {};
  const panicStatus = snapshot?.panic_window?.symbols[selectedSymbol];
  const depthPresentation = snapshot?.summary?.depth_states[selectedSymbol];
  const sellStatusLabel = (optionSymbol: string, fallbackLabel: string) => {
    const status = resolveSellStatus(snapshot, optionSymbol);
    if (status.state === 'window_open') return `🟠 ${fallbackLabel} · 卖出窗口开启`;
    if (status.state === 'observation') return `⚪ ${fallbackLabel} · 观察期`;
    return `⚪ ${fallbackLabel} · 无`;
  };
  const selectOpportunity = (nextSymbol: string, side: OpportunitySide) => {
    if (side === 'buy') setSymbol(nextSymbol);
    else setSellSymbol(nextSymbol);
    window.requestAnimationFrame(() => {
      document.getElementById(side === 'buy' ? 'buy-condition-detail' : 'sell-window-detail')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
      {snapshot && <OpportunityOverview snapshot={snapshot} onSelect={selectOpportunity} />}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">量化条件查询</h2>
            <p className="mt-1 text-sm text-slate-500">从量化监控池选择标的，查看生产口径的买入条件和历史事件统计。</p>
          </div>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={loading} className="rounded-md bg-slate-200 px-3 py-2 text-sm dark:bg-slate-700">{loading ? '读取中…' : '刷新快照'}</button>}
        </div>
        {snapshot && <p className="mt-2 text-xs text-slate-500">{quantAnalysisFreshnessText(snapshot.generated_at)}</p>}
        <select aria-label="量化监控标的" value={selectedSymbol} onChange={(event) => setSymbol(event.target.value)} className="mt-4 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">
          {monitoredSymbols.map((item) => <option key={item} value={item}>{opportunityStatusLabel(snapshot?.summary, item)}</option>)}
        </select>
      </div>

      {error && <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100">读取失败：{error}</div>}
      {!snapshot && !error && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">{loading ? '正在读取量化系统快照…' : '暂无量化分析快照。'}</div>}

      {snapshot && isQuantAnalysisStale(snapshot.generated_at) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">量化分析数据 {snapshotAgeHours === null ? '时间未知' : `${snapshotAgeHours} 小时前`}，可能过期。</div>
      )}

      {snapshot && result && !result.found && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="font-semibold">{result.symbol || '该代码'} 不在量化监控池，无判定数据</div>
          <div className="mt-2 text-sm text-slate-500">池内代码：{result.monitoredSymbols.join('、')}</div>
        </div>
      )}

      {snapshot && result?.found && (
        <>
          <div id="buy-condition-detail" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            {panicStatus?.applicable
              ? <PanicWindowStatus status={panicStatus} analysis={result.analysis} presentation={depthPresentation} />
              : <DepthHighlight analysis={result.analysis} presentation={depthPresentation} title="深度买入窗口（个股）" />}
            <h3 className="text-lg font-semibold">{result.symbol} 买入条件</h3>
            {!result.analysis.available ? (
              <p className="mt-3 text-amber-700 dark:text-amber-300">当前无可用判定：{result.analysis.error || '数据未生成'}</p>
            ) : <BuyConditions analysis={result.analysis} />}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="font-semibold">历史事件统计</h3>
            {Object.keys(result.analysis.signal_stats || {}).length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">当前没有可展示的历史事件样本。</p>
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
            <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">历史统计不代表未来收益；概率禁止相乘。</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">{snapshot.disclaimer}</div>
        </>
      )}

      {snapshot && (
        <div id="sell-window-detail" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="text-lg font-semibold">卖出窗口</h3>
          {snapshot.sell?.shadow && <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-300">量化卖出模块当前为观察期，全部信号均未正式生效</p>}
          <p className="mt-1 text-sm text-slate-500">从当前持仓选择标的，查看量化系统给出的修复期、知足常乐、补涨收敛与止盈阶梯依据。</p>
          <select aria-label="卖出持仓标的" value={selectedSellSymbol} onChange={(event) => setSellSymbol(event.target.value)} className="mt-3 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">
            {sellOptions.length === 0 && <option value="">暂无可用持仓</option>}
            {sellOptions.map((item) => <option key={item.symbol} value={item.symbol}>{sellStatusLabel(item.symbol, item.label)}</option>)}
          </select>
          {!snapshot.sell ? <p className="mt-3 text-sm text-slate-500">卖出窗口快照尚未生成，请刷新量化快照。</p> : !sellFamily || !familyPnl ? <p className="mt-3 text-sm text-slate-500">未持有，无卖出窗口可查。</p> : <SellWindow item={sellFamily} status={selectedSellStatus} pnl={familyPnl} displayCurrency={displayCurrency} rates={rates} audit={sellAudit} />}
        </div>
      )}
    </section>
  );
}
