import type { Holding, ImportedPortfolio, ImportIssue, ParsedOptionDetail, ParsedOptionDetails, PortfolioState } from './types';

export function countNeedsReview(holdings: Holding[]): number {
  return holdings.filter((holding) => (
    holding.confidence === 'low' || holding.missingFields?.includes('成本待核对')
  )).length;
}

type ImportedHolding = Omit<Holding, 'id'>;

export function mergeImportedHoldings(holdings: ImportedHolding[]): ImportedHolding[] {
  const merged = new Map<string, ImportedHolding>();
  for (const holding of holdings) {
    const key = mergeKey(holding);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...holding, missingFields: [...(holding.missingFields ?? [])] });
      continue;
    }
    const currentMarketValue = nativeMarketValue(current);
    const nextMarketValue = nativeMarketValue(holding);
    const shares = current.shares + holding.shares;
    const buyPrice = weightedPositivePrice(current, holding, shares);
    merged.set(key, {
      ...current,
      shares,
      buyPrice,
      currentPrice: nextMarketValue > currentMarketValue ? holding.currentPrice : current.currentPrice,
      marketValueOverride: sumOnlyWhenBothKnown(current.marketValueOverride, holding.marketValueOverride),
      costOverride: sumOnlyWhenBothKnown(current.costOverride, holding.costOverride),
      confidence: lowerConfidence(current.confidence, holding.confidence),
      missingFields: [...new Set([...(current.missingFields ?? []), ...(holding.missingFields ?? [])])],
    });
  }
  return [...merged.values()];
}

function mergeKey(holding: ImportedHolding): string {
  const base = `${holding.symbol}|${holding.assetType ?? 'stock'}|${holding.currency}`;
  if (holding.assetType !== 'option') return base;
  const option = holding.option;
  return `${base}|${option?.underlying ?? ''}|${option?.optionType ?? ''}|${option?.strike ?? ''}|${option?.expiration ?? ''}`;
}

function nativeMarketValue(holding: ImportedHolding): number {
  const multiplier = holding.assetType === 'option' ? holding.option?.contractMultiplier ?? 100 : 1;
  return holding.marketValueOverride ?? holding.shares * holding.currentPrice * multiplier;
}

function weightedPositivePrice(left: ImportedHolding, right: ImportedHolding, totalShares: number): number {
  if (left.buyPrice > 0 && right.buyPrice > 0 && totalShares > 0) {
    return (left.buyPrice * left.shares + right.buyPrice * right.shares) / totalShares;
  }
  return left.buyPrice > 0 ? left.buyPrice : right.buyPrice > 0 ? right.buyPrice : 0;
}

function sumOnlyWhenBothKnown(left: number | undefined, right: number | undefined): number | undefined {
  return left != null && right != null ? left + right : undefined;
}

function lowerConfidence(
  left: Holding['confidence'],
  right: Holding['confidence'],
): Holding['confidence'] {
  const rank = { high: 2, medium: 1, low: 0 } as const;
  const leftValue = left ?? 'medium';
  const rightValue = right ?? 'medium';
  return rank[leftValue] <= rank[rightValue] ? leftValue : rightValue;
}

export function crossCheckImportedPnl(
  holding: ImportedHolding,
  issues: ImportIssue[],
): ImportedHolding {
  const costKnown = holding.costOverride != null || (holding.shares > 0 && holding.buyPrice > 0);
  if (!costKnown || holding.reportedPnl == null) return holding;
  const marketValue = nativeMarketValue(holding);
  const multiplier = holding.assetType === 'option' ? holding.option?.contractMultiplier ?? 100 : 1;
  const cost = holding.costOverride ?? holding.shares * holding.buyPrice * multiplier;
  const computedPnl = marketValue - cost;
  const signsDiffer = (computedPnl < 0 && holding.reportedPnl > 0)
    || (computedPnl > 0 && holding.reportedPnl < 0);
  const differenceTooLarge = Math.abs(computedPnl - holding.reportedPnl)
    > Math.max(Math.abs(marketValue) * 0.1, 50);
  if (!signsDiffer && !differenceTooLarge) return holding;
  const missingFields = [...new Set([...(holding.missingFields ?? []), '成本待核对'])];
  issues.push({
    field: `${holding.symbol} 成本待核对`,
    reason: `${holding.symbol} 识别出的盈亏（${computedPnl.toFixed(2)}）与券商截图显示（${holding.reportedPnl.toFixed(2)}）不符，买入价或股数可能读错，请到持仓表核对。`,
    priority: 'required',
  });
  return { ...holding, confidence: 'low', missingFields };
}

export function applyImageImport(
  current: PortfolioState,
  result: ImportedPortfolio,
  createId: () => string,
): PortfolioState {
  return {
    holdings: [
      ...current.holdings.filter((holding) => holding.source !== 'image-import'),
      ...result.holdings.map((holding) => ({ ...holding, id: createId() })),
    ],
    cash: [
      ...current.cash.filter((cash) => cash.source !== 'image-import'),
      ...result.cash,
    ],
    updatedAt: new Date().toISOString(),
  };
}

export interface OptionDetailsApplyResult {
  next: PortfolioState;
  updated: string[];
  added: string[];
  issues: ImportIssue[];
}

