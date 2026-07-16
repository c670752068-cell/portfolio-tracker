import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_RULES_REFRESH_MS,
  deleteAlertRule,
  dispatchAlertRuleMutation,
  fetchAlertRules,
  formatAlertCurrentPrice,
  formatAlertDistance,
  resolveHoldingCostSuggestion,
  saveAlertRule,
  type AlertRule,
  type AlertRuleDraft,
} from './alertRules';

const endpoint = 'http://example.test/api/portfolio/alert-rules';

const targetRule: AlertRule = {
  id: 'fngu-target',
  symbol: 'FNGU',
  type: 'target_price',
  direction: 'above',
  target_price: 40,
  approach_pct: 5,
  reduce_to_pct: 5,
  enabled: true,
  current_price: 38,
  distance_pct: 5,
  last_reminder_at: '2026-07-15 10:35 ET',
};

afterEach(() => vi.unstubAllGlobals());

describe('alert-rules server CRUD', () => {
  it('refreshes the shared banner state on the same 35-minute cadence', () => {
    expect(ALERT_RULES_REFRESH_MS).toBe(35 * 60 * 1000);
  });

  it('loads the shared server rules with GET semantics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rules: [targetRule] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAlertRules(endpoint)).resolves.toEqual([targetRule]);
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }));
  });

  it('creates or updates a rule with POST and returns the normalized server rule', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, rule: targetRule }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const draft: AlertRuleDraft = {
      id: 'fngu-target',
      symbol: 'fngu',
      type: 'target_price',
      direction: 'above',
      target_price: 40,
      approach_pct: 5,
      reduce_to_pct: 5,
      enabled: true,
    };
    await expect(saveAlertRule(endpoint, draft)).resolves.toEqual(targetRule);
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(draft),
    }));
  });

  it('deletes an encoded rule id and surfaces server failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 'rule / one' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'invalid_rule', message: '规则参数无效' },
      }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteAlertRule(endpoint, 'rule / one')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${endpoint}/rule%20%2F%20one`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    await expect(saveAlertRule(endpoint, {
      symbol: 'MSFT',
      type: 'gain_pct',
      cost_basis: 0,
      gain_pct: 20,
      approach_pct: 5,
      enabled: true,
    })).rejects.toThrow('规则参数无效');
  });
});

describe('alert cost and callback policy', () => {
  it('labels the quote timestamp and the directional distance without making the user infer it', () => {
    const checked = { ...targetRule, last_checked_at: '2026-07-15T15:10:00.000Z' };

    expect(formatAlertCurrentPrice(checked, new Date('2026-07-15T15:20:00.000Z')))
      .toBe('当前价 $38.00 @ 11:10 ET');
    expect(formatAlertCurrentPrice(checked, new Date('2026-07-15T21:00:00.000Z')))
      .toBe('上一交易日收盘 $38.00 @ 11:10 ET');
    expect(formatAlertDistance(checked)).toBe('还需上涨 5.00%');
    expect(formatAlertDistance({
      ...checked,
      direction: 'below',
      target_price: 36,
      distance_pct: 5.56,
    })).toBe('还需下跌 5.56%');
  });

  it('auto-fills only a complete broker-weighted cost', () => {
    expect(resolveHoldingCostSuggestion({
      weighted_average_cost: 22.5,
      currency: 'USD',
      coverage: 'complete',
      auto_fill_allowed: true,
    })).toEqual({
      automaticValue: 22.5,
      referenceValue: 22.5,
      requiresConfirmation: false,
      coverage: 'complete',
    });

    expect(resolveHoldingCostSuggestion({
      weighted_average_cost: 19.8,
      currency: 'USD',
      coverage: 'partial',
      auto_fill_allowed: false,
    })).toEqual({
      automaticValue: null,
      referenceValue: 19.8,
      requiresConfirmation: true,
      coverage: 'partial',
    });
  });

  it('routes create, edit, and delete actions to distinct callbacks', async () => {
    const onCreate = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();
    const callbacks = { onCreate, onUpdate, onDelete };
    const draft: AlertRuleDraft = {
      symbol: 'MSFT',
      type: 'gain_pct',
      cost_basis: 300,
      gain_pct: 20,
      approach_pct: 5,
      enabled: true,
    };

    await dispatchAlertRuleMutation({ kind: 'create', draft }, callbacks);
    await dispatchAlertRuleMutation({
      kind: 'update',
      draft: { ...draft, id: 'msft-gain', gain_pct: 30 },
    }, callbacks);
    await dispatchAlertRuleMutation({ kind: 'delete', id: 'msft-gain' }, callbacks);

    expect(onCreate).toHaveBeenCalledWith(draft);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'msft-gain', gain_pct: 30 }));
    expect(onDelete).toHaveBeenCalledWith('msft-gain');
  });
});
