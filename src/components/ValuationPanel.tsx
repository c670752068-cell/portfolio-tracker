import { useRef } from 'react';
import { changeText } from '../indexQuotes';
import { CNN_UNLOCK, VIX_UNLOCK, type PositionBadge } from '../positionGuard';
import { VXSMH_CALM_BELOW, VXSMH_HIGH_FROM, useVolatility, vxsmhZone, type VolatilityItem } from '../volatilityIndex';
import type {
  DisplayCurrency,
  ExchangeRates,
  Holding,
  QuantAnalysisSnapshot,
  QuantValuationTab,
  QuantVixContext,
} from '../types';
import { dateText } from '../format';
import { valuationFreshness } from '../valuationFreshness';
import type { DepthQuote } from '../depthQuotePrice';
import type { OneTapRefreshState } from '../oneTapRefresh';
import { DecisionWorkspace } from './DecisionWorkspace';
import type { ValuationSettings } from './ValuationCard';

const NDX_DANJUAN_URL = 'https://danjuanfunds.com/dj-valuation-table-detail/NDX';

interface ValuationPanelProps {
  initialSymbol?: string;
  snapshot: QuantAnalysisSnapshot | null;
  onDirtyChange: (dirty: boolean) => void;
  holdings?: Holding[];
  monitoredQuotes?: ReadonlyMap<string, DepthQuote>;
  quantLoading?: boolean;
  quantError?: string;
  onRefreshQuant?: () => void;
  refreshState?: OneTapRefreshState;
  refreshCooldownSeconds?: number;
  displayCurrency?: DisplayCurrency;
  rates?: ExchangeRates;
  valuationSettings?: ValuationSettings;
  totalAssets?: number;
  positionBadge?: PositionBadge | null;
}

export function ValuationPanel({
  initialSymbol,
  snapshot,
  holdings,
  quantLoading,
  quantError,
  onRefreshQuant,
  refreshState,
  refreshCooldownSeconds,
  positionBadge,
}: ValuationPanelProps) {
  if (!snapshot) return <PreparingState />;
  const valuation = snapshot.valuation_tab;
  if (!valuation) return <PreparingState />;
  return (
    <div className="decision-page space-y-3 md:space-y-5">
      <MarketIndicators snapshot={snapshot} positionBadge={positionBadge} />
      <DecisionWorkspace
        initialSymbol={initialSymbol}
        snapshot={snapshot}
        holdings={holdings}
        loading={quantLoading}
        error={quantError}
        onRefresh={onRefreshQuant}
        refreshState={refreshState}
        cooldownSeconds={refreshCooldownSeconds}
      />
    </div>
  );
}

export function MarketIndicators({ snapshot, positionBadge = null }: {
  snapshot: QuantAnalysisSnapshot | null;
  positionBadge?: PositionBadge | null;
}) {
  if (!snapshot?.valuation_tab) return <PreparingState />;
  return <CurrentIndicators valuation={snapshot.valuation_tab} vix={vixContext(snapshot)} positionBadge={positionBadge} />;
}

