import { useMemo, useState } from 'react';
import { CASH_EQUIVALENT_SYMBOLS } from '../assetClass';
import { isQuantAnalysisStale, lookupQuantSymbol, quantAnalysisAgeHours } from '../quantAnalysis';
import type { QuantAnalysisSnapshot, QuantGateResult, QuantSignalStatWindow, QuantSymbolAnalysis } from '../types';

interface ConditionLookupProps {
  snapshot: QuantAnalysisSnapshot | null;
  initialSymbol?: string;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}

const MARKET_GATES = [
  ['low_zone', '低位区'],
  ['signal_triggered', '买入信号'],
  ['valuation', '估值/情绪'],
] as const;

const DISCIPLINE_GATES = [
  ['position_gate', '仓位门'],
  ['batch_available', '批次'],
] as const;

function numberText(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : '暂无';
}

function integerText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : '暂无';
}

function isApplicable(gate: QuantGateResult | undefined): boolean {
  return gate?.applicable !== false;
}

function gateDetail(key: string, gate: QuantGateResult): string {
  if (key === 'low_zone') {
    return `距最近 250 个交易日高点回撤 ${numberText(gate.current_drawdown_pct, '%')}；达到 ${numberText(gate.threshold_pct, '%')} 进入低位区`;
  }
  if (key === 'signal_triggered') {
    const signals = Array.isArray(gate.recent_buy_signals) ? gate.recent_buy_signals : [];
    return signals.length > 0
      ? signals.map((item) => {
          if (typeof item !== 'object' || item === null) return '';
          const signal = item as Record<string, unknown>;
          return `${String(signal.label || signal.name || '信号')} ${String(signal.date || '')}`.trim();
        }).filter(Boolean).join('、')
      : '最近闭合交易日没有触发生产买入信号';
  }
  if (key === 'position_gate') {
    return `同族仓位 ${numberText(gate.family_share_pct, '%')} / 上限 ${numberText(gate.cap_pct, '%')}`;
  }
  if (key === 'batch_available') {
    return `第 ${integerText(gate.next_batch)} 批 / 共 ${integerText(gate.batch_count)} 批`;
  }
  if (key === 'valuation') {
    const reason = String(gate.reason || '按量化系统当前估值与情绪规则判定');
    return `${reason}；CNN ${numberText(gate.cnn)}（<30 恐慌开窗）；纳指100 PE 分位 ${numberText(gate.ndx_percentile, '%')}；SOXX 分位 ${numberText(gate.soxx_percentile, '%')}；个股 PE 分位 ${numberText(gate.stock_percentile, '%')}`;
  }
  return String(gate.reason || '按量化系统当前估值与情绪规则判定');
}

function GateCard({ gateKey, label, gate }: { gateKey: string; label: string; gate: QuantGateResult }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="font-semibold"><span className={gate.passed ? 'text-emerald-600' : 'text-rose-600'}>{gate.passed ? '✓' : '✗'}</span> {label}</div>
      <div className="mt-1 text-xs text-slate-500">{gateDetail(gateKey, gate)}</div>
    </div>
  );
}

function StatWindow({ label, stat }: { label: string; stat: QuantSignalStatWindow }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <div className="font-medium">{label}</div>
      {stat.sample_insufficient || stat.n < 20 || stat.win_rate === null ? (
        <div className="mt-1 text-amber-700 dark:text-amber-300">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 text-slate-600 dark:text-slate-300">历史成功率 {(stat.win_rate * 100).toFixed(1)}%（n={stat.n}）</div>
      )}
    </div>
  );
}

function DepthStat({ stat }: { stat: NonNullable<QuantSymbolAnalysis['depth_stats']> }) {
  const insufficient = stat.sample_insufficient || stat.n < 20 || stat.win_rate_60d === null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
      <div className="font-medium">回撤深度 {stat.level_pct}%</div>
      {insufficient ? (
        <div className="mt-1 text-amber-700 dark:text-amber-300">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 text-slate-600 dark:text-slate-300">60 日历史成功率 {(stat.win_rate_60d! * 100).toFixed(1)}%（n={stat.n}）</div>
      )}
      <div className="mt-1 text-xs text-slate-500">含熊市样本：{stat.bear_included ? '是' : '否'}</div>
    </div>
  );
}

