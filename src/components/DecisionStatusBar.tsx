import type { QuantAnalysisSnapshot, QuantAnalysisFreshness } from '../types';

export function DecisionStatusBar({ snapshot }: { snapshot: QuantAnalysisSnapshot }) {
  const buyCount = snapshot.summary?.buy_ready.length ?? 0;
  const sellCount = Object.values(snapshot.sell?.symbols ?? {})
    .filter((family) => family.profit_gate?.verdict === 'ladder_active')
    .length;
  return (
    <section className="grid gap-2 rounded-2xl border border-neutral/40 bg-surface-raised p-3 sm:grid-cols-2" aria-label="当前买卖状态">
      <StatusPill
        active={buyCount > 0}
        activeClass="border-buy/35 bg-buy/10 text-buy"
        text={buyCount > 0 ? `当前 ${buyCount} 个标的达到买入条件` : '当前没有标的达到买入条件'}
      />
      <StatusPill
        active={sellCount > 0}
        activeClass="border-trim/35 bg-trim/10 text-trim"
        text={sellCount > 0 ? `${sellCount} 个持仓达到止盈档` : '当前没有持仓达到止盈档'}
      />
      <FreshnessBadges freshness={snapshot.freshness} />
    </section>
  );
}

function StatusPill({
  active,
  activeClass,
  text,
}: {
  active: boolean;
  activeClass: string;
  text: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${active ? activeClass : 'border-neutral/30 bg-surface-overlay/45 text-ink-muted'}`}>
      {text}
    </div>
  );
}

function FreshnessBadges({ freshness }: { freshness: QuantAnalysisFreshness | undefined }) {
  if (!freshness) return null;
  const badges = [
    ['持仓', freshness.positions_as_of],
    ['价格', freshness.prices_at],
    ['估值', freshness.valuation_as_of],
    ['情绪', freshness.cnn_as_of],
    ['买入判定', freshness.buy_plan_evaluated_at],
    ['卖出判定', freshness.sell_evaluated_at],
    ['胜率状态', freshness.regime_evaluated_at],
  ] as const;
  return (
    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 border-t border-neutral/25 pt-2 sm:col-span-2">
      {badges.map(([label, value]) => (
        <span key={label} className="font-mono text-[10px] tabular-nums text-ink-muted">
          {label} {dateText(value)}
        </span>
      ))}
    </div>
  );
}

function dateText(value: string | null): string {
  if (!value) return '暂无';
  const date = value.slice(0, 10);
  const time = value.length > 10 ? value.slice(11, 16) : '';
  return time ? `${date} ${time}` : date;
}