function CurrentIndicators({
  valuation,
  vix,
  positionBadge,
}: {
  valuation: QuantValuationTab;
  vix: QuantVixContext | null;
  positionBadge: PositionBadge | null;
}) {
  const freshness = valuationFreshness(valuation.ndx);
  const cnnValue = finite(valuation.cnn.current_score);
  const peValue = finite(valuation.ndx.current_pe);
  const vixValue = vix?.available ? finite(vix.value) : null;
  const ndxState: IndicatorState = freshness.effectivelyStale
    ? 'unavailable'
    : ndxIndicatorState(peValue);
  const vixState = thresholdState(vixValue, (value) => value >= VIX_UNLOCK);
  return (
    <div data-testid="mobile-decision-grid" className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
      <ThresholdIndicatorCard
        title="市场情绪 · CNN 恐慌贪婪指数"
        state={thresholdState(cnnValue, (value) => value <= CNN_UNLOCK)}
        badgeLabel={positionBadge?.text}
        badgeAlert={positionBadge?.over}
        timestamp={`CNN · ${dateText(valuation.cnn.as_of ?? valuation.generated_at)}`}
        compactDate={compactDate(valuation.cnn.as_of ?? valuation.generated_at)}
        target={`CNN ≤ ${CNN_UNLOCK} 才能超 30%`}
        featured
        visual={<CnnFearGreedGauge value={cnnValue} rating={ratingText(valuation.cnn.rating)} />}
        details={[ratingText(valuation.cnn.rating)]}
      />
      <ThresholdIndicatorCard
        title="纳指100 估值"
        value={peValue}
        valuePrefix="PE "
        state={ndxState}
        target="警戒线 PE ≥ 35"
        dangerLabel="估值过高"
        readyLabel="估值偏低"
        compactDate={compactDate(freshness.asOf ?? valuation.generated_at)}
        activationUrl={NDX_DANJUAN_URL}
        activationLabel="双击查看雪球估值"
        details={[
          `5年分位 ${percentText(valuation.ndx.pe_percentile_5y)}${valuation.ndx.zone && valuation.ndx.zone !== '数据缺失' ? ` · ${valuation.ndx.zone}` : ''}`,
          `PB ${numberText(valuation.ndx.current_pb)}`,
        ]}
        timestamp={`丹居 · ${dateText(freshness.asOf ?? valuation.generated_at)}`}
      >
        {valuation.ndx.realtime_estimate && (
          <div className="mt-3 rounded-xl bg-buy/8 p-3 text-xs leading-relaxed text-ink-secondary">
            实时估算 <strong className="text-buy tabular-nums">{valuation.ndx.realtime_estimate.pe.toFixed(2)}</strong>
            {' '}（QQQ {sessionText(valuation.ndx.realtime_estimate.price_session)}价；盈利基数按季更新）
            <div className="mt-1 text-ink-muted">{valuation.ndx.realtime_estimate.note}；估算值不参与判定</div>
          </div>
        )}
        {freshness.effectivelyStale && (
          <p className="mt-3 rounded-lg border border-trim/40 bg-trim/10 px-3 py-2 text-xs leading-relaxed text-ink-secondary">
            ⚠ 数据停留在 {freshness.asOf ?? '未知日期'}（{freshness.tradingDaysOld ?? valuation.ndx.stale_days ?? 0} 个交易日前）
            {valuation.ndx.gate_available === false ? '；估值闸门当前不可判定' : ''}
          </p>
        )}
      </ThresholdIndicatorCard>
      <VxsmhIndicator />
      <ThresholdIndicatorCard
        title="VIX 波动率"
        value={vixValue}
        valuePrefix="VIX "
        state={vixState}
        badgeLabel={positionBadge?.text}
        badgeAlert={positionBadge?.over}
        target={`VIX ≥ ${VIX_UNLOCK} 才能到 50%`}
        wideOnMobile
        compactDate={compactDate(vix?.as_of)}
        details={[
          vix?.available ? `${numberText(finite(vix.percentile_window_days), 0)}日分位 ${percentText(finite(vix.percentile))}` : (vix?.reason ?? '数据暂无'),
          vix?.zone_label ?? '档位暂无',
          adjustmentText(vix?.position_adjustment_pct),
        ]}
        timestamp={`${vix?.source?.provider ?? 'VIX'} · ${vix?.as_of ?? '数据准备中'}`}
      >
        {vix?.is_proxy && (
          <p className="mt-3 text-xs leading-relaxed text-trim">RV20 代理，非真实 VIX</p>
        )}
        {vix?.term_structure?.available === false && (
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            期限结构：{vix.term_structure.reason ?? '暂无'}
          </p>
        )}
      </ThresholdIndicatorCard>
    </div>
  );
}

const VXSMH_ZONE_STATE = { 平稳: 'normal', 平常: 'neutral', 高波动: 'ready' } as const;

/** 半导体版 VIX，占原来标普 500 估值的位置。只作参考，不进仓位上限；颜色看所在区间，不看当天涨跌。 */
export function VxsmhCard({ item }: { item: VolatilityItem | null }) {
  const price = item?.price ?? null;
  const change = item?.changePercent ?? null;
  const date = item?.quoteTime?.slice(0, 10) ?? null;
  const zone = vxsmhZone(price);
  return (
    <ThresholdIndicatorCard
      title="VXSMH 半导体波动率"
      value={price}
      valuePrefix="VXSMH "
      state={zone === null ? 'unavailable' : VXSMH_ZONE_STATE[zone]}
      badgeLabel={`${zone === null ? '' : `${zone} · `}较昨收 ${changeText(change)}`}
      target={`平稳 < ${VXSMH_CALM_BELOW} · 高波动 ≥ ${VXSMH_HIGH_FROM}`}
      compactDate={compactDate(date)}
      timestamp={`Yahoo · ${date ?? '日期暂无'}`}
      details={[]}
    />
  );
}

