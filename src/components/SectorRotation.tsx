import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Holding, QuantAnalysisSnapshot } from '../types';
import { getServerSectorRotationUrl } from '../runtimeConfig';
import { technicalPresetSymbols, technicalSymbolName } from '../technicalSymbols';
import { fetchRotation, PERIODS, relativePerformance, ROTATION_COPY, ROTATION_LABELS, rotationTrail, SECTORS, signedPercent, signedPp, stockSector, type RelativePerformance, type RotationHistory, type RotationPayload, type RotationPoint, type RotationState, type SectorSymbol } from '../sectorRotation';
import './SectorRotation.css';

interface Props { snapshot: QuantAnalysisSnapshot | null; holdings: readonly Holding[]; onOpenDecision: (symbol: string) => void }
export interface SectorRow { symbol: SectorSymbol; name: string; performance: RelativePerformance; trail: RotationPoint[] }
const COLORS: Record<RotationState, string> = { leading: '#059669', weakening: '#d58a08', lagging: '#dc445a', improving: '#2586d8', neutral: '#7c8798' };
const ENDPOINT = () => getServerSectorRotationUrl() || '/api/portfolio/sector-rotation';

export function SectorRotation({ snapshot, holdings, onOpenDecision }: Props) {
  const [selected, setSelected] = useState<SectorSymbol>('XLK');
  const [sessions, setSessions] = useState(63);
  const [payload, setPayload] = useState<RotationPayload | null>(null);
  const [watchHistory, setWatchHistory] = useState<Record<string, RotationHistory>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [watchError, setWatchError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [descending, setDescending] = useState(true);
  const symbols = useMemo(() => snapshot ? technicalPresetSymbols(snapshot, [...holdings]) : [], [snapshot, holdings]);
  const selectedStocks = useMemo(() => symbols.filter(symbol => stockSector(symbol) === selected), [symbols, selected]);
  const watchKey = selectedStocks.join(',');
  const period = PERIODS.find(item => item.sessions === sessions)!;
  const unmapped = symbols.filter(symbol => !stockSector(symbol));
  useEffect(() => {
    const controller = new AbortController();
    void fetchRotation(ENDPOINT(), undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) { setPayload(result); setError(''); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '行情暂不可用'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); }, 15 * 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!watchKey) return;
    const controller = new AbortController();
    const queue = watchKey.split(',');
    const batches: string[][] = [];
    for (let i = 0; i < queue.length; i += 12) batches.push(queue.slice(i, i + 12));
    void (async () => {
      for (const batch of batches) {
        const result = await fetchRotation(ENDPOINT(), batch, controller.signal);
        if (!controller.signal.aborted) { setWatchHistory(current => ({ ...current, ...result.series })); setWatchError(''); }
      }
    })().catch(reason => { if (!controller.signal.aborted) setWatchError(reason instanceof Error ? reason.message : '关注股票行情暂不可用'); });
    return () => controller.abort();
  }, [watchKey, refresh]);
  const rows = useMemo<SectorRow[]>(() => SECTORS.map(sector => ({
    ...sector,
    performance: relativePerformance(payload?.series[sector.symbol], payload?.series.SPY, sessions),
    trail: rotationTrail(payload?.series[sector.symbol], payload?.series.SPY, payload?.completed_week ?? ''),
  })), [payload, sessions]);
  const row = rows.find(item => item.symbol === selected)!;
  const current = row.trail.at(-1);
  const ranked = [...rows].sort((a, b) => {
    if (a.performance.excessPp == null) return b.performance.excessPp == null ? 0 : 1;
    if (b.performance.excessPp == null) return -1;
    return (b.performance.excessPp - a.performance.excessPp) * (descending ? 1 : -1);
  });
  const available = rows.filter(item => item.performance.available).length;
  const stale = rows.filter(item => item.performance.stale).length;
  const chooseSector = useCallback((symbol: SectorSymbol) => { setSelected(symbol); setWatchError(''); }, []);
  const showWatch = (symbol: string) => {
    const stock = relativePerformance(watchHistory[symbol], payload?.series.SPY, sessions);
    const comparable = stock.available && row.performance.available && stock.start === row.performance.start && stock.end === row.performance.end;
    const vsSector = comparable ? stock.assetReturn! - row.performance.assetReturn! : null;
    const description = !comparable ? stock.reason || '等待同期板块数据' : stock.excessPp! >= 0
      ? vsSector! >= 0 ? '强于大盘，也强于板块' : '跑赢大盘，但落后于板块'
      : vsSector! >= 0 ? '落后于大盘，但强于板块' : '弱于大盘，也弱于板块';
    return <article className="rotation-stock" key={symbol}>
      <div className="rotation-stock-heading"><h3>{symbol} <span>{technicalSymbolName(symbol, holdings, snapshot?.growth_watchlist?.names)}</span></h3><button onClick={() => onOpenDecision(symbol)} aria-label={`查看 ${symbol} 个股决策`}>查看决策 ↗</button></div>
      <div className="rotation-metrics is-stock"><Metric label={`近${period.label}`} value={stock.assetReturn} /><Metric label="较标普" value={stock.excessPp} pp /><Metric label={`较${row.name}`} value={vsSector} pp /></div>
      <p className={`rotation-stock-summary ${comparable && stock.excessPp! >= 0 && vsSector! >= 0 ? 'is-positive' : ''}`}>{description}</p>
      {(stock.stale || row.performance.stale) && <p className="rotation-warning">含过期或缓存行情，仅供回看</p>}
    </article>;
  };
  return <section className="rotation-page" aria-label="板块强弱与轮动">
    <header className="rotation-page-title"><div><p className="rotation-eyebrow">MARKET CONTEXT</p><h2>板块强弱与轮动</h2><p>看清哪些板块领先、哪些正在转弱，以及关注股票是否跟上。</p></div><span className="rotation-source-badge">真实行情 · 完整收盘</span></header>
    <div className="rotation-toolbar"><div className="rotation-benchmark"><span>比较基准</span><strong>标普500 · SPY</strong></div><div className="rotation-periods" aria-label="表现区间"><span>表现区间</span>{PERIODS.map(item => <button key={item.sessions} onClick={() => setSessions(item.sessions)} aria-pressed={sessions === item.sessions}>{item.label}</button>)}</div><button className="rotation-refresh" disabled={loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>{loading ? '读取中…' : '↻ 刷新行情'}</button></div>
    <div className="rotation-freshness" role="status">{payload ? <>数据截至 {payload.series.SPY?.as_of ?? '暂无'} · 预期完整收盘 {payload.expected_close} · {available}/11 板块可比{stale > 0 && <strong> · {stale} 个含过期/异常数据</strong>}</> : '正在读取 11 大板块与标普500；首次读取可能需要几十秒。'}</div>
    {error && <p className="rotation-error" role="alert">{error}。{payload ? '保留上次页面结果，请核对日期后使用。' : '暂无可用结果，不使用演示数据替代。'}</p>}
    {payload && !payload.calendar_verified && <p className="rotation-warning">交易日历年份未覆盖，收盘日期需人工核验。</p>}
    <div className="rotation-grid">
      <section className="rotation-card rotation-map-card"><div className="rotation-card-title"><div><h3>板块轮动</h3><p>周度观察 · 最近12个完整周轨迹 · 不随表现区间改变</p></div><select aria-label="选择板块" value={selected} onChange={event => chooseSector(event.target.value as SectorSymbol)}>{SECTORS.map(sector => <option value={sector.symbol} key={sector.symbol}>{sector.name} {sector.symbol}</option>)}</select></div><RotationMap rows={rows} selected={selected} onSelect={chooseSector} /><div className="rotation-map-foot"><span>轨迹记录过去，不预测未来。</span><span>自定义 10 / 4 周模型 ⓘ</span></div></section>
      <section className="rotation-card rotation-selection" aria-label="选中板块详情"><h3>{row.name} <span>· {selected}</span></h3>{current ? <><span className={`rotation-state state-${current.state}`}>相对{ROTATION_LABELS[current.state]}</span><p>{ROTATION_COPY[current.state]}</p><small>象限截至 {current.date} · 周度，不是当日涨跌</small></> : <p className="rotation-unavailable">周度样本不足，暂不判断象限</p>}
        <div className="rotation-metrics"><Metric label={`${row.name}近${period.label}`} value={row.performance.assetReturn} /><Metric label={`标普近${period.label}`} value={row.performance.benchmarkReturn} neutral /><Metric label="较标普" value={row.performance.excessPp} pp /></div>
        {!row.performance.available && <p className="rotation-warning">{row.performance.reason}</p>}
        {row.performance.stale && <p className="rotation-warning">数据未更新至预期收盘日，或刷新失败；不作为实时状态。</p>}
        <div className="rotation-comparison"><h4>近{period.label}表现对比</h4><p>复权累计表现 · 起点=100 · 非相对比值线</p><PerformanceChart performance={row.performance} symbol={selected} /><small>{row.performance.start ?? '—'} → {row.performance.end ?? '—'} · {sessions} 个交易日</small></div>
      </section>
      <section className="rotation-card rotation-ranking"><div className="rotation-card-title"><div><h3>11大板块排名</h3><p>同一收盘日期与区间 · 复权收益差，以百分点表示</p><small className="rotation-scroll-hint">左右滑动查看轮动状态与走势 →</small></div></div><div className="rotation-table-scroll" tabIndex={0} aria-label="板块排名，可左右滚动"><table><thead><tr><th>板块 / ETF</th><th>近{period.label}涨跌</th><th aria-sort={descending ? 'descending' : 'ascending'}><button onClick={() => setDescending(value => !value)}>较标普 {descending ? '↓' : '↑'}</button></th><th>轮动状态<small>周度</small></th><th>相对走势</th></tr></thead><tbody>{ranked.map(item => {
        const latest = item.trail.at(-1);
        return <tr key={item.symbol} className={selected === item.symbol ? 'is-selected' : ''}><th><button aria-pressed={selected === item.symbol} onClick={() => chooseSector(item.symbol)}><strong>{item.name}</strong><span>{item.symbol}</span></button></th><td className={numberTone(item.performance.assetReturn)}>{signedPercent(item.performance.assetReturn)}{item.performance.stale && <small>日期/来源待核查</small>}</td><td className={numberTone(item.performance.excessPp)}>{signedPp(item.performance.excessPp)}{!item.performance.available && <small>{item.performance.reason}</small>}</td><td>{latest ? <span className={`rotation-state state-${latest.state}`}>{ROTATION_LABELS[latest.state]}</span> : <span className="rotation-unavailable">数据不足</span>}</td><td><Sparkline points={item.performance.points.map(p => p.ratio)} color={latest ? COLORS[latest.state] : COLORS.neutral} /></td></tr>;
      })}</tbody></table></div></section>
      <section className="rotation-card rotation-watch"><div className="rotation-card-title"><div><h3>关注股票 · {row.name}</h3><p>从当前成长股与持仓匹配 · {selectedStocks.length} 支</p></div></div>{watchError && <p className="rotation-error" role="alert">{watchError}，请刷新重试；旧数据仍需核对日期。</p>}{selectedStocks.length ? <div className="rotation-watch-list">{selectedStocks.map(showWatch)}</div> : <div className="rotation-empty"><strong>这个板块暂无已匹配的关注股票</strong><p>可选择其他板块。不会把不确定的分类自动套入。</p></div>}</section>
    </div>
    <details className="rotation-card rotation-method"><summary>计算口径与数据说明</summary><div className="rotation-method-grid"><section><h4>表现与相对强度</h4><p>以 SPY ETF 代表标普500、11 只 Select Sector SPDR ETF 代表板块，不是对全部标普成分股重新编制指数。使用 Yahoo Finance 拆股及分红调整收盘价；不与原始收盘价混用。</p><p>1月/3月/6月/1年分别为 21/63/126/252 个交易日。收益 = 期末复权价 ÷ 期初复权价 − 1；“较标普” = 标的收益 − SPY 收益，单位为百分点。相对比值 RS = 标的复权价 ÷ SPY 复权价。</p><p>表内短走势为区间 RS 归一化曲线；右侧两条线分别是标的与 SPY 的累计表现。跑赢基准仍可能亏损；领先也可能发生在下跌市场。</p></section><section><h4>透明的周度轮动模型</h4><p>仅使用完整周最后一个交易日：横轴 = 100 × 周 RS / 最近10周 RS 均值；纵轴 = 100 × 横轴 / 最近4周横轴均值。中心为 100，保留最近12周轨迹。此为自定义相对趋势模型，并非专有 JdK RRG 指标，也不是 RSI。</p><p>右上领先、右下转弱、左下落后、左上改善；恰在中轴为临界。四象限不保证顺时针轮动。区间跑赢与周度象限可能不同，不代表计算矛盾。</p><p>数据每15分钟检查缓存，收盘后延迟20分钟纳入当日。日期未对齐、调整价缺失或样本不足时不计算，不向前补价格。更新失败保留上次数据并标记。</p></section></div><details className="rotation-mapping"><summary>关注股票分类与未归类标的（{unmapped.length}）</summary><p>按维护的行业映射关联当前关注股票，包含非标普成分股及 ADR，不声称这些股票均在标普500。跨板块指数、杠杆产品、商品和未知分类不强行放入单一板块。</p><p>未归类：{unmapped.join('、') || '无'}</p><p>分类维护日期：2026-10-06。分类变化需核验更新。</p></details><p className="rotation-boundary">相对强弱不等于绝对涨跌，也不直接构成买卖信号；不改变现有决策、推送或交易规则。</p></details>
  </section>;
}

