import { dateText } from '../format';
import type { QuantAnalysisSnapshot } from '../types';

export function SnapshotStamp({ snapshot }: { snapshot: QuantAnalysisSnapshot }) {
  return (
    <p className="mt-0.5 text-[9px] tabular-nums text-ink-muted sm:mt-1 sm:text-[11px]">
      统一量化快照 {dateText(snapshot.generated_at)} · 非各项数据更新时间
    </p>
  );
}