function VxsmhIndicator() {
  const { data } = useVolatility();
  return <VxsmhCard item={data?.items.find((item) => item.key === 'VXSMH') ?? null} />;
}

type IndicatorState = 'ready' | 'warning' | 'danger' | 'normal' | 'neutral' | 'unavailable';

function ThresholdIndicatorCard({
  title,
  value,
  valuePrefix,
  state,
  target,
  details,
  timestamp,
  compactDate,
  featured = false,
  warningLabel = '警戒',
  dangerLabel = '高风险',
  readyLabel = '已达标',
  badgeLabel,
  badgeAlert,
  wideOnMobile = false,
  activationUrl,
  activationLabel,
  visual,
  children,
}: {
  title: string;
  value?: number | null;
  valuePrefix?: string;
  state: IndicatorState;
  target: string;
  details: readonly string[];
  timestamp: string;
  compactDate: string;
  featured?: boolean;
  warningLabel?: string;
  dangerLabel?: string;
  readyLabel?: string;
  badgeLabel?: string;
  /** 徽章自己定颜色：true 红、false 绿、null 灰；不传就跟卡片状态走。 */
  badgeAlert?: boolean | null;
  wideOnMobile?: boolean;
  activationUrl?: string;
  activationLabel?: string;
  visual?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const ready = state === 'ready';
  const warning = state === 'warning';
  const danger = state === 'danger';
  const cardClass = ready || danger
    ? 'border-loss/60 bg-loss/10'
    : warning
      ? 'border-trim/60 bg-trim/10'
    : state === 'normal'
      ? 'border-gain/40 bg-gain/10'
      : 'border-neutral/40 bg-surface-raised';
  const valueClass = ready || danger ? 'text-loss' : warning ? 'text-trim' : state === 'normal' ? 'text-gain' : 'text-ink-muted';
  const stateBadgeClass = ready || danger ? 'bg-loss text-white' : warning ? 'bg-trim text-white' : state === 'normal' ? 'bg-gain text-white' : 'bg-neutral/40 text-ink-muted';
  const badgeClass = badgeAlert === undefined ? stateBadgeClass : badgeAlert === null ? 'bg-neutral/40 text-ink-muted' : badgeAlert ? 'bg-loss text-white' : 'bg-gain text-white';
  const badgeText = badgeLabel ?? (ready ? readyLabel : danger ? dangerLabel : warning ? warningLabel : state === 'normal' ? '未到警戒线' : '数据过期');
  const card = (
    <section
      data-testid={featured ? 'mobile-cnn-card' : 'mobile-indicator-card'}
      data-panic-state={state}
      data-alert-state={state}
      aria-label={title}
      className={`h-full min-w-0 rounded-2xl border p-3 sm:p-5 ${featured || wideOnMobile ? 'col-span-2 xl:col-span-1' : ''} ${cardClass}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 gap-y-1 sm:gap-x-3">
        <h3 className={`${featured ? 'text-sm' : 'text-xs'} font-semibold text-ink-secondary sm:text-sm`}>{title}</h3>
        <span className="hidden whitespace-nowrap text-[10px] tabular-nums text-ink-muted sm:block sm:text-[11px]">{timestamp}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-ink-muted sm:hidden">数据 {compactDate}</span>
      </div>
      <div className={`${state === 'normal' && !badgeLabel ? 'hidden sm:flex' : 'flex'} mt-2 flex-wrap items-center justify-between gap-1 sm:mt-3 sm:gap-2`}>
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold sm:px-2.5 sm:py-1 sm:text-xs ${badgeClass}`}>{badgeText}</span>
        <span className="text-[9px] font-medium tabular-nums text-ink-muted sm:text-xs">{target}</span>
      </div>
      {visual ?? (
        <div className={`text-display mt-2 truncate text-base font-semibold tabular-nums sm:mt-3 sm:break-words sm:text-4xl ${valueClass}`}>
          {value === null || value === undefined ? '暂无' : `${valuePrefix ?? ''}${value.toFixed(2)}`}
        </div>
      )}
      <div className={`mt-1 hidden flex-wrap gap-x-2 gap-y-1 text-xs tabular-nums text-ink-secondary sm:mt-3 sm:flex sm:gap-x-4 sm:text-sm`}>
        {details.map((detail) => <span key={detail}>{detail}</span>)}
      </div>
      <div className="hidden sm:block">{children}</div>
      {activationLabel && (
        <div className="mt-2 text-[9px] font-medium text-buy sm:text-xs">
          {activationLabel} <span aria-hidden="true">↗</span>
        </div>
      )}
    </section>
  );
  return activationUrl && activationLabel
    ? <DoubleActivationLink url={activationUrl} label={activationLabel}>{card}</DoubleActivationLink>
    : card;
}

function DoubleActivationLink({ url, label, children }: { url: string; label: string; children: React.ReactNode }) {
  const lastActivation = useRef(0);
  function open() {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label}，按回车也可打开`}
      className="block h-full min-w-0 touch-manipulation rounded-2xl outline-none transition-transform duration-100 active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-buy/70 focus-visible:ring-offset-2"
      onClick={(event) => {
        event.preventDefault();
        const now = Date.now();
        if (now - lastActivation.current <= 450) {
          lastActivation.current = 0;
          open();
          return;
        }
        lastActivation.current = now;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      }}
    >
      {children}
    </a>
  );
}

function CnnFearGreedGauge({ value, rating }: { value: number | null; rating: string }) {
  const score = Math.min(100, Math.max(0, value ?? 0));
  const angle = Math.PI - (score / 100) * Math.PI;
  const markerX = 120 + 92 * Math.cos(angle);
  const markerY = 112 - 92 * Math.sin(angle);
  return (
    <div data-testid="mobile-cnn-gauge" className="mx-auto mt-1 w-full max-w-[280px] sm:mt-2 sm:max-w-[250px]" aria-label={`CNN 恐慌贪婪指数 ${value === null ? '暂无' : value.toFixed(2)}`}>
      <svg viewBox="0 0 240 130" role="img" className="h-auto w-full overflow-visible">
        <defs>
          <linearGradient id="cnn-fear-greed-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff3b5c" />
            <stop offset="28%" stopColor="#ff9f0a" />
            <stop offset="55%" stopColor="#ffd60a" />
            <stop offset="78%" stopColor="#63d987" />
            <stop offset="100%" stopColor="#19c7a3" />
          </linearGradient>
        </defs>
        <path d="M 20 112 A 100 100 0 0 1 220 112" fill="none" stroke="url(#cnn-fear-greed-gradient)" strokeLinecap="round" strokeWidth="18" />
        {value !== null && <circle cx={markerX} cy={markerY} r="9" fill="var(--color-surface-raised)" stroke="var(--color-ink-primary)" strokeWidth="4" />}
        <text x="120" y="84" textAnchor="middle" className="fill-current text-[46px] font-semibold tabular-nums text-ink-primary">{value === null ? '--' : value.toFixed(0)}</text>
        <text x="120" y="106" textAnchor="middle" className="fill-current text-[12px] font-semibold text-ink-secondary">{rating}</text>
      </svg>
      <div data-testid="cnn-range-legend" className="-mt-1 grid grid-cols-5 gap-0.5 text-center text-[8px] leading-tight text-ink-muted sm:hidden">
        {[
          ['bg-[#ff3b5c]', '极度恐惧'],
          ['bg-[#ff9f0a]', '恐惧'],
          ['bg-[#ffd60a]', '中性'],
          ['bg-[#63d987]', '贪婪'],
          ['bg-[#19c7a3]', '极度贪婪'],
        ].map(([color, label]) => (
          <div key={label}>
            <div className={`mb-1 h-1 rounded-full ${color}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
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

function thresholdState(
  value: number | null,
  readyPredicate: (value: number) => boolean,
  warningPredicate?: (value: number) => boolean,
): IndicatorState {
  if (value === null) return 'unavailable';
  if (readyPredicate(value)) return 'ready';
  return warningPredicate?.(value) ? 'warning' : 'normal';
}

function ndxIndicatorState(value: number | null): IndicatorState {
  if (value === null) return 'unavailable';
  if (value < 30) return 'ready';
  if (value >= 35) return 'danger';
  return 'normal';
}

function compactDate(value: string | null | undefined): string {
  if (!value) return '--';
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : '--';
}

function vixContext(snapshot: QuantAnalysisSnapshot): QuantVixContext | null {
  const value = snapshot.context.vix;
  if (!value || typeof value !== 'object' || !('available' in value)) return null;
  return value as QuantVixContext;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function adjustmentText(value: number | null | undefined): string {
  const numeric = finite(value);
  if (numeric === null) return '仓位调整暂无';
  return `参考仓位调整 ${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

function percentText(value: number | null): string {
  return value === null ? '暂无' : `${value.toFixed(2)}%`;
}

function numberText(value: number | null, digits = 2): string {
  return value === null ? '暂无' : value.toFixed(digits);
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
