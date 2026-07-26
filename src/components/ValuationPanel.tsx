import type { QuantAnalysisSnapshot, QuantValuationDistance, QuantValuationTab } from '../types';
import { buildValuationSummary } from '../valuationPlan';
import { BuyPlanSection } from './BuyPlanSection';
import { RegimeSection } from './RegimeSection';
import { ValuationCharts } from './ValuationCharts';

interface ValuationPanelProps {
  snapshot: QuantAnalysisSnapshot | null;
  onDirtyChange: (dirty: boolean) => void;
}

export function ValuationPanel({ snapshot, onDirtyChange }: ValuationPanelProps) {
  if (!snapshot) return <PreparingState />;
  const valuation = snapshot.valuation_tab;
  if (!valuation) {
    return (
      <div className="space-y-5">
        <PreparingState />
        <BuyPlanPreparing />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-buy/30 bg-gradient-to-br from-buy/12 via-surface-raised to-surface-raised p-5 sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-buy">此刻怎么做</div>
        <h2 className="mt-2 max-w-4xl text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
          {buildValuationSummary(snapshot)}
        </h2>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">冷静时定规则，市场恐慌时执行规则。这里只做证据与计划展示，不自动下单。</p>
      </section>
      <CurrentIndicators valuation={valuation} />
      <RegimeSection regime={snapshot.regime_status} />
      <ValuationCharts valuation={valuation} />
      <DistanceSection valuation={valuation} />
      {snapshot.buy_plan_status ? (
        <BuyPlanSection snapshot={snapshot} onDirtyChange={onDirtyChange} />
      ) : (
        <BuyPlanPreparing />
      )}
    </div>
  );
}

function CurrentIndicators({ valuation }: { valuation: QuantValuationTab }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <IndicatorCard
        title="纳指100 估值"
        value={valuation.ndx.current_pe}
        valuePrefix="PE "
        tone={valuationTone(valuation.ndx.pe_percentile_5y)}
        details={[
          `5年分位 ${percentText(valuation.ndx.pe_percentile_5y)} · ${valuation.ndx.zone ?? '区间暂无'}`,
          `PB ${numberText(valuation.ndx.current_pb)}`,
        ]}
        timestamp={`丹居 · ${valuation.ndx.as_of ?? valuation.generated_at}`}
      >
        {valuation.ndx.realtime_estimate && (
          <div className="mt-3 rounded-xl bg-buy/8 p-3 text-xs leading-relaxed text-ink-secondary">
            实时估算 <strong className="font-mono text-buy tabular-nums">{valuation.ndx.realtime_estimate.pe.toFixed(2)}</strong>
            {' '}（QQQ {sessionText(valuation.ndx.realtime_estimate.price_session)}价；盈利基数按季更新）
            <div className="mt-1 text-ink-muted">{valuation.ndx.realtime_estimate.note}</div>
          </div>
        )}
      </IndicatorCard>
      <IndicatorCard
        title="市场情绪"
        value={valuation.cnn.current_score}
        valuePrefix="CNN "
        tone={sentimentTone(valuation.cnn.current_score)}
        details={[ratingText(valuation.cnn.rating)]}
        timestamp={`CNN · ${valuation.cnn.as_of ?? valuation.generated_at}`}
      />
    </div>
  );
}

function IndicatorCard({
  title,
  value,
  valuePrefix,
  tone,
  details,
  timestamp,
  children,
}: {
  title: string;
  value: number | null;
  valuePrefix: string;
  tone: string;
  details: readonly string[];
  timestamp: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink-secondary">{title}</h3>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">{timestamp}</span>
      </div>
      <div className={`mt-3 font-mono text-4xl font-semibold tracking-tight tabular-nums ${tone}`}>
        {value === null ? '暂无' : `${valuePrefix}${value.toFixed(2)}`}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm tabular-nums text-ink-secondary">
        {details.map((detail) => <span key={detail}>{detail}</span>)}
      </div>
      {children}
    </section>
  );
}

