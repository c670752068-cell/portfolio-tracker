import type { SmaIndicators } from '../decisionIndicators';
import { slopePerDay } from '../decisionIndicators';

export function SmaOverheatDetails({ value }: { value: SmaIndicators }) {
  const upside = {
    direction: 'up', title: '上升参考 · 回落峰值', count: value.overheat.peakCount, matches: value.overheat.pullbackCount,
    mean: value.overheat.meanPeak, median: value.overheat.medianPeak, coverage: value.overheat,
    countLabel: '独立正值峰', outcome: '回落', extreme: '峰值',
    method: '正值峰高于前5日且不低于后5日；10日以内的相邻峰保留更高者。峰后10日最低收盘价较峰值日收盘价回落 ≥ 3% 才计入回落样本。',
    events: value.overheat.events.map(event => ({ ...event, reversalPct: event.drawdownPct })),
  };
  const downside = {
    direction: 'down', title: '下降参考 · 反弹谷底', count: value.downside.troughCount, matches: value.downside.reboundCount,
    mean: value.downside.meanTrough, median: value.downside.medianTrough, coverage: value.downside,
    countLabel: '独立负值谷底', outcome: '反弹', extreme: '谷底',
    method: '负值谷底低于前5日且不高于后5日；10日以内的相邻谷底保留更低者。谷底后10日最高收盘价较谷底日收盘价反弹 ≥ 3% 才计入反弹样本。',
    events: value.downside.events.map(event => ({ ...event, reversalPct: event.reboundPct })),
  };
  const falling = value.slope20 != null && value.slope20 < 0;
  const sides = falling ? [downside, upside] : [upside, downside];
  return <section className="decision-context" data-testid="overheat-evidence">
    {sides.map(stats => <section className="sma-direction-evidence" key={stats.direction} data-direction={stats.direction}>
      <h4>{stats.title}</h4>
      <p className={stats.direction === 'down' && falling ? 'sma-downside-summary' : ''}>中位数 <b>{slopePerDay(stats.median)}%/天</b> · 均值 <b>{slopePerDay(stats.mean)}%/天</b></p>
      <p>{stats.count ? <>已确认 <b>{stats.count}</b> 个{stats.countLabel}，其中 <b>{stats.matches}</b> 次在后续 10 个交易日内{stats.outcome}至少 3%。</> : `暂无已确认的${stats.countLabel}样本。`}</p>
      <p className="decision-note">{stats.coverage.historyStart ?? '—'} → {stats.coverage.asOf ?? '—'} · {stats.coverage.barCount} 个有效日线{stats.coverage.asOf && !stats.coverage.fullFiveYears ? ' · 历史不足5年' : ''}</p>
      {!stats.coverage.reliable && <p className="decision-note">样本不足：至少需要 252 个有效日线、8 次符合条件的{stats.extreme}；暂不据此标记{stats.direction === 'down' ? '下降偏快' : '过热'}。</p>}
      <details className="decision-evidence"><summary>{stats.direction === 'down' ? '下降' : '上升'}统计方法与最近样本</summary>
        <p>固定 8 日回看：20DMA 日斜率 =（当前20日均线 / 8个交易日前的20日均线 − 1）× 100 / 8。</p>
        <p>最多近5年完整收盘：{stats.method}避免重复计数；尾部尚不足10日的不计入。</p>
        <p>均值、中位数取符合条件的{stats.extreme}斜率。历史极值依赖事后确认，不是预测胜率，不表示触线必{stats.outcome}或应当买卖；不改变原买卖裁决及推送阈值。</p>
        <ul className="overheat-event-list">{stats.events.filter(event => event.qualifies).slice(-5).reverse().map(event => <li key={event.date}><b>{event.date}</b><span>{stats.extreme} {slopePerDay(event.slope)}%/天</span><span>后10日最大收盘{stats.outcome} {stats.direction === 'down' ? '+' : '-'}{event.reversalPct.toFixed(2)}%</span></li>)}</ul>
      </details>
    </section>)}
  </section>;
}
