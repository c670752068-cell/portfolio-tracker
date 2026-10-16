import type { QuantIndexEtfValuationEntry } from '../types';

export function IndexEtfValuationView({ entry, metric }: {
  entry: QuantIndexEtfValuationEntry;
  metric: 'ttm' | 'forward';
}) {
  const value = metric === 'forward' ? entry.forward_pe : entry.current_pe;
  const available = entry.available && value != null && Number.isFinite(value) && value > 0;
  return <div className="space-y-4" data-testid="index-etf-valuation">
    <div className="rounded-xl border border-neutral/35 bg-surface-overlay p-4 sm:p-5">
      <h3 className="font-semibold">{entry.symbol} · {entry.basis_name} · {metric === 'forward' ? '远期 PE（FY1）' : entry.metric_label ?? '指数 PE（发行商口径）'}</h3>
      <strong className="mt-3 block text-3xl tabular-nums">{available ? value.toFixed(2) : '暂无数据'}</strong>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{metric === 'forward' ? entry.forward_note : `估值依据：${entry.basis_symbol}。保留发行商原口径，不将参考标的 PE 冒充杠杆 ETF 自身盈利。`}</p>
      <p className="mt-2 text-xs text-ink-muted">数据截至 {entry.as_of ?? '暂无'} · <a className="text-buy underline" href={entry.source_url} target="_blank" rel="noreferrer noopener">{entry.source} 官方来源 ↗</a></p>
      {(entry.stale || entry.refresh_error) && <p role="status" className="mt-2 text-xs text-amber-600">{entry.stale ? '数据已过期，请以来源日期为准。' : '本次刷新失败，保留上次可靠数据及原日期。'}</p>}
    </div>
    <p className="text-sm leading-relaxed text-ink-secondary">{entry.history_note}</p>
    <p className="text-xs leading-relaxed text-ink-muted">不补造历史曲线或分位；PE 仅供参考，不改变回撤优先的买入判断。</p>
  </div>;
}
