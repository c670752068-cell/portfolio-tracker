export type PrivateDataGateState = 'ready' | 'loading' | 'error';

export function privateDataGateState({
  serverSyncRequired,
  pushedAt,
  loading,
  error,
}: {
  serverSyncRequired: boolean;
  pushedAt: string | null;
  loading: boolean;
  error: string;
}): PrivateDataGateState {
  if (!serverSyncRequired || pushedAt) return 'ready';
  if (loading) return 'loading';
  if (error) return 'error';
  return 'loading';
}
