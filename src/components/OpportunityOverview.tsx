import { quantAnalysisFreshnessText } from '../quantAnalysis';
import type { QuantAnalysisSnapshot, QuantBuyOpportunity, QuantSellOpportunity } from '../types';

export type OpportunitySide = 'buy' | 'sell';

interface OpportunityOverviewProps {
  snapshot: QuantAnalysisSnapshot;
  onSelect?: (symbol: string, side: OpportunitySide) => void;
  compact?: boolean;
}

function pct(value: number): string {
  return `${Math.abs(value).toFixed(2)}%`;
}

function BuyRow({ item, onSelect }: { item: QuantBuyOpportunity; onSelect?: OpportunityOverviewProps['onSelect'] }) {
  return (
    <button type="button" onClick={() => onSelect?.(item.symbol, 'buy')} className="grid min-h-11 w-full min-w-0 gap-1 rounded-xl border border-neutral/40 bg-surface-overlay/30 p-3 text-left hover:border-buy/60 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
      <strong className="font-mono text-base tabular-nums">{item.symbol}</strong>
      <span className="min-w-0 font-mono text-xs tabular-nums text-ink-secondary">
        {item.reason} · 回撤 {pct(item.drawdown_pct)} / 阈值 {pct(item.threshold_pct)}
      </span>
      <span className={`font-mono text-xs tabular-nums ${item.sample_insufficient ? 'text-ink-muted' : 'font-semibold text-buy'}`}>
        {item.sample_insufficient || item.win_rate_60d === null
          ? `60 日样本不足（n=${item.n}）`
          : `60 日胜率 ${(item.win_rate_60d * 100).toFixed(2)}%（n=${item.n}）`}
        <span className="ml-2" aria-hidden="true">→</span>
      </span>
    </button>
  );
}

function SellRow({ item, onSelect }: { item: QuantSellOpportunity; onSelect?: OpportunityOverviewProps['onSelect'] }) {
  return (
    <button type="button" onClick={() => onSelect?.(item.symbol, 'sell')} className="grid min-h-11 w-full min-w-0 gap-1 rounded-xl border border-neutral/40 bg-surface-overlay/30 p-3 text-left hover:border-trim/60 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
      <strong className="font-mono text-base tabular-nums">{item.symbol}</strong>
      <span className="min-w-0 font-mono text-xs tabular-nums text-ink-secondary">
        {item.trigger}：{item.detail}{item.shadow && <span className="ml-1 font-medium text-trim">（观察期）</span>}
      </span>
      <span className="text-xs font-semibold text-trim">详情 →</span>
    </button>
  );
}

function GroupTitle({ icon, children }: { icon: string; children: string }) {
  return <h3 className="mb-2 mt-4 text-sm font-semibold"><span aria-hidden="true">{icon}</span> {children}</h3>;
}

