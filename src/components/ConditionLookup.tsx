import { useMemo, useState } from 'react';
import { buildAlertHoldingOptions } from '../alertRules';
import { CASH_EQUIVALENT_SYMBOLS } from '../assetClass';
import { isQuantAnalysisStale, lookupQuantSymbol, quantAnalysisAgeHours, quantAnalysisFreshnessText } from '../quantAnalysis';
import type { Holding, QuantAnalysisSnapshot, QuantGateResult, QuantPanicSymbolStatus, QuantSellFamily, QuantSignalStatWindow, QuantSymbolAnalysis } from '../types';

interface ConditionLookupProps {
  snapshot: QuantAnalysisSnapshot | null;
  holdings?: Holding[];
  initialSymbol?: string;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}

const RISK_ROLE_LABELS: Record<string, string> = {
  option: '期权',
  leveraged_2x: '两三倍杠杆',
  underlying: '正股/单倍 ETF',
};

const MARKET_GATES = [
  ['low_zone', '低位区'],
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
        <div className="mt-1 text-slate-600 dark:text-slate-300">历史成功率 {(stat.win_rate * 100).toFixed(2)}%（n={stat.n}）</div>
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
        <div className="mt-1 text-slate-600 dark:text-slate-300">60 日历史成功率 {(stat.win_rate_60d! * 100).toFixed(2)}%（n={stat.n}）</div>
      )}
      <div className="mt-1 text-xs text-slate-500">含熊市样本：{stat.bear_included ? '是' : '否'}</div>
    </div>
  );
}

function sessionLabel(value: string): string {
  return ({ overnight: '夜盘', premarket: '盘前', afterhours: '盘后', regular: '盘中' } as Record<string, string>)[value] || value;
}

function StockDepthWindow({ analysis }: { analysis: QuantSymbolAnalysis }) {
  const depth = analysis.depth_window;
  if (!depth?.applicable) return null;
  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/20">
      <div className="font-semibold">深度买入窗口（个股）</div>
      <div className="mt-2 font-medium">深度位 {depth.open ? '✓' : '✗'} · 当前回撤 {numberText(depth.current_pct, '%')} · 阈值 {numberText(depth.threshold_pct, '%')}</div>
      <div className="mt-1 text-xs text-slate-500">取价时段：{sessionLabel(depth.price_session)}</div>
      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
        {depth.sample_insufficient || depth.win_rate_60d === null
          ? `60 日样本不足（n=${depth.n}）`
          : `60 日历史成功率 ${(depth.win_rate_60d * 100).toFixed(2)}%（n=${depth.n}）`}
      </div>
    </div>
  );
}

