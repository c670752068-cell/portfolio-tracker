import { finalVerdictWord } from '../finalVerdictWord';
import { finalVerdictSymbols } from '../quantAnalysis';
import { dedupeVerdictSentence, layerRequirements } from '../silenceBroadcast';
import type { QuantAnalysisSnapshot, QuantFinalVerdictLayer } from '../types';

/**
 * The server's own verdict, verbatim. Every word here is a payload field —
 * the card ranks and labels nothing, it only stops the five layers from
 * being invisible behind a collapsed disclosure.
 */

type LayerState = 'passed' | 'failed' | 'not_applicable' | 'unknown';

const LAYER_STATE_VIEW = {
  passed: { icon: '✓', className: 'text-gain', note: '' },
  failed: { icon: '✗', className: 'text-loss', note: '' },
  not_applicable: { icon: '○', className: 'text-ink-muted', note: '不适用' },
  unknown: { icon: '○', className: 'text-ink-muted', note: '' },
} as const;

const VERDICT_BADGE = {
  BUY: 'bg-gain/15 text-gain',
  NO_BUY: 'bg-neutral/30 text-ink-secondary',
} as const;

function layerState(layer: QuantFinalVerdictLayer): LayerState {
  if (layer.state === 'passed' || layer.state === 'failed' || layer.state === 'not_applicable') return layer.state;
  return 'unknown';
}

export function SymbolVerdictCard({ snapshot, symbol }: { snapshot: QuantAnalysisSnapshot | null; symbol: string }) {
  const verdict = snapshot ? finalVerdictSymbols(snapshot)[symbol] : undefined;
  const layers = verdict?.layers ?? [];
  const sentence = verdict?.single_sentence ? dedupeVerdictSentence(verdict.single_sentence) : '';
  const requirements = verdict ? layerRequirements(verdict) : [];
  const badgeClass = verdict?.verdict === 'BUY'
    ? VERDICT_BADGE.BUY
    : verdict?.verdict === 'NO_BUY'
      ? VERDICT_BADGE.NO_BUY
      : 'bg-trim/10 text-trim';

  return (
    <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-lg">{symbol}</strong>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}>{finalVerdictWord(verdict)}</span>
      </div>
      {sentence && <p className="mt-2 text-sm text-ink-secondary" data-verdict-field="sentence">{sentence}</p>}
      {layers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {layers.map((layer) => {
            const state = layerState(layer);
            const view = LAYER_STATE_VIEW[state];
            return (
              <li key={layer.layer} className="flex gap-2 text-sm">
                <span className={`shrink-0 font-semibold ${view.className}`} data-layer-state={state}>{view.icon}</span>
                <span className="min-w-0">
                  <span className="font-medium">{layer.label ?? layer.layer}</span>
                  {view.note && <span className="ml-1 text-ink-muted">{view.note}</span>}
                  {layer.reason && <span className="ml-1 text-ink-muted">{layer.reason}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {requirements.map((requirement) => (
        <p key={requirement} className="mt-2 text-sm font-medium tabular-nums text-trim">{requirement}</p>
      ))}
    </div>
  );
}
