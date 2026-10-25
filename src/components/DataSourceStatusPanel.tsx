import { locationText, sourceAgeText, type DataSourceStatus } from '../dataSources';

const OPEND_REASON = {
  not_configured: '未配置',
  connect_refused: '连不上',
  need_verify_code: '要输验证码',
  login_expired: '登录失效',
} as const;

/** 设置页的「数据状态」：每一样数据跑在哪、最后什么时候更新。只读。 */
export function DataSourceStatusPanel({ status }: { status: DataSourceStatus | null }) {
  if (!status) {
    return <p className="text-xs text-ink-muted">数据状态读取中…</p>;
  }
  return (
    <div data-data-sources="true" className="space-y-2">
      {!status.macAlive && (
        <p className="rounded-lg bg-loss/10 px-2 py-1.5 text-[11px] font-semibold text-loss">
          Mac 上的推送已经停了：持仓、净值和量化快照会停在最后一次推送的时间，服务器自己取的那几项照常。
        </p>
      )}
      <ul className="space-y-1">
        {status.sources.map((row) => (
          <li key={row.key} data-data-source={row.key} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate">
              {row.name}
              <span className="ml-1 text-ink-muted">· {locationText(row.location)}</span>
            </span>
            <span className={`shrink-0 tabular-nums ${row.stale ? 'font-semibold text-loss' : 'text-ink-secondary'}`}>
              {row.key === 'server_opend'
                ? OPEND_REASON[(row.reason || 'not_configured') as keyof typeof OPEND_REASON] || row.reason
                : sourceAgeText(row)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-ink-muted">
        「服务器」那几项 Mac 关机也照常；「本机（Mac）」那几项要 Mac 开着并联网。
      </p>
    </div>
  );
}
