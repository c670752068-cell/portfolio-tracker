const MODEL = 'ma200_20d_annualized';
const ROLE = 'trend_context_only';
const FORMULA = '(MA200_t / MA200_t-20 - 1) × 252 / 20 × 100';
const DATA_SOURCE = 'Yahoo Finance adjusted daily';
const MA_PERIOD = 200;
const CHANGE_WINDOW = 20;
const ANNUALIZATION = 252;
const REQUIRED_BARS = MA_PERIOD + CHANGE_WINDOW;
const DASHBOARD_MA_PERIODS = [20, 50, 200];
const DASHBOARD_DEFAULT_SLOPE_WINDOW = 8;
const DASHBOARD_BAND_SIGMA = 1.5;
const DASHBOARD_CHANNEL_NEAR_SIGMA = 1.25;
const DASHBOARD_Z_SCORE_PERIOD = 200;
const DASHBOARD_RANGES = new Set(['1y', '3y', '5y', '10y', '20y']);
const DASHBOARD_FETCH_RANGE = {
  '1y': '2y', '3y': '5y', '5y': '10y', '10y': 'max', '20y': 'max',
};

const INDEX_SYMBOLS = new Map([
  ['NDX', '^NDX'],
  ['SPX', '^GSPC'],
  ['SOX', '^SOX'],
]);

export function normalizeSlopeQuerySymbol(value) {
  const symbol = String(value ?? '').trim().toUpperCase();
  if (!/^\^?[A-Z][A-Z0-9.-]{0,10}$/.test(symbol)) {
    throw new Error('股票代码格式不正确，请输入 1–11 位美股或指数代码');
  }
  return symbol;
}

export function buildYahooSlopeChartUrl(value, requestedRange = '2y') {
  const normalized = normalizeSlopeQuerySymbol(value);
  const mapped = INDEX_SYMBOLS.get(normalized) ?? normalized.replaceAll('.', '-');
  const symbol = encodeURIComponent(mapped);
  const range = DASHBOARD_FETCH_RANGE[requestedRange] ?? requestedRange;
  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${encodeURIComponent(range)}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
}

export function normalizeSlopeDashboardRange(value) {
  const range = String(value ?? '').trim().toLowerCase();
  if (!DASHBOARD_RANGES.has(range)) throw new Error('图表周期只支持 1y、3y、5y、10y、20y');
  return range;
}

export function normalizeSlopeWindow(value) {
  const window = Number(value);
  if (!Number.isInteger(window) || window < 1 || window > 30) {
    throw new Error('斜率回看必须是 1–30 个交易日');
  }
  return window;
}

export function parseYahooSlopeHistory(value, payload, options = {}) {
  const symbol = normalizeSlopeQuerySymbol(value);
  const now = options.now instanceof Date ? options.now : new Date();
  const points = closedAdjustedPoints(payload, now);
  if (points.length < REQUIRED_BARS) return unavailable(symbol, points);
  const movingAverages = rollingAverage(points, MA_PERIOD);
  const series = slopeSeries(movingAverages);
  const current = movingAverages.at(-1);
  const comparison = movingAverages.at(-1 - CHANGE_WINDOW);
  if (!current || !comparison || comparison.value === 0) {
    return unavailable(symbol, points, '20个交易日前的200日均线为零，斜率无法计算');
  }
  const annualized = annualizedSlope(current.value, comparison.value);
  const classification = classifySlope(annualized);
  return {
    ...common(symbol),
    available: true,
    annualized_pct: rounded(annualized),
    current_ma: rounded(current.value),
    comparison_ma: rounded(comparison.value),
    ...classification,
    as_of: current.date,
    observed_bars: points.length,
    required_bars: REQUIRED_BARS,
    series,
    reason: `200日均线斜率为 ${signed(annualized)}%，属于${classification.label}；仅作趋势查看，不影响回撤买入判定。`,
  };
}

