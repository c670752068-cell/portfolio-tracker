import { isDustQuantPosition } from './dustPosition';
import { leverageInfoForSymbol } from './leverageMap';
import type {
  AssetType,
  CashPosition,
  Holding,
  ImportIssue,
  PortfolioState,
  QuantHoldingCost,
  QuantPosition,
  QuantPositionsPayload,
  QuantPositionsSnapshot,
} from './types';

export interface QuantMappedPortfolio {
  holdings: Holding[];
  cash: CashPosition[];
  issues: ImportIssue[];
}

export function mapQuantPositions(
  payload: QuantPositionsPayload,
  prior: PortfolioState,
): QuantMappedPortfolio {
  const issues: ImportIssue[] = [];
  // 零碎残值不进持仓列表；它那几美元留在下面推算出的现金里，总资产口径不变。
  const tracked = payload.positions.filter((position) => !isDustQuantPosition(position));
  const holdings = tracked.map((position, index) => mapPosition(position, index, prior, issues));
  const marketValue = tracked.reduce((sum, position) => sum + finite(position.market_value), 0);
  const cashAmount = payload.net_liquidation - marketValue;
  const cash: CashPosition[] = [];

  cash.push({
    amount: roundMoney(cashAmount),
    currency: 'USD',
    source: 'quant-sync',
    note: cashAmount >= 0
      ? '按净资产减持仓市值推算'
      : '净值对账调整（含现金、负债、应计及快照时差）',
  });
  if (cashAmount < 0) {
    issues.push({
      field: '现金推算',
      reason: `净资产低于持仓市值 ${Math.abs(cashAmount).toFixed(2)} USD，已计入负的净值对账调整，请核对券商汇总口径。`,
      priority: 'required',
    });
  }

  addManualDuplicateIssues(holdings, prior.holdings, issues);
  return { holdings, cash, issues };
}

function mapPosition(
  position: QuantPosition,
  index: number,
  prior: PortfolioState,
  issues: ImportIssue[],
): Holding {
  const symbol = position.symbol.trim().toUpperCase();
  const mappedLeverage = leverageInfoForSymbol(symbol);
  const assetType: AssetType = position.asset_type === 'option'
    ? 'option'
    : mappedLeverage
      ? 'leveraged_etf'
      : position.asset_type === 'etf'
        ? 'etf'
        : 'stock';
  const candidates = prior.holdings.filter((holding) => enhancementCandidate(holding, position, symbol, assetType));
  let enhancement: Holding | undefined;

  if (assetType === 'option' && candidates.length > 1) {
    issues.push({
      field: `${symbol} 期权增强`,
      reason: `${symbol} 期权详情无法自动对应，请用『补充期权详情』重新导入一次。`,
      priority: 'required',
    });
  } else {
    enhancement = candidates.sort((left, right) => nativeMarketValue(right) - nativeMarketValue(left))[0];
  }

  const multiplier = assetType === 'option'
    ? finitePositive(position.contract_multiplier) ?? enhancement?.option?.contractMultiplier ?? 100
    : 1;
  const shares = finite(position.qty);
  const marketValue = finite(position.market_value);
  const positionCost = finitePositive(position.cost_basis);
  const inferredPrice = shares !== 0 ? marketValue / Math.abs(shares) / multiplier : 0;
  const broker = position.broker.trim().toUpperCase();

  return {
    id: `quant-${slug(broker)}-${index}-${slug(symbol)}`,
    symbol,
    name: assetType === 'leveraged_etf' && mappedLeverage
      ? `${symbol} ${mappedLeverage.factor}× 杠杆 ETF`
      : assetType === 'option'
        ? optionName(position, symbol) || enhancement?.name || symbol
        : enhancement?.name || symbol,
    shares,
    buyPrice: positionCost !== null && shares !== 0
      ? positionCost / Math.abs(shares) / multiplier
      : enhancement?.buyPrice ?? 0,
    currentPrice: inferredPrice,
    sector: enhancement?.sector ?? '',
    currency: 'USD',
    assetType,
    option: assetType === 'option' ? {
      underlying: symbol,
      contractCode: position.contract_code || enhancement?.option?.contractCode,
      optionType: position.option_type || enhancement?.option?.optionType || 'call',
      strike: finiteOrNull(position.strike) ?? enhancement?.option?.strike ?? null,
      expiration: position.expiry || enhancement?.option?.expiration || null,
      contractMultiplier: multiplier,
      delta: enhancement?.option?.delta ?? null,
      theta: enhancement?.option?.theta ?? null,
      gamma: enhancement?.option?.gamma ?? null,
      vega: enhancement?.option?.vega ?? null,
      impliedVolatility: enhancement?.option?.impliedVolatility ?? null,
      underlyingPrice: enhancement?.option?.underlyingPrice ?? null,
    } : undefined,
    marketValueOverride: marketValue,
    costOverride: positionCost ?? enhancement?.costOverride,
    note: enhancement?.note,
    missingFields: enhancement?.missingFields,
    confidence: enhancement?.confidence,
    source: 'quant-sync',
    broker,
    cashEquivalent: enhancement?.cashEquivalent,
    leverageFactor: assetType === 'leveraged_etf'
      ? mappedLeverage?.factor ?? enhancement?.leverageFactor
      : undefined,
    reportedPnl: enhancement?.reportedPnl,
    reportedPnlPct: enhancement?.reportedPnlPct,
  };
}