function DistanceSection({ valuation }: { valuation: QuantValuationTab }) {
  return (
    <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">还差多少</h3>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">OpenD 最新价 · {valuation.generated_at}</span>
      </div>
      {valuation.distance_to_anchors.length === 0 ? (
        <div className="mt-4 rounded-xl bg-surface-overlay/40 p-6 text-center text-sm text-ink-muted">锚点距离数据准备中</div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {valuation.distance_to_anchors.map((distance) => <DistanceCard key={distance.label} distance={distance} />)}
        </div>
      )}
    </section>
  );
}

function DistanceCard({ distance }: { distance: QuantValuationDistance }) {
  const reached = distance.pe_gap_pct >= 0;
  return (
    <article className={`rounded-xl border p-4 ${reached ? 'border-buy/60 bg-buy/10' : 'border-neutral/40 bg-surface-overlay/35'}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold">距 {distance.label}</h4>
        {reached && <span className="rounded-full bg-buy px-2.5 py-1 text-xs font-semibold text-surface-base">已到达</span>}
      </div>
      <div className="mt-4 space-y-2 font-mono text-sm tabular-nums">
        <div>PE {distance.current_pe.toFixed(2)} → {distance.target_pe.toFixed(2)} <span className={reached ? 'text-buy' : 'text-ink-secondary'}>（{gapText(distance.pe_gap_pct)}）</span></div>
        <div>
          QQQ {moneyText(distance.current_qqq_price)} → 约 {moneyText(distance.implied_qqq_price)}
          <span className={reached ? 'text-buy' : 'text-ink-secondary'}>（{gapText(distance.price_gap_pct)}）</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-muted">ⓘ {distance.estimate_note || '按当前盈利基数估算'}</p>
    </article>
  );
}

function PreparingState() {
  return (
    <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-8 text-center">
      <h2 className="font-semibold">估值与情绪数据准备中</h2>
      <p className="mt-2 text-sm text-ink-muted">下一份量化快照到达后会自动显示；这里不会用假数据填充。</p>
    </div>
  );
}

function BuyPlanPreparing() {
  return (
    <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-6">
      <h3 className="font-semibold">开枪计划表</h3>
      <p className="mt-2 text-sm text-ink-muted">数据准备中。先保留现有计划，不临时改变纪律。</p>
    </div>
  );
}

function valuationTone(value: number | null): string {
  if (value !== null && value <= 30) return 'text-buy';
  if (value !== null && value >= 70) return 'text-trim';
  return 'text-ink-primary';
}

function sentimentTone(value: number | null): string {
  if (value !== null && value <= 25) return 'text-buy';
  if (value !== null && value >= 75) return 'text-trim';
  return 'text-ink-primary';
}

function percentText(value: number | null): string {
  return value === null ? '暂无' : `${value.toFixed(2)}%`;
}

function numberText(value: number | null): string {
  return value === null ? '暂无' : value.toFixed(2);
}

function moneyText(value: number | null): string {
  return value === null ? '暂无' : `$${value.toFixed(2)}`;
}

function gapText(value: number | null): string {
  if (value === null) return '暂无';
  if (value >= 0) return '已到达';
  return `还差 ${Math.abs(value).toFixed(2)}%`;
}

function ratingText(value: string | null): string {
  const labels: Record<string, string> = {
    'extreme fear': '极度恐惧 Extreme Fear',
    fear: '恐惧 Fear',
    neutral: '中性 Neutral',
    greed: '贪婪 Greed',
    'extreme greed': '极度贪婪 Extreme Greed',
  };
  return value ? labels[value.toLowerCase()] ?? value : '评级暂无';
}

function sessionText(value: string): string {
  const labels: Record<string, string> = {
    pre: '盘前',
    premarket: '盘前',
    regular: '盘中/最近收盘',
    post: '盘后',
    afterhours: '盘后',
    overnight: '夜盘',
    closed: '最近收盘',
  };
  return labels[value] ?? value;
}
