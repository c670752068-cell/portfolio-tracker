import type { PeakDistance } from '../marketStatusBar';

/** 过档后的底色深浅：第一档最浅，最后一档最深（90%）。 */
function shade(item: PeakDistance): number {
  return Math.round(15 + 75 * (item.level / item.tiers.length));
}

function detailText(item: PeakDistance): string {
  if (item.level > 0) return `已过 -${item.tiers[item.level - 1]}% 档`;
  if (item.nextTier !== null && item.gapPct !== null) return `差 ${item.gapPct.toFixed(1)}% 到 -${item.nextTier}%`;
  return '暂无';
}

/** SPY、DIA、QQQ 距前高（夜盘、盘前用当时的价）：没变色不加杠杆，变色后颜色越深越可以加。 */
export function PeakDistanceStrip({ items }: { items: readonly PeakDistance[] }) {
  return (
    <div data-peak-distance="true" className="grid grid-cols-3 gap-1.5" aria-label="距前高（变色才考虑加杠杆）">
      {items.map((item) => {
        const value = item.drawdownPct === null
          ? '暂无'
          : `${item.drawdownPct > 0 ? '+' : ''}${item.drawdownPct.toFixed(1)}%`;
        const dark = item.level > 0 && shade(item) >= 60;
        return (
          <div
            key={item.key}
            data-peak-symbol={item.key}
            data-level={item.level}
            className={`min-w-0 rounded-xl border px-2 py-1.5 ${item.level > 0 ? 'border-gain/40' : 'border-neutral/35 bg-surface-overlay'}`}
            title={`${item.label} 距前高 ${value}；变色档位 ${item.tiers.map((tier) => `-${tier}%`).join(' / ')}，没变色不加杠杆`}
            style={item.level > 0 ? { background: `color-mix(in srgb, var(--color-gain) ${shade(item)}%, transparent)` } : undefined}
          >
            <p className={`truncate text-[10px] tabular-nums ${dark ? 'text-white/85 dark:text-surface-base/80' : 'text-ink-muted'}`}>
              {[item.key, item.priceLabel, item.price === null ? '暂无' : item.price.toFixed(2)].filter(Boolean).join(' ')}
            </p>
            <p className={`truncate tabular-nums ${dark ? 'text-white dark:text-surface-base' : 'text-ink-primary'}`}>
              <strong className="text-sm font-bold">{value}</strong> <span className="text-[10px] font-normal">距前高</span>
            </p>
            <p className={`truncate text-[10px] tabular-nums ${dark ? 'text-white/85 dark:text-surface-base/80' : 'text-ink-muted'}`}>{detailText(item)}</p>
          </div>
        );
      })}
    </div>
  );
}
