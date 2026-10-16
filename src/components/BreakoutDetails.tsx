import type { QuantChannelReviewSnapshot } from '../types';
import { breakoutDescription, currentBreakout } from '../breakoutSignals';
export function BreakoutRules() {
  return <details className="breakout-rules"><summary aria-label="露头规则">ⓘ</summary><div>
    <strong>露头规则</strong>
    <p>↑ 向上：连续至少 15 个有效交易日 Z&lt;0 后，首次 Z&gt;0。</p>
    <p>↓ 向下：连续至少 15 个有效交易日 Z&gt;0 后，首次 Z&lt;0。</p>
    <p>只穿越零轴，不要求达到 ±1.5。正负是相对 200DMA 的位置，不是当天涨跌；不覆盖回撤判断。</p>
    <p>仅完整收盘确认。周末、休市日不计；缺失数据和 Z=0 均中断连续计数。</p>
    <p>筛选展示最近审查日的露头，历史记录在“最近提醒”。</p>
  </div></details>;
}
export function BreakoutDetails({ review, symbol, preview }: { review: QuantChannelReviewSnapshot; symbol: string; preview: boolean }) {
  const event = currentBreakout(review, symbol);
  const status = review.breakouts?.[symbol];
  const history = (review.breakout_history ?? []).filter(e => e.symbol === symbol).slice(-12).reverse();
  return <div className="breakout-details" data-testid="breakout-details">
    <h4>露头记录</h4>
    {preview ? <p className="decision-note">盘中不确认露头；以下仅为完整收盘记录。</p> : null}
    {event ? <p className="breakout-current">{breakoutDescription(event)}</p>
      : <p className="decision-note">{status?.status === 'none' ? '未触发' : '暂无法判断'} · {status?.reason ?? '等待完整收盘审查数据。'}{status?.as_of && `（${status.as_of}）`}</p>}
    <p className="decision-note">穿越零轴，不等于买卖或极值信号。</p>
    <details className="decision-evidence" key={symbol}><summary>最近提醒{history.length ? ` · ${history.length} 条` : ''}</summary>
      <p>按事件日期展示，历史记录不算当日新增；不代表手机推送已送达。</p>
      {history.length ? <ul>{history.map(e => <li key={e.id}>{breakoutDescription(e)}</li>)}</ul> : <p>暂无已确认记录。</p>}
    </details>
  </div>;
}
