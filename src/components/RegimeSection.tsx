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
  if (!regime?.available || !regime.current?.primary) {
    return (
      <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-5">
        <h3 className="font-semibold">长样本状态格准备中</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {regime?.reason ?? '下一份包含回撤深度与 VIX 分位的量化快照到达后自动显示。'}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label="回撤、波动率与估值情绪状态">
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
  const primary = regime.current!.primary;
  const overlay = regime.current!.overlay;
  const quality = regime.data_quality;
  return (
    <article className="rounded-2xl border border-buy/30 bg-gradient-to-br from-buy/10 via-surface-raised to-surface-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-buy">
          三重市场状态
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">
          {regime.evaluated_at ?? '时间暂无'}
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
        {primary.cell_label}
      </p>
      {regime.headline && (
        <p className="mt-2 max-w-5xl text-sm leading-relaxed text-ink-secondary">
          {regime.headline}
        </p>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StateCard
          eyebrow="主轴一 · 回撤深度"
          value={`QQQ 回撤 ${signedPercent(primary.drawdown_pct)}`}
          detail={`当前档 ${primary.row_bucket}`}
        />
        <StateCard
          eyebrow="主轴二 · 波动率分位"
          value={`VIX 分位 ${percentValue(primary.vix_percentile_1y)}`}
          detail={`VIX ${numberText(primary.vix_value)} · ${primary.col_bucket}${primary.vix_is_proxy ? ' · RV20 代理' : ''}`}
        />
        <StateCard
          eyebrow="PE / CNN 叠加层"
          value={overlay.overlay_available ? `${overlay.pe_zone ?? '估值暂无'} · CNN ${numberText(overlay.cnn_score)}` : '叠加数据暂无'}
          detail="补充标注，不参与状态格建模"
          subdued
        />
      </div>
      {overlay.overlay_available && (
        <div className="mt-3 rounded-xl border border-neutral/35 bg-surface-overlay/45 p-3 text-xs leading-relaxed text-ink-muted">
          <span className="font-medium text-ink-secondary">叠加层，仅供参考：</span>
          {' '}{overlay.overlay_note}
        </div>
      )}
      {quality && (
        <div className="mt-4 rounded-xl bg-surface-overlay/45 p-3 text-xs leading-relaxed text-ink-muted">
          <span className="font-mono tabular-nums">
            {quality.grid_start ?? '起始暂无'} 至 {quality.grid_end ?? '结束暂无'}
            {' · '}长样本 {quality.grid_sample_days} 天
            {' · '}VIX {quality.vix_observations} 条
          </span>
          <div className="mt-1">{quality.caveat}</div>
          {quality.is_proxy && <div className="mt-1 text-trim">VIX 当前使用 RV20 代理，非真实 VIX。</div>}
        </div>
      )}
      {quality?.conclusion_allowed === false && quality.headline_caveat && (
        <div className="mt-4 rounded-xl border border-trim/35 bg-trim/10 p-3 text-sm leading-relaxed text-ink-primary">
          <strong className="text-trim">样本范围提醒：</strong> {quality.headline_caveat}
        </div>
      )}
    </article>
  );
}

function StateCard({
  eyebrow,
  value,
  detail,
  subdued = false,
}: {
  eyebrow: string;
  value: string;
  detail: string;
  subdued?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${subdued ? 'border-neutral/30 bg-surface-base/35' : 'border-buy/20 bg-buy/5'}`}>
      <div className="text-[11px] font-medium text-ink-muted">{eyebrow}</div>
      <div className={`mt-2 font-mono text-base font-semibold tabular-nums ${subdued ? 'text-ink-secondary' : 'text-ink-primary'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-ink-muted">{detail}</div>
    </div>
  );
}

function RegimeGrid({ regime }: { regime: QuantRegimeStatus }) {
  const cells = (regime.grid ?? []).flat();
  const current = regime.current!.primary;
  const currentCell = cells.find((item) => (
    item.row_bucket_index === current.row_bucket_index
    && item.col_bucket_index === current.col_bucket_index
  ));
  const [selectedKey, setSelectedKey] = useState(currentCell ? cellKey(currentCell) : null);
  const selectedCell = cells.find((item) => cellKey(item) === selectedKey) ?? currentCell;
  const rowLabels = uniqueLabels(cells, 'row_bucket_index', 'row_bucket');
  const columnLabels = uniqueLabels(cells, 'col_bucket_index', 'col_bucket');

  return (
    <article className="min-w-0 rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">5×5 状态定位</h3>
        <span className="text-[11px] text-ink-muted">行=QQQ 回撤 · 列=VIX 分位</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
        行 = QQQ 自高点回撤，列 = VIX 近 1 年分位；每格 = 该状态下买入 QQQ 持有 60 天的胜率与样本数。
      </p>
      {cells.length === 0 ? (
        <EmptyEvidence />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-[4.25rem_repeat(5,minmax(0,1fr))] gap-1 text-center sm:grid-cols-[5.5rem_repeat(5,minmax(0,1fr))]">
            <span />
            {columnLabels.map((label) => (
              <span key={label.index} className="truncate px-0.5 font-mono text-[9px] tabular-nums text-ink-muted sm:text-[10px]">
                {shortBucket(label.label)}
              </span>
            ))}
            {rowLabels.flatMap((row) => {
              const rowCells = columnLabels.map((column) => (
                <GridCell
                  key={`${row.index}-${column.index}`}
                  cell={cells.find((item) => item.row_bucket_index === row.index && item.col_bucket_index === column.index)}
                  current={current.row_bucket_index === row.index && current.col_bucket_index === column.index}
                  selected={selectedKey === `${row.index}:${column.index}`}
                  onSelect={setSelectedKey}
                />
              ));
              return [
                <span key={`label-${row.index}`} className="self-center truncate text-left font-mono text-[10px] tabular-nums text-ink-muted sm:text-xs">
                  {row.label}
                </span>,
                ...rowCells,
              ];
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
            “熊”表示该格样本包含真实熊市；样本不足时不展示胜率数字。
          </p>
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
    ? Math.max(9, Math.min(34, statistic.win_rate_pct * 0.34))
    : 0;
  return (
    <button
      type="button"
      disabled={!cell}
      aria-pressed={selected}
      aria-label={cell ? `查看 ${cell.row_bucket} × ${cell.col_bucket} 详情` : '该状态格暂无样本'}
      onClick={() => cell && onSelect(cellKey(cell))}
      className={[
        'relative min-w-0 rounded-lg border px-0.5 py-2 text-center',
        'transition-[transform,border-color,box-shadow] duration-200 active:scale-[0.97] motion-reduce:transition-none',
        current ? 'border-buy' : 'border-neutral/30',
        selected ? 'ring-2 ring-buy/35' : '',
        sufficient ? 'text-ink-primary' : 'bg-surface-overlay/45 text-ink-muted',
        cell ? 'cursor-pointer' : 'cursor-default',
      ].join(' ')}
      style={sufficient ? { backgroundColor: `color-mix(in srgb, var(--color-buy) ${intensity}%, var(--color-grid-base))` } : undefined}
      title={cell ? `${cell.row_bucket} × ${cell.col_bucket}` : '暂无样本'}
    >
      {cell?.bear_included && (
        <span className="absolute right-0.5 top-0.5 rounded bg-surface-raised/85 px-0.5 text-[7px] font-semibold text-trim sm:text-[8px]">
          熊
        </span>
      )}
      <div className="font-mono text-[9px] font-semibold tabular-nums sm:text-xs">
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
          {cell.row_bucket} × {cell.col_bucket}
        </span>
      </div>
      <div className="mt-2 font-mono tabular-nums text-ink-muted">
        {sufficient ? (
          <>
            {cell.reference_benchmark} {cell.reference_horizon_days} 日 · 胜率 {percentValue(statistic?.win_rate_pct)}
            {' · '}n={statistic?.n ?? 0} · 中位 {signedPercent(statistic?.median_return_pct)}
          </>
        ) : (
          <>样本不足（n={statistic?.n ?? 0}，需 ≥30）· 不输出胜率结论</>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        熊市样本：{cell.bear_included ? '已包含' : '未包含，当前格不具备结论条件'}
      </p>
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
  const winRates = regime.win_rates ?? regime.current?.cell_stats ?? {};
  return (
    <article className="min-w-0 rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <h3 className="font-semibold">QQQ / TQQQ 历史胜率</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">仅对应当前“回撤 × VIX”状态格。</p>
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
        历史统计不代表未来收益；样本集中度警示与 n≥30、熊市样本门槛始终生效。
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
          {statistic?.bear_included && <span className="ml-1 text-trim">熊</span>}
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
        <Metric label="与当前差额" value={`${signedNumber(advice.gap_pct)}% · ${signedMoney(advice.gap_usd)}`} />
      </div>
      <p className="mt-4 text-sm font-medium leading-relaxed text-ink-secondary">{advice.action_text}</p>
      <div className="mt-3 space-y-1 rounded-xl bg-surface-overlay/45 p-3 text-xs leading-relaxed text-ink-muted">
        <p>
          主轴矩阵 {advice.matrix_target_pct.toFixed(2)}%
          {' · '}PE/CNN 叠加 {signedNumber(advice.overlay_adjustment_pct)} 点
          {' · '}单次变化上限 {advice.max_step_pct.toFixed(2)}%
          {advice.capped_by_max_step && '（本次已限幅）'}
        </p>
        {advice.overlay_note && <p>{advice.overlay_note}</p>}
        {advice.vix_note && <p>{advice.vix_note}</p>}
        {advice.basis === 'matrix_only' && <p>仓位参考仅来自预设矩阵，未引用当前不足样本的胜率。</p>}
        <p>仓位门：{advice.position_gate.note}</p>
        <p>{advice.disclaimer}</p>
      </div>
    </article>
  );
}

function Metric({ label, value, tone = 'text-ink-primary' }: { label: string; value: string; tone?: string }) {
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
  indexKey: 'row_bucket_index' | 'col_bucket_index',
  labelKey: 'row_bucket' | 'col_bucket',
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
  return `${cell.row_bucket_index}:${cell.col_bucket_index}`;
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
