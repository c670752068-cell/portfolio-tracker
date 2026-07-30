import { useMemo, useState, type FormEvent } from 'react';
import { buildAlertHoldingOptions, dispatchAlertRuleMutation, formatAlertCurrentPrice, formatAlertDistance, resolveHoldingCostSuggestion, type AlertRule, type AlertRuleDraft, type AlertRuleType } from '../alertRules';
import { formatMoney } from '../format';
import { REFRESH_CADENCE } from '../refreshCadence';
import { depthQuoteSnapshot, type DepthQuote } from '../depthQuotePrice';
import type { Holding, QuantHoldingCost } from '../types';

interface AlertRulesPanelProps {
  rules: AlertRule[];
  holdings: Holding[];
  holdingCosts: Record<string, QuantHoldingCost>;
  monitoredQuotes?: ReadonlyMap<string, DepthQuote>;
  initialRuleType?: AlertRuleType;
  initialSymbol?: string;
  loading: boolean;
  error: string;
  onCreate: (draft: AlertRuleDraft) => void | Promise<void>;
  onUpdate: (draft: AlertRuleDraft) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

interface FormState {
  id?: string;
  symbol: string;
  type: AlertRuleType;
  direction: 'above' | 'below';
  targetPrice: number;
  costBasis: number;
  gainPct: number;
  approachPct: number;
  reduceToPct: number;
}

function newForm(type: AlertRuleType, symbol: string, holdingCosts: Record<string, QuantHoldingCost>): FormState {
  const suggestion = resolveHoldingCostSuggestion(holdingCosts[symbol]);
  return {
    symbol,
    type,
    direction: 'above',
    targetPrice: 0,
    costBasis: suggestion.automaticValue ?? 0,
    gainPct: 20,
    approachPct: 5,
    reduceToPct: 5,
  };
}

function ruleTarget(rule: AlertRule): number | null {
  if (rule.type === 'target_price') return rule.target_price ?? null;
  return typeof rule.cost_basis === 'number' && typeof rule.gain_pct === 'number'
    ? rule.cost_basis * (1 + rule.gain_pct / 100)
    : null;
}

function reminderTypeLabel(type: AlertRule['last_alert_type']): string {
  if (type === 'approach') return '接近';
  if (type === 'reached') return '到达';
  return '已触发';
}

export function AlertRulesPanel(props: AlertRulesPanelProps) {
  const holdingOptions = useMemo(() => buildAlertHoldingOptions(props.holdings), [props.holdings]);
  const firstSymbol = props.initialSymbol || holdingOptions[0]?.symbol || '';
  const [form, setForm] = useState(() => newForm(props.initialRuleType || 'target_price', firstSymbol, props.holdingCosts));
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');
  const suggestion = useMemo(() => resolveHoldingCostSuggestion(props.holdingCosts[form.symbol]), [form.symbol, props.holdingCosts]);
  const latestReminder = [...props.rules]
    .filter((rule) => rule.last_reminder_at)
    .sort((left, right) => String(right.last_reminder_at).localeCompare(String(left.last_reminder_at)))[0];

  function setRuleType(type: AlertRuleType) {
    setForm((current) => ({ ...newForm(type, current.symbol, props.holdingCosts), id: current.id }));
  }

  function setSymbol(symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    const nextSuggestion = resolveHoldingCostSuggestion(props.holdingCosts[normalized]);
    setForm((current) => ({
      ...current,
      symbol: normalized,
      type: current.type === 'gain_pct' && nextSuggestion.automaticValue === null ? 'target_price' : current.type,
      costBasis: nextSuggestion.automaticValue ?? 0,
    }));
  }

  function editRule(rule: AlertRule) {
    const costSuggestion = resolveHoldingCostSuggestion(props.holdingCosts[rule.symbol]);
    setForm({
      id: rule.id,
      symbol: rule.symbol,
      type: rule.type,
      direction: rule.direction || 'above',
      targetPrice: rule.target_price ?? 0,
      costBasis: rule.cost_basis ?? costSuggestion.automaticValue ?? 0,
      gainPct: rule.gain_pct ?? 20,
      approachPct: rule.approach_pct,
      reduceToPct: rule.reduce_to_pct ?? 5,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (!form.symbol) {
      setLocalError('请选择当前持仓');
      return;
    }
    if (form.type === 'target_price' && form.targetPrice <= 0) {
      setLocalError('目标价必须大于 0');
      return;
    }
    if (form.type === 'gain_pct' && form.costBasis <= 0) {
      setLocalError('券商未提供完整成本，仅可用目标价规则');
      return;
    }
    const draft: AlertRuleDraft = form.type === 'target_price'
      ? {
          id: form.id,
          symbol: form.symbol,
          type: form.type,
          direction: form.direction,
          target_price: form.targetPrice,
          approach_pct: form.approachPct,
          reduce_to_pct: form.reduceToPct,
          enabled: true,
        }
      : {
          id: form.id,
          symbol: form.symbol,
          type: form.type,
          cost_basis: form.costBasis,
          gain_pct: form.gainPct,
          approach_pct: form.approachPct,
          reduce_to_pct: form.reduceToPct,
          enabled: true,
        };
    setSaving(true);
    try {
      await dispatchAlertRuleMutation(
        form.id ? { kind: 'update', draft: { ...draft, id: form.id } } : { kind: 'create', draft },
        props,
      );
      setForm(newForm(form.type, form.symbol, props.holdingCosts));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      {latestReminder && (
        <div className="rounded-xl border border-trim/60 bg-trim/10 p-3 text-sm text-trim dark:border-trim/60 dark:bg-trim/15 dark:text-trim">
          <strong>{latestReminder.symbol} {reminderTypeLabel(latestReminder.last_alert_type)}提醒</strong>
          <span className="ml-2 font-mono tabular-nums">{latestReminder.last_reminder_at}</span>
          <div className="mt-1 text-xs">只提醒不下单，请在券商 App 手动执行。</div>
        </div>
      )}

      <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4 dark:border-neutral/60 dark:bg-surface-raised">
        <h2 className="text-base font-semibold">目标提醒</h2>
        <p className="mt-1 text-xs text-ink-muted">规则保存在服务器，电脑与手机共用；{REFRESH_CADENCE.alerts.interval}检查一次，接近与到达各提醒一次。</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">规则类型</span>
              <select value={form.type} onChange={(event) => setRuleType(event.target.value as AlertRuleType)} className={inputClass}>
                <option value="target_price">目标价</option>
                <option value="gain_pct" disabled={suggestion.automaticValue === null}>涨幅阈值{suggestion.automaticValue === null ? '（成本不可用）' : ''}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">股票代码</span>
              <select value={form.symbol} onChange={(event) => setSymbol(event.target.value)} className={inputClass}>
                {holdingOptions.length === 0 && <option value="">暂无可用持仓</option>}
                {holdingOptions.map((option) => <option key={option.symbol} value={option.symbol}>{option.label}</option>)}
              </select>
            </label>
          </div>

          {form.type === 'target_price' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm"><span className="mb-1 block font-medium">方向</span><select value={form.direction} onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value as 'above' | 'below' }))} className={inputClass}><option value="above">上涨到</option><option value="below">下跌到</option></select></label>
              <label className="text-sm"><span className="mb-1 block font-medium">目标价</span><input type="number" min="0" step="any" value={form.targetPrice || ''} onChange={(event) => setForm((current) => ({ ...current, targetPrice: Number(event.target.value) }))} className={inputClass} /></label>
              <label className="text-sm"><span className="mb-1 block font-medium">清仓或减到总仓位</span><select value={form.reduceToPct} onChange={(event) => setForm((current) => ({ ...current, reduceToPct: Number(event.target.value) }))} className={inputClass}><option value={5}>5%</option><option value={3}>3%</option></select></label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="text-sm"><span className="mb-1 block font-medium">成本价（USD）</span><div className={`${inputClass} cursor-not-allowed bg-surface-overlay/30 dark:bg-surface-base`}>{suggestion.automaticValue == null ? '成本不可用' : `${formatMoney(suggestion.automaticValue)}（券商加权）`}</div></div>
                <label className="text-sm"><span className="mb-1 block font-medium">涨幅阈值</span><select value={form.gainPct} onChange={(event) => setForm((current) => ({ ...current, gainPct: Number(event.target.value) }))} className={inputClass}><option value={20}>+20%</option><option value={30}>+30%</option></select></label>
              </div>
              {suggestion.coverage === 'complete' && <p className="text-xs text-gain dark:text-gain">成本来自三券商持仓，已按股数加权。</p>}
              {suggestion.coverage !== 'complete' && <p className="text-xs text-trim dark:text-trim">成本不可用{suggestion.referenceValue == null ? '' : `（部分账户参考 ${formatMoney(suggestion.referenceValue)}）`}；券商未提供完整成本，仅可用目标价规则。</p>}
              <p className="text-xs text-ink-muted">到达后提醒：卖出 50% 仓位，留 50% 博弈。</p>
            </div>
          )}

          <label className="block text-sm"><span className="mb-1 block font-medium">接近阈值</span><select value={form.approachPct} onChange={(event) => setForm((current) => ({ ...current, approachPct: Number(event.target.value) }))} className={inputClass}><option value={5}>5%</option><option value={3}>3%</option></select></label>
          {(localError || props.error) && <div className="rounded border border-loss/60 bg-loss/10 p-2 text-xs text-loss dark:border-loss/60 dark:bg-loss/15 dark:text-loss">{localError || props.error}</div>}
          <button type="submit" disabled={saving || props.loading} className="rounded-md bg-buy px-4 py-2 text-sm font-medium text-surface-base disabled:bg-neutral">{saving ? '保存中…' : form.id ? '保存修改' : '创建提醒'}</button>
        </form>
      </div>

      <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4 dark:border-neutral/60 dark:bg-surface-raised">
        <h3 className="font-semibold">已保存规则</h3>
        {props.rules.length === 0 ? <p className="mt-2 text-sm text-ink-muted">暂无提醒规则。</p> : (
          <div className="mt-2 divide-y divide-neutral/30 dark:divide-neutral/50">
            {props.rules.map((rule) => {
              const quote = depthQuoteSnapshot(props.holdings, props.monitoredQuotes ?? new Map(), rule.symbol);
              const target = ruleTarget(rule);
              const displayRule = quote
                ? {
                    ...rule,
                    current_price: quote.price,
                    last_checked_at: quote.timestamp,
                    prices_at: quote.timestamp,
                    price_session: quote.session,
                    distance_pct: target == null ? null : Math.abs(quote.price - target) / target * 100,
                  }
                : rule;
              return (
                <div key={rule.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono font-semibold tabular-nums">{rule.symbol} · {rule.type === 'target_price' ? `目标价 ${target == null ? '暂无' : formatMoney(target)}` : `成本 ${rule.cost_basis == null ? '暂无' : formatMoney(rule.cost_basis)} +${Number(rule.gain_pct).toFixed(2)}%`}</div>
                      <div className="mt-1 font-mono text-xs tabular-nums text-ink-muted">{formatAlertCurrentPrice(displayRule)} · {formatAlertDistance(displayRule)}</div>
                      <div className="mt-1 font-mono text-xs tabular-nums text-ink-muted">最近提醒 {rule.last_reminder_at || '尚未触发'}</div>
                    </div>
                    <div className="flex gap-2"><button type="button" onClick={() => editRule(rule)} className={smallButtonClass}>编辑</button><button type="button" onClick={() => void props.onDelete(rule.id)} className={smallButtonClass}>删除</button></div>
                  </div>
                  <p className="mt-2 text-xs text-trim dark:text-trim">只提醒不下单；由你在券商 App 手动执行。</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const inputClass = 'w-full rounded-md border border-neutral/60 bg-surface-raised px-2 py-2 font-mono text-sm tabular-nums focus:border-buy focus:outline-none dark:border-neutral dark:bg-surface-base';
const smallButtonClass = 'rounded-md border border-neutral/60 px-2 py-1 text-xs dark:border-neutral';
