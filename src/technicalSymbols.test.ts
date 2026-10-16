import { describe, expect, it } from 'vitest';
import { heldTechnicalSymbols, matchesChannelFilter, technicalPresetSymbols, technicalSymbolName } from './technicalSymbols';
import type { Holding, QuantAnalysisSnapshot, QuantChannelAlert } from './types';

describe('technical symbol filters', () => {
  const holdings = [
    { symbol: 'US.WMT', shares: 5, assetType: 'stock' },
    { symbol: 'NVDA', shares: 0, assetType: 'stock' },
    { symbol: 'NVDA CALL', shares: 1, assetType: 'option' },
    { symbol: 'SGOV', shares: 3, cashEquivalent: true },
    { symbol: 'GLDM', shares: 2, assetType: 'etf' },
  ] as Holding[];
  it('uses actual holdings, not watchlist membership or option underlyings', () => {
    const held = heldTechnicalSymbols(holdings);
    expect([...held]).toEqual(['WMT', 'GLDM']);
    expect(matchesChannelFilter('WMT', 'held', held)).toBe(true);
    expect(matchesChannelFilter('NVDA', 'held', held)).toBe(false);
    const symbols = technicalPresetSymbols({ symbols: {}, growth_watchlist: { active_symbols: ['SMH'] } } as unknown as QuantAnalysisSnapshot, holdings);
    expect(symbols).toEqual(['SMH', 'WMT', 'GLDM', 'NDX', 'SOX', 'SPX']);
  });
  it('separates near/buy/sell and never labels unavailable data as an opportunity', () => {
    const held = new Set<string>();
    const alert = { available: true, state: 'buy_near' } as QuantChannelAlert;
    expect(matchesChannelFilter('SMH', 'buy', held, alert)).toBe(false);
    expect(matchesChannelFilter('SMH', 'buy_near', held, alert)).toBe(true);
    expect(matchesChannelFilter('SMH', 'sell', held, { ...alert, state: 'sell' })).toBe(true);
    expect(matchesChannelFilter('SMH', 'buy_near', held, { ...alert, available: false })).toBe(false);
    expect(matchesChannelFilter('SMH', 'buy', held)).toBe(false);
    expect(technicalSymbolName('WMT')).toBe('沃尔玛');
    expect(technicalSymbolName('GLDM')).toBe('迷你实物黄金 ETF');
    expect(technicalSymbolName('NEW', [], { NEW: '新标的名称' })).toBe('新标的名称');
  });
});
