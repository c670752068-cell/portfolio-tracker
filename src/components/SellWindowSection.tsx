import { useEffect, useMemo, useState } from 'react';
import { buildAlertHoldingOptions } from '../alertRules';
import { formatDisplayMoney } from '../displayCurrency';
import { computeFamilyPnl, type FamilyPnl } from '../familyPnl';
import { findSellFamily, resolveSellStatus, type ResolvedSellStatus } from '../sellStatus';
import type { DisplayCurrency, ExchangeRates, Holding, QuantAnalysisSnapshot, QuantSellFamily } from '../types';

type OpportunitySide = 'buy' | 'sell';

interface SellWindowSectionProps {
  snapshot: QuantAnalysisSnapshot | null;
  holdings?: Holding[];
  initialSymbol?: string;
  initialSide?: OpportunitySide;
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

function numberText(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : '暂无';
}

function integerText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : '暂无';
}

type StatusTone = 'buy' | 'trim' | 'neutral';

function StatusDot({ tone }: { tone: StatusTone }) {
  const color = tone === 'buy' ? 'bg-buy' : tone === 'trim' ? 'bg-trim' : 'bg-neutral';
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

function ObservationBadge({ visible }: { visible: boolean }) {
  return visible ? <span className="ml-1 text-trim">（观察期，未正式生效）</span> : null;
}

function signedPct(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

function InfoDisclosure({ label, children }: { label: string; children: string }) {
  return (
    <details className="relative ml-1 inline-block align-middle">
      <summary
        aria-label={label}
        className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full text-ink-muted hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-buy"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6M12 7h.01" />
        </svg>
      </summary>
      <div className="absolute right-0 z-20 w-64 rounded-xl border border-neutral/40 bg-surface-raised p-3 text-xs font-normal leading-relaxed text-ink-secondary shadow-lg">
        {children}
      </div>
    </details>
  );
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
        <div className="mt-2 grid gap-2 tabular-nums sm:grid-cols-3">
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
        {pnl.coverage !== 'complete' && <p className="mt-2 text-xs font-medium tabular-nums text-trim">
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
          <InfoDisclosure label="说明：修复期口径">这是市场维度（相对 QQQ 强弱），与你的买入成本无关</InfoDisclosure>
        </div>
        <p className="mt-1">{repairText}</p>
        <p className="mt-2 text-xs text-ink-muted">这是市场维度（相对 QQQ 强弱），与你的买入成本无关。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral/40 p-3">
          <div className="font-semibold">知足常乐<ObservationBadge visible={item.contentment.observation} /></div>
          {!item.contentment.available ? <p className="mt-1 text-ink-muted">该持仓族暂无反弹基准对比数据。</p> : (
            <>
              <p className="mt-1 tabular-nums text-ink-muted">本标的 {numberText(item.contentment.asset_gain_pct, '%')} · QQQ {numberText(item.contentment.qqq_gain_pct, '%')} · 差距 {numberText(item.contentment.gap_vs_qqq_pct, ' 点')}</p>
              <p className={`mt-1 font-medium tabular-nums ${item.contentment.triggered && (item.contentment.actionable ?? gateActionable) ? 'text-trim' : 'text-ink-muted'}`}>{item.contentment.triggered ? ((item.contentment.actionable ?? gateActionable) ? `量化剧本参考比例 ${integerText(item.contentment.minimum_reduction_pct)}%` : '市场依据已出现，但盈利闸门未通过，不构成减仓提示') : '尚未接近或超过 QQQ，不触发该依据'}</p>
            </>
          )}
        </div>
        <div className="rounded-lg border border-neutral/40 p-3">
          <div className="font-semibold">补涨收敛<ObservationBadge visible={item.convergence.observation} /></div>
          <p className="mt-1 tabular-nums text-ink-muted">大科技追平 QQQ：{integerText(item.convergence.count)}/{integerText(item.convergence.minimum_assets)} 只</p>
          <p className={`mt-1 font-medium ${item.convergence.triggered && (item.convergence.actionable ?? gateActionable) ? 'text-trim' : 'text-ink-muted'}`}>{item.convergence.triggered ? ((item.convergence.actionable ?? gateActionable) ? `市场亢奋·量化剧本参考：${item.convergence.action.replace('，仅手动操作', '')}` : '市场依据已出现，但盈利闸门未通过，不构成减仓提示') : '尚未达到补涨收敛门槛'}</p>
        </div>
      </div>
      <div className="rounded-lg border border-neutral/40 p-3">
        <div className="font-semibold">
          止盈阶梯参考 · 剧本：{item.playbook.label || '未标注'}
          <InfoDisclosure label="说明：止盈阶梯适用条件">只在浮盈达到最低档后适用</InfoDisclosure>
        </div>
        {firstStep && <p className="mt-1 text-xs text-ink-muted">只在浮盈达到最低档 +{firstStep.gain_min_pct.toFixed(2)}% 后适用。</p>}
        {isCompleteLoss && firstStep && <p className="mt-2 rounded-lg bg-loss/10 p-3 font-medium tabular-nums text-loss">当前为浮亏 {signedPct(pnl.pnlPct!)}，止盈阶梯（最低档 +{firstStep.gain_min_pct.toFixed(2)}%）尚未适用。下方阶梯仅作参考，不构成减仓提示。</p>}
        {isPartialLoss && <p className="mt-2 rounded-lg bg-trim/10 p-3 font-medium tabular-nums text-trim">已知成本部分为浮亏 {signedPct(pnl.pnlPct!)}（另有 {pnl.unknownCostHoldings.length} 个持仓成本未知）。止盈阶梯参考请以券商实际成本为准。</p>}
        {isPartialGain && <p className="mt-2 rounded-lg bg-trim/10 p-3 font-medium tabular-nums text-trim">该档位基于已计成本部分（另有 {pnl.unknownCostHoldings.length} 个持仓成本未知），实际盈利可能不同；减仓比例请以券商实际成本为准。</p>}
        {belowFirst && firstStep && <p className="mt-2 tabular-nums text-trim">距第一档 +{firstStep.gain_min_pct.toFixed(2)}% 还差 {(firstStep.gain_min_pct - pnl.pnlPct!).toFixed(2)} 点{pnl.coverage === 'partial' ? '（基于已计成本部分）' : ''}</p>}
        {!item.playbook.available ? <p className="mt-1 text-ink-muted">该持仓族尚未配置止盈剧本。</p> : (
          <>
            <ul className={`mt-2 space-y-1 tabular-nums text-ink-secondary ${gateActionable ? '' : 'opacity-40 grayscale'}`}>
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
        {item.recent_signals.length === 0 ? <p className="mt-1 text-ink-muted">最近没有触发 sell 向信号。</p> : <ul className="mt-1 space-y-1 tabular-nums text-ink-secondary">{item.recent_signals.map((signal) => <li key={`${signal.name}-${signal.date}`}>{signal.label} {signal.date}</li>)}</ul>}
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

export function SellWindowSection({ snapshot, holdings = [], initialSymbol = '', initialSide, displayCurrency = 'USD', rates = USD_RATES }: SellWindowSectionProps) {
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
  const sellStatusLabel = (optionSymbol: string, fallbackLabel: string) => {
    const status = resolveSellStatus(snapshot, optionSymbol);
    if (status.state === 'window_open') return `${fallbackLabel} · 卖出窗口开启`;
    if (status.state === 'observation') return `${fallbackLabel} · 观察期`;
    return fallbackLabel;
  };
  const selectedSellTone: StatusTone = selectedSellStatus.state === 'window_open'
    ? 'buy'
    : selectedSellStatus.state === 'observation'
      ? 'trim'
      : 'neutral';
  useEffect(() => {
    if (initialSide !== 'sell') return;
    window.requestAnimationFrame(() => {
      document.getElementById('sell-window-detail')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [initialSide]);

  return (
    <>
      {snapshot && (
        <div id="sell-window-detail" className="scroll-mt-4 rounded-xl border border-neutral/40 bg-surface-raised p-4">
          <h3 className="text-lg font-semibold">卖出窗口</h3>
          {snapshot.sell?.shadow && <p className="mt-1 text-sm font-medium text-trim">量化卖出模块当前为观察期，全部信号均未正式生效</p>}
          <p className="mt-1 text-sm text-ink-muted">从当前持仓选择标的，查看量化系统给出的修复期、知足常乐、补涨收敛与止盈阶梯依据。</p>
          <div className="mt-3 flex items-center gap-2">
            <StatusDot tone={selectedSellTone} />
            <select aria-label="卖出持仓标的" value={selectedSellSymbol} onChange={(event) => setSellSymbol(event.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral bg-transparent px-3 py-2">
              {sellOptions.length === 0 && <option value="">暂无可用持仓</option>}
              {sellOptions.map((item) => <option key={item.symbol} value={item.symbol}>{sellStatusLabel(item.symbol, item.label)}</option>)}
            </select>
          </div>
          {sellFamilyMatch?.multipleHeldMatches && <p className="mt-2 text-xs font-medium text-trim">该标的同时属于多个族，已按市值最大者展示</p>}
          {!snapshot.sell ? <p className="mt-3 text-sm text-ink-muted">卖出窗口快照尚未生成，请刷新量化快照。</p> : !sellFamily || !familyPnl ? <p className="mt-3 text-sm text-ink-muted">未持有，无卖出窗口可查。</p> : <SellWindow item={sellFamily} status={selectedSellStatus} pnl={familyPnl} displayCurrency={displayCurrency} rates={rates} audit={sellAudit} />}
        </div>
      )}
    </>
  );
}
