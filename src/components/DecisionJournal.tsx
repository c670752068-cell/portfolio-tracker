import { useMemo, useState } from 'react';
import type {
  DecisionLog, DecisionPrediction, DecisionTrade, DecisionTrigger,
} from '../decisionLog';
import { buildDecisionStats, MIN_RELIABLE_SAMPLES, type DecisionStatGroup } from '../decisionLogStats';
import {
  blendedBenchmarkReturn, blendedMaxDrawdownPct, buildTwr, buyAndHoldReturn, maxDrawdownPct,
  type ClosePoint,
} from '../twr';
import { formatDisplayMoney } from '../displayCurrency';
import { formatPct } from '../format';
import type { DisplayCurrency, ExchangeRates } from '../types';

const TRIGGER_LABELS: Record<DecisionTrigger, string> = {
  drawdown: '回撤深度', cnn: 'CNN 恐慌', vix: 'VIX', pe_percentile: 'PE 分位', z_score: 'Z-Score',
  ma200: '200DMA', sma: 'SMA', sell_line: '卖出线', take_profit: '止盈规则', subjective: '主观判断', other: '其他',
};
const STATUS_LABELS: Record<DecisionTrade['status'], string> = {
  pending_note: '待补充', in_progress: '进行中', hit: '命中', miss: '未命中', expired: '过期',
};
const PREDICTION_LABELS: Record<DecisionPrediction['type'], string> = {
  rebuy_after_dip: '卖出后等回调接回', target_price: '买入后目标价', beat_qqq: '买入后跑赢 QQQ',
  take_profit_rule: '止盈规则', none: '无预判',
};

function dateText(value: string | null): string {
  if (!value) return '暂无';
  const parsed = new Date(value);
  return Number.isNaN(+parsed) ? value : parsed.toLocaleString('zh-CN', { timeZone: 'America/New_York', hour12: false });
}

function signedPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '暂无';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function DecisionLogSection({
  log, displayCurrency, rates, error, loading, onSaveNote, onAddTrade,
}: {
  log: DecisionLog | null;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  error?: string;
  loading?: boolean;
  onSaveNote?: (trade: DecisionTrade, note: { trigger: DecisionTrigger[]; prediction: DecisionPrediction | null; note: string; price?: number }) => void;
  onAddTrade?: (draft: { trade_time: string; symbol: string; side: 'BUY' | 'SELL'; qty: number; price?: number }) => void;
}) {
  const stats = useMemo(() => buildDecisionStats(log?.trades ?? []), [log]);

  return (
    <div className="space-y-3 md:space-y-5">
      <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold sm:text-lg">决策日志</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              成交由量化系统按前后两次券商快照差分推算，买入价来自成本增量，卖出价常常缺失、可以手工补。
              每笔记下当时的指标和你的预判，收盘后系统自动判定结果。只记录，不下单。
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-neutral/25 px-2 py-1 text-[10px] font-medium text-ink-secondary">
            {loading ? '读取中…' : `更新于 ${dateText(log?.updated_at ?? null)}`}
          </span>
        </div>
        {error && <p className="mt-2 text-xs text-loss">{error}</p>}
        {stats.pendingNotes > 0 && (
          <p className="mt-3 rounded-lg border border-trim/55 bg-trim/10 px-3 py-2 text-xs font-semibold text-trim" role="status">
            有 {stats.pendingNotes} 笔交易待补充决策理由
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
        <h3 className="text-sm font-bold sm:text-base">命中率统计</h3>
        <p className="mt-1 text-xs text-ink-muted">
          基准来自回测（2015-01 至 2026-10）：没有预判能力时，回调 5% 接回胜率 50%，回调 10% 接回 62%。
          样本少于 {MIN_RELIABLE_SAMPLES} 笔时结论不可靠。
        </p>
        {stats.groups.length === 0 ? (
          <p className="mt-3 text-xs text-ink-muted">还没有填过预判，先在下面的交易里补一条。</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.groups.map((group) => <StatCard key={group.key} group={group} displayCurrency={displayCurrency} rates={rates} />)}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold sm:text-base">交易记录</h3>
          <span className="text-[10px] text-ink-muted">{log?.trades.length ?? 0} 笔</span>
        </div>
        {(log?.trades.length ?? 0) === 0 ? (
          <p className="mt-3 text-xs text-ink-muted">还没有抓到成交。下一次本机同步后会自动出现，也可以在下面手动补录。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {[...(log?.trades ?? [])].reverse().map((trade) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                displayCurrency={displayCurrency}
                rates={rates}
                onSave={onSaveNote}
              />
            ))}
          </ul>
        )}
        <ManualTradeEditor onAdd={onAddTrade} />
      </div>
    </div>
  );
}

export function ReturnsSection({
  log, qqqSeries, sgovSeries, displayCurrency, rates, onAddFlow, onRemoveFlow,
}: {
  log: DecisionLog | null;
  qqqSeries: ClosePoint[];
  sgovSeries: ClosePoint[];
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  onAddFlow?: (draft: { date: string; amount: number; note: string }) => void;
  onRemoveFlow?: (id: string) => void;
}) {
  const twr = useMemo(() => buildTwr(log?.nav_series ?? [], log?.cash_flows ?? []), [log]);
  const ytd = useMemo(
    () => buildTwr(log?.nav_series ?? [], log?.cash_flows ?? [], { from: `${new Date().getUTCFullYear()}-01-01` }),
    [log],
  );
  const lastYear = useMemo(() => {
    const from = new Date();
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    return buildTwr(log?.nav_series ?? [], log?.cash_flows ?? [], { from: from.toISOString().slice(0, 10) });
  }, [log]);
  // 起止同一天时区间长度是零，基准算出来是 0.00%，那不是「没回撤」而是「算不了」。
  const benchmark = twr.start && twr.end && twr.end > twr.start
    ? {
      qqq: buyAndHoldReturn(qqqSeries, twr.start, twr.end),
      blended: blendedBenchmarkReturn(qqqSeries, sgovSeries, twr.start, twr.end, 0.6),
      qqqDrawdown: maxDrawdownPct(qqqSeries, twr.start, twr.end),
      blendedDrawdown: blendedMaxDrawdownPct(qqqSeries, sgovSeries, twr.start, twr.end, 0.6),
    }
    : { qqq: null, blended: null, qqqDrawdown: null, blendedDrawdown: null };

  return (
    <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <h3 className="text-sm font-bold sm:text-base">时间加权收益率 vs QQQ</h3>
      <p className="mt-1 text-xs text-ink-muted">
        口径是网站总资产（三家券商合计）。每日净值由本机同步时写入，出入金由你手工登记后剔除，
        所以这里和长桥 App 的「简单加权」不是一回事。净值序列从 {twr.start ?? '—'} 开始，
        在那之前没有数据，算不出来的区间一律显示暂无。
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="今年以来 TWR" value={signedPct(ytd.returnPct)} />
        <Metric label="近 1 年 TWR" value={signedPct(lastYear.returnPct)} />
        <Metric label="自开始以来 TWR" value={signedPct(twr.returnPct)} />
        <Metric label="净值样本天数" value={`${log?.nav_series.length ?? 0} 天`} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="同期满仓 QQQ" value={signedPct(benchmark.qqq)} />
        <Metric label="同期 60% QQQ + 40% SGOV" value={signedPct(benchmark.blended)} />
        <Metric label="账户最大回撤" value={signedPct(twr.maxDrawdownPct)} />
        <Metric label="QQQ / 60-40 最大回撤" value={`${signedPct(benchmark.qqqDrawdown)} / ${signedPct(benchmark.blendedDrawdown)}`} />
      </div>
      {twr.monthly.length > 0 && (
        <table className="mt-3 w-full text-left text-xs tabular-nums">
          <thead className="text-ink-muted"><tr><th className="py-1 font-medium">月份</th><th className="py-1 font-medium">TWR</th></tr></thead>
          <tbody>
            {twr.monthly.map((row) => (
              <tr key={row.month} className="border-t border-neutral/25">
                <td className="py-1">{row.month}</td>
                <td className={`py-1 ${row.returnPct >= 0 ? 'text-gain' : 'text-loss'}`}>{signedPct(row.returnPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CashFlowEditor
        flows={log?.cash_flows ?? []}
        displayCurrency={displayCurrency}
        rates={rates}
        onAdd={onAddFlow}
        onRemove={onRemoveFlow}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral/35 bg-surface-overlay/35 p-2.5">
      <div className="text-[10px] text-ink-muted sm:text-xs">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums sm:text-base">{value}</div>
    </div>
  );
}

function StatCard({ group, displayCurrency, rates }: { group: DecisionStatGroup; displayCurrency: DisplayCurrency; rates: ExchangeRates }) {
  const ahead = group.baselineGapPp !== null && group.baselineGapPp > 0;
  return (
    <div className="rounded-lg border border-neutral/35 bg-surface-overlay/35 p-3" data-stat-group={group.key}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-ink-primary">{group.label}</span>
        <span className="shrink-0 text-[10px] text-ink-muted">{group.samples} 笔已判定</span>
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums">
        {group.hitRate === null ? '暂无' : formatPct(group.hitRate)}
      </p>
      <p className="mt-0.5 text-[10px] tabular-nums text-ink-secondary">
        {group.baseline === null ? '无基准可比' : `基准 ${formatPct(group.baseline)} · ${group.baselineGapPp === null ? '暂无差距' : `${ahead ? '高出' : '低于'} ${Math.abs(group.baselineGapPp).toFixed(1)} 个百分点`}`}
      </p>
      <p className="mt-1 text-[10px] tabular-nums text-ink-muted">
        平均比不操作 {signedPct(group.avgVsHoldPct)}
        {group.cumulativeVsHoldUsd !== null && ` · 累计 ${formatDisplayMoney(group.cumulativeVsHoldUsd, displayCurrency, rates)}`}
      </p>
      {(group.pending > 0 || group.expired > 0) && (
        <p className="mt-1 text-[10px] text-ink-muted">进行中 {group.pending} 笔 · 过期 {group.expired} 笔</p>
      )}
      {group.note && <p className="mt-1 text-[10px] font-semibold text-trim">{group.note}</p>}
    </div>
  );
}

function TradeRow({ trade, displayCurrency, rates, onSave }: {
  trade: DecisionTrade;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  onSave?: (trade: DecisionTrade, note: { trigger: DecisionTrigger[]; prediction: DecisionPrediction | null; note: string; price?: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = trade.status === 'pending_note';
  return (
    <li
      className={`rounded-xl border p-3 ${pending ? 'border-trim/55 bg-trim/10' : 'border-neutral/30 bg-surface-overlay/25'}`}
      data-trade-row={trade.id}
    >
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-sm font-bold">
            {trade.symbol} · {trade.side === 'BUY' ? '买入' : '卖出'} {trade.qty}
            {trade.price === null ? ' · 价格待补' : ` @ ${formatDisplayMoney(trade.price, displayCurrency, rates)}`}
          </span>
          <span className="mt-0.5 block text-[10px] tabular-nums text-ink-muted">
            {dateText(trade.trade_time)} 美东
            {trade.broker && ` · ${trade.broker}`}
            {trade.price_estimated && ' · 价格为估算'}
            {trade.recorded_by === 'manual' && ' · 手动补录'}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${pending ? 'bg-trim/20 text-trim' : trade.status === 'hit' ? 'bg-gain/15 text-gain' : trade.status === 'miss' ? 'bg-loss/15 text-loss' : 'bg-neutral/25 text-ink-secondary'}`}>
          {STATUS_LABELS[trade.status]}
        </span>
      </button>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums text-ink-secondary sm:grid-cols-4">
        <Indicator label="QQQ 回撤" value={signedPct(trade.indicators.qqq_drawdown_pct)} />
        <Indicator label="该标的回撤" value={signedPct(trade.indicators.symbol_drawdown_pct)} />
        <Indicator label="Z-Score" value={trade.indicators.z_score === null ? '暂无' : trade.indicators.z_score.toFixed(2)} />
        <Indicator label="200DMA 斜率" value={signedPct(trade.indicators.ma200_slope_pct)} />
        <Indicator label="TTM PE" value={trade.indicators.ttm_pe === null ? '暂无' : trade.indicators.ttm_pe.toFixed(1)} />
        <Indicator label="PE 分位" value={trade.indicators.ttm_pe_percentile === null ? '暂无' : `${trade.indicators.ttm_pe_percentile.toFixed(1)}%`} />
        <Indicator label="CNN" value={trade.indicators.cnn_fear_greed === null ? '暂无' : trade.indicators.cnn_fear_greed.toFixed(0)} />
        <Indicator label="VIX" value={trade.indicators.vix === null ? '暂无' : trade.indicators.vix.toFixed(2)} />
      </dl>
      {trade.prediction && (
        <p className="mt-1 text-[10px] text-ink-secondary">
          预判：{PREDICTION_LABELS[trade.prediction.type]}
          {trade.prediction.dip_pct != null && ` · 回调 ${trade.prediction.dip_pct}%`}
          {trade.prediction.target_price != null && ` · 目标 ${formatDisplayMoney(trade.prediction.target_price, displayCurrency, rates)}`}
          {trade.prediction.horizon_months != null && ` · ${trade.prediction.horizon_months} 个月`}
          {trade.prediction.trailing_pct != null && ` · 移动止盈 ${trade.prediction.trailing_pct}%`}
          {trade.prediction.fixed_gain_pct != null && ` · 固定止盈 ${trade.prediction.fixed_gain_pct}%`}
        </p>
      )}
      {trade.note && <p className="mt-1 text-[10px] text-ink-secondary">备注：{trade.note}</p>}
      {trade.status === 'hit' || trade.status === 'miss' || trade.status === 'expired' ? (
        <p className="mt-1 text-[10px] tabular-nums text-ink-muted">
          判定于 {trade.resolved_at ? dateText(trade.resolved_at) : '暂无'} · 结果 {signedPct(trade.result_pct)} · 同期 QQQ {signedPct(trade.qqq_result_pct)} · 比不操作 {signedPct(trade.vs_hold_pct)}
        </p>
      ) : null}
      {open && <NoteForm trade={trade} onSave={onSave} />}
    </li>
  );
}

function Indicator({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-ink-muted">{label}</dt><dd>{value}</dd></div>;
}

function NoteForm({ trade, onSave }: {
  trade: DecisionTrade;
  onSave?: (trade: DecisionTrade, note: { trigger: DecisionTrigger[]; prediction: DecisionPrediction | null; note: string; price?: number }) => void;
}) {
  const [trigger, setTrigger] = useState<DecisionTrigger[]>(trade.trigger);
  const [type, setType] = useState<DecisionPrediction['type'] | ''>(trade.prediction?.type ?? '');
  const [dip, setDip] = useState(String(trade.prediction?.dip_pct ?? 10));
  const [target, setTarget] = useState(String(trade.prediction?.target_price ?? ''));
  const [months, setMonths] = useState(String(trade.prediction?.horizon_months ?? 3));
  const [trailing, setTrailing] = useState(String(trade.prediction?.trailing_pct ?? ''));
  const [fixed, setFixed] = useState(String(trade.prediction?.fixed_gain_pct ?? ''));
  const [note, setNote] = useState(trade.note);
  const [price, setPrice] = useState('');

  function prediction(): DecisionPrediction | null {
    if (!type) return null;
    if (type === 'rebuy_after_dip') return { type, dip_pct: Number(dip), reference_symbol: 'QQQ' };
    if (type === 'target_price') return { type, target_price: Number(target), horizon_months: Number(months) };
    if (type === 'beat_qqq') return { type, horizon_months: Number(months) };
    if (type === 'take_profit_rule') {
      return {
        type,
        trailing_pct: trailing ? Number(trailing) : null,
        fixed_gain_pct: fixed ? Number(fixed) : null,
      };
    }
    return { type: 'none' };
  }

  return (
    <form
      className="mt-3 space-y-2 border-t border-neutral/25 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(trade, {
          trigger, prediction: prediction(), note,
          ...(price ? { price: Number(price) } : {}),
        });
      }}
    >
      <fieldset>
        <legend className="text-[10px] font-semibold text-ink-secondary">触发条件（可多选）</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {(Object.keys(TRIGGER_LABELS) as DecisionTrigger[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={trigger.includes(key)}
              onClick={() => setTrigger((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))}
              className={`min-h-8 rounded-full px-2.5 text-[10px] font-medium ${trigger.includes(key) ? 'bg-buy text-white' : 'bg-neutral/25 text-ink-secondary'}`}
            >
              {TRIGGER_LABELS[key]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-[10px] font-semibold text-ink-secondary">
        预判
        <select
          value={type}
          onChange={(event) => setType(event.target.value as DecisionPrediction['type'] | '')}
          className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal"
        >
          <option value="">先不填</option>
          {(Object.keys(PREDICTION_LABELS) as DecisionPrediction['type'][]).map((key) => (
            <option key={key} value={key}>{PREDICTION_LABELS[key]}</option>
          ))}
        </select>
      </label>
      {type === 'rebuy_after_dip' && (
        <label className="block text-[10px] font-semibold text-ink-secondary">
          等 QQQ 从前高回撤多少接回（%）
          <input value={dip} onChange={(event) => setDip(event.target.value)} inputMode="decimal" className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal tabular-nums" />
        </label>
      )}
      {type === 'target_price' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] font-semibold text-ink-secondary">
            目标价
            <input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="decimal" className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal tabular-nums" />
          </label>
          <label className="block text-[10px] font-semibold text-ink-secondary">
            期限（月）
            <input value={months} onChange={(event) => setMonths(event.target.value)} inputMode="numeric" className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal tabular-nums" />
          </label>
        </div>
      )}
      {type === 'beat_qqq' && (
        <label className="block text-[10px] font-semibold text-ink-secondary">
          期限（月，1 / 3 / 6 / 12）
          <input value={months} onChange={(event) => setMonths(event.target.value)} inputMode="numeric" className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal tabular-nums" />
        </label>
      )}
      {type === 'take_profit_rule' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] font-semibold text-ink-secondary">
            移动止盈（从最高点回落 %）
            <input value={trailing} onChange={(event) => setTrailing(event.target.value)} inputMode="decimal" className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal tabular-nums" />
          </label>
          <label className="block text-[10px] font-semibold text-ink-secondary">
            固定止盈（赚到 %）
            <input value={fixed} onChange={(event) => setFixed(event.target.value)} inputMode="decimal" className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal tabular-nums" />
          </label>
        </div>
      )}
      {trade.price === null && (
        <label className="block text-[10px] font-semibold text-ink-secondary">
          补填成交价（推算成交没有卖出价时用）
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal tabular-nums" />
        </label>
      )}
      <label className="block text-[10px] font-semibold text-ink-secondary">
        备注
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs font-normal" />
      </label>
      <button type="submit" className="min-h-9 w-full rounded-lg bg-buy px-3 text-xs font-bold text-white">保存这笔的理由与预判</button>
    </form>
  );
}

function CashFlowEditor({ flows, displayCurrency, rates, onAdd, onRemove }: {
  flows: DecisionLog['cash_flows'];
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  onAdd?: (draft: { date: string; amount: number; note: string }) => void;
  onRemove?: (id: string) => void;
}) {
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  return (
    <details className="mt-3 rounded-lg border border-neutral/35 bg-surface-overlay/25 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">出入金登记（{flows.length} 条）</summary>
      <p className="mt-1 text-[10px] text-ink-muted">入金填正数、出金填负数；TWR 会把这些钱的影响剔掉。</p>
      {flows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {flows.map((flow) => (
            <li key={flow.id} className="flex items-center justify-between gap-2 text-[10px] tabular-nums text-ink-secondary">
              <span>{flow.date} · {formatDisplayMoney(flow.amount, displayCurrency, rates)}{flow.note && ` · ${flow.note}`}</span>
              <button type="button" onClick={() => onRemove?.(flow.id)} className="rounded bg-neutral/25 px-2 py-0.5 text-[10px]">删除</button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-2 grid grid-cols-3 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!date || !amount) return;
          onAdd?.({ date, amount: Number(amount), note });
          setDate(''); setAmount(''); setNote('');
        }}
      >
        <input value={date} onChange={(event) => setDate(event.target.value)} placeholder="2026-10-16" className="rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs tabular-nums" />
        <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="金额" inputMode="decimal" className="rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs tabular-nums" />
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注" className="rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs" />
        <button type="submit" className="col-span-3 min-h-9 rounded-lg bg-neutral/30 text-xs font-semibold">记一条出入金</button>
      </form>
    </details>
  );
}

function ManualTradeEditor({ onAdd }: {
  onAdd?: (draft: { trade_time: string; symbol: string; side: 'BUY' | 'SELL'; qty: number; price?: number }) => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [time, setTime] = useState('');
  return (
    <details className="mt-3 rounded-lg border border-neutral/35 bg-surface-overlay/25 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">手动补录过去的交易</summary>
      <p className="mt-1 text-[10px] text-ink-muted">推算成交只保留最近 50 条，更早的交易可以自己补。补录的交易没有当时的指标快照。</p>
      <form
        className="mt-2 grid grid-cols-2 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!symbol || !qty || !time) return;
          onAdd?.({
            trade_time: new Date(time).toISOString(), symbol, side, qty: Number(qty),
            ...(price ? { price: Number(price) } : {}),
          });
          setSymbol(''); setQty(''); setPrice(''); setTime('');
        }}
      >
        <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="代码 如 TQQQ" className="rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs" />
        <select value={side} onChange={(event) => setSide(event.target.value as 'BUY' | 'SELL')} className="rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs">
          <option value="BUY">买入</option>
          <option value="SELL">卖出</option>
        </select>
        <input value={qty} onChange={(event) => setQty(event.target.value)} placeholder="数量" inputMode="decimal" className="rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs tabular-nums" />
        <input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="成交价（可空）" inputMode="decimal" className="rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs tabular-nums" />
        <input value={time} onChange={(event) => setTime(event.target.value)} placeholder="成交时间 2026-09-01 14:30" className="col-span-2 rounded-lg border border-neutral/40 bg-surface-raised px-2 py-1.5 text-xs" />
        <button type="submit" className="col-span-2 min-h-9 rounded-lg bg-neutral/30 text-xs font-semibold">补录这笔交易</button>
      </form>
    </details>
  );
}
