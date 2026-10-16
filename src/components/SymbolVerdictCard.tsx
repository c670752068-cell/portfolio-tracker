import { isHonestPass } from '../gateHonesty';
import { isThreeXSymbol, type StockFamilyAllocation } from '../positionAllocation';
import { depthConditionSatisfied, finalVerdictSymbols } from '../quantAnalysis';
import { dedupeVerdictSentence, layerRequirements } from '../silenceBroadcast';
import type { QuantAnalysisSnapshot, QuantFinalVerdictLayer } from '../types';

/**
 * The server's own verdict, verbatim. Every word here is a payload field —
 * the card ranks and labels nothing, it only stops the five layers from
 * being invisible behind a collapsed disclosure.
 */

type LayerState = 'passed' | 'passed_on_missing_data' | 'failed' | 'not_applicable' | 'unknown';

const LAYER_STATE_VIEW = {
  passed: { icon: '✓', className: 'text-gain', note: '' },
  // The verdict stays the server's `passed`; only the icon and the wording change.
  passed_on_missing_data: { icon: '⚠', className: 'text-trim', note: '（因数据缺失而未拦截，非真实通过）' },
  failed: { icon: '✗', className: 'text-loss', note: '' },
  not_applicable: { icon: '○', className: 'text-ink-muted', note: '不适用' },
  unknown: { icon: '○', className: 'text-ink-muted', note: '' },
} as const;

function layerState(layer: QuantFinalVerdictLayer): LayerState {
  if (layer.state === 'passed') return isHonestPass(true, layer.reason) ? 'passed' : 'passed_on_missing_data';
  if (layer.state === 'failed' || layer.state === 'not_applicable') return layer.state;
  return 'unknown';
}

export function SymbolVerdictCard({
  snapshot,
  symbol,
  allocation,
  embedded = false,
}: {
  snapshot: QuantAnalysisSnapshot | null;
  symbol: string;
  allocation?: StockFamilyAllocation | null;
  embedded?: boolean;
}) {
  const verdict = snapshot ? finalVerdictSymbols(snapshot)[symbol] : undefined;
  const hasDepthCondition = Boolean(
    snapshot?.summary?.depth_states?.[symbol]
    || snapshot?.symbols?.[symbol]?.depth_window?.applicable,
  );
  const layers = verdict?.layers ?? [];
  const withoutSleeveQuota = layers.filter((layer) => layer.layer !== 'sleeve_borrow');
  const visibleLayers = isThreeXSymbol(symbol)
    ? withoutSleeveQuota
    : withoutSleeveQuota.filter((layer) => !['entry_gate_1x', 'buy_plan_conditions', 'panic_window'].includes(layer.layer));
  const satisfied = snapshot ? depthConditionSatisfied(snapshot, symbol) : false;
  const depthOverridesVerdict = hasDepthCondition && satisfied && verdict?.verdict !== 'BUY';
  const sentence = !depthOverridesVerdict && verdict?.single_sentence
    ? dedupeVerdictSentence(verdict.single_sentence)
    : '';
  const requirements = verdict ? layerRequirements({ ...verdict, layers: visibleLayers }) : [];
  const badgeClass = satisfied ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss';

  return (
    <div
      data-testid={embedded ? 'embedded-symbol-verdict' : 'standalone-symbol-verdict'}
      className={embedded ? 'mt-4 border-t border-neutral/30 pt-4' : 'rounded-xl border border-neutral/40 bg-surface-raised p-4'}
    >
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-lg">{symbol}</strong>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}>{satisfied ? '满足' : '不满足'}</span>
        </div>
      )}
      {sentence && <p className="mt-2 text-sm text-ink-secondary" data-verdict-field="sentence">{sentence}</p>}
      {depthOverridesVerdict && (
        <p className="mt-2 text-sm text-gain">深度位置已满足；组合仓位限制不改变回撤深度判定。</p>
      )}
      {!hasDepthCondition && !sentence && verdict?.verdict === 'UNDECIDABLE' && (
        <p className="mt-2 text-sm text-loss">数据缺失，当前不满足</p>
      )}
      {!hasDepthCondition && !verdict && (
        <p className="mt-2 text-sm text-ink-muted">待更新，当前不满足</p>
      )}
      {(visibleLayers.length > 0 || allocation) && (
        <ul className="mt-3 space-y-2">
          {visibleLayers.map((layer) => {
            const state = layerState(layer);
            const view = LAYER_STATE_VIEW[state];
            return (
              <li key={layer.layer} className="flex gap-2 text-sm">
                <span className={`shrink-0 font-semibold ${view.className}`} data-layer-state={state}>{view.icon}</span>
                <span className="min-w-0">
                  <span className="font-medium">{layer.label ?? layer.layer}</span>
                  {layer.reason && <span className="ml-1 text-ink-muted">{layer.reason}</span>}
                  {view.note && <span className="ml-1 text-ink-muted">{view.note}</span>}
                </span>
              </li>
            );
          })}
          {allocation && (
            <li className="flex gap-2 text-sm" data-position-allocation>
              <span className="shrink-0 font-semibold text-gain">✓</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">仓位配比</span>
                <span className="ml-1 tabular-nums text-ink-muted">
                  当前 {allocation.currentPct.toFixed(2)}% · 上限 {allocation.capPct.toFixed(2)}%
                </span>
                <span
                  aria-label="个股族仓位进度"
                  aria-valuemax={allocation.capPct}
                  aria-valuemin={0}
                  aria-valuenow={allocation.currentPct}
                  className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral/30"
                  role="progressbar"
                >
                  <span
                    className={`block h-full rounded-full ${allocation.currentPct > allocation.capPct ? 'bg-loss' : 'bg-gain'}`}
                    style={{ width: `${Math.min(100, allocation.currentPct / allocation.capPct * 100)}%` }}
                  />
                </span>
                <span className="mt-1 block text-xs text-ink-muted">
                  {allocation.members.length > 0
                    ? `${allocation.family} 家族合并：${allocation.members.join(' + ')}`
                    : `${allocation.family} 家族当前未持有`}
                </span>
              </span>
            </li>
          )}
        </ul>
      )}
      {requirements.map((requirement) => (
        <p key={requirement} className="mt-2 text-sm font-medium tabular-nums text-trim">{requirement}</p>
      ))}
    </div>
  );
}
