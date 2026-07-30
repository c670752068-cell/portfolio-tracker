import { useEffect, useMemo, useState } from 'react';
import { dateText } from '../format';
import type { QuantAnalysisSnapshot, QuantBuyPlan } from '../types';
import {
  BUY_PLAN_TEMPLATES,
  conditionProgress,
  evaluateLocalBuyPlan,
  loadLocalBuyPlans,
  planToYaml,
  saveLocalBuyPlans,
  serverPlanToLocal,
  validateLocalBuyPlan,
  type LocalBuyPlan,
} from '../valuationPlan';

interface BuyPlanSectionProps {
  snapshot: QuantAnalysisSnapshot;
  onDirtyChange: (dirty: boolean) => void;
}

const EMPTY_PLAN: LocalBuyPlan = {
  id: '',
  symbol: '',
  label: '',
  ndxPeBelow: 30,
  cnnScoreBelow: 30,
  drawdownBelowPct: -25,
  vixAbove: null,
  vixPercentileAbove: null,
  buyPctOfNav: 3,
  enabled: true,
};

export function BuyPlanSection({ snapshot, onDirtyChange }: BuyPlanSectionProps) {
  const serverPlans = useMemo(
    () => snapshot.buy_plan_status?.plans ?? [],
    [snapshot.buy_plan_status?.plans],
  );
  const [localPlans, setLocalPlans] = useState<LocalBuyPlan[] | null>(() => loadLocalBuyPlans());
  const [editing, setEditing] = useState<LocalBuyPlan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showYaml, setShowYaml] = useState(false);
  const [copyState, setCopyState] = useState('');

  const basePlans = useMemo(
    () => localPlans ?? serverPlans.map(serverPlanToLocal),
    [localPlans, serverPlans],
  );
  const evaluated = useMemo(
    () => (localPlans === null
      ? [...serverPlans]
      : localPlans.map((plan) => evaluateLocalBuyPlan(
          plan,
          snapshot,
          serverPlans.find((item) => item.id === plan.id)?.position_gate,
        ))).sort(planSort),
    [localPlans, serverPlans, snapshot],
  );
  const yaml = useMemo(() => planToYaml(basePlans), [basePlans]);
  const accountPlan = evaluated.find((plan) => plan.buy_sizing?.risk_context);
  const symbols = useMemo(
    () => Object.entries(snapshot.symbols)
      .filter(([, analysis]) => analysis.available)
      .map(([symbol]) => symbol)
      .sort(),
    [snapshot.symbols],
  );

  useEffect(() => {
    onDirtyChange(dirty);
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, onDirtyChange]);

  function beginCreate(templateIndex = 0) {
    const template = BUY_PLAN_TEMPLATES[templateIndex];
    setEditing({
      ...EMPTY_PLAN,
      ...template.values,
      id: `plan-${Date.now()}`,
      symbol: symbols[0] ?? '',
      label: template.label,
    });
    setDirty(true);
    setErrors([]);
  }

  function beginEdit(plan: QuantBuyPlan) {
    setEditing(serverPlanToLocal(plan));
    setDirty(false);
    setErrors([]);
  }

  function updateEditing(patch: Partial<LocalBuyPlan>) {
    setEditing((current) => current ? { ...current, ...patch } : current);
    setDirty(true);
    setErrors([]);
  }

  function saveEditing() {
    if (!editing) return;
    const nextErrors = validateLocalBuyPlan(editing);
    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }
    const next = [
      ...basePlans.filter((plan) => plan.id !== editing.id),
      { ...editing, symbol: editing.symbol.toUpperCase() },
    ];
    setLocalPlans(next);
    saveLocalBuyPlans(next);
    setEditing(null);
    setDirty(false);
    onDirtyChange(false);
  }

  function cancelEditing() {
    if (dirty && !window.confirm('当前修改尚未保存，确定放弃吗？')) return;
    setEditing(null);
    setDirty(false);
    setErrors([]);
    onDirtyChange(false);
  }

  function deletePlan(plan: QuantBuyPlan) {
    if (!window.confirm(`确定删除「${plan.symbol} · ${plan.label}」吗？`)) return;
    const next = basePlans.filter((item) => item.id !== plan.id);
    setLocalPlans(next);
    saveLocalBuyPlans(next);
    if (editing?.id === plan.id) cancelEditing();
  }

  async function copyYaml() {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopyState('已复制');
    } catch {
      setCopyState('复制失败，请长按文本手动复制');
    }
  }

  return (
    <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">开枪计划表</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">在冷静时写下条件，恐慌时就不用临时决定。</p>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">
          量化快照 {dateText(snapshot.buy_plan_status?.evaluated_at) === '暂无' ? '数据准备中' : dateText(snapshot.buy_plan_status?.evaluated_at)}
        </span>
      </div>

      {accountPlan?.buy_sizing && <PlanAccountContext plan={accountPlan} />}

      {evaluated.length === 0 ? (
        <EmptyPlans onUseTemplate={() => beginCreate(0)} />
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {evaluated.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onEdit={() => beginEdit(plan)}
              onDelete={() => deletePlan(plan)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <PlanEditor
          plan={editing}
          symbols={symbols}
          errors={errors}
          onChange={updateEditing}
          onSave={saveEditing}
          onCancel={cancelEditing}
          onTemplate={(index) => updateEditing({ ...BUY_PLAN_TEMPLATES[index].values, label: BUY_PLAN_TEMPLATES[index].label })}
        />
      ) : (
        <button
          type="button"
          onClick={() => beginCreate(0)}
          className="mt-4 min-h-11 rounded-xl border border-buy/50 px-4 py-2 text-sm font-semibold text-buy hover:bg-buy/10"
        >
          + 新增计划
        </button>
      )}

      <div className="mt-5 border-t border-neutral/30 pt-4">
        <button
          type="button"
          onClick={() => setShowYaml((current) => !current)}
          className="min-h-11 rounded-xl bg-buy px-4 py-2 text-sm font-semibold text-surface-base"
        >
          {showYaml ? '收起 YAML' : '生成 YAML'}
        </button>
        {showYaml && (
          <div className="ui-enter mt-3">
            <textarea
              readOnly
              aria-label="开枪计划 YAML"
              value={yaml}
              className="h-72 w-full rounded-xl border border-neutral/50 bg-surface-base p-3 font-mono text-xs tabular-nums text-ink-secondary"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={copyYaml}
                className="min-h-11 rounded-xl border border-buy/50 px-4 py-2 text-sm font-semibold text-buy hover:bg-buy/10"
              >
                一键复制
              </button>
              {copyState && <span className="text-xs text-ink-secondary">{copyState}</span>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              粘贴到 <code className="font-mono tabular-nums">config/buy_plan.yaml</code> 后，量化系统会在条件满足时推送手机。网站只做本地即时预览，不会自动下单。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function PlanAccountContext({ plan }: { plan: QuantBuyPlan }) {
  const sizing = plan.buy_sizing!;
  const risk = sizing.risk_context!;
  const isHardCapBlocked = risk.sleeve.over_hard_cap_usd > 0;
  return (
    <div className="mt-4 rounded-xl border border-neutral/30 bg-surface-overlay/45 p-3 text-xs text-ink-secondary">
      <div className="tabular-nums">当前仓位门额度：${sizing.suggested_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
      <div className="mt-1 tabular-nums">等效敞口 {risk.total_effective_pct.toFixed(2)}% · 实付现金 {risk.total_cash_pct.toFixed(2)}%</div>
      <div className="mt-1 tabular-nums">{risk.sleeve.name}：等效 {risk.sleeve.effective_pct.toFixed(2)}% · 现金 {risk.sleeve.cash_pct.toFixed(2)}%</div>
      <div className={`mt-2 rounded-lg px-3 py-2 ${sizing.gate.passed ? 'bg-buy/10 text-buy' : 'bg-trim/10 text-trim'}`}>
        {isHardCapBlocked ? '本轮不建议新增：' : sizing.gate.passed ? '仓位门通过：' : '仓位门未过：'}{sizing.gate.reason}
        {isHardCapBlocked && <span className="ml-1 tabular-nums">（{risk.sleeve.name}超硬顶 {risk.sleeve.hard_cap_pct.toFixed(2)}%）</span>}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onEdit,
  onDelete,
}: {
  plan: QuantBuyPlan;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sizing = plan.buy_sizing;
  const risk = sizing?.risk_context;
  const gatePassed = sizing?.gate?.passed ?? plan.position_gate.passed;
  const gateNote = sizing?.gate?.reason ?? plan.position_gate.note;
  const proposedAmount = sizing?.suggested_usd ?? plan.action_amount_usd;
  const isHardCapBlocked = (risk?.sleeve.over_hard_cap_usd ?? 0) > 0;
  const readyStyle = plan.ready ? 'border-buy/60 bg-buy/10' : 'border-neutral/40 bg-surface-overlay/35';
  return (
    <article className={`rounded-xl border p-4 ${readyStyle}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold"><span className="font-mono tabular-nums">{plan.symbol}</span> · {plan.label}</div>
          <div className={`mt-1 text-xs ${plan.ready ? 'text-buy' : 'text-ink-muted'}`}>
            {plan.ready ? '条件已满足，可按预先计划执行' : `${plan.met_count}/${plan.total_count} 条件满足`}
          </div>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={onEdit} className="min-h-11 rounded-lg px-3 text-xs text-ink-secondary hover:bg-surface-overlay">编辑</button>
          <button type="button" onClick={onDelete} className="min-h-11 rounded-lg px-3 text-xs text-ink-muted hover:bg-surface-overlay">删除</button>
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {plan.conditions.map((conditionValue) => (
          <div key={conditionValue.key}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span>{conditionValue.met ? <span className="text-buy">✓</span> : <span className="text-ink-muted">○</span>} {conditionValue.name}</span>
              <span className="font-mono text-right tabular-nums text-ink-secondary">
                当前 {numberText(conditionValue.current)} · {conditionValue.gap_text}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral/30">
              <span className="block h-full rounded-full bg-buy" style={{ width: `${conditionProgress(conditionValue)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {!risk && <div className="mt-4 border-t border-neutral/30 pt-3 text-xs">
        <div className="font-mono tabular-nums text-ink-secondary">
          {proposedAmount === null
            ? `${plan.action_text} · 金额待量化同步`
            : `触发时：$${proposedAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}（账户 ${plan.buy_pct_of_nav}%）`}
        </div>
        <div className={`mt-2 rounded-lg px-3 py-2 ${gatePassed ? 'bg-buy/10 text-buy' : 'bg-trim/10 text-trim'}`}>
          {isHardCapBlocked ? '本轮不建议新增：' : gatePassed ? '仓位门通过：' : '仓位门未过：'}{gateNote}
          {isHardCapBlocked && <span className="ml-1 font-mono tabular-nums">（{risk!.sleeve.name}超硬顶 {risk!.sleeve.hard_cap_pct.toFixed(2)}%）</span>}
        </div>
      </div>}
    </article>
  );
}

function PlanEditor({
  plan,
  symbols,
  errors,
  onChange,
  onSave,
  onCancel,
  onTemplate,
}: {
  plan: LocalBuyPlan;
  symbols: readonly string[];
  errors: readonly string[];
  onChange: (patch: Partial<LocalBuyPlan>) => void;
  onSave: () => void;
  onCancel: () => void;
  onTemplate: (index: number) => void;
}) {
  return (
    <div className="ui-enter mt-5 rounded-xl border border-buy/35 bg-surface-overlay/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">编辑计划</h4>
        <div className="flex flex-wrap gap-2">
          {BUY_PLAN_TEMPLATES.map((template, index) => (
            <button key={template.label} type="button" onClick={() => onTemplate(index)} className="min-h-9 rounded-lg border border-neutral/50 px-3 text-xs text-ink-secondary hover:border-buy/50 hover:text-buy">
              {template.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1.5 block text-ink-secondary">标的</span>
          <select value={plan.symbol} onChange={(event) => onChange({ symbol: event.target.value })} className="min-h-11 w-full rounded-xl border border-neutral/50 bg-surface-raised px-3">
            <option value="">请选择</option>
            {symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block text-ink-secondary">计划名称</span>
          <input value={plan.label} onChange={(event) => onChange({ label: event.target.value })} className="min-h-11 w-full rounded-xl border border-neutral/50 bg-surface-raised px-3" />
        </label>
        <StepperField label="NDX PE 低于" value={plan.ndxPeBelow} step={0.5} onChange={(value) => onChange({ ndxPeBelow: value })} />
        <StepperField label="CNN 低于" value={plan.cnnScoreBelow} step={5} onChange={(value) => onChange({ cnnScoreBelow: value })} />
        <StepperField label="回撤深于（%）" value={plan.drawdownBelowPct} step={5} onChange={(value) => onChange({ drawdownBelowPct: value })} />
        <StepperField label="买入占净值（%）" value={plan.buyPctOfNav} step={1} onChange={(value) => onChange({ buyPctOfNav: value })} />
      </div>
      <div className="mt-4 rounded-xl border border-neutral/40 bg-surface-raised p-3">
        <p className="text-xs leading-relaxed text-ink-muted">
          VIX 条件为可选项；推荐优先使用分位，绝对值会随年代常态漂移。它只在你明确加入计划后参与 AND 条件。
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <OptionalStepperField
            label="VIX 高于"
            value={plan.vixAbove ?? null}
            defaultValue={25}
            step={1}
            onChange={(value) => onChange({ vixAbove: value })}
          />
          <OptionalStepperField
            label="VIX 分位高于（推荐）"
            value={plan.vixPercentileAbove ?? null}
            defaultValue={90}
            step={5}
            onChange={(value) => onChange({ vixPercentileAbove: value })}
          />
        </div>
      </div>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={plan.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} className="h-5 w-5 accent-buy" />
        启用这份计划
      </label>
      {errors.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-trim">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onSave} className="min-h-11 rounded-xl bg-buy px-4 py-2 text-sm font-semibold text-surface-base">保存计划</button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-neutral/50 px-4 py-2 text-sm text-ink-secondary">取消</button>
      </div>
    </div>
  );
}

function StepperField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1.5 block text-ink-secondary">{label}</span>
      <span className="grid grid-cols-[44px_1fr_44px] overflow-hidden rounded-xl border border-neutral/50 bg-surface-raised">
        <button type="button" aria-label={`${label}减少`} onClick={() => onChange(Number((value - step).toFixed(2)))} className="min-h-11 border-r border-neutral/40 text-lg text-ink-secondary hover:bg-surface-overlay">−</button>
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-h-11 min-w-0 bg-transparent px-2 text-center font-mono tabular-nums outline-none"
        />
        <button type="button" aria-label={`${label}增加`} onClick={() => onChange(Number((value + step).toFixed(2)))} className="min-h-11 border-l border-neutral/40 text-lg text-ink-secondary hover:bg-surface-overlay">+</button>
      </span>
    </label>
  );
}

function OptionalStepperField({
  label,
  value,
  defaultValue,
  step,
  onChange,
}: {
  label: string;
  value: number | null;
  defaultValue: number;
  step: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <div>
      <label className="flex min-h-9 items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(event) => onChange(event.target.checked ? defaultValue : null)}
          className="h-4 w-4 accent-buy"
        />
        {label}
      </label>
      {value !== null && (
        <div className="mt-2">
          <StepperField label={`${label}阈值`} value={value} step={step} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function EmptyPlans({ onUseTemplate }: { onUseTemplate: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-buy/40 bg-buy/5 p-6 text-center">
      <div className="font-semibold">还没有开枪计划</div>
      <p className="mt-2 text-sm text-ink-muted">先用一份温和模板，再按自己的风险承受能力修改。</p>
      <button type="button" onClick={onUseTemplate} className="mt-4 min-h-11 rounded-xl bg-buy px-4 py-2 text-sm font-semibold text-surface-base">
        用模板快速创建第一个计划
      </button>
    </div>
  );
}

function planSort(left: QuantBuyPlan, right: QuantBuyPlan): number {
  return right.met_count - left.met_count
    || Number(right.ready) - Number(left.ready)
    || left.symbol.localeCompare(right.symbol);
}

function numberText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '暂无' : value.toFixed(2);
}
