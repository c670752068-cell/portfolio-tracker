import { changeText, delayText, type IndexItem } from '../indexQuotes';

/** 状态条里的黄金卡片：COMEX 黄金期货（GC=F），美元/盎司，近 24 小时都有价。 */
export function GoldCard({ gold, stale }: { gold: IndexItem; stale: boolean }) {
  const change = gold.changePercent;
  return (
    <div
      data-gold-card="true"
      className="w-[5.5rem] shrink-0 rounded-xl border border-neutral/35 bg-surface-overlay px-2 py-1.5 sm:w-auto sm:flex-1"
      title={`${gold.name} ${gold.symbol}，美元/盎司；涨跌幅对上一个结算价，数据源 Yahoo Finance`}
    >
      <p className="truncate text-[10px] text-ink-muted">黄金 美元/盎司</p>
      <p className="truncate text-sm font-bold tabular-nums text-ink-primary">{gold.price === null ? '暂无' : gold.price.toFixed(1)}</p>
      <p className={`truncate text-[10px] font-semibold tabular-nums ${
        change === null ? 'text-ink-muted' : change > 0 ? 'text-gain' : change < 0 ? 'text-loss' : 'text-ink-secondary'
      }`}
      >
        {changeText(change)}
      </p>
      {stale
        ? <p className="truncate text-[10px] font-semibold text-loss">数据延迟</p>
        : delayText(gold.delayMinutes) && <p className="truncate text-[10px] tabular-nums text-ink-muted">{delayText(gold.delayMinutes)}</p>}
    </div>
  );
}
