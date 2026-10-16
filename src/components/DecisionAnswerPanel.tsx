import type { DecisionAction } from '../decisionAction';
import { OBSERVATION_LABELS, zObservationSignal } from '../decisionSignals';

export interface DecisionQuote {
  date: string | null;
  close: number | null;
  z: number | null;
  annualSlope: number | null;
  slopeDate: string | null;
}

interface Props {
  symbol: string;
  name: string;
  held: boolean;
  action: DecisionAction;
  mode: 'closed' | 'preview';
  onModeChange: (mode: 'closed' | 'preview') => void;
  onReturnToList: () => void;
  closed: DecisionQuote;
  preview: DecisionQuote | null;
}

/** Presentation only: preview quotes never replace the existing formal verdict. */
export function DecisionAnswerPanel({ symbol, name, held, action, mode, onModeChange, onReturnToList, closed, preview }: Props) {
  const quote = mode === 'preview' ? preview : closed;
  const state = zObservationSignal(quote?.z);
  return <aside className="decision-detail decision-answer-panel" aria-label="当前股票判断详情">
    <div className="decision-detail-identity">
      <button className="decision-return-list" onClick={onReturnToList}>← 返回列表</button>
      <div className="decision-detail-heading"><h3>{symbol} <span>{name}</span></h3>{held && <span className="held-tag">已持仓</span>}</div>
    </div>
    <section className={`decision-action-summary action-${action.kind}`} aria-label={`${symbol} 当前行动`}>
      <h4>当前结论</h4>
      <strong className={`decision-action-label action-${action.kind}`}>{action.label}</strong>
    </section>
    <div className="decision-mode" role="group" aria-label="行情显示">
      <button type="button" aria-pressed={mode === 'closed'} onClick={() => onModeChange('closed')}>完整收盘</button>
      <button type="button" aria-pressed={mode === 'preview'} onClick={() => onModeChange('preview')}>盘中预览</button>
    </div>
    <section className="decision-quote" aria-label={mode === 'preview' ? '盘中行情' : '收盘行情'}>
      {quote ? <>
        <div className="decision-quote-stamp"><time>{quote.date ?? '日期待更新'}</time><span className={mode === 'preview' ? 'is-preview' : ''}>{mode === 'preview' ? '未收盘确认' : '完整收盘'}</span></div>
        <div className="decision-quote-price"><span>{mode === 'preview' ? '盘中价' : '收盘价'}</span><strong>{number(quote.close, '$')}</strong></div>
        <dl className="decision-quote-metrics">
          <div><dt>Z-Score</dt><dd className={`quote-z signal-${state}`}>{number(quote.z, '', true)}</dd><span className={`signal-badge signal-${state}`}>{OBSERVATION_LABELS[state]}</span></div>
          <div><dt>200DMA 年化斜率</dt><dd className={quote.annualSlope != null && quote.annualSlope < 0 ? 'is-negative' : ''}>{number(quote.annualSlope, '', true, '%')}</dd><small>{quote.slopeDate && quote.slopeDate !== quote.date ? quote.slopeDate : '20日回看'}</small></div>
        </dl>
      </> : <p className="decision-quote-empty" role="status">暂无盘中数据</p>}
    </section>
  </aside>;
}

function number(value: number | null | undefined, prefix = '', signed = false, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${prefix}${signed && value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;
}
