export type DailyVerdictAccent = 'buy' | 'trim' | 'neutral';

interface DailyVerdictCardProps {
  title?: string | null;
  detail?: string | null;
  meta?: string | null;
  accent?: DailyVerdictAccent;
}

const accentClasses: Record<DailyVerdictAccent, string> = {
  buy: 'border-l-buy',
  trim: 'border-l-trim',
  neutral: 'border-l-neutral',
};

export function DailyVerdictCard({
  title,
  detail,
  meta,
  accent = 'neutral',
}: DailyVerdictCardProps) {
  const visibleTitle = title?.trim();
  if (!visibleTitle) return null;

  return (
    <section
      aria-label="今日决断"
      className={`rounded-2xl border border-neutral/60 border-l-4 bg-surface-raised p-6 ${accentClasses[accent]}`}
    >
      <p className="text-sm font-medium tracking-wide text-ink-secondary">今日决断</p>
      <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-ink-primary sm:text-3xl">
        {visibleTitle}
      </h2>
      {detail && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-secondary">{detail}</p>}
      {meta && <p className="mt-3 font-mono text-xs tabular-nums text-ink-muted">{meta}</p>}
    </section>
  );
}