function BuyConditions({ analysis }: { analysis: QuantSymbolAnalysis }) {
  const gates = analysis.gates ?? {};
  const marketGates = MARKET_GATES
    .map(([key, label]) => ({ key, label, gate: gates[key] ?? { passed: false } }))
    .filter((item) => isApplicable(item.gate));
  const marketPassed = marketGates.filter((item) => item.gate.passed).length;
  const lowZone = gates.low_zone;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <strong>市场条件满足 {marketPassed}/{marketGates.length}</strong>
        <span className="text-xs text-slate-500">市场判断</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {marketGates.map((item) => <GateCard key={item.key} gateKey={item.key} label={item.label} gate={item.gate} />)}
      </div>
      {lowZone && !isApplicable(lowZone) && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <div className="font-semibold">价格回撤参考</div>
          <div className="mt-1 text-xs text-slate-500">距最近 250 个交易日高点回撤 {numberText(lowZone.current_drawdown_pct, '%')}，不参与个股市场条件计数。</div>
        </div>
      )}
      <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <summary className="cursor-pointer font-semibold">纪律闸门（决定允许买多少），不是行情判断</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DISCIPLINE_GATES.map(([key, label]) => {
            const gate = gates[key] ?? { passed: false };
            return isApplicable(gate) ? <GateCard key={key} gateKey={key} label={label} gate={gate} /> : null;
          })}
        </div>
      </details>
    </div>
  );
}

export function ConditionLookup({ snapshot, initialSymbol = '', loading = false, error = '', onRefresh }: ConditionLookupProps) {
  const monitoredSymbols = useMemo(() => snapshot
    ? Object.keys(snapshot.symbols).filter((item) => !CASH_EQUIVALENT_SYMBOLS.has(item.toUpperCase())).sort()
    : [], [snapshot]);
  const firstSymbol = monitoredSymbols.includes(initialSymbol.toUpperCase())
    ? initialSymbol.toUpperCase()
    : monitoredSymbols[0] || '';
  const [symbol, setSymbol] = useState(firstSymbol);
  const selectedSymbol = monitoredSymbols.includes(symbol) ? symbol : firstSymbol;
  const result = useMemo(() => snapshot && selectedSymbol ? lookupQuantSymbol(snapshot, selectedSymbol) : null, [snapshot, selectedSymbol]);
  const snapshotAgeHours = snapshot ? quantAnalysisAgeHours(snapshot.generated_at) : null;

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">量化条件查询</h2>
            <p className="mt-1 text-sm text-slate-500">从量化监控池选择标的，查看生产口径的买入条件和历史事件统计。</p>
          </div>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={loading} className="rounded-md bg-slate-200 px-3 py-2 text-sm dark:bg-slate-700">{loading ? '读取中…' : '刷新快照'}</button>}
        </div>
        <select aria-label="量化监控标的" value={selectedSymbol} onChange={(event) => setSymbol(event.target.value)} className="mt-4 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">
          {monitoredSymbols.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      {error && <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100">读取失败：{error}</div>}
      {!snapshot && !error && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">{loading ? '正在读取量化系统快照…' : '暂无量化分析快照。'}</div>}

      {snapshot && isQuantAnalysisStale(snapshot.generated_at) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">量化分析数据 {snapshotAgeHours === null ? '时间未知' : `${snapshotAgeHours} 小时前`}，可能过期。</div>
      )}

      {snapshot && result && !result.found && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="font-semibold">{result.symbol || '该代码'} 不在量化监控池，无判定数据</div>
          <div className="mt-2 text-sm text-slate-500">池内代码：{result.monitoredSymbols.join('、')}</div>
        </div>
      )}

      {snapshot && result?.found && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="text-lg font-semibold">{result.symbol} 买入条件</h3>
            {!result.analysis.available ? (
              <p className="mt-3 text-amber-700 dark:text-amber-300">当前无可用判定：{result.analysis.error || '数据未生成'}</p>
            ) : <BuyConditions analysis={result.analysis} />}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="font-semibold">历史事件统计</h3>
            {Object.keys(result.analysis.signal_stats || {}).length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">当前买入信号没有可展示的历史事件样本。</p>
            ) : Object.entries(result.analysis.signal_stats || {}).map(([name, stats]) => (
              <div key={name} className="mt-3">
                <div className="text-sm font-medium">{name}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <StatWindow label="5 日" stat={stats.d5} />
                  <StatWindow label="20 日" stat={stats.d20} />
                  <StatWindow label="60 日" stat={stats.d60} />
                </div>
              </div>
            ))}
            {result.analysis.depth_stats && <DepthStat stat={result.analysis.depth_stats} />}
            <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">历史统计不代表未来收益；概率禁止相乘。</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">{snapshot.disclaimer}</div>
        </>
      )}
    </section>
  );
}