export function parseYahooSlopeDashboard(value, payload, options = {}) {
  const symbol = normalizeSlopeQuerySymbol(value);
  const range = normalizeSlopeDashboardRange(options.range ?? '5y');
  const slopeWindow = normalizeSlopeWindow(
    options.slopeWindow ?? DASHBOARD_DEFAULT_SLOPE_WINDOW,
  );
  const maPeriods = normalizeMaPeriods(options.maPeriods ?? DASHBOARD_MA_PERIODS);
  const now = options.now instanceof Date ? options.now : new Date();
  const points = closedRawPoints(payload, now);
  const averages = new Map(maPeriods.map((period) => [period, rollingValues(points, period)]));
  const standardDeviations = rollingStandardDeviation(points, DASHBOARD_Z_SCORE_PERIOD);
  const series = dashboardSeries(
    points, averages, maPeriods, slopeWindow, standardDeviations,
  );
  const visibleSeries = series.filter((point) => point.date >= rangeStartDate(now, range));
  const latest = series.at(-1);
  const latestClosed = series.findLast((point) => !point.is_partial);
  const required = Math.max(...maPeriods) + slopeWindow;
  const available = points.length >= required && visibleSeries.length > 0;
  const latestStatus = latest?.is_partial ? 'intraday' : 'closed';
  const freshness = latest?.is_partial
    ? `已显示${monthDayText(latest.date)}盘中数据；${monthDayText(latestClosed?.date)}为最新完整收盘。`
    : latest
      ? `已显示${monthDayText(latest.date)}完整收盘数据。`
      : '';
  return {
    symbol,
    available,
    decision_use: false,
    buy_veto: false,
    query_source: 'custom_dashboard',
    data_source: 'Yahoo Finance raw daily OHLC',
    price_adjustment: 'raw',
    as_of: latest?.date ?? null,
    required_bars: required,
    observed_bars: points.length,
    reason: available
      ? `${freshness}按旧版 K 线仪表盘原公式展示价格、移动均线和多条斜率曲线；只供查看，不进入买入裁决。`
      : `完整斜率曲线至少需要 ${required} 个已收盘交易日，当前只有 ${points.length} 个。`,
    dashboard: {
      range,
      slope_window_sessions: slopeWindow,
      slope_unit: 'pct_per_day',
      ma_periods: maPeriods,
      band_sigma: DASHBOARD_BAND_SIGMA,
      z_score_period: DASHBOARD_Z_SCORE_PERIOD,
      latest_bar_status: latestStatus,
      latest_closed_as_of: latestClosed?.date ?? null,
      channel_alert: buildChannelAlert(latestClosed),
      summary: technicalSummary(latest),
      series: visibleSeries,
    },
  };
}

export function buildChannelAlert(point) {
  const close = finitePositive(point?.close);
  const zScore = Number(point?.zscore200);
  const band = Array.isArray(point?.band200) ? point.band200 : [];
  const lowerBand = finitePositive(band[0]);
  const upperBand = finitePositive(band[1]);
  if (
    !point?.date || close === null || lowerBand === null || upperBand === null
    || !Number.isFinite(zScore)
  ) {
    return {
      available: false,
      state: 'insufficient',
      signal: 'neutral',
      label: '数据不足',
      as_of: point?.date ?? null,
      complete_close: true,
      decision_use: false,
      buy_veto: false,
      reason: '至少需要 200 个完整收盘价才能判断通道位置。',
    };
  }
  let state = 'neutral';
  let signal = 'neutral';
  let label = '通道内';
  let reason = '收盘价位于通道内部，暂不提示买入或卖出。';
  if (zScore >= DASHBOARD_BAND_SIGMA) {
    state = 'sell'; signal = 'sell'; label = '可以卖';
    reason = '完整收盘价已经突破通道上轨，进入卖出阶段。';
  } else if (zScore >= DASHBOARD_CHANNEL_NEAR_SIGMA) {
    state = 'sell_near'; signal = 'sell'; label = '接近卖';
    reason = '完整收盘价已接近通道上轨，进入卖出观察区。';
  } else if (zScore <= -DASHBOARD_BAND_SIGMA) {
    state = 'buy'; signal = 'buy'; label = '可以买';
    reason = '完整收盘价已经跌破通道下轨，进入白色区域和买入阶段。';
  } else if (zScore <= -DASHBOARD_CHANNEL_NEAR_SIGMA) {
    state = 'buy_near'; signal = 'buy'; label = '接近买';
    reason = '完整收盘价已接近通道下轨，进入买入观察区。';
  }
  return {
    available: true,
    state,
    signal,
    label,
    as_of: point.date,
    close: rounded(close),
    lower_band: rounded(lowerBand),
    upper_band: rounded(upperBand),
    z_score: rounded(zScore),
    near_sigma: DASHBOARD_CHANNEL_NEAR_SIGMA,
    boundary_sigma: DASHBOARD_BAND_SIGMA,
    complete_close: true,
    decision_use: false,
    buy_veto: false,
    reason,
  };
}

