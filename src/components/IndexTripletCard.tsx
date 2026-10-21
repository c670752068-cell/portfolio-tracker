import { changeText, delayText, type IndexQuotes } from '../indexQuotes';

/** 涨跌幅变化时闪一下：涨用网站的上涨色，跌用下跌色。 */
export type IndexFlash = Record<string, 'up' | 'down' | undefined>;

/** 状态条最前面那张卡片：纳斯达克 / 标普500 / 道琼斯，一张卡片三行。 */
export function IndexTripletCard({ quotes, stale, flash }: {
  quotes: IndexQuotes;
  stale: boolean;
  flash: IndexFlash;
}) {
  const delay = quotes.items.find((item) => (item.delayMinutes ?? 0) > 0)?.delayMinutes ?? null;
  const futures = quotes.items.some((item) => item.futures);
  return (
    <div
      data-index-card="true"
      className="w-[10.5rem] shrink-0 rounded-xl border border-neutral/35 bg-surface-overlay px-2 py-1.5 sm:w-auto sm:flex-1"
    >
      <p className="flex items-baseline justify-between gap-1 text-[10px] text-ink-muted">
        <span className="truncate">三大指数{futures ? ' · 期货' : ''}</span>
        {stale
          ? <span className="shrink-0 font-semibold text-loss">数据延迟</span>
          : delay !== null && <span className="shrink-0">{delayText(delay)}</span>}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {quotes.items.map((item) => (
          <li
            key={item.key}
            data-index-row={item.key}
            className={`flex items-baseline justify-between gap-2 rounded text-[11px] tabular-nums ${
              flash[item.key] === 'up' ? 'index-flash-up' : flash[item.key] === 'down' ? 'index-flash-down' : ''
            }`}
          >
            <span className="truncate text-ink-secondary">{item.name}</span>
            <span
              className={`shrink-0 font-bold ${
                item.changePercent === null
                  ? 'text-ink-muted'
                  : item.changePercent > 0 ? 'text-gain' : item.changePercent < 0 ? 'text-loss' : 'text-ink-secondary'
              }`}
              title={item.price === null ? undefined : `${item.symbol} ${item.price.toFixed(2)}`}
            >
              {changeText(item.changePercent)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
