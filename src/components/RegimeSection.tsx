import type { QuantRegimeGridCell, QuantRegimeStatus, QuantRegimeVerdictCard } from '../types';
import { dateText } from '../format';

export function RegimeSection({ regime }: { regime: QuantRegimeStatus | undefined }) {
  if (!regime?.available || !regime.current_cell || !regime.verdict_card) {
    return <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-5"><h3 className="font-semibold">当前状态准备中</h3><p className="mt-2 text-sm text-ink-muted">{regime?.reason ?? '等待量化快照提供唯一当前状态格。'}</p></section>;
  }
  return <section className="space-y-4" aria-label="当前市场状态"><VerdictCard verdict={regime.verdict_card} asOf={regime.current_cell.as_of} /><RegimeMatrix regime={regime} /><PositionAdvice regime={regime} /></section>;
}

function VerdictCard({ verdict, asOf }: { verdict: QuantRegimeVerdictCard; asOf: string }) {
  const tqqq = verdict.leveraged['60'];
  const worstCase = verdict.caveats.find((item) => item.startsWith('最差情形'))?.replace(/^最差情形\s*/, '') ?? '暂无';
  return <article className="rounded-2xl border border-buy/35 bg-gradient-to-br from-buy/12 via-surface-raised to-surface-raised p-4 sm:p-6">
    <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-buy">当前状态</h3><span className="font-mono text-[11px] tabular-nums text-ink-muted">{dateText(asOf)}</span></div>
    <h4 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{verdict.headline}</h4><p className="mt-1 text-sm text-ink-secondary">{verdict.cell_label}</p>
    {verdict.sample_sufficient ? <>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">{[20, 60, 120].map((days) => <Horizon key={days} days={days} item={verdict.horizons[String(days)]} emphasis={days === 60} />)}</div>
      <p className="mt-3 font-mono text-xs tabular-nums text-ink-muted">{verdict.sample_context}</p>
      {typeof tqqq === 'object' && tqqq && <p className="mt-3 rounded-xl bg-surface-overlay/45 px-3 py-2 font-mono text-xs tabular-nums text-ink-secondary">TQQQ 同状态 60 日：胜率 {percent(tqqq.win_rate_pct)} · 中位 {signed(tqqq.median_return_pct)} · n={tqqq.n}</p>}
      <p className="mt-3 rounded-xl border border-trim/35 bg-trim/10 px-3 py-2 font-mono text-sm font-semibold tabular-nums text-ink-primary">⚠ 最差情形：{worstCase}</p>
    </> : <p className="mt-4 rounded-xl bg-surface-overlay/50 p-4 text-sm text-ink-muted">{verdict.sample_context}，无统计结论。</p>}
    <p className="mt-3 text-xs leading-relaxed text-ink-muted">{verdict.overlay_note}</p><p className="mt-2 text-xs text-ink-muted">{verdict.action_hint}</p>
    <p className="mt-3 border-t border-neutral/25 pt-3 text-xs text-ink-secondary">你的计划：{verdict.plan_link.ready_count}/{verdict.plan_link.total_count} 条满足{verdict.plan_link.nearest ? ` · 最近「${verdict.plan_link.nearest.label ?? '计划'}」还差 ${verdict.plan_link.nearest.missing.map(roundEmbeddedDecimals).join('、') || '暂无'}` : ''}</p>
  </article>;
}

function Horizon({ days, item, emphasis }: { days: number; item: QuantRegimeVerdictCard['horizons'][string]; emphasis: boolean }) {
  if (!item) return <div className="rounded-xl bg-surface-overlay/45 p-3"><div className="text-xs text-ink-muted">{days} 日</div><div className="mt-2 font-mono text-sm tabular-nums text-ink-muted">暂无</div></div>;
  return <div className={`rounded-xl border p-3 ${emphasis ? 'border-buy/45 bg-buy/10' : 'border-neutral/30 bg-surface-overlay/45'}`}><div className="text-xs text-ink-muted">{days} 日</div><div className={`mt-2 font-mono font-semibold tabular-nums ${emphasis ? 'text-2xl text-buy sm:text-3xl' : 'text-lg text-ink-primary'}`}>{percent(item.win_rate_pct)}</div><div className="mt-1 font-mono text-xs tabular-nums text-ink-secondary">中位 {signed(item.median_return_pct)} · n={item.n}</div></div>;
}

