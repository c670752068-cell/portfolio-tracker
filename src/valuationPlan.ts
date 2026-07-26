import type {
  QuantAnalysisSnapshot,
  QuantBuyPlan,
  QuantBuyPlanCondition,
} from './types';

export interface LocalBuyPlan {
  id: string;
  symbol: string;
  label: string;
  ndxPeBelow: number;
  cnnScoreBelow: number;
  drawdownBelowPct: number;
  buyPctOfNav: number;
  enabled: boolean;
}

export const BUY_PLAN_STORAGE_KEY = 'portfolio-tracker:buy-plans-v1';

export const BUY_PLAN_TEMPLATES = [
  {
    label: '试探仓',
    values: {
      ndxPeBelow: 30,
      cnnScoreBelow: 30,
      drawdownBelowPct: -25,
      buyPctOfNav: 3,
      enabled: true,
    },
  },
  {
    label: '加码仓',
    values: {
      ndxPeBelow: 28,
      cnnScoreBelow: 20,
      drawdownBelowPct: -35,
      buyPctOfNav: 5,
      enabled: true,
    },
  },
  {
    label: '梭哈仓',
    values: {
      ndxPeBelow: 27,
      cnnScoreBelow: 10,
      drawdownBelowPct: -45,
      buyPctOfNav: 8,
      enabled: true,
    },
  },
] as const;

export function buildValuationSummary(snapshot: QuantAnalysisSnapshot): string {
  const valuation = snapshot.valuation_tab;
  if (!valuation?.available) return '估值与情绪数据准备中，先按原计划耐心等待。';
  const pe = finite(valuation.ndx.realtime_estimate?.pe)
    ?? finite(valuation.ndx.current_pe);
  const p30 = finite(valuation.ndx.percentile_lines.p30);
  const cnn = finite(valuation.cnn.current_score);
  const readyPlan = snapshot.buy_plan_status?.plans.find((plan) => plan.ready);
  if (readyPlan) {
    return `两项都到位了，你的 ${readyPlan.symbol} ${readyPlan.label} 条件已满足。`;
  }
  if (cnn !== null && cnn <= 20) {
    return '市场很恐慌——这正是你计划里要开枪的时候，按纪律分批执行。';
  }
  const valuationReady = pe !== null && p30 !== null && pe <= p30;
  if (valuationReady && cnn !== null) {
    return `估值已到位（PE ${pe.toFixed(2)}），情绪还没砸（CNN ${cnn.toFixed(2)}）——再等等，别急着开枪。`;
  }
  if (pe !== null && cnn !== null) {
    return `估值 PE ${pe.toFixed(2)}，情绪 CNN ${cnn.toFixed(2)}——让预先写好的规则替你做决定。`;
  }
  return '部分数据暂缺，先不临时改变计划。';
}

export function evaluateLocalBuyPlan(
  plan: LocalBuyPlan,
  snapshot: QuantAnalysisSnapshot,
  positionGate?: QuantBuyPlan['position_gate'],
): QuantBuyPlan {
  const realtimePe = finite(snapshot.valuation_tab?.ndx.realtime_estimate?.pe);
  const dailyPe = finite(snapshot.valuation_tab?.ndx.current_pe);
  const cnn = finite(snapshot.valuation_tab?.cnn.current_score);
  const lowZone = snapshot.symbols[plan.symbol]?.gates?.low_zone;
  const drawdown = finite(lowZone?.current_drawdown_pct);
  const conditions = [
    condition('ndx_pe_below', 'NDX PE', plan.ndxPeBelow, realtimePe ?? dailyPe, ''),
    condition('cnn_score_below', 'CNN', plan.cnnScoreBelow, cnn, ' 点'),
    condition('drawdown_below_pct', '回撤', plan.drawdownBelowPct, drawdown, '%'),
  ];
  const conditionsReady = conditions.every((item) => item.met);
  const gate = positionGate ?? { passed: false, note: '本地预览只计算三项条件；仓位门待量化系统同步' };
  return {
    id: plan.id,
    symbol: plan.symbol,
    label: plan.label,
    enabled: plan.enabled,
    ready: plan.enabled && conditionsReady && gate.passed,
    conditions_ready: conditionsReady,
    conditions,
    met_count: conditions.filter((item) => item.met).length,
    total_count: conditions.length,
    action_text: `买入账户净值 ${numberScalar(plan.buyPctOfNav)}%`,
    action_amount_usd: null,
    buy_pct_of_nav: plan.buyPctOfNav,
    position_gate: gate,
  };
}

