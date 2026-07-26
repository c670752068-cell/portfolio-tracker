import type { QuantTodayVerdict, QuantVerdictLevel } from '../types';

interface DailyVerdictCardProps {
  verdict?: QuantTodayVerdict | null;
}

const accentClasses: Record<QuantVerdictLevel, string> = {
  block: 'border-l-loss',
  buy: 'border-l-buy',
  trim: 'border-l-trim',
  wait: 'border-l-ink-secondary',
  hold: 'border-l-neutral',
};

export function DailyVerdictCard({ verdict }: DailyVerdictCardProps) {
  const visibleTitle = verdict?.headline?.trim();
  if (!verdict || !visibleTitle) return null;
  const level = verdict.level in accentClasses ? verdict.level : 'hold';
  const points = Array.isArray(verdict?.points)
    ? verdict.points.filter((point): point is string => typeof point === 'string' && Boolean(point.trim())).slice(0, 3)
    : [];

  return (
    <section
      aria-label="今日决断"
      className={`rounded-2xl border border-neutral/60 border-l-4 bg-surface-raised p-6 ${accentClasses[level]}`}
    >
      <p className="text-sm font-medium tracking-wide text-ink-secondary">今日决断</p>
      <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-ink-primary sm:text-3xl">
        {visibleTitle}
      </h2>
      {points.length > 0 && (
        <ul className="mt-3 grid gap-1 text-sm leading-relaxed text-ink-secondary">
          {points.map((point) => <li key={point}>· {point}</li>)}
        </ul>
      )}
      <p className="mt-3 font-mono text-xs tabular-nums text-ink-muted">
        {verdict.as_of} · 规则 {verdict.rule_version}
      </p>
    </section>
  );
}
