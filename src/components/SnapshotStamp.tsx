import { dateText } from '../format';
import type { QuantAnalysisSnapshot } from '../types';

export function SnapshotStamp({ snapshot }: { snapshot: QuantAnalysisSnapshot }) {
  return (
    <p className="mt-1 text-[11px] tabular-nums text-ink-muted">
      统一量化快照 {dateText(snapshot.generated_at)}
    </p>
  );
}
