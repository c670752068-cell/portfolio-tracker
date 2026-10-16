export const SECTORS = [
  { symbol: 'XLK', name: '科技' }, { symbol: 'XLC', name: '通信服务' },
  { symbol: 'XLE', name: '能源' }, { symbol: 'XLY', name: '可选消费' },
  { symbol: 'XLF', name: '金融' }, { symbol: 'XLI', name: '工业' },
  { symbol: 'XLP', name: '必需消费' }, { symbol: 'XLV', name: '医疗保健' },
  { symbol: 'XLB', name: '材料' }, { symbol: 'XLU', name: '公用事业' },
  { symbol: 'XLRE', name: '房地产' },
] as const;
export type SectorSymbol = typeof SECTORS[number]['symbol'];
export const PERIODS = [
  { sessions: 21, label: '1月' }, { sessions: 63, label: '3月' },
  { sessions: 126, label: '6月' }, { sessions: 252, label: '1年' },
] as const;
export type RotationState = 'leading' | 'weakening' | 'lagging' | 'improving' | 'neutral';
export const ROTATION_LABELS: Record<RotationState, string> = { leading: '领先', weakening: '转弱', lagging: '落后', improving: '改善', neutral: '临界' };
export const ROTATION_COPY: Record<RotationState, string> = {
  leading: '相对趋势在基线上方，相对动能也在基线上方。',
  weakening: '相对趋势仍在基线上方，但相对动能已减弱。',
  lagging: '相对趋势和相对动能均在基线下方。',
  improving: '相对趋势仍在基线下方，相对动能开始改善。',
  neutral: '相对趋势或动能位于基线，暂不归入四象限。',
};

// Explicit maintained classifications, NOT a claim of S&P 500 membership.
// Multi-sector indices, commodities and leveraged ETFs are intentionally not assigned.
const STOCK_SECTORS: Record<string, SectorSymbol> = Object.fromEntries([
  ['XLK', 'AAPL MSFT NVDA AVGO MU TSM AMD ORCL CRM ADBE INTU CSCO INTC QCOM TXN NOW PLTR AMAT LRCX KLAC'],
  ['XLC', 'GOOG GOOGL META NFLX DIS TMUS VZ T CMCSA'],
  ['XLY', 'AMZN TSLA MCD NKE PDD HD LOW SBUX BKNG ABNB BABA JD'],
  ['XLP', 'WMT KO PEP COST PG PM MO CL MDLZ'],
  ['XLF', 'JPM BAC WFC GS MS C BRK.B V MA AXP SCHW'],
  ['XLI', 'CAT GE HON BA RTX LMT UBER UPS UNP DE'],
  ['XLE', 'XOM CVX COP EOG SLB OXY'],
  ['XLV', 'LLY UNH JNJ ABBV MRK PFE AMGN TMO ABT ISRG'],
  ['XLB', 'LIN APD SHW FCX NEM DOW NUE'],
  ['XLU', 'NEE DUK SO AEP CEG VST'],
  ['XLRE', 'PLD AMT EQIX O WELL SPG'],
].flatMap(([sector, symbols]) => symbols.split(' ').map(symbol => [symbol, sector as SectorSymbol])));
export function stockSector(symbol: string): SectorSymbol | null { return STOCK_SECTORS[symbol] ?? null; }

export interface RotationPrice { date: string; close: number }
export interface RotationHistory {
  symbol: string;
  available: boolean;
  stale: boolean;
  as_of?: string;
  fetched_at?: string;
  source?: string;
  adjustment?: string;
  series?: RotationPrice[];
  error?: string | null;
}
export interface RotationPayload {
  version: number;
  generated_at: string;
  expected_close: string;
  completed_week: string;
  calendar_verified: boolean;
  benchmark: 'SPY';
  price_basis: 'split_and_dividend_adjusted';
  series: Record<string, RotationHistory>;
}
export interface RelativePoint { date: string; asset: number; benchmark: number; ratio: number }
export interface RotationPoint { date: string; x: number; y: number; state: RotationState }
export interface RelativePerformance {
  available: boolean;
  reason: string;
  start: string | null;
  end: string | null;
  assetReturn: number | null;
  benchmarkReturn: number | null;
  excessPp: number | null;
  points: RelativePoint[];
  stale: boolean;
}