function numberTone(value: number | null) { return value == null || value === 0 ? '' : value > 0 ? 'is-positive' : 'is-negative'; }
function Metric({ label, value, pp = false, neutral = false }: { label: string; value: number | null; pp?: boolean; neutral?: boolean }) {
  return <div><span>{label}</span><strong className={neutral ? '' : numberTone(value)}>{pp && value != null ? <>{signedPercent(value).slice(0, -1)}<small> 个百分点</small></> : signedPercent(value)}</strong></div>;
}
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <span className="rotation-unavailable">—</span>;
  const min = Math.min(...points), span = Math.max(...points) - min || 1;
  const path = points.map((value, i) => `${2 + i / (points.length - 1) * 92},${25 - (value - min) / span * 22}`).join(' ');
  return <svg viewBox="0 0 96 28" className="rotation-spark" role="img" aria-label="相对标普比值走势，起点归一化"><polyline points={path} fill="none" stroke={color} strokeWidth="1.8" /></svg>;
}
export function PerformanceChart({ performance, symbol }: { performance: RelativePerformance; symbol: string }) {
  if (!performance.available) return <div className="rotation-chart-empty">{performance.reason || '等待完整收盘数据'}</div>;
  const points = performance.points;
  const values = points.flatMap(p => [p.asset, p.benchmark]);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * .12, 1);
  const low = min - padding, high = max + padding;
  const x = (i: number) => 40 + i / (points.length - 1) * 330;
  const y = (value: number) => 190 - (value - low) / (high - low) * 162;
  const last = points.at(-1)!;
  return <><svg viewBox="0 0 440 224" className="rotation-performance" role="img" aria-label={`${symbol} 与 SPY 同期复权累计表现对比，起点100`}>
    {[0, .5, 1].map(t => { const value = low + (high - low) * t; return <g key={t}><line x1="40" x2="375" y1={y(value)} y2={y(value)} className="rotation-gridline" /><text x="32" y={y(value) + 4} textAnchor="end">{value.toFixed(0)}</text></g>; })}
    <polyline points={points.map((p, i) => `${x(i)},${y(p.benchmark)}`).join(' ')} fill="none" stroke="var(--color-ink-muted)" strokeWidth="2" strokeDasharray="5 4" />
    <polyline points={points.map((p, i) => `${x(i)},${y(p.asset)}`).join(' ')} fill="none" stroke="#059669" strokeWidth="2.5" />
    <circle cx={x(points.length - 1)} cy={y(last.asset)} r="4" fill="#059669" /><circle cx={x(points.length - 1)} cy={y(last.benchmark)} r="4" fill="var(--color-ink-muted)" />
    <text x="40" y="212">起点</text><text x="206" y="212" textAnchor="middle">{points[Math.floor(points.length / 2)].date.slice(5)}</text><text x="372" y="212" textAnchor="end">{last.date.slice(5)}</text>
  </svg><div className="rotation-line-legend"><span><i />{symbol} <b>{last.asset.toFixed(2)}</b></span><span><i />SPY <b>{last.benchmark.toFixed(2)}</b></span></div></>;
}

