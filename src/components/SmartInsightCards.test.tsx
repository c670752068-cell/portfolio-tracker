import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Holding, HoldingMetric, QuantAnalysisSnapshot } from '../types';
import {
  buildHoldingEmotionInsight,
  buildLeverageRadarRows,
} from '../smartInsight';
import {
  FearComfortBanner,
  LeverageOpportunityRadar,
} from './SmartInsightCards';

function snapshot(overrides: Partial<QuantAnalysisSnapshot> = {}): QuantAnalysisSnapshot {
  return {
    source: 'futu-assistant',
    generated_at: '2026-07-24T10:00:00-04:00',
    rule_version: '2.2',
    disclaimer: '仅作信息展示',
    context: {},
    symbols: {},
    ...overrides,
  };
}

const holding: Holding = {
  id: 'aapl',
  symbol: 'AAPL',
  name: 'Apple',
  shares: 10,
  buyPrice: 100,
  currentPrice: 80,
  sector: '科技',
  currency: 'USD',
  assetType: 'stock',
};

function metric(
  holdingValue: Holding = holding,
  overrides: Partial<HoldingMetric> = {},
): HoldingMetric {
  return {
    holding: holdingValue,
    marketValueNative: 800,
    costNative: 1000,
    marketValue: 800,
    cost: 1000,
    costKnown: true,
    pnl: -200,
    pnlPct: -0.2,
    dayChange: 0,
    dayChangeNative: 0,
    dayChangePct: null,
    weight: 0.1,
    deltaEquivalentShares: null,
    deltaAdjustedExposure: null,
    equivalentExposure: 800,
    ...overrides,
  };
}

describe('money and emotion translation', () => {
  it('uses the canonical holding metric for dollar loss and includes sample-backed depth history', () => {
    const result = buildHoldingEmotionInsight(metric(), snapshot({
      symbols: {
        AAPL: {
          available: true,
          depth_window: {
            applicable: true,
            open: true,
            current_pct: 20,
            threshold_pct: 18,
            price_session: 'regular',
            win_rate_60d: 0.68,
            n: 25,
            sample_insufficient: false,
            bear_included: true,
          },
        },
      },
    }));

    expect(result).toEqual({
      lossUsd: 200,
      winRate60d: 0.68,
      sampleCount: 25,
      sampleInsufficient: false,
    });
  });

  it('keeps the loss but marks insufficient history honestly', () => {
    const result = buildHoldingEmotionInsight(metric(), snapshot({
      symbols: {
        AAPL: {
          available: true,
          depth_window: {
            applicable: true,
            open: true,
            current_pct: 20,
            threshold_pct: 18,
            price_session: 'regular',
            win_rate_60d: null,
            n: 5,
            sample_insufficient: true,
            bear_included: false,
          },
        },
      },
    }));

    expect(result).toEqual({
      lossUsd: 200,
      winRate60d: null,
      sampleCount: 5,
      sampleInsufficient: true,
    });
  });

  it('does not invent a dollar loss when the canonical metric has no cost or loss', () => {
    expect(buildHoldingEmotionInsight(metric(holding, { costKnown: false, pnl: 0 }), snapshot({
      holding_costs: {
        AAPL: {
          weighted_average_cost: 100,
          currency: 'USD',
          coverage: 'complete',
          auto_fill_allowed: true,
        },
      },
    }))).toBeNull();
    expect(buildHoldingEmotionInsight(metric(holding, { pnl: 50 }), snapshot())).toBeNull();
  });

  it('never turns an underlying stock cost into an option loss', () => {
    const optionHolding: Holding = {
      ...holding,
      id: 'aapl-call',
      assetType: 'option',
      buyPrice: 0,
      option: {
        underlying: 'AAPL',
        optionType: 'call',
        strike: 100,
        expiration: '2027-01-15',
        contractMultiplier: 100,
        delta: 0.5,
        theta: null,
        gamma: null,
        vega: null,
        impliedVolatility: null,
        underlyingPrice: 80,
      },
    };
    const result = buildHoldingEmotionInsight(
      metric(optionHolding, { costKnown: false, cost: 0, pnl: 0 }),
      snapshot({
        holding_costs: {
          AAPL: {
            weighted_average_cost: 100,
            currency: 'USD',
            coverage: 'complete',
            auto_fill_allowed: true,
          },
        },
      }),
    );

    expect(result).toBeNull();
  });
});

describe('fear comfort banner', () => {
  it('uses a calm purple banner only when CNN fear and greed is at or below 25', () => {
    const visible = renderToStaticMarkup(
      <FearComfortBanner
        context={{ cnn_fear_greed: { available: true, score: 25, rating: 'extreme fear' } }}
      />,
    );
    const hidden = renderToStaticMarkup(
      <FearComfortBanner
        context={{ cnn_fear_greed: { available: true, score: 25.01, rating: 'fear' } }}
      />,
    );

    expect(visible).toContain('现在是恐慌，正是用子弹的时刻——按你的规则执行');
    expect(visible).toContain('border-l-buy');
    expect(visible).not.toContain('animate-');
    expect(hidden).toBe('');
  });
});

describe('leveraged opportunity radar', () => {
  it('calculates readiness, remaining depth and progress from available backend fields', () => {
    const rows = buildLeverageRadarRows(snapshot({
      symbols: {
        TQQQ: {
          available: true,
          depth_window: {
            applicable: true,
            open: false,
            current_pct: 20,
            threshold_pct: 25,
            current_price: 60,
            threshold_price: 56,
            price_session: 'premarket',
            win_rate_60d: 0.55,
            n: 22,
            sample_insufficient: false,
            bear_included: true,
          },
        },
        FNGU: {
          available: true,
          depth_window: {
            applicable: true,
            open: true,
            current_pct: 30,
            threshold_pct: 25,
            current_price: 24,
            threshold_price: 26,
            price_session: 'regular',
            win_rate_60d: null,
            n: 2,
            sample_insufficient: true,
            bear_included: false,
          },
        },
        SOXL: {
          available: true,
          depth_window: {
            applicable: false,
            open: false,
            current_pct: 0,
            threshold_pct: 25,
            price_session: 'regular',
            win_rate_60d: null,
            n: 0,
            sample_insufficient: true,
            bear_included: false,
          },
        },
      },
    }));

    expect(rows).toEqual([
      {
        symbol: 'TQQQ',
        ready: false,
        currentPct: 20,
        thresholdPct: 25,
        remainingPct: 5,
        progressPct: 80,
        currentPrice: 60,
        thresholdPrice: 56,
        priceSession: 'premarket',
      },
      {
        symbol: 'FNGU',
        ready: true,
        currentPct: 30,
        thresholdPct: 25,
        remainingPct: 0,
        progressPct: 100,
        currentPrice: 24,
        thresholdPrice: 26,
        priceSession: 'regular',
      },
    ]);
  });

  it('renders missing prices as unavailable instead of zero or fake values', () => {
    const html = renderToStaticMarkup(
      <LeverageOpportunityRadar
        snapshot={snapshot({
          symbols: {
            TECL: {
              available: true,
              depth_window: {
                applicable: true,
                open: false,
                current_pct: 10,
                threshold_pct: 20,
                price_session: 'closed',
                win_rate_60d: null,
                n: 0,
                sample_insufficient: true,
                bear_included: false,
              },
            },
          },
        })}
      />,
    );

    expect(html).toContain('三倍标的买点进度');
    expect(html).toContain('还差 10.00%');
    expect(html).toContain('现价暂无，买点价暂无');
    expect(html).not.toContain('$0.00');
    expect(html).not.toContain('NaN');
  });
});
