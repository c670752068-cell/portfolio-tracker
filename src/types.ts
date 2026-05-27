export interface Holding {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  buyPrice: number;
  currentPrice: number;
  sector: string;
  currency: 'USD' | 'CNY' | 'HKD' | 'OTHER';
  note?: string;
}

export interface CashPosition {
  amount: number;
  currency: 'USD' | 'CNY' | 'HKD' | 'OTHER';
}

export interface PortfolioState {
  holdings: Holding[];
  cash: CashPosition[];
  updatedAt: string;
}

export interface AppSettings {
  kimiApiKey: string;
  kimiModel: string;
  proxyUrl: string;
}

export interface HoldingMetric {
  holding: Holding;
  marketValue: number;
  cost: number;
  pnl: number;
  pnlPct: number;
  weight: number;
}

export interface PortfolioMetrics {
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPct: number;
  equityValue: number;
  cashValue: number;
  cashWeight: number;
  holdingsMetrics: HoldingMetric[];
  sectorWeights: Record<string, number>;
}

export interface RiskFinding {
  level: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
}
