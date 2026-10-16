import { readFile } from 'node:fs/promises';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const DEFAULT_MAX_EXPORT_AGE_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ANALYSIS_PATH = '/api/portfolio/quant-analysis';

function assertRecentTimestamp(value, now, maxExportAgeMs, label) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const age = nowMs - timestamp;
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)
      || age > maxExportAgeMs || age < -MAX_CLOCK_SKEW_MS) {
    throw new Error(`NDX fallback refused: ${label} site_export is not recent`);
  }
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : Number.NaN;
}

export function mergeFreshNdxCard(onlineSnapshot, localSnapshot, {
  now = new Date(),
  maxExportAgeMs = DEFAULT_MAX_EXPORT_AGE_MS,
} = {}) {
  if (!isRecord(onlineSnapshot?.valuation_tab) || !isRecord(localSnapshot?.valuation_tab?.ndx)) {
    throw new Error('NDX fallback snapshot structure is invalid');
  }
  assertRecentTimestamp(localSnapshot.generated_at, now, maxExportAgeMs, 'top-level');
  assertRecentTimestamp(localSnapshot.valuation_tab.generated_at, now, maxExportAgeMs, 'valuation');
  if (localSnapshot.valuation_tab.ndx.available !== true) {
    throw new Error('NDX fallback refused: local card is unavailable');
  }
  if (localSnapshot.valuation_tab.ndx.stale === true) {
    throw new Error('NDX fallback refused: local card is stale');
  }
  if (localSnapshot.valuation_tab.ndx.stale !== false) {
    throw new Error('NDX fallback refused: local card stale state is unknown');
  }
  const staleDays = localSnapshot.valuation_tab.ndx.stale_days;
  if (localSnapshot.valuation_tab.ndx.gate_available !== true
      || staleDays !== 0) {
    throw new Error('NDX fallback refused: local card freshness is unavailable');
  }
  const localAsOf = parseDateOnly(localSnapshot.valuation_tab.ndx.as_of);
  if (!Number.isFinite(localAsOf)) {
    throw new Error('NDX fallback refused: local as_of is invalid');
  }
  const currentPe = localSnapshot.valuation_tab.ndx.current_pe;
  if (typeof currentPe !== 'number' || !Number.isFinite(currentPe) || currentPe <= 0) {
    throw new Error('NDX fallback refused: local current_pe is invalid');
  }
  const onlineAsOf = parseDateOnly(onlineSnapshot.valuation_tab.ndx?.as_of);
  if (Number.isFinite(onlineAsOf) && localAsOf <= onlineAsOf) {
    throw new Error('NDX fallback refused: local as_of is not newer than production');
  }
  return {
    ...onlineSnapshot,
    valuation_tab: {
      ...onlineSnapshot.valuation_tab,
      ndx: structuredClone(localSnapshot.valuation_tab.ndx),
    },
  };
}

function assertAnalysisEnvelope(snapshot, label) {
  const symbolsValid = isRecord(snapshot?.symbols);
  const generatedAtValid = typeof snapshot?.generated_at === 'string'
    && Number.isFinite(Date.parse(snapshot.generated_at));
  if (snapshot?.source !== 'futu-assistant' || typeof snapshot?.rule_version !== 'string'
      || !symbolsValid || !generatedAtValid || !isRecord(snapshot?.valuation_tab)) {
    throw new Error(`NDX fallback refused: ${label} quant-analysis envelope is invalid`);
  }
}

async function responseError(response) {
  try {
    const detail = (await response.text()).trim().slice(0, 300);
    return detail ? `: ${detail}` : '';
  } catch {
    return '';
  }
}

async function getProductionSnapshot(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`NDX fallback GET failed: HTTP ${response.status}${await responseError(response)}`);
  }
  let snapshot;
  try {
    snapshot = await response.json();
  } catch {
    throw new Error('NDX fallback refused: production quant-analysis is not valid JSON');
  }
  assertAnalysisEnvelope(snapshot, 'production');
  return snapshot;
}

export async function publishFreshNdxFallback({
  origin,
  token,
  exportPath,
  fetchImpl = fetch,
  now = new Date(),
  maxExportAgeMs = DEFAULT_MAX_EXPORT_AGE_MS,
}) {
  if (typeof origin !== 'string' || !origin.trim() || typeof token !== 'string' || !token.trim()) {
    throw new Error('NDX fallback configuration is invalid');
  }
  let localSnapshot;
  try {
    localSnapshot = JSON.parse(await readFile(exportPath, 'utf8'));
  } catch (error) {
    throw new Error(`NDX fallback site_export read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertAnalysisEnvelope(localSnapshot, 'local');
  const url = `${origin.replace(/\/+$/, '')}${ANALYSIS_PATH}`;

  const initiallyOnline = await getProductionSnapshot(url, token, fetchImpl);
  mergeFreshNdxCard(initiallyOnline, localSnapshot, { now, maxExportAgeMs });

  // Rebase as late as possible so a concurrent full refresh is not overwritten
  // by fields copied from the first GET.
  const latestOnline = await getProductionSnapshot(url, token, fetchImpl);
  const merged = mergeFreshNdxCard(latestOnline, localSnapshot, { now, maxExportAgeMs });
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(merged),
  });
  if (!response.ok) {
    throw new Error(`NDX fallback POST failed: HTTP ${response.status}${await responseError(response)}`);
  }
  return {
    published: true,
    asOf: localSnapshot.valuation_tab.ndx.as_of,
    productionGeneratedAt: latestOnline.generated_at,
  };
}
