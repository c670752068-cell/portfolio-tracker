import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyInbox, ingestSignals, readInbox, SIGNAL_INBOX_KEY } from './signalInbox';
import type { QuantChannelAlert } from './types';

export function useSignalInbox() {
  const [inbox, setInbox] = useState(() => {
    try { return readInbox(typeof window === 'undefined' ? null : window.localStorage.getItem(SIGNAL_INBOX_KEY)); }
    catch { return emptyInbox(); }
  });
  const current = useRef(inbox);
  const [batch, setBatch] = useState<string[]>([]);
  const ingest = useCallback((alerts: Record<string, QuantChannelAlert>) => {
    const result = ingestSignals(current.current, alerts);
    current.current = result.inbox; setInbox(result.inbox);
    if (result.added.length) setBatch(result.added.map(e => e.id));
  }, []);
  const markRead = useCallback((ids: string[]) => {
    const next = { ...current.current, unread: current.current.unread.filter(e => !ids.includes(e.id)) };
    current.current = next; setInbox(next);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(SIGNAL_INBOX_KEY, JSON.stringify(inbox)); } catch { /* Private browsing still works in memory. */ }
  }, [inbox]);
  return { inbox, batch, ingest, markRead };
}
