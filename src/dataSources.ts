// 设置页的「数据状态」：每一样数据跑在哪、最后什么时候更新。服务器算好，网页只读。
export interface DataSourceRow {
  key: string;
  name: string;
  location: 'mac' | 'server' | string;
  updatedAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
  applicable?: boolean;
  note?: string;
  ready?: boolean;
  reason?: string | null;
}
export interface DataSourceStatus {
  generatedAt: string | null;
  macAlive: boolean;
  sources: DataSourceRow[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseDataSources(body: unknown): DataSourceStatus {
  const status = record(record(body).status);
  const rows = Array.isArray(status.sources) ? status.sources : [];
  return {
    generatedAt: typeof status.generated_at === 'string' ? status.generated_at : null,
    macAlive: status.macAlive === true,
    sources: rows.map((raw) => {
      const item = record(raw);
      const age = typeof item.ageMinutes === 'number' && Number.isFinite(item.ageMinutes) ? item.ageMinutes : null;
      return {
        key: String(item.key || ''),
        name: String(item.name || ''),
        location: String(item.location || ''),
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
        ageMinutes: age,
        stale: item.stale === true,
        applicable: item.applicable === false ? false : undefined,
        note: typeof item.note === 'string' ? item.note : undefined,
        ready: typeof item.ready === 'boolean' ? item.ready : undefined,
        reason: typeof item.reason === 'string' ? item.reason : null,
      };
    }),
  };
}

export async function fetchDataSources(endpoint: string, signal?: AbortSignal): Promise<DataSourceStatus> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`数据状态读取失败（HTTP ${response.status}）`);
  return parseDataSources(await response.json());
}

export function locationText(location: string): string {
  if (location === 'mac') return '本机（Mac）';
  if (location === 'server') return '服务器';
  return '未知';
}

export function sourceAgeText(row: Pick<DataSourceRow, 'ageMinutes' | 'stale' | 'applicable'>): string {
  if (row.applicable === false) return '现在不用';
  if (row.ageMinutes === null) return row.stale ? '从未' : '服务器实时取数';
  const text = row.ageMinutes < 60
    ? `${row.ageMinutes} 分钟前`
    : `${Math.round(row.ageMinutes / 60)} 小时前`;
  return row.stale ? `${text} · 已过期` : text;
}