export function serverPlanToLocal(plan: QuantBuyPlan): LocalBuyPlan {
  return {
    id: plan.id,
    symbol: plan.symbol,
    label: plan.label,
    ndxPeBelow: conditionTarget(plan, 'ndx_pe_below', 30),
    cnnScoreBelow: conditionTarget(plan, 'cnn_score_below', 30),
    drawdownBelowPct: conditionTarget(plan, 'drawdown_below_pct', -25),
    buyPctOfNav: plan.buy_pct_of_nav,
    enabled: plan.enabled,
  };
}

export function validateLocalBuyPlan(plan: LocalBuyPlan): string[] {
  const errors: string[] = [];
  if (!plan.symbol.trim()) errors.push('请选择标的');
  if (!plan.label.trim()) errors.push('请输入计划名称');
  if (!between(plan.ndxPeBelow, 0, 100, false)) errors.push('NDX PE 必须大于 0 且不超过 100');
  if (!between(plan.cnnScoreBelow, 0, 100, true)) errors.push('CNN 必须在 0–100 之间');
  if (!between(plan.drawdownBelowPct, -100, 0, false)) errors.push('回撤必须在 -100% 到 0% 之间');
  if (!between(plan.buyPctOfNav, 0, 20, false)) errors.push('买入占净值必须大于 0 且不超过 20%');
  return errors;
}

export function conditionProgress(conditionValue: QuantBuyPlanCondition): number {
  const current = finite(conditionValue.current);
  const target = finite(conditionValue.target);
  if (conditionValue.met) return 100;
  if (current === null || target === null) return 0;
  if (conditionValue.key === 'drawdown_below_pct') {
    return clamp(Math.abs(current) / Math.abs(target || 1) * 100);
  }
  if (current <= 0) return 0;
  return clamp(target / current * 100);
}

export function planToYaml(plans: readonly LocalBuyPlan[]): string {
  const lines = [
    '# 用户的开枪计划：冷静时写好，恐慌时按计划手动执行',
    'version: 1',
    'plans:',
  ];
  if (plans.length === 0) return `${lines.join('\n')}\n  []\n`;
  for (const plan of plans) {
    lines.push(
      `  - id: ${yamlScalar(plan.id)}`,
      `    symbol: ${yamlScalar(plan.symbol.toUpperCase())}`,
      `    label: ${yamlString(plan.label)}`,
      '    conditions:',
      `      ndx_pe_below: ${numberScalar(plan.ndxPeBelow)}`,
      `      cnn_score_below: ${numberScalar(plan.cnnScoreBelow)}`,
      `      drawdown_below_pct: ${numberScalar(plan.drawdownBelowPct)}`,
      '    action:',
      `      buy_pct_of_nav: ${numberScalar(plan.buyPctOfNav)}`,
      `    enabled: ${plan.enabled ? 'true' : 'false'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function loadLocalBuyPlans(): LocalBuyPlan[] | null {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null;
  const raw = localStorage.getItem(BUY_PLAN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isLocalBuyPlan) : null;
  } catch {
    return null;
  }
}

export function saveLocalBuyPlans(plans: readonly LocalBuyPlan[]): void {
  if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
  localStorage.setItem(BUY_PLAN_STORAGE_KEY, JSON.stringify(plans));
}

function condition(
  key: QuantBuyPlanCondition['key'],
  label: string,
  target: number,
  current: number | null,
  suffix: string,
): QuantBuyPlanCondition {
  const met = current !== null && current < target;
  const gap = current === null
    ? '数据暂缺'
    : met
      ? '已满足'
      : key === 'ndx_pe_below'
        ? `还差 ${((current / target) - 1) * 100 < 0.05 ? '0.0' : (((current / target) - 1) * 100).toFixed(1)}%`
        : `还差 ${(current - target).toFixed(1)}${suffix}`;
  return {
    key,
    name: `${label} < ${target}${key === 'drawdown_below_pct' ? '%' : ''}`,
    target,
    current,
    met,
    gap_text: gap,
  };
}

function conditionTarget(
  plan: QuantBuyPlan,
  key: QuantBuyPlanCondition['key'],
  fallback: number,
): number {
  return finite(plan.conditions.find((item) => item.key === key)?.target) ?? fallback;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function between(
  value: number,
  minimum: number,
  maximum: number,
  includeMinimum: boolean,
): boolean {
  return Number.isFinite(value)
    && (includeMinimum ? value >= minimum : value > minimum)
    && value <= maximum;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function numberScalar(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : yamlString(value);
}

function isLocalBuyPlan(value: unknown): value is LocalBuyPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<LocalBuyPlan>;
  return typeof plan.id === 'string'
    && typeof plan.symbol === 'string'
    && typeof plan.label === 'string'
    && typeof plan.ndxPeBelow === 'number'
    && typeof plan.cnnScoreBelow === 'number'
    && typeof plan.drawdownBelowPct === 'number'
    && typeof plan.buyPctOfNav === 'number'
    && typeof plan.enabled === 'boolean';
}
