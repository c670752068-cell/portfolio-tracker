import { easternText, beijingText } from '../alertLog';
import { IndexTripletCard, type IndexFlash } from './IndexTripletCard';
import type { IndexQuotes } from '../indexQuotes';
import type { StatusCard } from '../marketStatusBar';

const TONE_CLASS: Record<StatusCard['tone'], string> = {
  warn: 'text-loss',
  calm: 'text-gain',
  muted: 'text-ink-secondary',
};

/** 日志页顶部那排小卡片：QQQ / VIX / CNN / 今日重要 / 当前时段。 */
export function MarketStatusBar({
  cards, dataTime, stale, indexQuotes = null, indexStale = false, indexFlash = {},
}: {
  cards: readonly StatusCard[];
  dataTime: string | null;
  stale: boolean;
  indexQuotes?: IndexQuotes | null;
  indexStale?: boolean;
  indexFlash?: IndexFlash;
}) {
  return (
    <div data-market-status-bar="true" className="space-y-1.5">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {indexQuotes && indexQuotes.items.length > 0 && (
          <IndexTripletCard quotes={indexQuotes} stale={indexStale} flash={indexFlash} />
        )}
        {cards.map((card) => (
          <div
            key={card.key}
            data-status-card={card.key}
            className="w-[5.5rem] shrink-0 rounded-xl border border-neutral/35 bg-surface-overlay px-2 py-1.5 sm:w-auto sm:flex-1"
          >
            <p className="truncate text-[10px] text-ink-muted">{card.label}</p>
            <p className={`truncate text-sm font-bold tabular-nums ${TONE_CLASS[card.tone]}`}>{card.value}</p>
            <p className="truncate text-[10px] tabular-nums text-ink-muted">{card.detail}</p>
            {card.detail2 && (
              <p data-status-detail2={card.key} className="truncate text-[10px] tabular-nums text-ink-muted">{card.detail2}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-muted" role="status">
        {stale && <span className="mr-1 rounded bg-loss/15 px-1.5 py-0.5 font-semibold text-loss">数据延迟</span>}
        数据时间 {dataTime === null ? '暂无' : `${beijingText(dataTime).slice(6)}`}
        {dataTime === null ? '' : `（美东 ${easternText(dataTime).slice(6)}）`} · 每 60 秒自动更新
      </p>
    </div>
  );
}
