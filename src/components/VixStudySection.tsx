import type {
  QuantVixContext,
  QuantVixStudy,
  QuantVixStudyStatistic,
} from '../types';

export function VixStudySection({
  study,
  context,
}: {
  study: QuantVixStudy | undefined;
  context: QuantVixContext | null;
}) {
  if (!study) return null;
  const persistence = Object.values(study.persistence)
    .sort((left, right) => left.threshold - right.threshold);
  const bucketRows = Object.entries(study.buckets);
  const regimeRows = Object.entries(study.by_regime)
    .map(([name, buckets]) => ({
      name,
      statistic: buckets.ge40?.['60'],
    }))
    .filter((row) => row.statistic && row.statistic.n > 0);
  return (
    <details className="group rounded-2xl border border-neutral/40 bg-surface-raised">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition-transform duration-150 active:scale-[0.99] motion-reduce:transition-none sm:px-5">
        <span>
          <strong className="block text-base">波动率与胜率研究</strong>
          <span className="mt-0.5 block text-xs text-ink-muted">
            {study.source.is_proxy ? 'RV20 代理，非真实 VIX' : '真实 VIX'} · {study.sample.start} 至 {study.sample.end} · {study.sample.trading_days} 个交易日
          </span>
        </span>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-muted transition-transform duration-200 ease-out group-open:rotate-180">
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-neutral/30 px-4 pb-5 pt-4 sm:px-5">
        <p className="rounded-xl bg-surface-overlay/50 p-3 text-sm leading-relaxed text-ink-secondary">
          {study.headline}
        </p>
        {study.regime_concentration.warning && (
          <p className="mt-3 rounded-xl border border-trim/35 bg-trim/10 p-3 text-sm leading-relaxed text-trim">
            {study.regime_concentration.warning}
          </p>
        )}

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <ResearchTable title="高波动持续多久">
            <thead className="text-ink-muted">
              <tr><Th>VIX 档</Th><Th>中位天数</Th><Th>平均天数</Th><Th>次数</Th></tr>
            </thead>
            <tbody>
              {persistence.map((row) => (
                <tr key={row.threshold}>
                  <Td>≥ {numberText(row.threshold)}</Td>
                  <Td>{numberText(row.median_trading_days)}</Td>
                  <Td>{numberText(row.mean_trading_days)}</Td>
                  <Td>{row.episode_count}</Td>
                </tr>
              ))}
            </tbody>
          </ResearchTable>

          <ResearchTable title="各档位 · 持有 60 个交易日">
            <thead className="text-ink-muted">
              <tr><Th>VIX 档</Th><Th>胜率 / 样本</Th><Th>平均收益</Th></tr>
            </thead>
            <tbody>
              {bucketRows.map(([key, horizons]) => (
                <StudyRow key={key} label={bucketLabel(key)} statistic={horizons['60']} />
              ))}
            </tbody>
          </ResearchTable>
        </div>

        {regimeRows.length > 0 && (
          <div className="mt-4">
            <ResearchTable title="极端档（VIX ≥ 40）按市场环境拆分">
              <thead className="text-ink-muted">
                <tr><Th>环境</Th><Th>胜率 / 样本</Th><Th>平均收益</Th></tr>
              </thead>
              <tbody>
                {regimeRows.map((row) => (
                  <StudyRow key={row.name} label={row.name} statistic={row.statistic} />
                ))}
              </tbody>
            </ResearchTable>
          </div>
        )}

        <div className="mt-4 space-y-1 text-xs leading-relaxed text-ink-muted">
          {study.limitations.map((item) => <p key={item}>• {item}</p>)}
          {context?.term_structure?.available === false && (
            <p>• {context.term_structure.reason ?? '期限结构暂不可用'}</p>
          )}
          <p>• 样本不足时不展示胜率数字；高胜率不代表未来仍会重复。</p>
        </div>
      </div>
    </details>
  );
}

function ResearchTable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl bg-surface-overlay/35 p-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[330px] text-left text-xs tabular-nums">
          {children}
        </table>
      </div>
    </section>
  );
}

function StudyRow({
  label,
  statistic,
}: {
  label: string;
  statistic: QuantVixStudyStatistic | undefined;
}) {
  if (!statistic) {
    return <tr><Td>{label}</Td><Td>暂无</Td><Td>暂无</Td></tr>;
  }
  return (
    <tr>
      <Td>{label}</Td>
      <Td>
        {statistic.sample_sufficient && statistic.win_rate_pct !== null
          ? `${statistic.win_rate_pct.toFixed(2)}% · n=${statistic.n}`
          : `样本不足 · n=${statistic.n}`}
      </Td>
      <Td>
        {statistic.sample_sufficient
          ? percentText(statistic.average_return_pct)
          : '暂无'}
      </Td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="pb-2 pr-3 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="border-t border-neutral/20 py-2 pr-3">{children}</td>;
}

function numberText(value: number | null): string {
  return value === null ? '暂无' : value.toFixed(2);
}

function percentText(value: number | null): string {
  if (value === null) return '暂无';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function bucketLabel(key: string): string {
  if (key === 'lt15') return '< 15';
  if (key === 'ge40') return '≥ 40';
  return key;
}
