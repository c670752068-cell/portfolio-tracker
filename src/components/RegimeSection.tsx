import { useState } from 'react';
import type {
  QuantRegimeGridCell,
  QuantRegimeStatistic,
  QuantRegimeStatus,
} from '../types';

interface RegimeSectionProps {
  regime: QuantRegimeStatus | undefined;
}

const HORIZONS = [20, 60, 120] as const;
const BENCHMARKS = ['QQQ', 'TQQQ'] as const;

export function RegimeSection({ regime }: RegimeSectionProps) {
  if (!regime?.available || !regime.current) {
    return (
      <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-5">
        <h3 className="font-semibold">联合历史准备中</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {regime?.reason ?? '下一份包含情绪与估值联合样本的量化快照到达后自动显示。'}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label="情绪与估值联合状态">
      <RegimeHeadline regime={regime} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <RegimeGrid regime={regime} />
        <WinRateTable regime={regime} />
      </div>
      <PositionAdvice regime={regime} />
    </section>
  );
}

function RegimeHeadline({ regime }: { regime: QuantRegimeStatus }) {
  const divergence = regime.divergence;
  const quality = regime.data_quality;
  return (
    <article className="rounded-2xl border border-buy/30 bg-gradient-to-br from-buy/12 via-surface-raised to-surface-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-buy">
          情绪 × 估值联合状态
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">
          {regime.evaluated_at ?? '时间暂无'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {regime.current?.regime_label}
        </p>
        {divergence?.detected && (
          <span className="rounded-full bg-buy/15 px-2.5 py-1 text-xs font-semibold text-buy">
            出现背离
          </span>
        )}
      </div>
      {divergence && (
        <p className="mt-3 max-w-4xl text-sm leading-relaxed text-ink-secondary">
          {divergence.note}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs tabular-nums text-ink-muted">
        <span>PE 分位 {numberText(regime.current?.pe_percentile_5y)}%</span>
        <span>CNN {numberText(regime.current?.cnn_score)}</span>
        {quality && <span>联合样本 {quality.joint_sample_days} 天</span>}
        {divergence && <span>同类背离 {divergence.historical_occurrences} 次</span>}
      </div>
      {quality && (
        <div className="mt-4 rounded-xl bg-surface-overlay/45 p-3 text-xs leading-relaxed text-ink-muted">
          {quality.joint_start ?? '起始暂无'} 至 {quality.joint_end ?? '结束暂无'} ·
          {' '}原始 PE {quality.raw_pe_observations} 条 / CNN {quality.raw_cnn_observations} 条
          {quality.pe_interpolated && ' · PE 已做线性插值'}
          <div className="mt-1">{quality.caveat}</div>
        </div>
      )}
      {quality?.conclusion_allowed === false && quality.headline_caveat && (
        <div className="mt-4 rounded-xl border border-trim/35 bg-trim/10 p-3 text-sm leading-relaxed text-ink-primary">
          <strong className="text-trim">样本范围提醒：</strong> {quality.headline_caveat}
        </div>
      )}
      {divergence?.no_reference && divergence.reference_note && (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">{divergence.reference_note}</p>
      )}
    </article>
  );
}

function RegimeGrid({ regime }: { regime: QuantRegimeStatus }) {
  const cells = (regime.grid ?? []).flat();
  const current = regime.current;
  const currentCell = cells.find((item) => (
    item.pe_bucket_index === current?.pe_bucket_index
    && item.cnn_bucket_index === current.cnn_bucket_index
  ));
  const [selectedKey, setSelectedKey] = useState(currentCell ? cellKey(currentCell) : null);
  const selectedCell = cells.find((item) => cellKey(item) === selectedKey) ?? currentCell;
  const peLabels = uniqueLabels(cells, 'pe_bucket_index', 'pe_bucket');
  const cnnLabels = uniqueLabels(cells, 'cnn_bucket_index', 'cnn_bucket');
  return (
    <article className="min-w-0 rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">5×5 状态定位</h3>
        <span className="text-[11px] text-ink-muted">行=PE分位 · 列=CNN情绪</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
        行 = 估值高低（PE 分位），列 = 市场情绪（CNN）。每格 = 该状态下买入 QQQ 持有 60 天的胜率与样本数。
      </p>
      {cells.length === 0 ? (
        <EmptyEvidence />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-[4.25rem_repeat(5,minmax(0,1fr))] gap-1 text-center sm:grid-cols-[5.5rem_repeat(5,minmax(0,1fr))]">
            <span />
            {cnnLabels.map((label) => (
              <span key={label.index} className="truncate px-0.5 text-[9px] text-ink-muted sm:text-[10px]">
                {shortBucket(label.label)}
              </span>
            ))}
            {peLabels.flatMap((pe) => {
              const rowCells = cnnLabels.map((cnn) => (
                <GridCell
                  key={`${pe.index}-${cnn.index}`}
                  cell={cells.find((item) => item.pe_bucket_index === pe.index && item.cnn_bucket_index === cnn.index)}
                  current={current?.pe_bucket_index === pe.index && current.cnn_bucket_index === cnn.index}
                  selected={selectedKey === `${pe.index}:${cnn.index}`}
                  onSelect={setSelectedKey}
                />
              ));
              return [
                <span key={`label-${pe.index}`} className="self-center truncate text-left text-[10px] text-ink-muted sm:text-xs">
                  {pe.label}
                </span>,
                ...rowCells,
              ];
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">样本不足时不展示胜率数字，仅保留样本量与当前格位置。</p>
          {selectedCell && <GridCellDetail cell={selectedCell} />}
        </>
      )}
    </article>
  );
}

function GridCell({
  cell,
  current,
  selected,
  onSelect,
}: {
  cell: QuantRegimeGridCell | undefined;
  current: boolean;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const statistic = cell?.reference;
  const sufficient = statistic?.sample_sufficient === true;
  const intensity = sufficient && statistic?.win_rate_pct !== null
    ? Math.max(8, Math.min(30, statistic.win_rate_pct * 0.3))
    : 0;
  return (
    <button
      type="button"
      disabled={!cell}
      aria-pressed={selected}
      aria-label={cell ? `查看 ${cell.pe_bucket} × ${cell.cnn_bucket} 详情` : '该状态格暂无样本'}
      onClick={() => cell && onSelect(cellKey(cell))}
      className={[
        'min-w-0 rounded-lg border px-0.5 py-2 text-center',
        'transition-transform duration-200 active:scale-[0.97] motion-reduce:transition-none',
        current ? 'border-buy' : 'border-neutral/30',
        selected ? 'ring-2 ring-buy/35' : '',
        sufficient ? 'text-ink-primary' : 'bg-surface-overlay/45 text-ink-muted',
        cell ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      style={sufficient ? { backgroundColor: `color-mix(in srgb, var(--color-buy) ${intensity}%, var(--color-surface-raised))` } : undefined}
      title={cell ? `${cell.pe_bucket} × ${cell.cnn_bucket}` : '暂无样本'}
    >
      <div className="font-mono text-[10px] font-semibold tabular-nums sm:text-xs">
        {sufficient ? percentValue(statistic?.win_rate_pct) : '样本不足'}
      </div>
      <div className="font-mono text-[8px] tabular-nums sm:text-[10px]">
        n={statistic?.n ?? 0}
      </div>
    </button>
  );
}

function GridCellDetail({ cell }: { cell: QuantRegimeGridCell }) {
  const statistic = cell.reference;
  const sufficient = statistic?.sample_sufficient === true;
  return (
    <div className="mt-3 rounded-xl bg-surface-overlay/45 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">状态格详情</span>
        <span className="font-mono tabular-nums text-ink-secondary">
          {cell.pe_bucket} × {cell.cnn_bucket}
        </span>
      </div>
      <div className="mt-2 font-mono tabular-nums text-ink-muted">
        {sufficient ? (
          <>{cell.reference_benchmark} {cell.reference_horizon_days} 日 · 胜率 {percentValue(statistic?.win_rate_pct)} · n={statistic?.n ?? 0} · 中位 {signedPercent(statistic?.median_return_pct)}</>
        ) : (
          <>样本不足（n={statistic?.n ?? 0}，需 ≥30）· 仅作参考的中位 {signedPercent(statistic?.median_return_pct)}</>
        )}
      </div>
      {statistic?.horizon_conflict && (
        <p className="mt-2 rounded-lg bg-trim/10 px-2 py-1.5 leading-relaxed text-trim">
          ⓘ {statistic.horizon_conflict_note ?? `不同期限相差 ${numberText(statistic.horizon_conflict_gap_pct)} 个百分点`}
        </p>
      )}
      {statistic?.sample_warning && (
        <p className="mt-2 leading-relaxed text-ink-muted">{statistic.sample_warning}</p>
      )}
    </div>
  );
}

function WinRateTable({ regime }: { regime: QuantRegimeStatus }) {
  const winRates = regime.win_rates ?? {};
  return (
    <article className="min-w-0 rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <h3 className="font-semibold">QQQ / TQQQ 历史胜率</h3>
      <div className="mt-4 space-y-4">
        {BENCHMARKS.map((benchmark) => (
          <div key={benchmark}>
            <div className="mb-2 font-mono text-xs font-semibold tabular-nums text-ink-secondary">{benchmark}</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="pb-2 font-medium">期限</th>
                    <th className="pb-2 font-medium">胜率 / 样本</th>
                    <th className="pb-2 font-medium">中位收益</th>
                    <th className="pb-2 font-medium">最差收益</th>
                  </tr>
                </thead>
                <tbody>
                  {HORIZONS.map((horizon) => (
                    <StatisticRow
                      key={horizon}
                      horizon={horizon}
                      statistic={winRates[benchmark]?.[String(horizon)]}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
        胜率只描述这段联合历史，不代表未来收益；20/60/120 均为交易日。
      </p>
    </article>
  );
}

function StatisticRow({
  horizon,
  statistic,
}: {
  horizon: number;
  statistic: QuantRegimeStatistic | undefined;
}) {
  const insufficient = !statistic?.sample_sufficient;
  return (
    <>
      <tr className={insufficient ? 'text-ink-muted' : 'text-ink-secondary'}>
        <td className="border-t border-neutral/20 py-2 font-mono tabular-nums">{horizon} 日</td>
        <td className="border-t border-neutral/20 py-2 font-mono font-semibold tabular-nums">
          {insufficient ? `样本不足 · n=${statistic?.n ?? 0}` : `${percentValue(statistic?.win_rate_pct)} · n=${statistic?.n ?? 0}`}
        </td>
        <td className="border-t border-neutral/20 py-2 font-mono tabular-nums">{signedPercent(statistic?.median_return_pct)}</td>
        <td className="border-t border-neutral/20 py-2 font-mono tabular-nums">{signedPercent(statistic?.worst_return_pct)}</td>
      </tr>
      {insufficient && statistic?.sample_warning && (
        <tr>
          <td colSpan={4} className="pb-2 text-[10px] leading-relaxed text-ink-muted">
            {statistic.sample_warning}
          </td>
        </tr>
      )}
      {statistic?.horizon_conflict && (
        <tr>
          <td colSpan={4} className="pb-2 text-[10px] leading-relaxed text-trim">
            ⓘ {statistic.horizon_conflict_note}
          </td>
        </tr>
      )}
    </>
  );
}

function PositionAdvice({ regime }: { regime: QuantRegimeStatus }) {
  const advice = regime.position_advice;
  if (!advice) {
    return (
      <article className="rounded-2xl border border-neutral/40 bg-surface-raised p-5">
        <h3 className="font-semibold">建议总风险仓位</h3>
        <EmptyEvidence />
      </article>
    );
  }
  return (
    <article className="rounded-2xl border border-buy/25 bg-surface-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">建议总风险仓位</h3>
        <span className="rounded-full bg-buy/12 px-3 py-1 text-xs font-semibold text-buy">
          {advice.scope_note}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="当前风险仓位" value={`${advice.current_risk_position_pct.toFixed(2)}%`} />
        <Metric label="状态参考仓位" value={`${advice.suggested_total_pct.toFixed(2)}%`} tone="text-buy" />
        <Metric
          label="与当前差额"
          value={`${signedNumber(advice.gap_pct)}% · ${signedMoney(advice.gap_usd)}`}
        />
      </div>
      <p className="mt-4 text-sm font-medium leading-relaxed text-ink-secondary">{advice.action_text}</p>
      <div className="mt-3 space-y-1 rounded-xl bg-surface-overlay/45 p-3 text-xs leading-relaxed text-ink-muted">
        <p>矩阵目标 {advice.matrix_target_pct.toFixed(2)}% · 单次变化上限 {advice.max_step_pct.toFixed(2)}%{advice.capped_by_max_step && '（本次已限幅）'}</p>
        {advice.divergence_note && <p>{advice.divergence_note}</p>}
        {advice.basis === 'matrix_only' && <p>仓位参考仅来自预设矩阵，未引用当前小样本胜率。</p>}
        <p>仓位门：{advice.position_gate.note}</p>
        <p>{advice.disclaimer}</p>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  tone = 'text-ink-primary',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-surface-overlay/45 p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`mt-2 font-mono text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function EmptyEvidence() {
  return <div className="mt-4 rounded-xl bg-surface-overlay/40 p-5 text-center text-sm text-ink-muted">证据数据暂无</div>;
}

function uniqueLabels(
  cells: readonly QuantRegimeGridCell[],
  indexKey: 'pe_bucket_index' | 'cnn_bucket_index',
  labelKey: 'pe_bucket' | 'cnn_bucket',
) {
  const labels = new Map<number, string>();
  for (const cell of cells) labels.set(cell[indexKey], cell[labelKey]);
  return [...labels.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, label]) => ({ index, label }));
}

function shortBucket(label: string): string {
  return label.replaceAll('（', ' ').replaceAll('）', '').split(' ')[0];
}

function cellKey(cell: QuantRegimeGridCell): string {
  return `${cell.pe_bucket_index}:${cell.cnn_bucket_index}`;
}

function numberText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无';
}

function percentValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '暂无';
}

function signedPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
    : '暂无';
}

function signedNumber(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
