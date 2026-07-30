import { finalVerdictFreshness, finalVerdictSymbols } from '../quantAnalysis';
import { dateText, formatMoney } from '../format';
import { dedupeVerdictSentence, layerRequirements, nearestVerdict } from '../silenceBroadcast';
import type { QuantAnalysisFreshness, QuantAnalysisSnapshot, QuantFinalVerdict } from '../types';

/**
 * A deliberately singular status strip.  The quant service owns every market
 * judgement; the client only groups its already-final verdicts for display.
 */
export function DecisionStatusBar({ snapshot }: { snapshot: QuantAnalysisSnapshot }) {
  const verdicts = Object.values(finalVerdictSymbols(snapshot));
  const headline = verdictHeadline(verdicts);
  const staleVerdict = verdicts.find((item) => item.data_stale || (item.data_stale_days ?? 0) > 0);
  const verdictFreshness = finalVerdictFreshness(snapshot);
  const freshness = snapshot.freshness;
  // `max_stale_days` is the server's configured tolerance, not an age — it must
  // never make fresh data look stale, nor stand in for the age itself.
  const isStale = Boolean(
    staleVerdict
    || verdictFreshness?.data_stale
    || freshness?.data_stale
    || (verdictFreshness?.stale_days ?? 0) > 0
    || (freshness?.stale_days ?? 0) > 0,
  );
  const stale = isStale
    ? {
        dataAsOf: staleVerdict?.data_as_of ?? verdictFreshness?.data_as_of ?? freshness?.data_as_of ?? null,
        staleDays: staleVerdict?.data_stale_days
          ?? verdictFreshness?.stale_days
          ?? freshness?.stale_days
          ?? null,
      }
    : null;
  const funding = fundingFacts(snapshot);
  const nearest = nearestVerdict(verdicts);
  const nearestRequirements = nearest
    ? layerRequirements(verdicts.find((item) => item.symbol === nearest.symbol)!)
    : [];
  const fallbackRequirements = nearestRequirements.length > 0
    ? nearestRequirements
    : verdicts.flatMap(layerRequirements).slice(0, 1);
  const isSilenceByRule = verdicts.some((verdict) => verdict.is_silence_by_rule);
  // When the server rendered today's statement, show that exact text so the
  // site and the phone push can never drift apart (二十七期 T4).
  const broadcastBody = snapshot.silence_broadcast?.body?.trim() || '';

  return (
    <section className="elev-3 rounded-2xl border border-neutral/40 bg-surface-raised p-3" aria-label="量化系统最终裁决">
      <div className="rounded-xl border border-neutral/30 bg-surface-overlay/45 px-3 py-2">
        <div className="text-sm font-semibold text-ink-primary">{headline}</div>
        {verdicts.length === 0 ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">等待下一份量化快照生成最终裁决；页面不会自行拼接买入结论。</p>
        ) : (
          <>
            {nearest && (
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                最接近的是 <span className="font-semibold text-ink-primary">{nearest.symbol}</span>
                {` —— ${nearest.totalCount} 层已过 ${nearest.passedCount} 层，仅差 ${nearest.blockingLabels.join('、')}`}
              </p>
            )}
            {fallbackRequirements.map((requirement) => (
              <p key={requirement} className="mt-1 text-xs leading-relaxed tabular-nums text-ink-secondary">{requirement}</p>
            ))}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-ink-secondary">查看 {verdicts.length} 个标的明细</summary>
              <div className="mt-2 space-y-1">
                {verdicts.map((verdict) => (
                  <div key={verdict.symbol}>
                    <p className="text-xs leading-relaxed tabular-nums text-ink-secondary">
                      <span className="mr-1 font-semibold text-ink-primary">{verdict.symbol}</span>
                      {verdict.single_sentence ? dedupeVerdictSentence(verdict.single_sentence) : '后端未提供结论说明。'}
                    </p>
                    {layerRequirements(verdict).map((requirement) => (
                      <p key={requirement} className="pl-4 text-xs leading-relaxed tabular-nums text-ink-muted">{requirement}</p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
        {stale && <p className="mt-2 text-xs tabular-nums text-trim">数据 {stale.dataAsOf ?? '暂无'}{typeof stale.staleDays === 'number' ? `（落后 ${stale.staleDays} 天）` : ''}</p>}
        {funding && <p className="mt-2 text-xs font-medium tabular-nums text-ink-primary">可用资金 {formatMoney(funding.availableUsd)} · 闸门放行 {formatMoney(funding.gateAllowedUsd)}</p>}
        {broadcastBody
          ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-ink-secondary">今日播报（与手机推送同一份）</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-ink-secondary">{broadcastBody}</pre>
            </details>
          )
          : isSilenceByRule && <p className="mt-2 text-xs leading-relaxed text-ink-muted">今日不买是规则的结论，不是系统故障。</p>}
      </div>
      <FreshnessBadges freshness={freshness} />
    </section>
  );
}

function fundingFacts(snapshot: QuantAnalysisSnapshot): { availableUsd: number; gateAllowedUsd: number } | null {
  const ammo = snapshot.ammo_overview;
  const availableUsd = ammo?.funding?.available_usd ?? ammo?.cash_exposure?.available_usd;
  const gateAllowedUsd = ammo?.buying_power?.by_3x_usd;
  if (typeof availableUsd !== 'number' || typeof gateAllowedUsd !== 'number') return null;
  if (!Number.isFinite(availableUsd) || !Number.isFinite(gateAllowedUsd)) return null;
  return { availableUsd, gateAllowedUsd };
}

function verdictHeadline(verdicts: QuantFinalVerdict[]): string {
  if (verdicts.length === 0) return '今日结论：数据不足，无法判定';
  const buyCount = verdicts.filter((item) => item.verdict === 'BUY').length;
  const noBuyCount = verdicts.filter((item) => item.verdict === 'NO_BUY').length;
  const undecidableCount = verdicts.filter((item) => item.verdict === 'UNDECIDABLE').length;
  if (undecidableCount === verdicts.length) return '今日结论：数据不足，无法判定';
  const parts = [
    buyCount > 0 ? `条件完整 ${buyCount}` : '',
    noBuyCount > 0 ? `不买 ${noBuyCount}` : '',
    undecidableCount > 0 ? `无法判定 ${undecidableCount}` : '',
  ].filter(Boolean);
  if (parts.length > 0) return `今日结论：${parts.join(' · ')}`;
  return '今日结论：暂无明确裁决';
}

function FreshnessBadges({ freshness }: { freshness: QuantAnalysisFreshness | undefined }) {
  if (!freshness) return null;
  const badges = [
    ['持仓', freshness.positions_as_of],
    ['价格', freshness.prices_at],
    ['估值', freshness.valuation_as_of],
    ['情绪', freshness.cnn_as_of],
    ['买入判定', freshness.buy_plan_evaluated_at],
    ['卖出判定', freshness.sell_evaluated_at],
    ['胜率状态', freshness.regime_evaluated_at],
  ] as const;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 border-t border-neutral/25 pt-2">
      {badges.map(([label, value]) => (
        <span key={label} className="text-[10px] tabular-nums text-ink-muted">
          {label} {dateText(value)}
        </span>
      ))}
    </div>
  );
}
