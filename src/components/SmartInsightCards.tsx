import { formatMoney } from '../format';
import { priceSessionLabel } from '../quoteSession';
import {
  buildHoldingEmotionInsight,
  buildLeverageRadarRows,
  type LeverageRadarRow,
} from '../smartInsight';
import type { HoldingMetric, QuantAnalysisSnapshot } from '../types';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function HoldingEmotionLine({
  metric,
  snapshot,
}: {
  metric: HoldingMetric;
  snapshot?: QuantAnalysisSnapshot | null;
}) {
  if (!snapshot) return null;
  const insight = buildHoldingEmotionInsight(metric, snapshot);
  if (!insight) return null;

  return (
    <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">
      <span className="font-mono tabular-nums">浮亏 {formatMoney(insight.lossUsd)}</span>
      {insight.sampleInsufficient ? (
        insight.sampleCount > 0 && (
          <span className="text-ink-muted">
            {' '}· 该深度样本不足（样本 <span className="font-mono tabular-nums">{insight.sampleCount}</span>）
          </span>
        )
      ) : (
        <span>
          {' '}· 该深度历史 60 日胜率{' '}
          <span className="font-mono tabular-nums text-gain">
            {((insight.winRate60d ?? 0) * 100).toFixed(2)}%
          </span>
          （样本 <span className="font-mono tabular-nums">{insight.sampleCount}</span>）
        </span>
      )}
    </p>
  );
}

export function FearComfortBanner({ context }: { context?: Record<string, unknown> | null }) {
  const raw = context?.cnn_fear_greed;
  if (!raw || typeof raw !== 'object') return null;
  const fear = raw as Record<string, unknown>;
  if (fear.available !== true || !finite(fear.score) || fear.score > 25) return null;

  return (
    <aside
      aria-label="恐慌期纪律提醒"
      className="rounded-2xl border border-buy/30 border-l-4 border-l-buy bg-buy/10 px-5 py-4"
    >
      <p className="font-semibold text-ink-primary">
        现在是恐慌，正是用子弹的时刻——按你的规则执行
      </p>
      <p className="mt-1 font-mono text-xs tabular-nums text-buy">
        CNN 恐慌与贪婪指数 {fear.score.toFixed(2)}
      </p>
    </aside>
  );
}

export function LeverageOpportunityRadar({ snapshot }: { snapshot: QuantAnalysisSnapshot }) {
  const rows = buildLeverageRadarRows(snapshot);
  if (rows.length === 0) return null;

  return (
    <section aria-label="三倍标的买点进度" className="rounded-2xl border border-neutral/50 bg-surface-raised p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink-secondary">机会雷达</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink-primary">三倍标的买点进度</h2>
        </div>
        <p className="text-xs text-ink-muted">只呈现量化系统已声明适用的标的</p>
      </div>

      <div className="mt-4 grid gap-4">
        {rows.map((row) => (
          <div key={row.symbol}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-sm font-semibold tabular-nums text-ink-primary">{row.symbol}</span>
              <span
                className={`rounded-full px-2.5 py-1 font-mono text-xs font-medium tabular-nums ${
                  row.ready ? 'bg-buy/15 text-buy' : 'bg-surface-overlay text-ink-secondary'
                }`}
              >
                {row.ready ? '已就绪' : `还差 ${row.remainingPct.toFixed(2)}%`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`${row.symbol} 买点进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Number(row.progressPct.toFixed(2))}
              className="mt-2 h-2 overflow-hidden rounded-full bg-neutral/35"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none ${
                  row.ready ? 'bg-buy' : 'bg-ink-muted/55'
                }`}
                style={{ width: `${row.progressPct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-muted">
              <span className="font-mono tabular-nums">
                回撤 {row.currentPct.toFixed(2)}% / 门槛 {row.thresholdPct.toFixed(2)}%
              </span>
              <span className="font-mono tabular-nums">
                {priceText(row)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function priceText(row: LeverageRadarRow): string {
  const current = row.currentPrice == null ? '现价暂无' : `现价 ${formatMoney(row.currentPrice)}`;
  const target = row.thresholdPrice == null ? '买点价暂无' : `买点价 ${formatMoney(row.thresholdPrice)}`;
  const session = priceSessionLabel(row.priceSession);
  return `${current}，${target}${session ? ` · ${session}` : ''}`;
}
