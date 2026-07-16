import { useMemo, useState, type FormEvent } from 'react';
import { isQuantAnalysisStale, lookupQuantSymbol, quantAnalysisAgeHours } from '../quantAnalysis';
import type { QuantAnalysisSnapshot, QuantGateResult, QuantSignalStatWindow, QuantSymbolAnalysis } from '../types';

interface ConditionLookupProps {
  snapshot: QuantAnalysisSnapshot | null;
  initialSymbol?: string;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}

const GATE_LABELS = [
  ['low_zone', '低位区'],
  ['signal_triggered', '买入信号'],
  ['position_gate', '仓位门'],
  ['daily_fuse', '当日熔断'],
  ['batch_available', '批次'],
  ['valuation', '估值/情绪'],
] as const;

function numberText(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : '暂无';
}

function gateDetail(key: string, gate: QuantGateResult): string {
  if (key === 'low_zone') {
    return `当前回撤 ${numberText(gate.current_drawdown_pct, '%')}；门槛 ${numberText(gate.threshold_pct, '%')}`;
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
  if (key === 'daily_fuse') {
    return `今日已买 ${numberText(gate.buys_today)} / 最多新增 ${numberText(gate.max_new_buys)}`;
  }
  if (key === 'batch_available') {
    return `下一批 ${numberText(gate.next_batch)} / 共 ${numberText(gate.batch_count)} 批`;
  }
  if (key === 'valuation') {
    const reason = String(gate.reason || '按量化系统当前估值与情绪规则判定');
    return `${reason}；CNN ${numberText(gate.cnn)}；纳指100 PE 分位 ${numberText(gate.ndx_percentile, '%')}；SOXX 分位 ${numberText(gate.soxx_percentile, '%')}；个股 PE 分位 ${numberText(gate.stock_percentile, '%')}`;
  }
  return String(gate.reason || '按量化系统当前估值与情绪规则判定');
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

export function ConditionLookup({ snapshot, initialSymbol = '', loading = false, error = '', onRefresh }: ConditionLookupProps) {
  const firstSymbol = initialSymbol || (snapshot ? Object.keys(snapshot.symbols).sort()[0] || '' : '');
  const [draft, setDraft] = useState(firstSymbol);
  const [symbol, setSymbol] = useState(firstSymbol);
  const result = useMemo(() => snapshot && symbol ? lookupQuantSymbol(snapshot, symbol) : null, [snapshot, symbol]);
  const snapshotAgeHours = snapshot ? quantAnalysisAgeHours(snapshot.generated_at) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setSymbol(draft.trim().toUpperCase());
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">量化条件查询</h2>
            <p className="mt-1 text-sm text-slate-500">输入代码，读取量化系统生产口径的买入六关和历史事件统计。</p>
          </div>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={loading} className="rounded-md bg-slate-200 px-3 py-2 text-sm dark:bg-slate-700">{loading ? '读取中…' : '刷新快照'}</button>}
        </div>
        <form onSubmit={submit} className="mt-4 flex gap-2">
          <input aria-label="股票代码" value={draft} onChange={(event) => setDraft(event.target.value.toUpperCase())} placeholder="例如 SOXL" className="min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-3 py-2 uppercase dark:border-slate-600" />
          <button className="rounded-md bg-indigo-600 px-4 py-2 text-white" type="submit">查询</button>
        </form>
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
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">{result.symbol} 买入六关</h3>
              <strong>当前满足 {result.analysis.gates_passed ?? 0}/{result.analysis.gates_total ?? 6} 关</strong>
            </div>
            {!result.analysis.available ? (
              <p className="mt-3 text-amber-700 dark:text-amber-300">当前无可用判定：{result.analysis.error || '数据未生成'}</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {GATE_LABELS.map(([key, label]) => {
                  const gate = result.analysis.gates?.[key] ?? { passed: false };
                  return (
                    <div key={key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div className="font-semibold"><span className={gate.passed ? 'text-emerald-600' : 'text-rose-600'}>{gate.passed ? '✓' : '✗'}</span> {label}</div>
                      <div className="mt-1 text-xs text-slate-500">{gateDetail(key, gate)}</div>
                    </div>
                  );
                })}
              </div>
            )}
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
