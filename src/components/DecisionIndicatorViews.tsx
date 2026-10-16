import type { PePosition, SmaIndicators } from '../decisionIndicators';
import { slopePerDay } from '../decisionIndicators';
import './DecisionIndicators.css';

export function PePositionView({ value, compact = false }: { value: PePosition; compact?: boolean }) {
  const relative = value.relativeToMedian;
  return <span className={`pe-position indicator-${value.tone} ${compact ? 'is-compact' : ''}`} data-testid="pe-position">
    <span className="indicator-top"><strong>{value.current == null ? '—' : value.current.toFixed(2)}{!compact && value.current != null && <small> 倍</small>}</strong><span className="indicator-tag">{value.label}</span></span>
    {value.percentile != null ? <>
      <span className="position-track" role="img" aria-label={`PE 历史位置 ${value.percentile.toFixed(1)}%，从低到高`}><i className="position-tick" style={{ left: '30%' }} /><i className="position-tick" style={{ left: '50%' }} /><i className="position-tick" style={{ left: '70%' }} /><b style={{ left: `${Math.min(98, Math.max(2, value.percentile))}%` }} /></span>
      <span className="position-labels"><span>低</span><strong>{value.percentile.toFixed(1)}% 分位</strong><span>高</span></span>
    </> : <small>{value.current == null ? '缺失 / 不适用，不用 0 代替' : '无可靠历史分位，不推断高低'}</small>}
    {!compact && relative != null && <span className="median-distance">{relative < 0 ? '↓ 低于' : relative > 0 ? '↑ 高于' : '= 等于'}历史中位{relative !== 0 && ` ${Math.abs(relative).toFixed(1)}%`}</span>}
    {!compact && value.median != null && <span className="pe-reference-values"><span>30% 位<b>{value.q30?.toFixed(2)}</b></span><span>历史中位<b>{value.median.toFixed(2)}</b></span><span>70% 位<b>{value.q70?.toFixed(2)}</b></span></span>}
    <small>{value.metricLabel} · {value.asOf ?? '日期待更新'}{value.stale ? ' · 已过期' : ''}</small>
  </span>;
}

export function SmaPositionView({ value, error, compact = false }: { value: SmaIndicators; error?: string; compact?: boolean }) {
  const falling = value.slope20 != null && value.slope20 < 0;
  return <span className={`sma-position ${compact ? 'is-compact' : ''} ${falling ? 'is-falling' : ''}`} data-testid="sma-position">
    <span className="indicator-top"><strong className={falling ? 'indicator-down' : value.hot ? 'indicator-hot' : 'indicator-short'}>20DMA {slopePerDay(value.slope20)}<small>%/天</small></strong></span>
    {(!compact || value.hot || value.cold) && <span className={`indicator-tag ${falling ? 'indicator-down' : value.hot ? 'indicator-hot' : ''}`}>{falling ? '↘ ' : value.hot ? '♨ ' : value.slope20 != null && value.slope20 > 0 ? '↗ ' : ''}{value.heatLabel}{!compact && value.percentile20 != null && ` · ${value.percentile20.toFixed(1)}% 分位`}</span>}
    <SmaReferenceView value={value} compact={compact} />
    {!compact && <span className="sma-secondary">50DMA <b>{slopePerDay(value.slope50)}%/天</b></span>}
    <span title={`200DMA ${slopePerDay(value.slope200)}%/天 · 8日回看 · ${value.asOf ?? '待更新'}`} className={`sma-zero-status ${value.severe ? 'is-severe' : value.risk === 'near' ? 'is-near' : ''}`}><b>{value.severe ? '⚠ ' : ''}{value.riskLabel}</b>{!compact && <span>{slopePerDay(value.slope200)}%/天</span>}</span>
    <small>8日回看 · {value.asOf ?? (error ? '日期不可用' : '读取中')}{error ? ` · ${error}` : ''}</small>
    {!compact && value.asOf && <small>温度历史：{value.historyStart} 至 {value.asOf} · {value.sampleCount} 个有效样本（最多近5年）</small>}
  </span>;
}

export function SmaReferenceView({ value, compact = false }: { value: SmaIndicators; compact?: boolean }) {
  if (value.slope20 == null || value.slope20 === 0) return <span className="sma-peak-reference">{value.slope20 === 0 ? '当前走平，暂无方向参考' : '当前斜率待更新，不判断方向'}</span>;
  const falling = value.slope20 < 0;
  const stats = falling ? value.downside : value.overheat;
  const median = falling ? value.downside.medianTrough : value.overheat.medianPeak;
  const mean = falling ? value.downside.meanTrough : value.overheat.meanPeak;
  const count = falling ? value.downside.reboundCount : value.overheat.pullbackCount;
  return <span className={`sma-peak-reference ${falling ? 'is-downside' : 'is-upside'}`} data-direction={falling ? 'down' : 'up'}>
    <strong className="sma-reference-median">{falling ? '下降' : '上升'}中位 <b>{slopePerDay(median)}</b><small>%/天</small></strong>
    {!compact && <><span>均值 {slopePerDay(mean)} %/天 · {count} 次</span><small>{falling ? '谷底后10日反弹 ≥ 3%' : '峰值后10日回落 ≥ 3%'}</small></>}
    {(!stats.reliable || !stats.fullFiveYears) && <small>{!stats.asOf ? '等待历史数据' : !stats.reliable ? '样本不足，仅供参考' : '历史不足5年'}</small>}
  </span>;
}
