import type { RiskFinding } from '../types';

interface RiskListProps {
  findings: RiskFinding[];
}

const STYLES: Record<RiskFinding['level'], string> = {
  info: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100',
  critical: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-100',
};

const LABEL: Record<RiskFinding['level'], string> = {
  info: '提示',
  warn: '警示',
  critical: '严重',
};

export function RiskList({ findings }: RiskListProps) {
  return (
    <div className="space-y-2">
      {findings.map((f, i) => (
        <div key={i} className={`rounded-lg border p-3 text-sm ${STYLES[f.level]}`}>
          <div className="flex items-center gap-2">
            <span className="rounded bg-white/60 px-1.5 py-0.5 text-xs font-semibold dark:bg-black/30">
              {LABEL[f.level]}
            </span>
            <span className="font-semibold">{f.title}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed opacity-90">{f.detail}</p>
        </div>
      ))}
    </div>
  );
}
