import type { Holding, QuantAnalysisSnapshot, QuantChannelAlert } from './types';

export const SYMBOL_NAMES: Readonly<Record<string, string>> = {
  NVDA: '英伟达', AAPL: '苹果', GOOG: '谷歌', GOOGL: '谷歌', META: 'Meta 平台',
  TSLA: '特斯拉', AMZN: '亚马逊', MSFT: '微软', AVGO: '博通', MU: '美光', TSM: '台积电',
  WMT: '沃尔玛', KO: '可口可乐', MCD: '麦当劳', NKE: '耐克', PDD: '拼多多', AMD: '超威半导体',
  QQQ: '纳指100 ETF', TQQQ: '纳指100三倍做多', SOXX: '半导体 ETF', SMH: '半导体 ETF',
  SOXL: '半导体三倍做多', XLK: '科技板块 ETF', TECL: '科技三倍做多',
  XLF: '金融板块 ETF', FAS: '金融三倍做多', IGV: '软件行业 ETF',
  FNGS: 'FANG+ 指数 ETN', FNGU: 'FANG+ 三倍做多', MAGS: '科技七巨头 ETF',
  GLD: '实物黄金 ETF', GLDM: '迷你实物黄金 ETF', GDX: '黄金矿业 ETF', COPX: '铜矿业 ETF',
  SPY: '标普500 ETF', VOO: '标普500 ETF', DIA: '道琼斯 ETF', NAIL: '住宅建筑三倍做多',
  NVDL: '英伟达两倍做多', TSLL: '特斯拉两倍做多', METU: 'Meta 两倍做多',
  NDX: '纳斯达克100指数', SOX: '费城半导体指数', SPX: '标普500指数',
};

export const CHANNEL_FILTERS = [
  { value: 'all', label: '全部' }, { value: 'held', label: '已持仓' },
  { value: 'buy', label: '可以买' }, { value: 'buy_near', label: '接近买' },
  { value: 'sell', label: '可以卖' }, { value: 'sell_near', label: '接近卖' },
] as const;
export type ChannelFilter = typeof CHANNEL_FILTERS[number]['value'];

export function heldTechnicalSymbols(holdings: readonly Holding[]): Set<string> {
  // Holding an option/leveraged proxy is not holding its ordinary-share ticker.
  return new Set(holdings.filter((item) => item.shares !== 0 && item.assetType !== 'option' && !item.cashEquivalent)
    .map((item) => item.symbol.toUpperCase().replace(/^US\./, '')));
}

export function technicalSymbolName(symbol: string, holdings: readonly Holding[] = [], names: Readonly<Record<string, string>> = {}): string {
  return SYMBOL_NAMES[symbol] ?? names[symbol] ?? holdings.find((item) => item.symbol.replace(/^US\./, '') === symbol)?.name ?? symbol;
}

export function technicalPresetSymbols(snapshot: QuantAnalysisSnapshot, holdings: readonly Holding[]): string[] {
  const active = snapshot.growth_watchlist?.active_symbols ?? [];
  const stored = Object.entries(snapshot.symbols ?? {}).filter(([, entry]) => Boolean(entry.ma_slope)).map(([symbol]) => symbol);
  return [...new Set([...active, ...stored, ...heldTechnicalSymbols(holdings), 'NDX', 'SOX', 'SPX'])]
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => !['CASH', 'USD', 'SGOV', 'BIL'].includes(symbol) && /^\^?[A-Z][A-Z0-9.-]{0,10}$/.test(symbol));
}

export function matchesChannelFilter(symbol: string, filter: ChannelFilter, held: ReadonlySet<string>, alert?: QuantChannelAlert): boolean {
  if (filter === 'all') return true;
  if (filter === 'held') return held.has(symbol);
  return alert?.available === true && alert.state === filter;
}
