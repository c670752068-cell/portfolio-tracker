import { quantAnalysisFreshnessText } from '../quantAnalysis';
import type { QuantAnalysisSnapshot, QuantBuyOpportunity, QuantSellOpportunity } from '../types';

export type OpportunitySide = 'buy' | 'sell';

interface OpportunityOverviewProps {
  snapshot: QuantAnalysisSnapshot;
  onSelect?: (symbol: string, side: OpportunitySide) => void;
}

function pct(value: number): string {
  return `${Math.abs(value).toFixed(2)}%`;
}

function BuyRow({ item, onSelect }: { item: QuantBuyOpportunity; onSelect?: OpportunityOverviewProps['onSelect'] }) {
  return (
    <button type="button" onClick={() => onSelect?.(item.symbol, 'buy')} className="grid w-full min-w-0 gap-1 rounded-lg border border-slate-200 p-3 text-left hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-600 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
      <strong className="text-base">{item.symbol}</strong>
      <span className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
        {item.reason} · 回撤 {pct(item.drawdown_pct)} / 阈值 {pct(item.threshold_pct)}
      </span>
      <span className={`text-xs ${item.sample_insufficient ? 'text-slate-400' : 'font-semibold text-indigo-700 dark:text-indigo-300'}`}>
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
    <button type="button" onClick={() => onSelect?.(item.symbol, 'sell')} className="grid w-full min-w-0 gap-1 rounded-lg border border-slate-200 p-3 text-left hover:border-rose-300 dark:border-slate-700 dark:hover:border-rose-700 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
      <strong className="text-base">{item.symbol}</strong>
      <span className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
        {item.trigger}：{item.detail}{item.shadow && <span className="ml-1 font-medium text-amber-700 dark:text-amber-300">（观察期）</span>}
      </span>
      <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">详情 →</span>
    </button>
  );
}

function GroupTitle({ icon, children }: { icon: string; children: string }) {
  return <h3 className="mb-2 mt-4 text-sm font-semibold"><span aria-hidden="true">{icon}</span> {children}</h3>;
}

function EmptyLine({ children }: { children: string }) {
  return <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500 dark:border-slate-700">{children}</p>;
}

export function OpportunityOverview({ snapshot, onSelect }: OpportunityOverviewProps) {
  const summary = snapshot.summary;
  if (!summary) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold">今日机会一览</h2>
        <p className="mt-2 text-sm text-slate-500">机会结论将随下一份量化快照生成。</p>
      </section>
    );
  }
  const allEmpty = summary.buy_ready.length === 0
    && summary.buy_near.length === 0
    && summary.sell_ready.length === 0;
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">今日机会一览</h2>
          <p className="mt-1 text-xs text-slate-500">{quantAnalysisFreshnessText(summary.generated_at)}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-200">引擎已判定</span>
      </div>
      {allEmpty && (
        <div className="my-5 rounded-xl bg-slate-100 p-5 text-center dark:bg-slate-900">
          <strong className="block text-xl">今日无操作窗口，耐心等待</strong>
          <span className="mt-1 block text-sm text-slate-500">三组均空是正常状态</span>
        </div>
      )}
      <GroupTitle icon="🟢">可买入（条件已满足）</GroupTitle>
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
      <GroupTitle icon="🔴">可卖出（持仓中有触发依据）</GroupTitle>
      <div className="space-y-2">
        {summary.sell_ready.length === 0
          ? <EmptyLine>当前持仓没有卖出窗口</EmptyLine>
          : summary.sell_ready.map((item) => <SellRow key={item.symbol} item={item} onSelect={onSelect} />)}
      </div>
      <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        ⚪ 其余 {summary.idle_count} 只今日无操作窗口 —— 耐心等待也是操作
      </p>
      <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">只提醒不下单；由你在券商 App 手动执行。</p>
    </section>
  );
}
