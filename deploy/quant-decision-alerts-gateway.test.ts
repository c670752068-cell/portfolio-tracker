import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildQuantDecisionEvents,
  deliverQuantDecisionAlerts,
  quantNotificationSlot,
} from './quant-decision-alerts.mjs';

const children: ChildProcess[] = [];
const servers: Server[] = [];
const roots: string[] = [];

async function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
  }));
}

async function waitForHealth(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch { /* process is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('gateway did not start');
}

async function startHarness(requests: string[]): Promise<string> {
  const bark = createServer((req, res) => {
    requests.push(req.url || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"code":200}');
  });
  servers.push(bark);
  const barkOrigin = await listen(bark);
  const root = await mkdtemp(join(tmpdir(), 'quant-decision-alerts-'));
  roots.push(root);
  const probe = createServer();
  const origin = await listen(probe);
  const port = new URL(origin).port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ['deploy/aliyun-gateway.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: port,
      PORTFOLIO_SYNC_TOKEN: 'unit-secret',
      PORTFOLIO_ANALYSIS_ROOT: join(root, 'analysis'),
      PORTFOLIO_ALERTS_ROOT: join(root, 'alerts'),
      BARK_DEVICE_KEY: 'unit-key', BARK_BASE_URL: barkOrigin,
    },
    stdio: 'ignore',
  });
  children.push(child);
  await waitForHealth(origin);
  return origin;
}

afterEach(async () => {
  children.splice(0).forEach((child) => child.kill('SIGTERM'));
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('quant decision mobile alerts', () => {
  it('only opens the two Beijing notification windows', () => {
    expect(quantNotificationSlot(new Date('2026-08-10T13:20:00Z'))).toBe('2026-08-10:premarket');
    expect(quantNotificationSlot(new Date('2026-08-10T13:24:59Z'))).toBe('2026-08-10:premarket');
    expect(quantNotificationSlot(new Date('2026-08-10T13:25:00Z'))).toBeNull();
    expect(quantNotificationSlot(new Date('2026-08-10T14:00:00Z'))).toBe('2026-08-10:open');
    expect(quantNotificationSlot(new Date('2026-08-10T14:04:59Z'))).toBe('2026-08-10:open');
    expect(quantNotificationSlot(new Date('2026-08-10T14:05:00Z'))).toBeNull();
    expect(quantNotificationSlot(new Date('2026-08-09T13:20:00Z'))).toBeNull();
  });

  it('delivers AVGO once per checkpoint, ignores price recovery below the sell line, and does not repeat dynamic reasons', async () => {
    const alertsRoot = await mkdtemp(join(tmpdir(), 'quant-schedule-'));
    roots.push(alertsRoot);
    const notifications: string[] = [];
    const snapshot = (currentPrice: number, verdict = 'SELL', reason = '已到卖出价') => ({
      symbols: { AVGO: { market_price: { available: true, current_price: currentPrice } } },
      sell: { symbols: { AVGO: {
        sell_price_plan: {
          available: true, method: 'forward_pe', sell_forward_pe: 30,
          sell_price: 394.42,
        },
        decision: {
          verdict, notification_state: verdict === 'SELL' ? 'sell' : 'wait',
          reason, recommended_sell_pct: 20,
        },
      } } },
    });
    const notify = async (event: { title: string }) => {
      notifications.push(event.title);
      return true;
    };

    expect((await deliverQuantDecisionAlerts({
      snapshot: snapshot(394.42), alertsRoot, notify,
      now: new Date('2026-08-10T13:20:00Z'),
    })).delivered).toHaveLength(1);
    expect((await deliverQuantDecisionAlerts({
      snapshot: snapshot(394.42, 'SELL', '理由文字已变化'), alertsRoot, notify,
      now: new Date('2026-08-10T13:23:00Z'),
    })).delivered).toHaveLength(0);
    expect((await deliverQuantDecisionAlerts({
      snapshot: snapshot(394.42), alertsRoot, notify,
      now: new Date('2026-08-10T14:00:00Z'),
    })).delivered).toHaveLength(1);
    expect((await deliverQuantDecisionAlerts({
      snapshot: snapshot(393.10), alertsRoot, notify,
      now: new Date('2026-08-10T14:02:00Z'),
    })).delivered).toHaveLength(0);
    expect((await deliverQuantDecisionAlerts({
      snapshot: snapshot(394.42), alertsRoot, notify,
      now: new Date('2026-08-10T14:03:00Z'),
    })).delivered).toHaveLength(0);
    expect((await deliverQuantDecisionAlerts({
      snapshot: snapshot(394.42), alertsRoot, notify,
      now: new Date('2026-08-10T15:00:00Z'),
    })).skipped).toBe(true);
    expect(notifications).toHaveLength(2);
    expect(JSON.parse(await readFile(join(alertsRoot, 'quant-decision-state.json'), 'utf8')).active).toHaveLength(1);
  });

  it('includes the website forward-PE sell price when a stock reaches it', () => {
    const snapshot = {
      symbols: { NVDA: { market_price: { available: true, current_price: 303.36 } } },
      sell: { symbols: { NVDA: {
        sell_price_plan: {
          available: true, method: 'forward_pe', sell_forward_pe: 30,
          sell_price: 303.36,
        },
        decision: {
          verdict: 'SELL', notification_state: 'sell',
          reason: '远期 PE 已进入高估值卖出区', recommended_sell_pct: 20,
          evidence: { history: { basis_symbol: 'NVDA' } },
        },
      } } },
    };

    expect(buildQuantDecisionEvents(snapshot)).toEqual([
      expect.objectContaining({
        title: '🟠 NVDA · 可卖 · $303.36',
        body: '达到远期 PE 30 卖出价 $303.36；先卖半仓期权，再卖杠杆，正股不急卖。',
      }),
    ]);
  });

  it('uses the website recovery stage for stocks and keeps the push to two short lines', () => {
    const snapshot = {
      symbols: { META: { market_price: { available: true, current_price: 714.28 } } },
      sell: { symbols: { META: {
        sell_price_plan: {
          available: true, method: 'recovery_valuation', basis_symbol: 'META',
          sell_price: 709.47, trigger_price: 709.47,
          previous_high_price: 793.65,
        },
        decision: {
          verdict: 'SELL', notification_state: 'sell',
          reason: '股价已达到第一卖点', recommended_sell_pct: 20,
          evidence: { history: { basis_symbol: 'META' } },
        },
      } } },
    };

    expect(buildQuantDecisionEvents(snapshot)).toEqual([
      expect.objectContaining({
        title: '🟠 META · 可卖 · $714.28',
        body: '已到第一卖点 $709.47；先卖半仓期权，再卖杠杆，正股不急卖。',
      }),
    ]);
  });

  it('reports both the QQQ trigger and the real TQQQ price for an index sell', () => {
    const snapshot = {
      symbols: { TQQQ: { market_price: { available: true, current_price: 86.12 } } },
      sell: { symbols: { TQQQ: {
        sell_price_plan: {
          available: true, method: 'benchmark_high', basis_symbol: 'QQQ',
          current_price: 86.12, basis_current_price: 745.50,
          sell_price: null, trigger_price: 745.34,
        },
        decision: {
          verdict: 'SELL', notification_state: 'sell',
          reason: 'QQQ 已回到历史新高', recommended_sell_pct: 20,
          evidence: { history: { basis_symbol: 'QQQ' } },
        },
      } } },
    };

    expect(buildQuantDecisionEvents(snapshot)).toEqual([
      expect.objectContaining({
        title: '🟠 TQQQ · 可卖 · $86.12',
        body: 'QQQ $745.50 已到新高 $745.34；先处理 TQQQ 期权，再分批减 TQQQ。',
      }),
    ]);
  });

  it('uses the active NDX valuation stage for a TQQQ sell push', () => {
    const snapshot = {
      symbols: { TQQQ: { market_price: { available: true, current_price: 86.12 } } },
      sell: { symbols: { TQQQ: {
        sell_price_plan: {
          available: true, method: 'ndx_valuation_stages', basis_symbol: 'QQQ',
          current_price: 86.12, basis_current_price: 751.2, current_ttm_pe: 32.4,
          sell_price: null, trigger_price: 741.93, active_stage: 'ndx_green',
          stages: [{
            key: 'ndx_green', label: '绿线首卖', trigger_price: 741.93,
            ttm_pe: 32, sell_holding_pct: 30, reached: true,
          }],
        },
        decision: {
          verdict: 'SELL', notification_state: 'sell',
          reason: '纳指100估值到绿线', recommended_sell_pct: 30,
          evidence: { history: { basis_symbol: 'QQQ' } },
        },
      } } },
    };

    expect(buildQuantDecisionEvents(snapshot)).toEqual([
      expect.objectContaining({
        title: '🟠 TQQQ · 可卖 · $86.12',
        body: '纳指100 PE 32.40 已到绿线首卖；卖出 30%；先期权，再杠杆指数。',
      }),
    ]);
  });

  it('pushes a GLD-cycle GDX sell only after the website final decision turns SELL', () => {
    const base = {
      symbols: { GDX: { market_price: { available: true, current_price: 93.61 } } },
      sell: { symbols: { GDX: {
        decision: {
          verdict: 'SELL', notification_state: 'sell',
          reason: 'GLD 黄金周期已到历史保守卖点', recommended_sell_pct: 25,
          evidence: { history: { basis_symbol: 'GLD' } },
        },
      } } },
    };

    expect(buildQuantDecisionEvents(base)).toEqual([
      expect.objectContaining({
        title: '🟠 GDX · 可卖 · $93.61',
        body: 'GLD 黄金周期已到历史保守卖点；按网站计划卖出 GDX 仓位 25%。',
      }),
    ]);
    expect(buildQuantDecisionEvents({
      ...base,
      sell: { symbols: { GDX: { decision: {
        ...base.sell.symbols.GDX.decision,
        verdict: 'WAIT', notification_state: 'wait', recommended_sell_pct: 0,
      } } } },
    })).toEqual([]);
  });

  it('asks for Codex only when the backend growth watchlist has unresolved symbols', () => {
    const snapshot = {
      growth_watchlist: {
        unresolved: [
          { symbol: 'NEW', reason: 'missing_rule_configuration' },
          { symbol: 'XYZ', reason: 'missing_rule_configuration' },
        ],
      },
    };
    expect(buildQuantDecisionEvents(snapshot)).toEqual([
      expect.objectContaining({
        title: '🟡 成长股 · 2只待判断',
        body: 'NEW、XYZ 尚未建立回撤规则；需要时请让 Codex 判断。',
      }),
    ]);
  });

  it('holds an earnings-window premarket rise until 10 ET unless it rose before earnings', () => {
    const snapshot = {
      symbols: {
        NVDA: {
          depth_window: { current_price: 223.96, price_session: 'pre' },
          earnings: { applicable: true, dates: ['2026-08-10'] },
        },
      },
      summary: {
        sell_ready: [{ symbol: 'NVDA', trigger: '财报后大涨', detail: '卖出条件已触发' }],
      },
      sell: { symbols: { NVDA: { recent_signals: [] } } },
    };

    const protectedEvents = buildQuantDecisionEvents(snapshot, {
      now: new Date('2026-08-10T13:00:00.000Z'),
    });
    expect(protectedEvents).toEqual([
      expect.objectContaining({
        title: '🟣 NVDA · 财报盘前保护 · $223.96',
        body: '财报窗口盘前上涨；不要卖，等 10:00 ET 再判断。',
      }),
    ]);

    const preRisen = {
      ...snapshot,
      sell: { symbols: { NVDA: { recent_signals: [
        { name: 'pre_earnings_rise', date: '2026-08-07', label: '财报前大涨' },
      ] } } },
    };
    expect(buildQuantDecisionEvents(preRisen, {
      now: new Date('2026-08-10T13:00:00.000Z'),
    })).toEqual([]);
    expect(buildQuantDecisionEvents(snapshot, {
      now: new Date('2026-08-10T14:00:00.000Z'),
    })).toEqual([]);
  });

  it('uses only actionable, fresh website valuation zones', () => {
    const snapshot = {
      symbols: {
        MSFT: { depth_window: { current_price: 524.11 } },
        AMZN: { depth_window: { current_price: 231.44 } },
        NVDA: { depth_window: { current_price: 223.96 } },
        TSLA: { depth_window: { current_price: 328.58 } },
      },
      stock_forward_valuation: {
        metric: 'forward_pe_1bf',
        symbols: {
          MSFT: { current: 24.8, zone: 'low', icon: '🟢', message: '按计划分批买入或继续持有。', available: true, stale: false },
          AMZN: { current: 28.8, zone: 'middle', icon: '⚪', message: '估值正常，继续持有。', available: true, stale: false },
          NVDA: { current: 31.2, zone: 'high', icon: '🟠', message: '清理期权和杠杆仓位。', available: true, stale: false },
          TSLA: { current: 33.2, zone: 'ultra_high', icon: '🔴', message: '执行退出计划。', available: true, stale: false },
        },
      },
    };
    const events = buildQuantDecisionEvents(snapshot, {
      now: new Date('2026-08-10T12:30:00.000Z'),
    });

    expect(events.map((event) => event.title)).toEqual([
      '🟢 MSFT · 低估值 · $524.11',
    ]);
    expect(events.every((event) => event.key.endsWith(':2026-08-10'))).toBe(true);
    expect(buildQuantDecisionEvents(snapshot, {
      now: new Date('2026-08-10T14:30:00.000Z'),
    })).toEqual([]);
  });

  it('asks to fill the overall position to 60% only when CNN is at or below 20', () => {
    const snapshot = {
      context: { cnn_fear_greed: { available: true, score: 20 } },
      ammo_overview: {
        nav_usd: 100_000,
        cash_exposure: { invested_usd: 48_000 },
      },
    };
    expect(buildQuantDecisionEvents(snapshot)).toEqual([
      expect.objectContaining({
        title: '🟢 CNN 20.00 · 仓位不足',
        body: '当前总仓位 48.00%，目标 60%；请尽量补足剩余 12.00%。',
      }),
    ]);
    expect(buildQuantDecisionEvents({
      ...snapshot,
      ammo_overview: { nav_usd: 100_000, cash_exposure: { invested_usd: 60_000 } },
    })).toEqual([]);
    expect(buildQuantDecisionEvents({
      ...snapshot,
      context: { cnn_fear_greed: { available: true, score: 20.01 } },
    })).toEqual([]);
  });

  it('uses mutually exclusive VIX 35/40 position floors with encouragement', () => {
    const snapshot = (vix: number, invested: number) => ({
      context: {
        cnn_fear_greed: { available: true, score: 50 },
        vix: { available: true, value: vix },
      },
      ammo_overview: {
        nav_usd: 100_000,
        cash_exposure: { invested_usd: invested },
      },
    });
    expect(buildQuantDecisionEvents(snapshot(35, 48_000))).toEqual([
      expect.objectContaining({
        title: '🟢 VIX 35.00 · 恐慌加仓',
        body: '当前总仓位 48.00%，目标 60%；不要害怕，按计划补足 12.00%。',
      }),
    ]);
    expect(buildQuantDecisionEvents(snapshot(40, 65_000))).toEqual([
      expect.objectContaining({
        title: '🟢 VIX 40.00 · 极恐加仓',
        body: '当前总仓位 65.00%，目标 70%；不要害怕，按计划补足 5.00%。',
      }),
    ]);
    expect(buildQuantDecisionEvents(snapshot(40, 70_000))).toEqual([]);
    expect(buildQuantDecisionEvents(snapshot(34.99, 40_000))).toEqual([]);
  });

  it('pushes only buy and PE-based decisions, with TQQQ sizing from CNN fear', async () => {
    const requests: string[] = [];
    const origin = await startHarness(requests);
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-08-03T13:14:38-04:00', rule_version: '2.2',
      symbols: {
        AVGO: { depth_window: { current_price: 320.25 } },
        TQQQ: {
          market_price: { available: true, current_price: 74.47, price_session: 'regular', basis: 'asset' },
          depth_window: {
            current_price: 687.99,
            price_note: 'QQQ 基准闭市价为唯一判定价',
          },
        },
        FNGU: { depth_window: { current_price: 36.55 } },
        MSFT: { depth_window: { current_price: 524.11 } },
        META: { depth_window: { current_price: 772.08 } },
      },
      summary: {
        buy_ready: [{ symbol: 'AVGO', reason: '自身深度位已达标' }],
        tqqq_first_entry: {
          symbol: 'TQQQ', benchmark: 'QQQ', drawdown_pct: 11.25,
          threshold_pct: 11, option_position_limit_pct: 1,
        },
        sell_ready: [{ symbol: 'FNGU', trigger: '修复完成', detail: '可考虑分批减仓' }],
        sell_near: [{ symbol: 'MSFT', trigger: '接近卖点', detail: '距历史保守卖点还差 3.00 点' }],
      },
      context: { cnn_fear_greed: { available: true, score: 14.5 } },
      sell: { symbols: { META: { exit_research: {
        sample_sufficient: true,
        anchor: { low_date: '2026-03-27', current_price: 820 },
        stages: [{ key: 'conservative', label: '保守兑现', reached_now: true,
          target_price_from_latest_low: 817.19, sell_holding_pct: 25, historical_reach_pct: 80 }],
      } } } },
    };
    const post = () => fetch(`${origin}/api/portfolio/quant-analysis`, {
      method: 'POST',
      headers: { Authorization: 'Bearer unit-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect((await post()).status).toBe(200);
    expect(requests).toHaveLength(0);
    expect((await post()).status).toBe(200);
    expect(requests).toHaveLength(0);
  });

  it('includes the MA200 slope context in a buy push without treating it as a veto', () => {
    const events = buildQuantDecisionEvents({
      symbols: { AVGO: { market_price: { available: true, current_price: 360.81 } } },
      summary: { buy_ready: [{
        symbol: 'AVGO', reason: '自身深度位已达标',
        ma_slope: { available: true, annualized_pct: -12.34, label: '强势下跌', buy_veto: false },
      }] },
    });

    expect(events).toEqual([expect.objectContaining({
      title: '🟢 AVGO · 可买 · $360.81',
      body: expect.stringContaining('斜率 -12.34%（强势下跌，仅风险提示）'),
    })]);
  });
});

describe('离谱的卖出线不触发推送', () => {
  const tslaSnapshot = {
    symbols: { TSLA: { market_price: { available: true, current_price: 382.7 } } },
    sell: { symbols: { TSLA: {
      sell_price_plan: {
        available: true, method: 'recovery_valuation', status: 'reached', quality: 'current_estimate',
        basis_symbol: 'TSLA', current_price: 367.16, basis_current_price: 367.16,
        current_forward_pe: 355.53, implied_forward_eps: 1.032712,
        sell_price: 30.98, trigger_price: 30.98, clear_price: 33.05,
        action_stage_key: 'reduce_risk', active_stage: 'trim_stock',
        stages: [{
          key: 'trim_stock', label: '正股分批减仓', trigger_price: 30.98,
          trigger_kind: 'forward_valuation', reached: true, action: '正股只分批减仓',
        }],
      },
      decision: {
        verdict: 'SELL', notification_state: 'sell', reason: '已到卖出价', recommended_sell_pct: 20,
        evidence: { history: { basis_symbol: 'TSLA' } },
      },
    } } },
  };

  it('TSLA 现价 $382.70、卖出线 $30.98 时不推送，并把输入数据写进日志', () => {
    const logWarning = vi.fn();

    expect(buildQuantDecisionEvents(tslaSnapshot, { logWarning })).toEqual([]);
    expect(logWarning).toHaveBeenCalled();
    expect(String(logWarning.mock.calls[0][0])).toContain('TSLA');
    expect(String(logWarning.mock.calls[0][0])).toContain('30.98');
  });

  it('合理的卖出线照常推送', () => {
    const logWarning = vi.fn();
    const snapshot = structuredClone(tslaSnapshot);
    snapshot.sell.symbols.TSLA.sell_price_plan.sell_price = 498.83;
    snapshot.sell.symbols.TSLA.sell_price_plan.trigger_price = 380;
    snapshot.sell.symbols.TSLA.sell_price_plan.clear_price = 520;
    snapshot.sell.symbols.TSLA.sell_price_plan.stages[0].trigger_price = 380;

    expect(buildQuantDecisionEvents(snapshot, { logWarning })).toHaveLength(1);
    expect(logWarning).not.toHaveBeenCalled();
  });
});
