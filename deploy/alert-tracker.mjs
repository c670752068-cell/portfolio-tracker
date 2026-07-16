import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NEW_YORK_TIME_ZONE = 'America/New_York';
const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const WEEKEND_DAYS = new Set(['Sat', 'Sun']);
const MAX_RULES = 100;
const MAX_RULE_BODY_BYTES = 256 * 1024;
const MAX_QUOTE_BATCH_SIZE = 50;

export const ALERT_TRACK_INTERVAL_MS = 35 * 60 * 1000;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function newYorkParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday || '',
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour || 0) * 60 + Number(values.minute || 0),
  };
}

export function isNewYorkRegularSession(date) {
  const clock = newYorkParts(date);
  return !WEEKEND_DAYS.has(clock.weekday)
    && clock.minutes >= REGULAR_OPEN_MINUTES
    && clock.minutes < REGULAR_CLOSE_MINUTES;
}

function targetPriceForRule(rule) {
  if (rule.type === 'target_price') return finiteNumber(rule.target_price);
  const cost = finiteNumber(rule.cost_basis);
  const gainPct = finiteNumber(rule.gain_pct);
  return cost !== null && gainPct !== null ? cost * (1 + gainPct / 100) : null;
}

function ruleDirection(rule) {
  return rule.type === 'gain_pct' ? 'above' : rule.direction;
}

function reachedTarget(rule, currentPrice, previousPrice, targetPrice) {
  const direction = ruleDirection(rule);
  if (direction === 'below') {
    return currentPrice <= targetPrice
      || (previousPrice !== null && previousPrice > targetPrice && currentPrice <= targetPrice);
  }
  return currentPrice >= targetPrice
    || (previousPrice !== null && previousPrice < targetPrice && currentPrice >= targetPrice);
}

function evaluateRule(rule, currentPrice, previousPrice) {
  const targetPrice = targetPriceForRule(rule);
  if (targetPrice === null || targetPrice <= 0 || currentPrice <= 0) return null;
  if (reachedTarget(rule, currentPrice, previousPrice, targetPrice)) {
    return { type: 'reached', targetPrice };
  }
  const approachPct = finiteNumber(rule.approach_pct) || 5;
  if (Math.abs(currentPrice - targetPrice) / targetPrice <= approachPct / 100) {
    return { type: 'approach', targetPrice };
  }
  return null;
}