function RegimeMatrix({ regime }: { regime: QuantRegimeStatus }) {
  const cells = (regime.grid ?? []).flat(); const current = regime.current_cell!;
  const rows = labels(cells, 'row_bucket_index', 'row_bucket'); const cols = labels(cells, 'col_bucket_index', 'col_bucket');
  return <details className="group rounded-2xl border border-neutral/40 bg-surface-raised"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 sm:px-5"><span><strong>查看完整状态矩阵</strong><span className="mt-1 block text-xs text-ink-muted">当前状态已在上方结论卡显示，此表用于对比其它状态。</span></span><span className="text-ink-muted group-open:rotate-180">⌄</span></summary><div className="border-t border-neutral/25 p-4 sm:p-5"><div className="grid grid-cols-[4.25rem_repeat(5,minmax(0,1fr))] gap-1 text-center sm:grid-cols-[5.5rem_repeat(5,minmax(0,1fr))]"><span />{cols.map((col) => <span key={col.index} className="font-mono text-[9px] tabular-nums text-ink-muted">{col.label}</span>)}{rows.flatMap((row) => [<span key={`r-${row.index}`} className="self-center text-left font-mono text-[10px] tabular-nums text-ink-muted">{row.label}</span>, ...cols.map((col) => { const cell = cells.find((item) => item.row_bucket_index === row.index && item.col_bucket_index === col.index); return <MatrixCell key={`${row.index}-${col.index}`} cell={cell} current={row.index === current.row_index && col.index === current.col_index} />; })])}</div></div></details>;
}

function MatrixCell({ cell, current }: { cell: QuantRegimeGridCell | undefined; current: boolean }) { const stat = cell?.reference; const sufficient = stat?.sample_sufficient; return <div className={`relative rounded-lg border px-0.5 py-2 ${current ? 'border-buy ring-2 ring-buy/35' : 'border-neutral/30'} ${sufficient ? 'bg-buy/10' : 'bg-surface-overlay/45 text-ink-muted'}`}><div className="font-mono text-[9px] font-semibold tabular-nums">{sufficient ? percent(stat?.win_rate_pct) : '样本不足'}</div><div className="font-mono text-[8px] tabular-nums">n={stat?.n ?? 0}</div>{cell && !cell.bear_included && <div className="mt-1 text-[8px] text-trim">仅牛市样本</div>}</div>; }

function PositionAdvice({ regime }: { regime: QuantRegimeStatus }) { const advice = regime.position_advice; if (!advice) return null; return <article className="rounded-2xl border border-neutral/40 bg-surface-raised p-5"><h3 className="font-semibold">建议总风险仓位</h3><p className="mt-1 text-xs text-ink-muted">{advice.scope_note}</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="当前风险仓位" value={`${advice.current_risk_position_pct.toFixed(2)}%`} /><Metric label="状态参考仓位" value={`${advice.suggested_total_pct.toFixed(2)}%`} /><Metric label="与当前差额" value={`${advice.gap_pct >= 0 ? '+' : ''}${advice.gap_pct.toFixed(2)}%`} /></div><p className="mt-3 text-xs text-ink-muted">{advice.disclaimer}</p></article>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-surface-overlay/45 p-3"><div className="text-xs text-ink-muted">{label}</div><div className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink-primary">{value}</div></div>; }
function labels(cells: readonly QuantRegimeGridCell[], index: 'row_bucket_index' | 'col_bucket_index', name: 'row_bucket' | 'col_bucket') { const values = new Map<number, string>(); cells.forEach((cell) => values.set(cell[index], cell[name])); return [...values].sort(([a], [b]) => a - b).map(([index, label]) => ({ index, label })); }
function percent(value: number | null | undefined) { return typeof value === 'number' ? `${value.toFixed(2)}%` : '暂无'; }
function signed(value: number | null | undefined) { return typeof value === 'number' ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '暂无'; }
function roundEmbeddedDecimals(value: string) { return value.replace(/-?\d+\.\d{3,}/g, (match) => Number(match).toFixed(2)); }
