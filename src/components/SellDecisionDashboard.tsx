import { useEffect, useMemo, useState } from 'react';
import { formatDisplayMoney } from '../displayCurrency';
import type { PeHistoryPayload } from '../peData';
import type { OneTapRefreshState } from '../oneTapRefresh';
import type {
  DisplayCurrency, ExchangeRates, Holding, QuantAnalysisSnapshot, QuantSellFamily,
} from '../types';
import { SellWindowSection } from './SellWindowSection';
import { isDustSellFamily } from '../dustPosition';
import { hasSellValuationConflict as valuationConflict } from '../sellStatus';

interface Props {
  snapshot: QuantAnalysisSnapshot | null;
  holdings: Holding[];
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  selectedFamily?: string;
  onSelectedFamilyChange?: (family: string) => void;
  ttmHistory?: PeHistoryPayload;
  initialOpen?: boolean;
  onRefresh?: () => void;
  refreshState?: OneTapRefreshState;
  refreshCooldownSeconds?: number;
}

interface Command {
  number: string;
  state: 'execute' | 'standby' | 'blocked';
  title: string;
  trigger: string;
  sellAmount: number;
  remainingAmount: number;
  referenceSymbol?: string;
  referencePrice?: number | null;
  referenceSession?: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pct(value: number | null, signed = true): string {
  if (value === null) return '暂无';
  return `${signed && value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function signedMoney(
  value: number | null,
  displayCurrency: DisplayCurrency,
  rates: ExchangeRates,
): string {
  if (value === null) return '金额待确认';
  const absolute = formatDisplayMoney(Math.abs(value), displayCurrency, rates);
  if (value > 0) return `+${absolute}`;
  if (value < 0) return `-${absolute}`;
  return absolute;
}

function sessionLabel(value: string): string {
  return ({
    pre: '盘前', premarket: '盘前', regular: '盘中', post: '盘后',
    afterhours: '盘后', overnight: '夜盘', closed: '休市', broker: '券商快照',
  } as Record<string, string>)[value] || '当前';
}

function familyPriceText(item: QuantSellFamily): string {
  const positions = item.positions || [];
  if (!positions.length) return '';
  const first = positions[0];
  if (first.current_price === null) return '';
  return `${first.symbol} $${first.current_price.toFixed(2)}`;
}

function commandsFor(item: QuantSellFamily, canSell = item.decision?.verdict === 'SELL'): Command[] {
  const firstPct = Math.max(item.decision?.recommended_sell_pct || 20, 0) / 100;
  const secondPctOfRemaining = 0.2;
  const firstAmount = item.market_value * firstPct;
  const afterFirst = Math.max(item.market_value - firstAmount, 0);
  const secondAmount = afterFirst * secondPctOfRemaining;
  const afterSecond = Math.max(afterFirst - secondAmount, 0);
  const reference = item.positions?.[0];

  return [
    {
      number: '01', state: canSell ? 'execute' : 'standby',
      title: canSell ? '第一令' : '保持阵地',
      trigger: canSell
        ? `${item.decision?.reason || '当前卖出条件已经满足'}。卖出当前仓位的 20%。`
        : item.decision?.reason || '尚未达到最低止盈条件',
      sellAmount: canSell ? firstAmount : 0,
      remainingAmount: canSell ? afterFirst : item.market_value,
      referenceSymbol: reference?.contract_code || reference?.symbol,
      referencePrice: reference?.current_price,
      referenceSession: reference?.price_session,
    },
    {
      number: '02', state: canSell ? 'standby' : 'blocked',
      title: '第二令',
      trigger: '第一令成交后继续持有；只有价格继续上涨、系统再次出现过热或贪婪确认时，卖出剩余仓位的 20%。',
      sellAmount: canSell ? secondAmount : 0,
      remainingAmount: canSell ? afterSecond : item.market_value,
    },
    {
      number: '03', state: canSell ? 'standby' : 'blocked',
      title: '第三令',
      trigger: '第二令成交后继续跟踪；价格继续上涨并再次触及终局危险值时，清仓全部剩余仓位。',
      sellAmount: canSell ? afterSecond : 0,
      remainingAmount: canSell ? 0 : item.market_value,
    },
  ];
}

function commandLabel(item: QuantSellFamily): string {
  if (item.decision?.verdict !== 'SELL') return '继续等待';
  const evidence = item.decision.evidence;
  if (evidence.history.status === 'reached') return '战略撤退';
  if (evidence.valuation.status === 'high') return '高估值减仓';
  if (evidence.sentiment.status === 'greed') return '贪婪减仓';
  return '战术减仓';
}

function CommandRow({ command, displayCurrency, rates }: {
  command: Command;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}) {
  const active = command.state === 'execute';
  return (
    <div className={`grid grid-cols-[2.5rem_1fr] gap-3 border-t border-neutral/30 py-4 first:border-t-0 ${command.state === 'blocked' ? 'opacity-55' : ''}`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${active ? 'bg-gain text-white' : 'bg-surface-overlay text-ink-secondary'}`}>
        {command.number}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm sm:text-base">
            {command.title} · {command.number === '03' ? '全部清仓' : '卖出'} {formatDisplayMoney(command.sellAmount, displayCurrency, rates)}
          </strong>
          <span className={`text-[10px] font-bold tracking-wider sm:text-xs ${active ? 'text-gain' : 'text-ink-muted'}`}>
            {active ? '立即执行' : command.state === 'blocked' ? '禁止推测' : '待命'}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary sm:text-sm">{command.trigger}</p>
        {active && command.referenceSymbol && command.referencePrice !== null && command.referencePrice !== undefined && (
          <p className="mt-2 rounded-lg bg-surface-overlay/75 px-3 py-2 text-xs font-semibold tabular-nums sm:text-sm">
            当前执行参考价 {command.referenceSymbol} {formatDisplayMoney(command.referencePrice, displayCurrency, rates)}（{sessionLabel(command.referenceSession || '')}）
            <span className="ml-2 font-normal text-ink-muted">成交前在券商确认限价</span>
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums sm:text-sm">
          <span className="font-semibold">执行后预计剩余 {formatDisplayMoney(command.remainingAmount, displayCurrency, rates)}</span>
        </div>
      </div>
    </div>
  );
}

export function SellDecisionDashboard({
  snapshot,
  holdings,
  displayCurrency,
  rates,
  selectedFamily: controlledFamily,
  onSelectedFamilyChange,
  ttmHistory,
  initialOpen = false,
  onRefresh,
  refreshState = { phase: 'idle', message: '' },
  refreshCooldownSeconds = 0,
}: Props) {
  const families = useMemo(() => Object.values(snapshot?.sell?.symbols || {}).filter((item) => !isDustSellFamily(item)).sort((a, b) => {
    const aSell = a.decision?.verdict === 'SELL' ? 0 : 1;
    const bSell = b.decision?.verdict === 'SELL' ? 0 : 1;
    return aSell - bSell || b.market_value - a.market_value || a.family.localeCompare(b.family);
  }), [snapshot]);
  const [internalFamily, setInternalFamily] = useState('');
  const [open, setOpen] = useState(initialOpen);
  const requestedFamily = controlledFamily ?? internalFamily;
  const effectiveFamily = requestedFamily || families[0]?.family || '';
  const item = families.find((family) => family.family === effectiveFamily) || null;

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const chooseFamily = (family: string) => {
    setInternalFamily(family);
    onSelectedFamilyChange?.(family);
  };

  if (!snapshot?.sell) return <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4 text-sm text-ink-muted">卖出快照尚未生成，请先同步数据。</div>;

  const refreshBusy = ['requested', 'throttled', 'waiting'].includes(refreshState.phase);

  return (
    <section>
      {onRefresh && (
        <div className="mb-2 flex items-center justify-end gap-2">
          {refreshState.message && (
            <span className={`min-w-0 text-right text-[10px] sm:text-xs ${refreshState.phase === 'error' || refreshState.phase === 'timeout' ? 'text-loss' : refreshState.phase === 'done' ? 'text-gain' : 'text-ink-muted'}`}>
              {refreshState.message}
            </span>
          )}
          <button type="button" onClick={onRefresh} disabled={refreshBusy} className="min-h-11 shrink-0 rounded-lg bg-neutral/25 px-3 text-xs sm:text-sm">
            {refreshBusy ? '刷新中…' : refreshCooldownSeconds > 0 ? `${refreshCooldownSeconds}s` : '刷新'}
          </button>
        </div>
      )}
      <CompactCommand
        item={item}
        requestedFamily={effectiveFamily}
        familyCount={families.length}
        sellCount={families.filter((family) => family.decision?.verdict === 'SELL').length}
        displayCurrency={displayCurrency}
        rates={rates}
        conflict={valuationConflict(item, ttmHistory)}
        open={open}
        onOpen={() => setOpen(true)}
      />

      <SellPricePlanGrid
        families={families}
        displayCurrency={displayCurrency}
        rates={rates}
        onSelect={chooseFamily}
      />

      {open && (
        <CommandDialog
          snapshot={snapshot}
          holdings={holdings}
          families={families}
          item={item}
          selectedFamily={effectiveFamily}
          displayCurrency={displayCurrency}
          rates={rates}
          ttmHistory={ttmHistory}
          onSelect={chooseFamily}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

function CompactCommand({ item, requestedFamily, familyCount, sellCount, displayCurrency, rates, conflict, open, onOpen }: {
  item: QuantSellFamily | null;
  requestedFamily: string;
  familyCount: number;
  sellCount: number;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  conflict: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const canSell = item?.decision?.verdict === 'SELL' && !conflict;
  const pnlUsd = item?.profit_gate?.unrealized_pnl_usd ?? null;
  const pnlPct = item?.profit_gate?.unrealized_pnl_pct ?? null;
  const profitState = pnlPct === null ? '待确认' : pnlPct > 0 ? '盈利' : pnlPct < 0 ? '亏损' : '持平';
  const plannedSellPrice = item?.sell_price_plan?.sell_price ?? null;
  const triggerPrice = item?.sell_price_plan?.trigger_price ?? null;
  const triggerBasis = item?.sell_price_plan?.basis_symbol || item?.family || '';
  const benchmarkPlan = item?.sell_price_plan?.method === 'benchmark_high'
    || item?.sell_price_plan?.method === 'ndx_valuation_stages';
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      className={`w-full rounded-xl border p-3 text-left shadow-sm transition active:scale-[.99] sm:rounded-2xl sm:p-5 ${canSell ? 'border-gain/45 bg-gain/8' : 'border-loss/35 bg-loss/7'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[10px] font-bold tracking-[0.18em] sm:text-xs ${canSell ? 'text-gain' : 'text-loss'}`}>卖出军令 · {sellCount} 可执行</div>
          <h2 className="mt-0.5 truncate text-base font-bold tracking-tight sm:mt-1 sm:text-xl">
            {item ? `${item.family} · ${commandLabel(item)}` : `${requestedFamily || '当前标的'} · 未持仓`}
          </h2>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-bold sm:px-3 sm:py-2 sm:text-xs ${canSell ? 'bg-gain text-white' : 'bg-loss text-white'}`}>
          {conflict ? '数据待同步' : canSell ? '允许卖出' : '不允许卖出'}
        </span>
      </div>
      {item ? (
        <>
          <div className="mt-2 grid grid-cols-3 divide-x divide-neutral/20 rounded-lg bg-surface-raised/65 py-1.5 sm:mt-3 sm:rounded-xl sm:py-2">
            <CompactMetric label="持仓市值" value={formatDisplayMoney(item.market_value, displayCurrency, rates)} />
            <CompactMetric label="盈亏状态" value={`${profitState} ${signedMoney(pnlUsd, displayCurrency, rates)}${pnlPct === null ? '' : ` · ${pct(pnlPct)}`}`} tone={pnlPct === null ? 'neutral' : pnlPct >= 0 ? 'gain' : 'loss'} />
            <CompactMetric
              label="当前卖出线"
              value={conflict
                ? '待测算'
                : benchmarkPlan && triggerPrice !== null
                  ? `${triggerBasis} ${formatDisplayMoney(triggerPrice, displayCurrency, rates)}`
                  : plannedSellPrice === null
                    ? '待测算'
                    : formatDisplayMoney(plannedSellPrice, displayCurrency, rates)}
            />
          </div>
          <p className="mt-2 break-words text-xs text-ink-secondary sm:text-sm">{conflict ? '同一股票的估值曲线与军令快照不一致，已禁止执行。' : item.decision?.reason}</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">该股票当前没有持仓，因此没有卖出军令。</p>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-ink-secondary sm:mt-3 sm:text-xs">
        <span>查看 {familyCount} 个持仓军令</span><span aria-hidden="true">↗</span>
      </div>
    </button>
  );
}

function SellPricePlanGrid({ families, displayCurrency, rates, onSelect }: {
  families: QuantSellFamily[];
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  onSelect: (family: string) => void;
}) {
  if (!families.length) return null;
  const rankedFamilies = [...families].sort((left, right) => {
    const rank = (family: QuantSellFamily) => {
      if (family.decision?.verdict === 'SELL') return 0;
      if (family.sell_price_plan?.quality === 'reference_only') return 3;
      if (family.sell_price_plan?.status === 'reached') return 2;
      return 1;
    };
    return rank(left) - rank(right) || right.market_value - left.market_value || left.family.localeCompare(right.family);
  });
  const sellCount = rankedFamilies.filter((family) => family.decision?.verdict === 'SELL').length;
  const waitingCount = rankedFamilies.length - sellCount;
  return (
    <details data-testid="mobile-sell-price-list" className="group mt-2 overflow-hidden rounded-xl bg-surface-raised/80 shadow-sm ring-1 ring-neutral/25 sm:mt-3 sm:rounded-2xl sm:border sm:border-neutral/35 sm:ring-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 active:bg-surface-overlay/50 sm:min-h-14 sm:px-5 sm:py-3">
        <div>
          <h3 className="text-sm font-bold sm:text-lg">全部持仓卖出价格</h3>
          <p className="mt-0.5 text-[10px] text-ink-muted sm:text-xs">{sellCount} 个可卖 · {waitingCount} 个等待</p>
        </div>
        <span className="flex items-center gap-2 text-[10px] text-ink-muted sm:text-xs">
          <span className="hidden sm:inline">先期权 → 杠杆 → 正股</span>
          <span aria-hidden="true" className="text-base transition-transform duration-200 group-open:rotate-180">⌄</span>
        </span>
      </summary>
      <div className="border-t border-neutral/25 px-2.5 pb-2.5 pt-2 sm:px-5 sm:pb-5 sm:pt-3">
        <p className="mb-2 hidden text-[10px] text-ink-muted sm:block sm:text-xs">普通个股取估值与前高的较早卖点；NVDA/MU 使用高增长宽容线；杠杆指数只看 1× 基准。</p>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-2 lg:grid-cols-4">
          {rankedFamilies.map((family) => (
            <SellPricePlanCard
              key={family.family}
              family={family}
              displayCurrency={displayCurrency}
              rates={rates}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function SellPricePlanCard({ family, displayCurrency, rates, onSelect }: {
  family: QuantSellFamily;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  onSelect: (family: string) => void;
}) {
  const plan = family.sell_price_plan;
  const price = plan?.sell_price ?? null;
  const clearPrice = plan?.clear_price ?? null;
  const referenceOnly = plan?.quality === 'reference_only';
  const planReached = plan?.status === 'reached';
  const actionable = family.decision?.verdict === 'SELL';
  const method = plan?.method === 'forward_pe'
    ? `远期 PE ${plan.sell_forward_pe?.toFixed(0)}`
    : plan?.method === 'recovery_valuation'
      ? plan.strategy_profile === 'high_growth_tolerant'
        ? '高增长宽容线'
        : '前高恢复 + 历史/远期估值'
      : plan?.method === 'benchmark_high'
        ? `${plan.basis_symbol || family.family} 历史新高`
      : plan?.method === 'ndx_valuation_stages'
        ? '纳指100估值三档'
    : plan?.method === 'historical_cycle'
      ? `${plan.basis_symbol || family.family} 历史周期`
      : '数据不足';
  const stage = (key: string) => plan?.stages?.find((item) => item.key === key)?.trigger_price ?? null;
  const derivativePrice = stage('clear_derivatives');
  const stockPrice = stage('trim_stock');
  const extremePrice = stage('extreme_valuation');
  const benchmarkTrigger = plan?.method === 'benchmark_high' || plan?.method === 'ndx_valuation_stages'
    ? plan.trigger_price ?? null
    : null;
  const actionLabel = plan?.action_stage_key === 'trim_stock'
    ? '正股分批'
    : plan?.action_stage_key === 'clear_derivatives'
      ? '清衍生仓'
      : '开始降风险';
  return (
    <button
      data-testid="mobile-sell-price-row"
      type="button"
      onClick={() => onSelect(family.family)}
      className={`min-h-0 rounded-lg border px-2.5 py-2 text-left transition active:scale-[.98] sm:min-h-24 sm:rounded-xl sm:p-3 ${actionable ? 'border-gain/45 bg-gain/8' : 'border-neutral/25 bg-surface-overlay/25'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{family.family}</strong>
        <span className={`text-[9px] font-bold ${actionable ? 'text-gain' : referenceOnly ? 'text-trim' : 'text-ink-muted'}`}>
          {actionable ? '可执行' : planReached ? '暂不执行' : referenceOnly ? '仅参考' : '等待'}
        </span>
      </div>
      <div className="sm:hidden">
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="truncate text-[10px] text-ink-muted">{method}</span>
          <strong className="shrink-0 text-sm tabular-nums">
            {benchmarkTrigger !== null
              ? `${plan?.basis_symbol || family.family} ${formatDisplayMoney(benchmarkTrigger, displayCurrency, rates)}`
              : price === null
                ? '待测算'
                : formatDisplayMoney(price, displayCurrency, rates)}
          </strong>
        </div>
      </div>
      <div className="hidden sm:block">
      {benchmarkTrigger !== null ? (
        <>
          <div className="mt-2 text-base font-bold tabular-nums">
            {plan?.basis_symbol || family.family} 到 {formatDisplayMoney(benchmarkTrigger, displayCurrency, rates)} 触发
          </div>
          <div className="mt-1 text-[10px] text-ink-muted sm:text-xs">
            {family.family} 现价 {plan?.current_price === null || plan?.current_price === undefined ? '暂无' : formatDisplayMoney(plan.current_price, displayCurrency, rates)} · {method}
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 text-base font-bold tabular-nums">
            {price === null ? '暂时无法测算' : `${formatDisplayMoney(price, displayCurrency, rates)} ${plan?.method === 'recovery_valuation' ? actionLabel : '开始卖'}`}
          </div>
          {plan?.method === 'recovery_valuation' ? (
            <div className="mt-1 space-y-0.5 text-[10px] text-ink-muted sm:text-xs">
              <div>
                清衍生仓 {derivativePrice === null ? '待测算' : formatDisplayMoney(derivativePrice, displayCurrency, rates)}
                {' · '}正股分批 {stockPrice === null ? '待测算' : formatDisplayMoney(stockPrice, displayCurrency, rates)}
              </div>
              <div>极端参考 {extremePrice === null ? '待测算' : formatDisplayMoney(extremePrice, displayCurrency, rates)}</div>
              <div>{method}</div>
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-ink-muted sm:text-xs">
              {method}{clearPrice === null ? '' : ` · ${formatDisplayMoney(clearPrice, displayCurrency, rates)} 高估清理`}
            </div>
          )}
        </>
      )}
      </div>
    </button>
  );
}

function CompactMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'gain' | 'loss' }) {
  return (
    <div className="min-w-0 px-2 sm:px-4">
      <div className="text-[9px] text-ink-muted sm:text-xs">{label}</div>
      <div className={`mt-0.5 break-all text-xs font-bold tabular-nums sm:text-base ${tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-ink-primary'}`}>{value}</div>
    </div>
  );
}

function CommandDialog({ snapshot, holdings, families, item, selectedFamily, displayCurrency, rates, ttmHistory, onSelect, onClose }: {
  snapshot: QuantAnalysisSnapshot;
  holdings: Holding[];
  families: QuantSellFamily[];
  item: QuantSellFamily | null;
  selectedFamily: string;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  ttmHistory?: PeHistoryPayload;
  onSelect: (family: string) => void;
  onClose: () => void;
}) {
  const conflict = valuationConflict(item, ttmHistory);
  const canSell = item?.decision?.verdict === 'SELL' && !conflict;
  const context = record(snapshot.context);
  const cnn = numeric(record(context.cnn_fear_greed).score);
  const ndx = numeric(record(context.ndx_valuation).pe_percentile_5y);
  const history = item?.decision?.evidence.history;
  const commands = item ? commandsFor(item, canSell) : [];
  const historyReliable = Boolean(item?.exit_research?.sample_sufficient && (item.exit_research.sample_count || 0) >= 5);
  const canonicalPe = item ? ttmHistory?.symbols[item.family]?.current ?? null : null;
  const decisionPe = item?.decision?.evidence.valuation.current_pe ?? null;
  const forwardDecision = item?.decision?.evidence.valuation.source === 'forward_pe_1bf';
  const decisionPeLabel = forwardDecision ? '当前远期 PE' : '当前 TTM PE';

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-2 sm:items-center sm:p-6" role="presentation">
      <button type="button" aria-label="关闭卖出军令详情" onClick={onClose} className="absolute inset-0 bg-black/35 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="sell-command-dialog-title" className="ui-enter relative max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-neutral/40 bg-surface-raised shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral/30 bg-surface-raised/92 px-4 py-3 backdrop-blur-xl sm:px-5">
          <div>
            <div className="text-[10px] font-bold tracking-[0.18em] text-buy sm:text-xs">持仓卖出军令</div>
            <h2 id="sell-command-dialog-title" className="text-lg font-bold sm:text-xl">选择持仓查看裁决</h2>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-surface-overlay px-4 text-sm font-semibold active:scale-[.97]">关闭</button>
        </header>

        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="持仓卖出军令">
            {families.map((family) => {
              const familyConflict = valuationConflict(family, ttmHistory);
              const familyCanSell = family.decision?.verdict === 'SELL' && !familyConflict;
              const active = family.family === selectedFamily;
              return (
                <button
                  type="button"
                  key={family.family}
                  aria-pressed={active}
                  onClick={() => onSelect(family.family)}
                  className={`min-h-16 rounded-xl border px-3 py-2 text-left transition active:scale-[.98] ${familyCanSell ? 'border-gain/45 bg-gain/10 text-gain' : 'border-loss/40 bg-loss/8 text-loss'} ${active ? 'ring-2 ring-buy ring-offset-2 ring-offset-surface-raised' : ''}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-bold"><span>{family.family}</span><span className="text-[9px]">{familyConflict ? '待同步' : familyCanSell ? '允许卖出' : '不允许卖出'}</span></span>
                  <span className="mt-1 block text-[10px] tabular-nums opacity-80">{formatDisplayMoney(family.market_value, displayCurrency, rates)}{familyPriceText(family) ? ` · ${familyPriceText(family)}` : ''}</span>
                  {family.sell_price_plan?.sell_price !== null && family.sell_price_plan?.sell_price !== undefined && (
                    <span className="mt-0.5 block text-[10px] tabular-nums opacity-80">卖点 {formatDisplayMoney(family.sell_price_plan.sell_price, displayCurrency, rates)}</span>
                  )}
                </button>
              );
            })}
          </div>

          {item ? (
            <div className="mt-4 space-y-3">
              <div className={`rounded-xl border p-4 ${canSell ? 'border-gain/50 bg-gain/8' : 'border-loss/45 bg-loss/7'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className={`text-[10px] font-bold tracking-[0.16em] ${canSell ? 'text-gain' : 'text-loss'}`}>当前军令</div>
                    <h3 className="mt-1 text-xl font-bold sm:text-2xl">{item.family} · {commandLabel(item)}</h3>
                    <p className="mt-1 text-xs text-ink-secondary sm:text-sm">{item.decision?.reason}</p>
                  </div>
                  <span className={`rounded-lg px-3 py-2 text-xs font-bold text-white ${canSell ? 'bg-gain' : 'bg-loss'}`}>{conflict ? '数据待同步' : canSell ? '允许卖出' : '不允许卖出'}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SummaryMetric label="持仓市值" value={formatDisplayMoney(item.market_value, displayCurrency, rates)} />
                  <SummaryMetric label="盈亏状态" value={`${signedMoney(item.profit_gate?.unrealized_pnl_usd ?? null, displayCurrency, rates)} · ${pct(item.profit_gate?.unrealized_pnl_pct ?? null)}`} />
                  <SummaryMetric label={decisionPeLabel} value={decisionPe?.toFixed(2) || '暂无'} />
                  <SummaryMetric label="估值位置" value={item.decision?.evidence.valuation.percentile === null || item.decision?.evidence.valuation.percentile === undefined ? '暂无' : `${item.decision.evidence.valuation.percentile.toFixed(0)} 分位`} />
                </div>
                {conflict && <div className="mt-3 rounded-lg bg-loss px-3 py-2 text-xs font-semibold text-white">同一股票 TTM 不一致：军令快照 {decisionPe?.toFixed(2)} · 估值曲线 {canonicalPe?.toFixed(2)}。已禁止执行，请先同步数据。</div>}
              </div>

              {(item.positions || []).length > 0 && <details className="rounded-xl border border-neutral/35 bg-surface-overlay/30 p-3">
                <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold leading-[2.75rem]">量化持仓实时计价（{item.positions?.length}）</summary>
                <div className="grid gap-2 border-t border-neutral/25 pt-3 sm:grid-cols-2">
                  {(item.positions || []).map((position, index) => <PositionCard key={`${position.broker}-${position.contract_code || position.symbol}-${index}`} position={position} displayCurrency={displayCurrency} rates={rates} />)}
                </div>
                <div className="mt-2 text-[10px] text-ink-muted sm:text-xs">每 20 分钟更新 · {snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString('zh-CN', { hour12: false }) : ''}</div>
              </details>}

              <details className="rounded-xl border border-neutral/35 bg-surface-overlay/30 p-3">
                <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold leading-[2.75rem]">执行序列与估值依据</summary>
                <div className="grid gap-0 border-t border-neutral/25 pt-2 lg:grid-cols-[1.15fr_.85fr]">
                  <section className="lg:pr-4">
                    <h4 className="mt-2 text-sm font-bold">执行序列</h4>
                    <div>{commands.map((command) => <CommandRow key={command.number} command={command} displayCurrency={displayCurrency} rates={rates} />)}</div>
                  </section>
                  <aside className="border-t border-neutral/25 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                    <h4 className="mt-2 text-sm font-bold">估值与卖出测算</h4>
                    <dl className="mt-3 space-y-3 text-xs sm:text-sm">
                      <DataRow label={decisionPeLabel} value={decisionPe?.toFixed(2) || '暂无'} />
                      <DataRow
                        label="当前卖出线"
                        value={(item.sell_price_plan?.method === 'benchmark_high' || item.sell_price_plan?.method === 'ndx_valuation_stages') && item.sell_price_plan.trigger_price !== null && item.sell_price_plan.trigger_price !== undefined
                          ? `${item.sell_price_plan.basis_symbol} ${formatDisplayMoney(item.sell_price_plan.trigger_price, displayCurrency, rates)}`
                          : item.sell_price_plan?.sell_price === null || item.sell_price_plan?.sell_price === undefined
                            ? '暂无'
                            : formatDisplayMoney(item.sell_price_plan.sell_price, displayCurrency, rates)}
                      />
                      <DataRow label="卖出价口径" value={item.sell_price_plan?.method === 'forward_pe'
                        ? `远期 PE ${item.sell_price_plan.sell_forward_pe?.toFixed(0)}`
                        : item.sell_price_plan?.method === 'recovery_valuation'
                          ? item.sell_price_plan.strategy_profile === 'high_growth_tolerant'
                            ? '高增长宽容线'
                            : '前高恢复 + 历史/远期估值'
                          : item.sell_price_plan?.method === 'historical_cycle'
                            ? `${item.sell_price_plan.basis_symbol} 历史周期`
                            : item.sell_price_plan?.method === 'ndx_valuation_stages'
                              ? '纳指100五年估值三档'
                            : '暂无'} />
                      {item.sell_price_plan?.clear_price !== null && item.sell_price_plan?.clear_price !== undefined && <DataRow label="高估清理价" value={formatDisplayMoney(item.sell_price_plan.clear_price, displayCurrency, rates)} />}
                      <DataRow label="5 年 PE 均值" value={item.decision?.evidence.valuation.average_pe?.toFixed(2) || '暂无'} />
                      <DataRow label="保守危险涨幅" value={pct(history?.target_gain_pct ?? null, false)} />
                      <DataRow label="距离危险值" value={history?.gap_pct === null || history?.gap_pct === undefined ? '暂无' : `${history.gap_pct.toFixed(2)} 点`} />
                      <DataRow label="历史到达率" value={history?.historical_reach_pct === null || history?.historical_reach_pct === undefined ? '暂无' : `${history.historical_reach_pct.toFixed(0)}%`} />
                      <DataRow label="市场情绪" value={`CNN ${cnn?.toFixed(0) || '暂无'}`} />
                      <DataRow label="纳指估值" value={`${ndx?.toFixed(0) || '暂无'} 分位`} />
                    </dl>
                    {!historyReliable && <div className="mt-3 rounded-lg border border-trim/30 bg-trim/8 p-3 text-xs text-trim"><strong>小样本，不参与军令。</strong> 当前仅 {item.exit_research?.sample_count || 0} 个独立周期。</div>}
                  </aside>
                </div>
              </details>

              <details className="rounded-xl border border-neutral/35 bg-surface-overlay/30 p-3">
                <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold leading-[2.75rem]">证据档案与完整历史统计</summary>
                <div className="border-t border-neutral/25 pt-3"><SellWindowSection key={item.family} snapshot={snapshot} holdings={holdings} initialSymbol={item.family} displayCurrency={displayCurrency} rates={rates} /></div>
              </details>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-neutral/35 bg-surface-overlay/45 p-6 text-center text-sm text-ink-muted">{selectedFamily} 当前未持仓，无卖出军令。</div>
          )}

          <p className="mt-4 text-[11px] text-ink-muted sm:text-xs">军令仅生成提醒，不自动下单；所有成交仍须在券商 App 手动确认。</p>
        </div>
      </section>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-surface-raised/75 px-3 py-2"><div className="text-[10px] text-ink-muted">{label}</div><div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div></div>;
}

function DataRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-ink-muted">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>;
}

function PositionCard({ position, displayCurrency, rates }: {
  position: NonNullable<QuantSellFamily['positions']>[number];
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}) {
  return (
    <div className="rounded-xl bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="truncate text-sm font-bold">{position.contract_code || position.symbol}</div><div className="mt-0.5 text-[10px] text-ink-muted sm:text-xs">{position.broker} · {position.asset_type === 'option' ? '期权' : position.asset_type === 'etf' ? 'ETF' : '个股'} · {sessionLabel(position.price_session)}</div></div>
        <div className="text-right tabular-nums"><div className="text-sm font-bold">{position.current_price === null ? '暂无' : formatDisplayMoney(position.current_price, displayCurrency, rates)}</div><div className="text-[10px] text-ink-muted">实时参考价</div></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] tabular-nums text-ink-muted sm:text-xs"><span>数量 <b className="text-ink-secondary">{position.quantity}</b></span><span>市值 <b className="text-ink-secondary">{formatDisplayMoney(position.market_value, displayCurrency, rates)}</b></span></div>
      {position.price_note && <div className="mt-1 text-[10px] text-trim">{position.price_note}</div>}
    </div>
  );
}