async function readJson(path, fallback) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(root, name, value) {
  await mkdir(root, { recursive: true });
  const target = join(root, name);
  const temporary = join(root, `.${name}-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function initialState(value) {
  return isRecord(value) && isRecord(value.rules) ? value : { rules: {} };
}

function eventAlreadySent(ruleState, dateKey, type) {
  return Boolean(ruleState?.events?.[dateKey]?.[type]);
}

function markEventSent(ruleState, dateKey, event, now) {
  const day = isRecord(ruleState.events?.[dateKey]) ? ruleState.events[dateKey] : {};
  return {
    ...ruleState,
    last_alert_at: now.toISOString(),
    last_alert_type: event.type,
    events: { ...(isRecord(ruleState.events) ? ruleState.events : {}), [dateKey]: { ...day, [event.type]: true } },
  };
}

async function fetchQuoteBatches(symbols, fetchQuotes) {
  const quotes = {};
  for (let index = 0; index < symbols.length; index += MAX_QUOTE_BATCH_SIZE) {
    const batch = symbols.slice(index, index + MAX_QUOTE_BATCH_SIZE);
    try {
      const result = await fetchQuotes(batch);
      if (isRecord(result)) Object.assign(quotes, result);
    } catch (error) {
      console.error('alert quote batch failed:', error instanceof Error ? error.message : String(error));
    }
  }
  return quotes;
}

export async function runAlertTrackerCycle({ now = new Date(), alertsRoot, rules, fetchQuotes, notify }) {
  if (!isNewYorkRegularSession(now)) return { skipped: true, events: [] };
  const activeRules = (Array.isArray(rules) ? rules : []).filter((rule) => rule?.enabled !== false);
  const symbols = [...new Set(activeRules.map((rule) => String(rule.symbol || '').toUpperCase()).filter(Boolean))];
  const quotes = await fetchQuoteBatches(symbols, fetchQuotes);
  const statePath = join(alertsRoot, 'state.json');
  const state = initialState(await readJson(statePath, { rules: {} }));
  const dateKey = newYorkParts(now).dateKey;
  const events = [];

  for (const rule of activeRules) {
    const currentPrice = finiteNumber(quotes[rule.symbol]);
    if (currentPrice === null) continue;
    const previous = isRecord(state.rules[rule.id]) ? state.rules[rule.id] : {};
    const previousPrice = finiteNumber(previous.last_price);
    const evaluated = evaluateRule(rule, currentPrice, previousPrice);
    let nextRuleState = { ...previous, last_price: currentPrice, last_checked_at: now.toISOString() };
    if (evaluated && !eventAlreadySent(previous, dateKey, evaluated.type)) {
      const event = {
        ruleId: rule.id,
        symbol: rule.symbol,
        type: evaluated.type,
        targetPrice: evaluated.targetPrice,
        currentPrice,
      };
      try {
        const delivered = await notify(event);
        if (delivered !== false) {
          events.push(event);
          nextRuleState = markEventSent(nextRuleState, dateKey, event, now);
        }
      } catch (error) {
        console.error('alert notification failed:', error instanceof Error ? error.message : String(error));
      }
    }
    state.rules[rule.id] = nextRuleState;
  }
  await atomicWriteJson(alertsRoot, 'state.json', state);
  return { skipped: false, events };
}

export function startAlertTracker({ runCycle, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, logError = console.error }) {
  const callback = async () => {
    try {
      await runCycle();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logError(`alert tracker cycle failed: ${reason}`);
    }
  };
  const timer = setIntervalImpl(callback, ALERT_TRACK_INTERVAL_MS);
  return () => clearIntervalImpl(timer);
}

export function formatAlertNotification(rule, event) {
  const stage = event.type === 'approach' ? '接近目标' : '到达目标';
  const title = `${rule.symbol} ${stage}`;
  const priceText = `当前价 $${event.currentPrice.toFixed(2)}，目标 $${event.targetPrice.toFixed(2)}。`;
  const action = rule.type === 'gain_pct'
    ? '卖出 50% 仓位，留 50% 博弈。'
    : '';
  const reduceTo = finiteNumber(rule.reduce_to_pct) ?? 5;
  return {
    title,
    body: `${priceText}${action}只提醒不下单；清仓或减到 ≤${reduceTo}% 由你在券商 App 手动执行。`,
  };
}

export function buildBarkPushUrl({ baseUrl, deviceKey, title, body }) {
  const base = String(baseUrl || 'https://api.day.app').replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(deviceKey)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?group=${encodeURIComponent('portfolio-alerts')}`;
}

export async function sendBarkNotification({ baseUrl, deviceKey, title, body, fetchImpl = fetch, logError = console.error }) {
  if (!deviceKey) throw new Error('Bark 推送未配置');
  const url = buildBarkPushUrl({ baseUrl, deviceKey, title, body });
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: 'GET' });
      lastStatus = response.status;
      if (response.ok) return true;
      logError(`Bark push attempt ${attempt} failed (HTTP ${response.status})`);
    } catch {
      logError(`Bark push attempt ${attempt} failed (network error)`);
    }
  }
  throw new Error(`Bark 推送失败${lastStatus ? `（HTTP ${lastStatus}）` : ''}`);
}

export async function readAlertRules(alertsRoot) {
  const value = await readJson(join(alertsRoot, 'rules.json'), []);
  return Array.isArray(value) ? value : [];
}