function common(symbol) {
  return {
    symbol,
    model: MODEL,
    role: ROLE,
    buy_veto: false,
    decision_use: false,
    query_source: 'custom',
    ma_period: MA_PERIOD,
    change_window_sessions: CHANGE_WINDOW,
    annualization_sessions: ANNUALIZATION,
    price_adjustment: 'adjusted',
    data_source: DATA_SOURCE,
    formula: FORMULA,
  };
}

function unavailable(symbol, points, detail) {
  const observed = points.length;
  const reason = detail
    ? `${detail}；不影响回撤买入判定。`
    : `斜率数据不足：至少需要 ${REQUIRED_BARS} 个已收盘交易日，当前只有 ${observed} 个；不影响回撤买入判定。`;
  return {
    ...common(symbol),
    available: false,
    annualized_pct: null,
    current_ma: null,
    comparison_ma: null,
    direction: null,
    regime: null,
    label: detail ? '数据异常' : '数据不足',
    as_of: points.at(-1)?.date ?? null,
    required_bars: REQUIRED_BARS,
    observed_bars: observed,
    series: [],
    reason,
  };
}

function closedAdjustedPoints(payload, now) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  const closes = Array.isArray(adjusted) ? adjusted : result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return [];
  const today = newYorkDate(now);
  return timestamps.flatMap((timestamp, index) => {
    const value = Number(closes[index]);
    const date = newYorkDate(new Date(Number(timestamp) * 1000));
    if (!Number.isFinite(value) || value <= 0 || !date || date === today) return [];
    return [{ date, value }];
  });
}

function closedRawPoints(payload, now) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0];
  const closes = quote?.close;
  if (!Array.isArray(closes)) return [];
  const today = newYorkDate(now);
  const regularEnd = Number(result?.meta?.currentTradingPeriod?.regular?.end);
  const isRegularSessionOpen = Number.isFinite(regularEnd)
    ? now.getTime() < regularEnd * 1000
    : true;
  return timestamps.flatMap((timestamp, index) => {
    const date = newYorkDate(new Date(Number(timestamp) * 1000));
    const close = finitePositive(closes[index]);
    if (!date || close === null) return [];
    return [{
      date,
      open: finitePositive(quote?.open?.[index]),
      high: finitePositive(quote?.high?.[index]),
      low: finitePositive(quote?.low?.[index]),
      close,
      volume: finiteNonNegative(quote?.volume?.[index]),
      is_partial: date === today && isRegularSessionOpen,
    }];
  });
}

function rollingAverage(points, period) {
  const result = [];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    total += points[index].value;
    if (index >= period) total -= points[index - period].value;
    if (index >= period - 1) result.push({ date: points[index].date, value: total / period });
  }
  return result;
}

function rollingValues(points, period) {
  const values = Array(points.length).fill(null);
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    total += points[index].close;
    if (index >= period) total -= points[index - period].close;
    if (index >= period - 1) values[index] = total / period;
  }
  return values;
}

function rollingStandardDeviation(points, period) {
  const values = Array(points.length).fill(null);
  let total = 0;
  let totalSquares = 0;
  for (let index = 0; index < points.length; index += 1) {
    const value = points[index].close;
    total += value;
    totalSquares += value * value;
    if (index >= period) {
      const previous = points[index - period].close;
      total -= previous;
      totalSquares -= previous * previous;
    }
    if (index >= period - 1) {
      const variance = Math.max(0, (totalSquares - (total * total) / period) / (period - 1));
      values[index] = Math.sqrt(variance);
    }
  }
  return values;
}