function validPoints(history?: RotationHistory): RotationPrice[] {
  if (!history?.available || history.adjustment !== 'split_and_dividend_adjusted') return [];
  const map = new Map<string, RotationPrice>();
  for (const point of history.series ?? []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close) && point.close > 0) map.set(point.date, point);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function relativePerformance(asset: RotationHistory | undefined, benchmark: RotationHistory | undefined, sessions: number): RelativePerformance {
  const result: RelativePerformance = { available: false, reason: '', start: null, end: null, assetReturn: null, benchmarkReturn: null, excessPp: null, points: [], stale: Boolean(asset?.stale || benchmark?.stale) };
  const base = validPoints(benchmark);
  const stock = new Map(validPoints(asset).map(p => [p.date, p.close]));
  if (!asset?.available || !benchmark?.available) return { ...result, reason: '完整收盘数据暂不可用' };
  if (base.length <= sessions) return { ...result, reason: `不足 ${sessions} 个交易日，不缩短区间代替` };
  const window = base.slice(-(sessions + 1));
  const start = window[0].date, end = window.at(-1)!.date;
  if (!window.every(p => stock.has(p.date))) return { ...result, start, end, reason: '同期交易日不完整，不补点或换日期比较' };
  const assetStart = stock.get(start)!;
  const benchmarkStart = window[0].close;
  const points = window.map(p => ({ date: p.date, asset: stock.get(p.date)! / assetStart * 100, benchmark: p.close / benchmarkStart * 100, ratio: (stock.get(p.date)! / p.close) / (assetStart / benchmarkStart) * 100 }));
  const last = points.at(-1)!;
  return { ...result, available: true, start, end, points, assetReturn: last.asset - 100, benchmarkReturn: last.benchmark - 100, excessPp: last.asset - last.benchmark };
}

function weekFriday(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + (5 - day.getUTCDay()));
  return day.toISOString().slice(0, 10);
}
export function rotationState(x: number, y: number): RotationState {
  if (Math.abs(x - 100) < 1e-8 || Math.abs(y - 100) < 1e-8) return 'neutral';
  return x > 100 ? y > 100 ? 'leading' : 'weakening' : y > 100 ? 'improving' : 'lagging';
}

/** Transparent 10/4-week normalization, not proprietary JdK RRG. */
export function rotationTrail(asset: RotationHistory | undefined, benchmark: RotationHistory | undefined, completedWeek: string): RotationPoint[] {
  const stocks = new Map(validPoints(asset).map(p => [p.date, p.close]));
  const weekly = new Map<string, RotationPrice>();
  for (const point of validPoints(benchmark)) {
    const week = weekFriday(point.date);
    if (week <= completedWeek) weekly.set(week, point);
  }
  const weeks = [...weekly.values()];
  const ratios = weeks.map(p => stocks.has(p.date) ? stocks.get(p.date)! / p.close : null);
  const levels = ratios.map((r, i) => {
    if (r == null || i < 9) return null;
    const window = ratios.slice(i - 9, i + 1);
    if (window.some(value => value == null)) return null;
    return r / ((window as number[]).reduce((a, b) => a + b, 0) / 10) * 100;
  });
  const output = weeks.map((week, i) => {
    const level = levels[i];
    if (level == null || i < 12) return null;
    const window = levels.slice(i - 3, i + 1);
    if (window.some(value => value == null)) return null;
    const momentum = level / ((window as number[]).reduce((a, b) => a + b, 0) / 4) * 100;
    return { date: week.date, x: level, y: momentum, state: rotationState(level, momentum) };
  });
  // A gap ends a trail; do not connect across missing weeks or use an older point as today's state.
  const tail = output.slice(-12);
  const lastGap = tail.findLastIndex(point => point == null);
  return tail.slice(lastGap + 1).filter((point): point is RotationPoint => point != null);
}

export function signedPercent(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}%`;
}
export function signedPp(value: number | null): string { return value == null ? '—' : `${signedPercent(value).slice(0, -1)} 个百分点`; }

export async function fetchRotation(endpoint: string, symbols?: string[], signal?: AbortSignal): Promise<RotationPayload> {
  const response = await fetch(`${endpoint}${symbols?.length ? `?symbols=${encodeURIComponent(symbols.join(','))}` : ''}`, { cache: 'no-store', signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `行情读取失败（${response.status}）`);
  if (body.version !== 1 || body.benchmark !== 'SPY' || body.price_basis !== 'split_and_dividend_adjusted' || !body.series) throw new Error('相对强度数据格式不匹配');
  return body;
}