function normalizedRule(input, existing) {
  if (!isRecord(input)) throw new Error('规则必须为对象');
  const id = String(input.id || existing?.id || randomBytes(8).toString('hex'));
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const type = input.type;
  const approachPct = finiteNumber(input.approach_pct);
  if (!/^[A-Z0-9.^-]{1,24}$/.test(symbol)) throw new Error('symbol 不合法');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('id 不合法');
  if (type !== 'target_price' && type !== 'gain_pct') throw new Error('type 不合法');
  if (approachPct === null || approachPct < 0 || approachPct > 100) throw new Error('approach_pct 不合法');
  const now = new Date().toISOString();
  const base = {
    id,
    symbol,
    type,
    approach_pct: approachPct,
    reduce_to_pct: input.reduce_to_pct === undefined ? 5 : finiteNumber(input.reduce_to_pct),
    enabled: input.enabled !== false,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (base.reduce_to_pct === null || base.reduce_to_pct < 0 || base.reduce_to_pct > 100) throw new Error('reduce_to_pct 不合法');
  if (type === 'target_price') {
    const targetPrice = finiteNumber(input.target_price);
    if (targetPrice === null || targetPrice <= 0 || targetPrice > 100_000_000) throw new Error('target_price 不合法');
    if (input.direction !== 'above' && input.direction !== 'below') throw new Error('direction 不合法');
    return { ...base, direction: input.direction, target_price: targetPrice };
  }
  const costBasis = finiteNumber(input.cost_basis);
  const gainPct = finiteNumber(input.gain_pct);
  if (costBasis === null || costBasis <= 0 || costBasis > 100_000_000) throw new Error('cost_basis 不合法');
  if (gainPct === null || gainPct <= -100 || gainPct > 10_000) throw new Error('gain_pct 不合法');
  return { ...base, cost_basis: costBasis, gain_pct: gainPct };
}

async function readLimitedBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_RULE_BODY_BYTES) {
      const error = new Error('请求体超过 256KB 限制');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function listRulesWithState(alertsRoot) {
  const [rules, rawState] = await Promise.all([
    readAlertRules(alertsRoot),
    readJson(join(alertsRoot, 'state.json'), { rules: {} }),
  ]);
  const state = initialState(rawState);
  return rules.map((rule) => ({
    ...rule,
    current_price: finiteNumber(state.rules?.[rule.id]?.last_price),
    last_checked_at: state.rules?.[rule.id]?.last_checked_at || null,
    last_alert_at: state.rules?.[rule.id]?.last_alert_at || null,
    last_alert_type: state.rules?.[rule.id]?.last_alert_type || null,
  }));
}

export function createAlertRulesRoute({ alertsRoot, sendJson }) {
  return async function handleAlertRulesRoute(url, req, res) {
    const collection = url.pathname === '/api/portfolio/alert-rules';
    const itemMatch = url.pathname.match(/^\/api\/portfolio\/alert-rules\/([A-Za-z0-9_-]{1,64})$/);
    if (!collection && !itemMatch) return false;
    if (collection && req.method === 'GET') {
      sendJson(res, 200, { rules: await listRulesWithState(alertsRoot) });
      return true;
    }
    if (collection && req.method === 'POST') {
      let body;
      try {
        body = await readLimitedBody(req);
      } catch (error) {
        sendJson(res, error.status || 400, { error: { code: 'request_body_error', message: error.message } });
        return true;
      }
      let input;
      try {
        input = JSON.parse(body.toString('utf8'));
      } catch {
        sendJson(res, 400, { error: { code: 'invalid_json', message: '请求体不是合法 JSON' } });
        return true;
      }
      const rules = await readAlertRules(alertsRoot);
      const existingIndex = rules.findIndex((rule) => rule.id === input?.id);
      if (existingIndex < 0 && rules.length >= MAX_RULES) {
        sendJson(res, 400, { error: { code: 'rule_limit', message: '提醒规则最多 100 条' } });
        return true;
      }
      let rule;
      try {
        rule = normalizedRule(input, existingIndex >= 0 ? rules[existingIndex] : null);
      } catch (error) {
        sendJson(res, 400, { error: { code: 'invalid_rule', message: error.message } });
        return true;
      }
      if (existingIndex >= 0) rules[existingIndex] = rule;
      else rules.push(rule);
      await atomicWriteJson(alertsRoot, 'rules.json', rules);
      sendJson(res, existingIndex >= 0 ? 200 : 201, { ok: true, rule });
      return true;
    }
    if (itemMatch && req.method === 'DELETE') {
      const id = itemMatch[1];
      const rules = await readAlertRules(alertsRoot);
      const next = rules.filter((rule) => rule.id !== id);
      await atomicWriteJson(alertsRoot, 'rules.json', next);
      sendJson(res, 200, { ok: true, id });
      return true;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
    return true;
  };
}