function ReferenceInfo({ gate }: { gate: QuantGateResult | undefined }) {
  if (!gate) return null;
  const stockOnly = gate.reference_only === true;
  return (
    <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">参考信息（不参与开窗）</summary>
      <div className="mt-2 text-xs text-slate-500">
        {stockOnly
          ? `个股 PE 分位 ${numberText(gate.stock_percentile, '%')}`
          : `CNN ${numberText(gate.cnn)}；纳指100 PE 分位 ${numberText(gate.ndx_percentile, '%')}；SOXX 分位 ${numberText(gate.soxx_percentile, '%')}`}
      </div>
    </details>
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
      <StockDepthWindow analysis={analysis} />
      {marketGates.length > 0 && <div className="flex items-center justify-between gap-3">
        <strong>市场条件满足 {marketPassed}/{marketGates.length}</strong>
        <span className="text-xs text-slate-500">市场判断</span>
      </div>}
      {marketGates.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
        {marketGates.map((item) => <GateCard key={item.key} gateKey={item.key} label={item.label} gate={item.gate} />)}
      </div>}
      {lowZone && !isApplicable(lowZone) && !analysis.depth_window?.applicable && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <div className="font-semibold">价格回撤参考</div>
          <div className="mt-1 text-xs text-slate-500">距最近 250 个交易日高点回撤 {numberText(lowZone.current_drawdown_pct, '%')}，不参与个股市场条件计数。</div>
        </div>
      )}
      <ReferenceInfo gate={gates.valuation} />
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

function ObservationBadge({ visible }: { visible: boolean }) {
  return visible ? <span className="ml-1 text-amber-700 dark:text-amber-300">（观察期，未正式生效）</span> : null;
}

function PanicWindowStatus({ status }: { status: QuantPanicSymbolStatus }) {
  return (
    <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{status.display.title}</strong>
        <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800 dark:bg-rose-900/60 dark:text-rose-100">{status.display.state_label}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-medium">
        <span>{status.display.depth_open_text}</span>
        <span>{status.display.panic_open_text}</span>
      </div>
      <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{status.depth.explanation}</div>
      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{status.panic.explanation}</div>
      <div className="mt-3 flex items-center gap-3">
        <progress className="h-2 flex-1 accent-rose-600" max={100} value={status.target.progress_pct} />
        <span className="text-xs font-semibold">{status.display.progress_text}</span>
      </div>
      {status.stop_reason && <div className="mt-2 text-xs text-slate-500">停止原因：{status.stop_reason}</div>}
    </div>
  );
}

function SellWindow({ item }: { item: QuantSellFamily }) {
  const repairText = item.repair.window_open
    ? '修复完成，可开始分批减仓：优先减期权与两三倍杠杆，不要一次性减完'
    : item.repair.status === 'repairing'
      ? `卖出窗口未开启：深跌修复期内，耐心持有（基准日 ${item.repair.base_date || '暂无'}）`
      : '修复期状态暂不可用，当前不生成卖出动作';
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className={`rounded-lg border p-3 ${item.repair.window_open ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
        <div className="font-semibold">{repairText}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="font-semibold">知足常乐<ObservationBadge visible={item.contentment.observation} /></div>
          {!item.contentment.available ? <p className="mt-1 text-slate-500">该持仓族暂无反弹基准对比数据。</p> : (
            <>
              <p className="mt-1 text-slate-500">本标的 {numberText(item.contentment.asset_gain_pct, '%')} · QQQ {numberText(item.contentment.qqq_gain_pct, '%')} · 差距 {numberText(item.contentment.gap_vs_qqq_pct, ' 点')}</p>
              <p className={`mt-1 font-medium ${item.contentment.triggered ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>{item.contentment.triggered ? `建议至少减仓 ${integerText(item.contentment.minimum_reduction_pct)}%` : '尚未接近或超过 QQQ，不触发该依据'}</p>
            </>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="font-semibold">补涨收敛<ObservationBadge visible={item.convergence.observation} /></div>
          <p className="mt-1 text-slate-500">大科技追平 QQQ：{integerText(item.convergence.count)}/{integerText(item.convergence.minimum_assets)} 只</p>
          <p className={`mt-1 font-medium ${item.convergence.triggered ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>{item.convergence.triggered ? `市场亢奋·${item.convergence.action.replace('，仅手动操作', '')}` : '尚未达到补涨收敛门槛'}</p>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="font-semibold">止盈阶梯参考</div>
        {!item.playbook.available ? <p className="mt-1 text-slate-500">该持仓族尚未配置止盈剧本。</p> : (
          <>
            <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">
              {item.playbook.sell_steps.map((step) => <li key={`${step.gain_min_pct}-${step.gain_max_pct}`}>盈利 {step.gain_min_pct.toFixed(2)}%{step.gain_max_pct >= 999 ? '+' : `–${step.gain_max_pct.toFixed(2)}%`}：减总仓 {step.sell_position_pct.toFixed(2)}%</li>)}
            </ul>
            <p className="mt-2 text-xs text-slate-500">优先顺序：{item.playbook.risk_first_order.map((role) => RISK_ROLE_LABELS[role] || role).join(' → ')}</p>
          </>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="font-semibold">近期卖出信号</div>
        {item.recent_signals.length === 0 ? <p className="mt-1 text-slate-500">最近没有触发 sell 向信号。</p> : <ul className="mt-1 space-y-1 text-slate-600 dark:text-slate-300">{item.recent_signals.map((signal) => <li key={`${signal.name}-${signal.date}`}>{signal.label} {signal.date}</li>)}</ul>}
      </div>
      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">只提醒不下单；由你在券商 App 手动执行。</p>
    </div>
  );
}

export function ConditionLookup({ snapshot, holdings = [], initialSymbol = '', loading = false, error = '', onRefresh }: ConditionLookupProps) {
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
  const sellOptions = useMemo(() => buildAlertHoldingOptions(holdings), [holdings]);
  const [sellSymbol, setSellSymbol] = useState(sellOptions[0]?.symbol || '');
  const selectedSellSymbol = sellOptions.some((item) => item.symbol === sellSymbol)
    ? sellSymbol
    : sellOptions[0]?.symbol || '';
  const sellFamily = snapshot?.sell
    ? Object.values(snapshot.sell.symbols).find((item) => item.family === selectedSellSymbol || item.held_symbols.includes(selectedSellSymbol))
    : undefined;
  const panicStatus = snapshot?.panic_window?.symbols[selectedSymbol];

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
        {snapshot && <p className="mt-2 text-xs text-slate-500">{quantAnalysisFreshnessText(snapshot.generated_at)}</p>}
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
            {panicStatus?.applicable && <PanicWindowStatus status={panicStatus} />}
            <h3 className="text-lg font-semibold">{result.symbol} 买入条件</h3>
            {!result.analysis.available ? (
              <p className="mt-3 text-amber-700 dark:text-amber-300">当前无可用判定：{result.analysis.error || '数据未生成'}</p>
            ) : <BuyConditions analysis={result.analysis} />}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="font-semibold">历史事件统计</h3>
            {Object.keys(result.analysis.signal_stats || {}).length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">当前没有可展示的历史事件样本。</p>
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

      {snapshot && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="text-lg font-semibold">卖出窗口</h3>
          <p className="mt-1 text-sm text-slate-500">从当前持仓选择标的，查看量化系统给出的修复期、知足常乐、补涨收敛与止盈阶梯依据。</p>
          <select aria-label="卖出持仓标的" value={selectedSellSymbol} onChange={(event) => setSellSymbol(event.target.value)} className="mt-3 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600">
            {sellOptions.length === 0 && <option value="">暂无可用持仓</option>}
            {sellOptions.map((item) => <option key={item.symbol} value={item.symbol}>{item.label}</option>)}
          </select>
          {!snapshot.sell ? <p className="mt-3 text-sm text-slate-500">卖出窗口快照尚未生成，请刷新量化快照。</p> : !sellFamily ? <p className="mt-3 text-sm text-slate-500">未持有，无卖出窗口可查。</p> : <SellWindow item={sellFamily} />}
        </div>
      )}
    </section>
  );
}
