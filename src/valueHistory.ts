const VALUE_HISTORY_KEY = 'portfolio-tracker:value-history-v1';

export interface ValuePoint {
  date: string;
  totalValueUsd: number;
}

export function recordDailyValue(
  history: ValuePoint[],
  date: string,
  totalValueUsd: number,
): ValuePoint[] {
  const byDate = new Map(history.map((point) => [point.date, point]));
  byDate.set(date, { date, totalValueUsd });
  return [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-365);
}

export function loadValueHistory(): ValuePoint[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(VALUE_HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValuePoint).sort((left, right) => left.date.localeCompare(right.date)).slice(-365);
  } catch {
    return [];
  }
}

export function saveValueHistory(history: ValuePoint[]): void {
  localStorage.setItem(VALUE_HISTORY_KEY, JSON.stringify(history));
}

function isValuePoint(value: unknown): value is ValuePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<ValuePoint>;
  return typeof point.date === 'string' && typeof point.totalValueUsd === 'number' && Number.isFinite(point.totalValueUsd);
}