export function RotationMap({ rows, selected, onSelect }: { rows: SectorRow[]; selected: string; onSelect: (symbol: SectorSymbol) => void }) {
  const all = rows.flatMap(row => row.trail);
  const halfX = Math.max(2, ...all.map(p => Math.abs(p.x - 100))) * 1.22;
  const halfY = Math.max(1, ...all.map(p => Math.abs(p.y - 100))) * 1.25;
  const x = (v: number) => 54 + (v - (100 - halfX)) / (halfX * 2) * 620;
  const y = (v: number) => 355 - (v - (100 - halfY)) / (halfY * 2) * 310;
  // Keep labels inside the plot and separate close neighbors without moving actual data points.
  const labels: { x: number; y: number; symbol: string }[] = [];
  for (const row of [...rows].sort((a, b) => Number(b.symbol === selected) - Number(a.symbol === selected))) {
    const point = row.trail.at(-1); if (!point) continue;
    let lx = Math.max(58, Math.min(626, x(point.x) + 12)), ly = y(point.y) - 10;
    for (let attempt = 0; attempt < 20; attempt++) {
      ly = Math.max(66, Math.min(335, ly));
      if (!labels.some(label => Math.abs(label.x - lx) < 50 && Math.abs(label.y - ly) < 17)) break;
      ly += 18; if (ly > 335) { ly = y(point.y) - 32; lx = Math.max(58, lx - 55); }
    }
    labels.push({ x: lx, y: ly, symbol: row.symbol });
  }
  return <div className="rotation-map"><svg viewBox="0 0 720 400" role="group" aria-label="11大板块相对趋势与动能轮动图">
    <rect x="54" y="45" width="310" height="155" className="quadrant improving" /><rect x="364" y="45" width="310" height="155" className="quadrant leading" /><rect x="54" y="200" width="310" height="155" className="quadrant lagging" /><rect x="364" y="200" width="310" height="155" className="quadrant weakening" />
    {[-1, -.5, 0, .5, 1].map(t => <g key={t}><line x1={x(100 + t * halfX)} x2={x(100 + t * halfX)} y1="45" y2="355" className={t === 0 ? 'rotation-axis' : 'rotation-gridline'} /><line x1="54" x2="674" y1={y(100 + t * halfY)} y2={y(100 + t * halfY)} className={t === 0 ? 'rotation-axis' : 'rotation-gridline'} /><text x={x(100 + t * halfX)} y="374" textAnchor="middle">{(100 + t * halfX).toFixed(1)}</text><text x="47" y={y(100 + t * halfY) + 4} textAnchor="end">{(100 + t * halfY).toFixed(1)}</text></g>)}
    <text x="66" y="65" className="quadrant-label" fill={COLORS.improving}>改善</text><text x="662" y="65" textAnchor="end" className="quadrant-label" fill={COLORS.leading}>领先</text><text x="66" y="342" className="quadrant-label" fill={COLORS.lagging}>落后</text><text x="662" y="342" textAnchor="end" className="quadrant-label" fill={COLORS.weakening}>转弱</text>
    <text x="365" y="394" textAnchor="middle">相对趋势 · 中轴100</text><text transform="translate(14 203) rotate(-90)" textAnchor="middle">相对动能</text>
    {[...rows].sort((a, b) => Number(a.symbol === selected) - Number(b.symbol === selected)).map(row => {
      const last = row.trail.at(-1); if (!last) return null;
      const active = row.symbol === selected, color = COLORS[last.state], label = labels.find(l => l.symbol === row.symbol)!;
      return <g key={row.symbol} className={`rotation-point ${active ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={`${row.name} ${row.symbol} ${ROTATION_LABELS[last.state]}，${last.date}，相对趋势 ${last.x.toFixed(2)}，相对动能 ${last.y.toFixed(2)}`} aria-pressed={active} onClick={() => onSelect(row.symbol)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.symbol); } }}>
        <title>{row.name} {row.symbol} · {last.date} · 趋势 {last.x.toFixed(2)} / 动能 {last.y.toFixed(2)}</title>
        <polyline points={row.trail.map(p => `${x(p.x)},${y(p.y)}`).join(' ')} fill="none" stroke={color} strokeOpacity={active ? .85 : .14} strokeWidth={active ? 2.3 : 1.1} />
        {row.trail.map((p, i) => <circle key={p.date} cx={x(p.x)} cy={y(p.y)} r={2.2 + i / 12} fill={color} opacity={active ? .18 + i / 16 : .08 + i / 42} />)}
        <line x1={x(last.x)} y1={y(last.y)} x2={label.x + 12} y2={label.y - 4} stroke={color} strokeOpacity=".3" />
        {active && <circle cx={x(last.x)} cy={y(last.y)} r="11" fill="none" stroke="var(--color-buy)" strokeWidth="2" />}
        <circle cx={x(last.x)} cy={y(last.y)} r="7" fill={color} stroke="var(--color-surface-raised)" strokeWidth="2" />
        <text x={label.x} y={label.y} className="rotation-point-label" fill={active ? 'var(--color-buy)' : 'var(--color-ink-primary)'}>{row.symbol}</text>
      </g>;
    })}
    {!all.length && <text x="364" y="187" textAnchor="middle">等待足够的完整周数据</text>}
  </svg></div>;
}