function enhancementCandidate(holding: Holding, position: QuantPosition, symbol: string, assetType: AssetType): boolean {
  if (assetType === 'option') {
    const underlying = holding.option?.underlying.trim().toUpperCase();
    const sameUnderlying = underlying === symbol || holding.symbol.trim().toUpperCase() === symbol;
    const incomingCode = position.contract_code?.trim().toUpperCase();
    const existingCode = holding.option?.contractCode?.trim().toUpperCase();
    return holding.assetType === 'option'
      && sameUnderlying
      && (!incomingCode || !existingCode || incomingCode === existingCode);
  }
  return holding.symbol.trim().toUpperCase() === symbol
    && (holding.assetType ?? 'stock') === assetType;
}

function optionName(position: QuantPosition, symbol: string): string {
  const strike = finiteOrNull(position.strike);
  if (!position.expiry || strike === null || !position.option_type) return '';
  return `${symbol} ${position.expiry} ${strike} ${position.option_type === 'put' ? 'Put' : 'Call'}`;
}

function nativeMarketValue(holding: Holding): number {
  const multiplier = holding.assetType === 'option' ? holding.option?.contractMultiplier ?? 100 : 1;
  return holding.marketValueOverride ?? holding.shares * holding.currentPrice * multiplier;
}

function addManualDuplicateIssues(synced: Holding[], prior: Holding[], issues: ImportIssue[]): void {
  const syncedSymbols = new Set(synced.map((holding) => holding.symbol));
  const duplicates = new Set(
    prior
      .filter((holding) => holding.source !== 'image-import' && holding.source !== 'quant-sync')
      .map((holding) => holding.symbol.trim().toUpperCase())
      .filter((symbol) => syncedSymbols.has(symbol)),
  );
  for (const symbol of duplicates) {
    issues.push({
      field: `${symbol} 重复持仓`,
      reason: `${symbol} 手动条目与同步持仓重复，已以三券商同步快照为准并自动排除手动重复项。`,
      priority: 'recommended',
    });
  }
}

function duplicatesSyncedHolding(holding: Holding, synced: readonly Holding[]): boolean {
  if (holding.assetType === 'option') return false;
  const symbol = holding.symbol.trim().toUpperCase();
  if (!symbol) return false;
  return synced.some((candidate) => (
    candidate.assetType !== 'option'
    && candidate.symbol.trim().toUpperCase() === symbol
  ));
}

export function applyQuantSync(current: PortfolioState, mapped: QuantMappedPortfolio): PortfolioState {
  return {
    holdings: [
      ...current.holdings.filter((holding) => (
        holding.source !== 'quant-sync'
        && holding.source !== 'image-import'
        && !duplicatesSyncedHolding(holding, mapped.holdings)
      )),
      ...mapped.holdings,
    ],
    cash: [
      ...current.cash.filter((cash) => cash.source !== 'quant-sync' && cash.source !== 'image-import'),
      ...mapped.cash,
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function applyQuantHoldingCosts(
  holdings: readonly Holding[],
  costs: Readonly<Record<string, QuantHoldingCost>>,
): Holding[] {
  return holdings.map((holding) => {
    if (holding.source !== 'quant-sync' || holding.assetType === 'option') return holding;
    const cost = costs[holding.symbol.trim().toUpperCase()];
    if (cost?.coverage !== 'complete'
      || !cost.auto_fill_allowed
      || typeof cost.weighted_average_cost !== 'number'
      || cost.weighted_average_cost <= 0) {
      return holding;
    }
    return {
      ...holding,
      buyPrice: cost.weighted_average_cost,
      costOverride: undefined,
    };
  });
}

export function isQuantSnapshotStale(pushedAt: string, now = Date.now()): boolean {
  const timestamp = Date.parse(pushedAt);
  return !Number.isFinite(timestamp) || now - timestamp > 90 * 60 * 1000;
}

export async function fetchQuantPositions(url: string, token: string): Promise<QuantPositionsSnapshot> {
  const headers: Record<string, string> = {};
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers,
  });
  const body = await response.json().catch(() => null) as QuantPositionsSnapshot | { error?: string } | null;
  if (!response.ok) {
    throw new Error(body && 'error' in body && body.error ? body.error : `同步失败（HTTP ${response.status}）`);
  }
  if (!body || !('payload' in body) || !Array.isArray(body.payload?.positions)) {
    throw new Error('同步返回格式无效');
  }
  return body;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finitePositive(value: unknown): number | null {
  const parsed = finiteOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
