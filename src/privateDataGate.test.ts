import { describe, expect, it } from 'vitest';
import { privateDataGateState } from './privateDataGate';

describe('privateDataGateState', () => {
  it('loads public server snapshots without requiring a viewer token', () => {
    expect(privateDataGateState({ serverSyncRequired: true, pushedAt: null, loading: false, error: '' })).toBe('loading');
    expect(privateDataGateState({ serverSyncRequired: true, pushedAt: null, loading: true, error: '' })).toBe('loading');
    expect(privateDataGateState({ serverSyncRequired: true, pushedAt: null, loading: false, error: 'network' })).toBe('error');
  });

  it('shows private data only after a successful server snapshot or without a server gateway', () => {
    expect(privateDataGateState({ serverSyncRequired: true, pushedAt: '2026-08-11T03:00:00Z', loading: false, error: '' })).toBe('ready');
    expect(privateDataGateState({ serverSyncRequired: false, pushedAt: null, loading: false, error: '' })).toBe('ready');
  });
});