function EmptyLine({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed border-neutral/40 p-3 text-sm text-ink-secondary">{children}</p>;
}

function CompactOpportunityOverview({
  snapshot,
  onSelect,
}: Pick<OpportunityOverviewProps, 'snapshot' | 'onSelect'>) {
  const summary = snapshot.summary!;
  const allEmpty = summary.buy_ready.length === 0
    && summary.buy_near.length === 0
    && summary.sell_ready.length === 0;
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral/60 border-l-4 border-l-buy bg-surface-raised p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">今日机会</h2>
        <span className="font-mono text-xs tabular-nums text-ink-secondary">{quantAnalysisFreshnessText(summary.generated_at)}</span>
      </div>
      <p className="mt-2 font-mono text-sm font-semibold tabular-nums">
        今日：条件满足 {summary.buy_ready.length} · 接近 {summary.buy_near.length} · 卖出窗口 {summary.sell_ready.length}
      </p>
      {allEmpty ? (
        <div className="mt-4 rounded-xl bg-surface-overlay/60 p-5 text-center">
          <strong className="text-lg">今日无操作窗口，耐心等待</strong>
        </div>
      ) : (
        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          {summary.buy_ready.map((item) => (
            <button key={`ready-${item.symbol}`} type="button" onClick={() => onSelect?.(item.symbol, 'buy')} className="min-h-11 rounded-full bg-buy/15 px-4 py-2 font-mono text-sm font-semibold tabular-nums text-buy hover:bg-buy/25">
              🟢 {item.symbol}
            </button>
          ))}
          {summary.buy_near.map((item) => (
            <button key={`near-${item.symbol}`} type="button" onClick={() => onSelect?.(item.symbol, 'buy')} className="min-h-11 rounded-full bg-trim/15 px-4 py-2 font-mono text-sm font-semibold tabular-nums text-trim hover:bg-trim/25">
              🟡 {item.symbol}
            </button>
          ))}
          {summary.sell_ready.map((item) => (
            <button key={`sell-${item.symbol}`} type="button" onClick={() => onSelect?.(item.symbol, 'sell')} className="min-h-11 rounded-full bg-trim/15 px-4 py-2 font-mono text-sm font-semibold tabular-nums text-trim hover:bg-trim/25">
              🔴 {item.symbol}{item.shadow ? '（观察期）' : ''}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-ink-secondary">点击标的直接查看量化系统详情；只提醒不下单。</p>
    </section>
  );
}

export function OpportunityOverview({ snapshot, onSelect, compact = false }: OpportunityOverviewProps) {
  const summary = snapshot.summary;
  if (!summary) {
    return (
      <section className="rounded-2xl border border-neutral/60 border-l-4 border-l-buy bg-surface-raised p-6">
        <h2 className="text-xl font-semibold tracking-tight">今日机会一览</h2>
        <p className="mt-2 text-sm text-ink-secondary">机会结论将随下一份量化快照生成。</p>
      </section>
    );
  }
  if (compact) {
    return <CompactOpportunityOverview snapshot={snapshot} onSelect={onSelect} />;
  }
  const allEmpty = summary.buy_ready.length === 0
    && summary.buy_near.length === 0
    && summary.sell_ready.length === 0;
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral/60 border-l-4 border-l-buy bg-surface-raised p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">今日机会一览</h2>
          <p className="mt-1 font-mono text-xs tabular-nums text-ink-secondary">{quantAnalysisFreshnessText(summary.generated_at)}</p>
        </div>
        <span className="rounded-full bg-surface-overlay px-2 py-1 text-xs text-ink-secondary">引擎已判定</span>
      </div>
      {allEmpty && (
        <div className="my-5 rounded-xl bg-surface-overlay/60 p-5 text-center">
          <strong className="block text-xl">今日无操作窗口，耐心等待</strong>
          <span className="mt-1 block text-sm text-ink-secondary">三组均空是正常状态</span>
        </div>
      )}
      <GroupTitle icon="🟢">条件已满足</GroupTitle>
      <div className="space-y-2">
        {summary.buy_ready.length === 0
          ? <EmptyLine>今日没有满足条件的买入标的</EmptyLine>
          : summary.buy_ready.map((item) => <BuyRow key={item.symbol} item={item} onSelect={onSelect} />)}
      </div>
      <GroupTitle icon="🟡">接近买入条件</GroupTitle>
      <div className="space-y-2">
        {summary.buy_near.length === 0
          ? <EmptyLine>今日没有距阈值较近的标的</EmptyLine>
          : summary.buy_near.map((item) => <BuyRow key={item.symbol} item={item} onSelect={onSelect} />)}
      </div>
      <GroupTitle icon="🔴">卖出窗口（持仓中有触发依据）</GroupTitle>
      <div className="space-y-2">
        {summary.sell_ready.length === 0
          ? <EmptyLine>当前持仓没有卖出窗口</EmptyLine>
          : summary.sell_ready.map((item) => <SellRow key={item.symbol} item={item} onSelect={onSelect} />)}
      </div>
      <p className="mt-4 rounded-lg bg-surface-overlay p-3 font-mono text-sm tabular-nums text-ink-secondary">
        ⚪ 其余 {summary.idle_count} 只今日无操作窗口 —— 耐心等待也是操作
      </p>
      <p className="mt-3 text-xs font-medium text-trim">只提醒不下单；由你在券商 App 手动执行。</p>
    </section>
  );
}
