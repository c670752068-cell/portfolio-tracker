import { changeText } from '../indexQuotes';
import type { PanicDrop } from '../panicDrop';

const monthDay = (date: string) => date.slice(5);

function Change({ value }: { value: number | null }) {
  const tone = value === null || value === 0 ? 'text-ink-muted' : value > 0 ? 'text-gain' : 'text-loss';
  return <td className={`px-1 py-0.5 text-right ${tone}`}>{changeText(value)}</td>;
}

function verdict(panic: PanicDrop): { title: string; detail: string | null } {
  if (panic.windowOpen === null) return { title: '恐慌性下跌 暂无数据', detail: null };
  const last = panic.lastPanic;
  if (panic.windowOpen && last) {
    return {
      title: `恐慌性下跌 ${monthDay(last.date)} · 标普 ${changeText(last.sp500)}`,
      detail: panic.anchorClose === null ? null : `标普收回 ${Math.round(panic.anchorClose).toLocaleString('en-US')} 前仓位可超 30%`,
    };
  }
  return {
    title: '当前没有恐慌性下跌',
    detail: last && panic.recoveredOn ? `上次 ${monthDay(last.date)}，${monthDay(panic.recoveredOn)} 已收复` : null,
  };
}

/** 每天的收盘涨跌，并明说当前有没有恐慌性下跌。 */
export function PanicDropLog({ panic }: { panic: PanicDrop }) {
  const { title, detail } = verdict(panic);
  return (
    <section data-panic-log="true" aria-label="每日收盘记录" className="rounded-xl border border-neutral/35 bg-surface-overlay px-2.5 py-1.5 text-[11px] tabular-nums">
      <p className={`font-semibold ${panic.windowOpen ? 'text-loss' : 'text-ink-primary'}`}>{title}</p>
      {detail && <p className="text-ink-secondary">{detail}</p>}
      <p className="text-[10px] text-ink-muted">标普收盘跌 3% 以上，且道指、纳指同跌才算</p>
      {panic.days.length > 0 && (
        <div className="mt-1 max-h-[7.5rem] overflow-y-auto" tabIndex={0} aria-label="每日收盘涨跌，可上下滚动">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-surface-overlay text-[10px] text-ink-muted">
              <tr>
                <th scope="col" className="px-1 py-0.5 text-left font-normal">收盘</th>
                <th scope="col" className="px-1 py-0.5 text-right font-normal">标普</th>
                <th scope="col" className="px-1 py-0.5 text-right font-normal">道指</th>
                <th scope="col" className="px-1 py-0.5 text-right font-normal">纳指</th>
              </tr>
            </thead>
            <tbody>
              {panic.days.map((day) => (
                <tr key={day.date} data-panic-day={day.date} className={day.panic ? 'bg-loss/15 font-semibold' : ''}>
                  <td className="whitespace-nowrap px-1 py-0.5 text-ink-secondary">{monthDay(day.date)}{day.panic ? ' 恐慌' : ''}</td>
                  <Change value={day.sp500} />
                  <Change value={day.dow} />
                  <Change value={day.nasdaq} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
