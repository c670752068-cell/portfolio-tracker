// 提醒效果：服务器每天收盘后算好存盘，网页只读。这里只做解析和显示格式化。
// 分类名（label）跟着统计一起从服务器来，网页不另写一份。
export interface OutcomeHorizons { d1: number | null; d5: number | null; d20: number | null }
export interface AlertOutcome {
  kind: string;
  symbol: string;
  base_date: string;
  base_close: number;
  backfilled: boolean;
  pending: boolean;
  changes: OutcomeHorizons;
  benchmark: OutcomeHorizons;
  excess: OutcomeHorizons;
}
export interface OutcomeSummaryGroup {
  kind: string;
  label: string;
  samples: number;
  pending: number;
  backfilled: number;
  avg: { d5: number | null; d20: number | null };
  excess: { d5: number | null; d20: number | null };
  winRate: number | null;
  reliable: boolean;
  note: string;
  /** 这一类看的就是 QQQ 自己，「对 QQQ 超额」没有意义，显示「—」。 */
  selfBenchmark?: boolean;
}
export interface AlertOutcomesPayload {
  updated_at: string | null;
  outcomes: Record<string, AlertOutcome>;
  summary: OutcomeSummaryGroup[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseAlertOutcomes(body: unknown): AlertOutcomesPayload {
  const store = record(record(body).outcomes);
  return {
    updated_at: typeof store.updated_at === 'string' ? store.updated_at : null,
    outcomes: record(store.outcomes) as Record<string, AlertOutcome>,
    summary: Array.isArray(store.summary) ? store.summary as OutcomeSummaryGroup[] : [],
  };
}

export async function fetchAlertOutcomes(endpoint: string, signal?: AbortSignal): Promise<AlertOutcomesPayload> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`提醒效果读取失败（HTTP ${response.status}）`);
  return parseAlertOutcomes(await response.json());
}

/** 还没到时间的写「待定」，不写 0。 */
export function horizonText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '待定';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function winRateText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '暂无';
  return `${(value * 100).toFixed(1)}%`;
}

export interface OutcomeSummaryRow extends OutcomeSummaryGroup {
  backfilledNote: string;
}

/** 次数多的排前面；回填的条数单独标注。 */
export function outcomeSummaryRows(summary: readonly OutcomeSummaryGroup[]): OutcomeSummaryRow[] {
  return [...summary]
    .sort((left, right) => right.samples - left.samples)
    .map((group) => ({
      ...group,
      backfilledNote: group.backfilled > 0 ? `含 ${group.backfilled} 条回填` : '',
    }));
}