function dashboardSeries(points, averages, maPeriods, slopeWindow, standardDeviations) {
  return points.map((point, index) => {
    const row = { ...point };
    for (const period of maPeriods) {
      const values = averages.get(period);
      const current = values[index];
      const comparison = values[index - slopeWindow];
      row[`ma${period}`] = current === null ? null : rounded(current);
      row[`slope${period}`] = current === null || comparison == null || comparison === 0
        ? null
        : rounded((current / comparison - 1) * 100 / slopeWindow);
    }
    const ma200 = row.ma200;
    const standardDeviation = standardDeviations[index];
    if (ma200 == null || standardDeviation == null || standardDeviation === 0) {
      row.std200 = standardDeviation == null ? null : rounded(standardDeviation);
      row.band200 = null;
      row.zscore200 = null;
    } else {
      row.std200 = rounded(standardDeviation);
      row.band200 = [
        rounded(ma200 - DASHBOARD_BAND_SIGMA * standardDeviation),
        rounded(ma200 + DASHBOARD_BAND_SIGMA * standardDeviation),
      ];
      row.zscore200 = rounded((point.close - ma200) / standardDeviation);
    }
    return row;
  });
}

function technicalSummary(latest) {
  if (!latest) return null;
  const slope = latest.slope200 == null ? null : latest.slope200 * ANNUALIZATION;
  const trend = slope == null ? null : classifySlope(slope);
  return {
    price: rounded(latest.close),
    ma200: latest.ma200 ?? null,
    distance_to_ma200_pct: latest.ma200 == null || latest.ma200 === 0
      ? null : rounded((latest.close / latest.ma200 - 1) * 100),
    z_score: latest.zscore200 ?? null,
    z_score_band: latest.zscore200 == null ? null : zScoreBand(latest.zscore200),
    z_score_label: zScoreLabel(latest.zscore200),
    ma200_slope_annualized_pct: slope == null ? null : rounded(slope),
    ma200_trend: trend?.regime ?? null,
    ma200_trend_label: trend?.label ?? '数据不足',
  };
}

function zScoreBand(value) {
  const lower = Math.floor(value * 2) / 2;
  return `${lower.toFixed(1)} 至 ${(lower + 0.5).toFixed(1)}`;
}

function zScoreLabel(value) {
  if (value == null) return '数据不足';
  if (value >= 1.5) return '显著高于长期趋势';
  if (value >= 1) return '偏高';
  if (value > -1) return '中性';
  if (value > -1.5) return '偏低';
  return '显著低于长期趋势';
}

function slopeSeries(movingAverages) {
  return movingAverages.slice(CHANGE_WINDOW).map((point, index) => ({
    date: point.date,
    annualized_pct: rounded(annualizedSlope(point.value, movingAverages[index].value)),
  })).slice(-260);
}

function annualizedSlope(current, comparison) {
  return (current / comparison - 1) * ANNUALIZATION / CHANGE_WINDOW * 100;
}

function normalizeMaPeriods(values) {
  const periods = [...new Set(values.map(Number))].sort((left, right) => left - right);
  if (periods.length === 0 || periods.length > 5
    || periods.some((period) => !Number.isInteger(period) || period < 2 || period > 400)) {
    throw new Error('移动均线周期不合法');
  }
  return periods;
}

function rangeStartDate(now, range) {
  const years = Number.parseInt(range, 10);
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  return newYorkDate(start);
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function classifySlope(value) {
  if (value > 10) return { direction: 'up', regime: 'strong_up', label: '强势上涨' };
  if (value > 0) return { direction: 'up', regime: 'weak_up', label: '弱势上涨' };
  if (value > -10) return { direction: 'down', regime: 'weak_down', label: '弱势下跌' };
  return { direction: 'down', regime: 'strong_down', label: '强势下跌' };
}

function newYorkDate(date) {
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthDayText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return '最新日期';
  return `${Number(match[2])}月${Number(match[3])}日`;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function signed(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
