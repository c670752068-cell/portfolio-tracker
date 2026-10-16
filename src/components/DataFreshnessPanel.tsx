import { snapshotDataDates } from '../dataFreshness';
import type { QuantAnalysisSnapshot } from '../types';

export function DataFreshnessPanel({ snapshot, compact = false }: { snapshot: QuantAnalysisSnapshot; compact?: boolean }) {
  const dates = snapshotDataDates(snapshot);
  return (
    <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-3 sm:p-4" aria-label="各项数据更新时间">
      <div className={compact ? 'grid gap-6' : 'grid gap-3 md:grid-cols-3'}>
        <div><h3 className="text-sm font-semibold">行情与日线时间</h3><p className="mt-1 text-xs tabular-nums text-ink-secondary">日线截至：{dates.marketDaily}</p><p className="mt-1 text-xs text-ink-muted">行情评估：{dates.market}</p><p className="mt-1 text-xs text-ink-muted">评估时间不等于成交时刻；盘中/收盘见图表</p></div>
        <div><h3 className="text-sm font-semibold">TTM PE 数据截至</h3><p className="mt-1 text-xs tabular-nums text-ink-secondary">{dates.pe}</p><p className="mt-1 text-xs text-ink-muted">各标的可能不同；远期 PE 时间见对应卡片</p></div>
        <div><h3 className="text-sm font-semibold">历史回撤统计截至</h3><p className="mt-1 text-xs tabular-nums text-ink-secondary">{dates.history}</p><p className="mt-1 text-xs text-ink-muted">统计生成：{dates.historyGenerated}</p></div>
      </div>
      <p className="mt-3 border-t border-neutral/30 pt-2 text-xs text-ink-muted">页面同步成功不代表所有数据同时更新；以上显示各数据源实际提供的日期。</p>
    </section>
  );
}