export function applyOptionDetails(
  current: PortfolioState,
  result: ParsedOptionDetails,
  createId: () => string,
): OptionDetailsApplyResult {
  const updated: string[] = [];
  const added: string[] = [];
  const issues = [...result.issues];
  const holdings = [...current.holdings];

  for (const detail of result.options) {
    const exactIndex = holdings.findIndex((holding) => exactOptionMatch(holding, detail));
    const candidates = holdings
      .map((holding, index) => ({ holding, index }))
      .filter(({ holding }) => sameUnderlyingAndType(holding, detail));
    const matchIndex = exactIndex >= 0 ? exactIndex : candidates.length === 1 ? candidates[0]!.index : -1;

    if (matchIndex >= 0) {
      const existing = holdings[matchIndex]!;
      holdings[matchIndex] = enrichOptionHolding(existing, detail);
      updated.push(existing.name || optionLabel(detail));
      continue;
    }
    if (candidates.length > 1) {
      issues.push({
        field: `${detail.underlying} 期权匹配`,
        reason: `找到 ${candidates.length} 条同标的同方向期权，但详情页信息不足以唯一匹配，未自动修改。`,
        priority: 'required',
      });
      continue;
    }
    const holding = newOptionHolding(detail, createId());
    holdings.push(holding);
    added.push(holding.name);
    issues.push({
      field: `${holding.name} 新增`,
      reason: '完整持仓中未找到对应期权，已由详情页新增；请核对张数与成本。',
      priority: 'recommended',
    });
  }

  return {
    next: { holdings, cash: current.cash, updatedAt: new Date().toISOString() },
    updated,
    added,
    issues,
  };
}

function sameUnderlyingAndType(holding: Holding, detail: ParsedOptionDetail): boolean {
  return holding.assetType === 'option'
    && holding.option?.underlying.trim().toUpperCase() === detail.underlying.trim().toUpperCase()
    && holding.option.optionType === detail.optionType;
}

function exactOptionMatch(holding: Holding, detail: ParsedOptionDetail): boolean {
  if (!sameUnderlyingAndType(holding, detail)) return false;
  if (detail.strike == null || detail.expiration == null) return false;
  return holding.option?.strike === detail.strike && holding.option.expiration === detail.expiration;
}

function enrichOptionHolding(holding: Holding, detail: ParsedOptionDetail): Holding {
  const option = holding.option!;
  const nextOption = {
    underlying: detail.underlying || option.underlying,
    optionType: detail.optionType ?? option.optionType,
    strike: detail.strike ?? option.strike,
    expiration: detail.expiration ?? option.expiration,
    contractMultiplier: detail.contractMultiplier || option.contractMultiplier,
    delta: detail.delta ?? option.delta,
    theta: detail.theta ?? option.theta,
    gamma: detail.gamma ?? option.gamma,
    vega: detail.vega ?? option.vega,
    impliedVolatility: detail.impliedVolatility ?? option.impliedVolatility,
    underlyingPrice: detail.underlyingPrice ?? option.underlyingPrice,
  };
  const resolvedFields = new Set<string>();
  if (nextOption.delta != null) resolvedFields.add('Delta');
  if (nextOption.expiration) resolvedFields.add('到期日');
  if (nextOption.strike != null) resolvedFields.add('行权价');
  if (nextOption.underlyingPrice != null) resolvedFields.add('标的现价');
  return {
    ...holding,
    shares: detail.contracts != null && detail.contracts > 0 ? detail.contracts : holding.shares,
    currentPrice: detail.premiumPrice ?? holding.currentPrice,
    currency: detail.currency ?? holding.currency,
    option: nextOption,
    missingFields: (holding.missingFields ?? []).filter((field) => !resolvedFields.has(field)),
    confidence: 'high',
  };
}

function newOptionHolding(detail: ParsedOptionDetail, id: string): Holding {
  const name = optionLabel(detail);
  const missingFields = [
    detail.strike == null ? '行权价' : null,
    detail.expiration == null ? '到期日' : null,
    detail.delta == null ? 'Delta' : null,
    detail.underlyingPrice == null ? '标的现价' : null,
    detail.contracts == null ? '持仓张数' : null,
  ].filter((field): field is string => field != null);
  return {
    id,
    symbol: detail.underlying.trim().toUpperCase(),
    name,
    shares: detail.contracts ?? 0,
    buyPrice: 0,
    currentPrice: detail.premiumPrice ?? 0,
    sector: '',
    currency: detail.currency,
    note: '由期权详情页新增',
    assetType: 'option',
    option: {
      underlying: detail.underlying.trim().toUpperCase(),
      optionType: detail.optionType,
      strike: detail.strike,
      expiration: detail.expiration,
      contractMultiplier: detail.contractMultiplier || 100,
      delta: detail.delta,
      theta: detail.theta,
      gamma: detail.gamma,
      vega: detail.vega,
      impliedVolatility: detail.impliedVolatility,
      underlyingPrice: detail.underlyingPrice,
    },
    source: 'image-import',
    confidence: missingFields.length === 0 ? 'high' : 'medium',
    missingFields,
  };
}

function optionLabel(detail: ParsedOptionDetail): string {
  const type = detail.optionType.toUpperCase();
  return [detail.underlying.trim().toUpperCase(), type, detail.strike, detail.expiration]
    .filter((value) => value != null && value !== '')
    .join(' ');
}
