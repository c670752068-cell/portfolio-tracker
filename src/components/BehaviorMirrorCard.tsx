import type { QuantBehaviorMirror } from '../types';

interface BehaviorMirrorCardProps {
  mirror?: QuantBehaviorMirror | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sufficientSample(stat: { n: number; sample_sufficient: boolean } | undefined): boolean {
  return Boolean(stat?.sample_sufficient && finite(stat.n) && stat.n > 0);
}

export function BehaviorMirrorCard({ mirror }: BehaviorMirrorCardProps) {
  if (!mirror || typeof mirror !== 'object') return null;

  const sellSufficient = sufficientSample(mirror.sell_flycount);
  const chaseSufficient = sufficientSample(mirror.chase_high);
  const labels = (sellSufficient || chaseSufficient) && Array.isArray(mirror.weakness_labels)
    ? mirror.weakness_labels.filter((label): label is string => typeof label === 'string' && Boolean(label.trim()))
    : [];
  const analyzed = finite(mirror.trades_analyzed) ? Math.max(0, mirror.trades_analyzed) : 0;
  const streak = finite(mirror.streak_days_following_rules)
    ? Math.max(0, mirror.streak_days_following_rules)
    : 0;

  return (
    <section aria-label="行为镜子" className="rounded-2xl border border-neutral/50 bg-surface-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-secondary">行为镜子</p>
          <h2 className="text-body mt-1 text-lg font-semibold text-ink-primary">
            {labels.length > 0 ? labels.join(' · ') : '数据积累中'}
          </h2>
        </div>
        {streak > 0 && (
          <span className="rounded-full border border-buy/30 bg-buy/10 px-3 py-1 text-xs tabular-nums text-buy">
            连续守规 {streak} 天
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <BehaviorStat
          label="卖飞比例"
          sample={mirror.sell_flycount?.n}
          sufficient={sellSufficient}
          value={mirror.sell_flycount?.flew_pct}
          detail={finite(mirror.sell_flycount?.avg_missed_60d_pct)
            ? `卖出后 60 日平均少赚 ${mirror.sell_flycount.avg_missed_60d_pct.toFixed(1)}%`
            : null}
        />
        <BehaviorStat
          label="追高比例"
          sample={mirror.chase_high?.n}
          sufficient={chaseSufficient}
          value={mirror.chase_high?.chased_pct}
          detail={finite(mirror.chase_high?.avg_entry_drawdown_pct)
            ? `追高后平均回撤 ${Math.abs(mirror.chase_high.avg_entry_drawdown_pct).toFixed(1)}%`
            : null}
        />
      </div>

      <p className="mt-3 text-xs tabular-nums text-ink-muted">
        已分析 {analyzed} 笔成交
      </p>
    </section>
  );
}

function BehaviorStat({
  label,
  sample,
  sufficient,
  value,
  detail,
}: {
  label: string;
  sample: number | undefined;
  sufficient: boolean;
  value: number | undefined;
  detail: string | null;
}) {
  const safeSample = finite(sample) ? Math.max(0, sample) : 0;
  if (!sufficient || !finite(value)) {
    return (
      <div className="rounded-xl border border-neutral/40 bg-surface-base p-3 text-sm text-ink-secondary">
        <p className="font-medium">数据积累中</p>
        <p className="mt-1 text-xs tabular-nums text-ink-muted">样本 {safeSample}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral/40 bg-surface-base p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink-primary">
        {value.toFixed(1)}%
      </p>
      <p className="text-xs tabular-nums text-ink-muted">样本 {safeSample}</p>
      {detail && <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{detail}</p>}
    </div>
  );
}
