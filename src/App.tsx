import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AllocationChart } from './components/AllocationChart';
import { AlertRulesPanel } from './components/AlertRulesPanel';
import { BehaviorMirrorCard } from './components/BehaviorMirrorCard';
import { CashEditor } from './components/CashEditor';
import { SellWindowSection } from './components/SellWindowSection';
import { SellDecisionDashboard } from './components/SellDecisionDashboard';
import { HoldingsTable } from './components/HoldingsTable';
import { ImageImportPanel } from './components/ImageImportPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SnapshotStamp } from './components/SnapshotStamp';
import { StockForwardValuationExplorer } from './components/StockForwardValuationExplorer';
import { Summary } from './components/Summary';
import { ThemeControl } from './components/ThemeControl';
import { ValuationPanel, MarketIndicators } from './components/ValuationPanel';
import { SectorRotation } from './components/SectorRotation';
import { JournalPage } from './components/JournalPage';
import { NotificationCenter } from './components/NotificationCenter';
import { ALERT_RULES_REFRESH_MS, deleteAlertRule, fetchAlertRules, saveAlertRule, type AlertRule, type AlertRuleDraft } from './alertRules';
import { fetchLatestExchangeRates, loadExchangeRates } from './exchangeRates';
import { canSyncQuotes, quoteSyncSetupHint, syncHoldingsWithQuotes } from './marketData';
import { MARKET_SESSION_REFRESH_MS, dayChangeSessionText, isRegularSession, marketSessionDateKey } from './marketSession';
import { computeMetrics } from './metrics';
import { fetchMonitoredQuotes } from './monitoredQuotes';
import { quoteSyncSessionText } from './quoteSession';
import { fetchQuantAnalysis, isQuantAnalysisStale, startQuantAnalysisAutoRefresh } from './quantAnalysis';
import { applyImageImport, applyOptionDetails, countNeedsReview, type OptionDetailsApplyResult } from './importMerge';
import { dedupeImportIssues } from './importIssues';
import { backupPortfolio, clearPortfolioBackup, loadPortfolio, loadPortfolioBackup, loadSettings, savePortfolio, saveSettings } from './storage';
import { applyQuantHoldingCosts, applyQuantSync, fetchQuantPositions, isQuantSnapshotStale, mapQuantPositions } from './quantSync';
import { privateDataGateState, type PrivateDataGateState } from './privateDataGate';
import {
  ONE_TAP_REFRESH_COOLDOWN_MS,
  oneTapRefreshCooldownSeconds,
  readOneTapRefresh,
  requestOneTapRefresh,
  runOneTapRefresh,
  type OneTapRefreshState,
} from './oneTapRefresh';
import { getServerAlertRulesUrl, getServerPortfolioPositionsUrl, getServerQuantAnalysisUrl, getServerQuoteProxyUrl, getServerRefreshRequestUrl, hasServerGateway } from './runtimeConfig';
import type { AppSettings, CashPosition, DisplayCurrency, ExchangeRates, Holding, ImportedPortfolio, ParsedOptionDetails, PortfolioState, QuantAnalysisSnapshot, QuoteSnapshot } from './types';
import { loadValueHistory, recordDailyValue, saveValueHistory, type ValuePoint } from './valueHistory';
import './App.css';

type Tab = 'dashboard' | 'rotation' | 'valuation' | 'calculator' | 'journal' | 'settings';
type QuoteRefreshReason = 'manual' | 'daily' | 'session';

const DAILY_QUOTE_SYNC_KEY = 'portfolio-tracker:daily-quote-sync-key-v1';
const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const SESSION_CLOCK_REFRESH_MS = 60 * 1000;

interface QuoteStatus {
  loading: boolean;
  lastSyncedAt: string | null;
  error: string;
  summary: string;
}

interface QuantStatus {
  loading: boolean;
  asOf: string | null;
  pushedAt: string | null;
  stale: boolean;
  error: string;
  summary: string;
}

interface QuantAnalysisStatus {
  loading: boolean;
  error: string;
  stale: boolean;
}

interface AlertRulesStatus {
  loading: boolean;
  error: string;
}

type ImportNotice =
  | { mode: 'full'; result: ImportedPortfolio }
  | { mode: 'option'; result: OptionDetailsApplyResult };

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getBeijingDateParts(date: Date): { date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
  };
}

function buildDailyQuoteSyncKey(targetDate: string, holdings: Holding[], settings: AppSettings): string {
  const symbols = holdings
    .map((holding) => (holding.assetType === 'option' ? holding.option?.underlying || holding.symbol : holding.symbol))
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(',');
  return `${targetDate}|${settings.quoteProvider}|${symbols}`;
}

export default function App() {
  const [portfolio, setPortfolio] = useState<PortfolioState>(() => loadPortfolio());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [rates, setRates] = useState<ExchangeRates>(() => loadExchangeRates());
  const [valueHistory, setValueHistory] = useState<ValuePoint[]>(() => loadValueHistory());
  const [rateError, setRateError] = useState<string>('');
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>({
    loading: false,
    lastSyncedAt: null,
    error: '',
    summary: '',
  });
  const [quantStatus, setQuantStatus] = useState<QuantStatus>({
    loading: false,
    asOf: null,
    pushedAt: null,
    stale: false,
    error: '',
    summary: '',
  });
  const [quantAnalysis, setQuantAnalysis] = useState<QuantAnalysisSnapshot | null>(null);
  const [monitoredQuotes, setMonitoredQuotes] = useState<Map<string, number | QuoteSnapshot>>(() => new Map());
  const [quantAnalysisStatus, setQuantAnalysisStatus] = useState<QuantAnalysisStatus>({ loading: false, error: '', stale: false });
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertRulesStatus, setAlertRulesStatus] = useState<AlertRulesStatus>({ loading: false, error: '' });
  const [oneTapRefreshState, setOneTapRefreshState] = useState<OneTapRefreshState>({ phase: 'idle', message: '' });
  const [oneTapCooldownSeconds, setOneTapCooldownSeconds] = useState(0);
  const [lastImport, setLastImport] = useState<ImportNotice | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [decisionSymbol, setDecisionSymbol] = useState<string | undefined>();
  const [sellFamily, setSellFamily] = useState('NVDA');
  const [, setValuationEditorDirty] = useState(false);
  const [marketNow, setMarketNow] = useState(() => new Date());
  const holdingsRef = useRef(portfolio.holdings);
  const portfolioRef = useRef(portfolio);
  const quantAnalysisRef = useRef<QuantAnalysisSnapshot | null>(null);
  const quoteRefreshInFlightRef = useRef(false);
  const quantAutoSyncKeyRef = useRef('');
  const quantAnalysisAutoLoadKeyRef = useRef('');
  const alertRulesAutoLoadKeyRef = useRef('');
  const oneTapRequestedAtRef = useRef(0);
  const oneTapRefreshInFlightRef = useRef(false);

  useEffect(() => {
    savePortfolio(portfolio);
    holdingsRef.current = portfolio.holdings;
    portfolioRef.current = portfolio;
  }, [portfolio]);

  useEffect(() => {
    let active = true;
    fetchLatestExchangeRates()
      .then((next) => {
        if (active) {
          setRates(next);
          setRateError('');
        }
      })
      .catch(() => {
        if (active) setRateError('暂未取得实时汇率，当前使用本地缓存或近似值。');
      });
    return () => { active = false; };
  }, []);

  const refreshQuotes = useCallback(async (reason: QuoteRefreshReason = 'manual', dailySyncKey?: string, dailyTargetDate?: string) => {
    if (quoteRefreshInFlightRef.current) return;
    const currentHoldings = holdingsRef.current;
    if (currentHoldings.length === 0) {
      setQuoteStatus((status) => ({ ...status, error: '', summary: '暂无持仓可同步。' }));
      return;
    }
    const setupHint = quoteSyncSetupHint(settings);
    if (setupHint) {
      setQuoteStatus((status) => ({ ...status, loading: false, error: setupHint, summary: '' }));
      return;
    }
    quoteRefreshInFlightRef.current = true;
    setQuoteStatus((status) => ({ ...status, loading: true, error: '' }));
    try {
      const result = await syncHoldingsWithQuotes(currentHoldings, settings);
      const updatedById = new Map(result.holdings.map((holding) => [holding.id, holding]));
      setPortfolio((current) => ({
        ...current,
        holdings: current.holdings.map((holding) => updatedById.get(holding.id) ?? holding),
        updatedAt: result.updatedAt,
      }));
      const failedText = result.failedSymbols.length > 0 ? `，${result.failedSymbols.length} 个失败` : '';
      const skippedText = result.skippedSymbols.length > 0
        ? `，${result.skippedSymbols.length} 个跳过（非标准代码/缺标的）`
        : '';
      const optionText = result.deltaEstimatedCount > 0
        ? `，期权 ${result.deltaEstimatedCount} 个已按 Delta 估算`
        : '';
      if (reason !== 'manual') {
        const nextDailySyncKey = dailySyncKey ?? buildDailyQuoteSyncKey(marketSessionDateKey(new Date()), currentHoldings, settings);
        localStorage.setItem(DAILY_QUOTE_SYNC_KEY, nextDailySyncKey);
      }
      const prefix = reason === 'daily'
        ? `开盘首刷（美东 ${dailyTargetDate ?? marketSessionDateKey(new Date())}）`
        : reason === 'session'
          ? '盘中自动刷新'
          : '已手动刷新';
      const sessionText = quoteSyncSessionText(result.holdings);
      setQuoteStatus({
        loading: false,
        lastSyncedAt: result.updatedAt,
        error: result.failedSymbols.length > 0 ? result.failedSymbols.map((item) => `${item.symbol}: ${item.reason}`).join('；') : '',
        summary: `${prefix} ${result.updatedSymbols.length}/${result.requestedSymbols.length} 个标的${optionText}${failedText}${skippedText}${sessionText ? ` · ${sessionText}` : ''}`,
      });
    } catch (error) {
      setQuoteStatus((status) => ({
        ...status,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      quoteRefreshInFlightRef.current = false;
    }
  }, [settings]);

  const refreshQuantPositions = useCallback(async (): Promise<boolean> => {
    const url = getServerPortfolioPositionsUrl();
    if (!url) {
      setQuantStatus((status) => ({ ...status, loading: false, error: '量化同步仅在 VPS 入口可用' }));
      return false;
    }
    setQuantStatus((status) => ({ ...status, loading: true, error: '' }));
    try {
      const snapshot = await fetchQuantPositions(url, settings.quantSyncToken.trim());
      const current = portfolioRef.current;
      const rawMapped = mapQuantPositions(snapshot.payload, current);
      const mapped = {
        ...rawMapped,
        holdings: applyQuantHoldingCosts(rawMapped.holdings, quantAnalysisRef.current?.holding_costs || {}),
      };
      const next = applyQuantSync(current, mapped);
      portfolioRef.current = next;
      setPortfolio(next);
      setQuantStatus({
        loading: false,
        asOf: snapshot.payload.as_of,
        pushedAt: snapshot.pushed_at,
        stale: isQuantSnapshotStale(snapshot.pushed_at),
        error: '',
        summary: `已同步 ${mapped.holdings.length} 个持仓、${mapped.cash.length} 个推算现金条目`,
      });
      return true;
    } catch (error) {
      setQuantStatus((status) => ({
        ...status,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }, [settings.quantSyncToken]);

  const refreshQuantAnalysis = useCallback(async (): Promise<boolean> => {
    const url = getServerQuantAnalysisUrl();
    if (!url) {
      setQuantAnalysisStatus({ loading: false, error: '量化决策数据仅在 VPS 入口可用', stale: false });
      return false;
    }
    setQuantAnalysisStatus((status) => ({ ...status, loading: true, error: '' }));
    try {
      const snapshot = await fetchQuantAnalysis(url, settings.quantSyncToken.trim());
      quantAnalysisRef.current = snapshot;
      setQuantAnalysis(snapshot);
      const current = portfolioRef.current;
      const enrichedHoldings = applyQuantHoldingCosts(current.holdings, snapshot.holding_costs || {});
      if (enrichedHoldings.some((holding, index) => holding !== current.holdings[index])) {
        const next = { ...current, holdings: enrichedHoldings, updatedAt: new Date().toISOString() };
        portfolioRef.current = next;
        setPortfolio(next);
      }
      setQuantAnalysisStatus({ loading: false, error: '', stale: isQuantAnalysisStale(snapshot.generated_at) });
      return true;
    } catch (error) {
      setQuantAnalysisStatus((status) => ({
        ...status,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }, [settings.quantSyncToken]);

  const refreshAlertRules = useCallback(async () => {
    const url = getServerAlertRulesUrl();
    if (!url) {
      setAlertRulesStatus({ loading: false, error: '目标提醒仅在 VPS 入口可用' });
      return;
    }
    setAlertRulesStatus({ loading: true, error: '' });
    try {
      setAlertRules(await fetchAlertRules(url, settings.quantSyncToken.trim()));
      setAlertRulesStatus({ loading: false, error: '' });
    } catch (error) {
      setAlertRulesStatus({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [settings.quantSyncToken]);

  const refreshAllExisting = useCallback(async () => {
    void refreshQuotes('manual');
    const [positionsUpdated, analysisUpdated] = await Promise.all([
      refreshQuantPositions(),
      refreshQuantAnalysis(),
    ]);
    if (!positionsUpdated || !analysisUpdated) {
      throw new Error('服务器持仓或买卖决策读取失败');
    }
  }, [refreshQuantAnalysis, refreshQuantPositions, refreshQuotes]);

  const refreshEverything = useCallback(async () => {
    const url = getServerRefreshRequestUrl();
    const token = settings.quantSyncToken.trim();
    if (!url) {
      setOneTapRefreshState({ phase: 'error', message: '当前入口不支持服务器重算' });
      return;
    }
    if (oneTapRefreshInFlightRef.current) {
      setOneTapRefreshState({ phase: 'waiting', message: '刷新正在进行中，请稍候…' });
      return;
    }
    if (oneTapCooldownSeconds > 0) {
      setOneTapRefreshState({ phase: 'throttled', message: `刚刚已刷新，请等待 ${oneTapCooldownSeconds} 秒` });
      return;
    }

    oneTapRefreshInFlightRef.current = true;
    oneTapRequestedAtRef.current = Date.now();
    setOneTapCooldownSeconds(Math.ceil(ONE_TAP_REFRESH_COOLDOWN_MS / 1000));
    try {
      await runOneTapRefresh({
        request: () => requestOneTapRefresh(url, token),
        refreshExisting: refreshAllExisting,
        read: () => readOneTapRefresh(url, token),
        onState: setOneTapRefreshState,
      });
    } finally {
      oneTapRefreshInFlightRef.current = false;
    }
  }, [oneTapCooldownSeconds, refreshAllExisting, settings.quantSyncToken]);

  useEffect(() => {
    if (oneTapCooldownSeconds <= 0) return undefined;
    const tick = () => {
      setOneTapCooldownSeconds(oneTapRefreshCooldownSeconds(Date.now(), oneTapRequestedAtRef.current));
    };
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [oneTapCooldownSeconds]);

  useEffect(() => {
    const url = getServerPortfolioPositionsUrl();
    if (!url) return;
    const key = `${url}|${settings.quantSyncToken.trim()}`;
    if (quantAutoSyncKeyRef.current === key) return;
    quantAutoSyncKeyRef.current = key;
    void refreshQuantPositions();
  }, [refreshQuantPositions, settings.quantSyncToken]);

  useEffect(() => {
    const url = getServerQuantAnalysisUrl();
    const key = `${url}|${settings.quantSyncToken.trim()}`;
    if (!url || quantAnalysisAutoLoadKeyRef.current === key) return;
    quantAnalysisAutoLoadKeyRef.current = key;
    void refreshQuantAnalysis();
  }, [refreshQuantAnalysis, settings.quantSyncToken]);

  useEffect(() => {
    if (!getServerQuantAnalysisUrl()) return undefined;
    return startQuantAnalysisAutoRefresh(() => {
      void refreshQuantAnalysis();
    }, document);
  }, [refreshQuantAnalysis]);

  useEffect(() => {
    if (!quantAnalysis) return undefined;
    let active = true;
    const serverProxyUrl = getServerQuoteProxyUrl();
    const quoteProxyUrl = serverProxyUrl
      || (settings.quoteProvider === 'proxy' ? settings.quoteProxyUrl : '');
    void fetchMonitoredQuotes({
      snapshot: quantAnalysis,
      holdings: portfolio.holdings,
      quoteProxyUrl,
    }).then((prices) => {
      if (active) setMonitoredQuotes(prices);
    });
    return () => {
      active = false;
    };
  }, [portfolio.holdings, quantAnalysis, settings.quoteProvider, settings.quoteProxyUrl]);

  useEffect(() => {
    const url = getServerAlertRulesUrl();
    const key = `${url}|${settings.quantSyncToken.trim()}`;
    if (!url || alertRulesAutoLoadKeyRef.current === key) return;
    alertRulesAutoLoadKeyRef.current = key;
    void refreshAlertRules();
  }, [refreshAlertRules, settings.quantSyncToken]);

  useEffect(() => {
    if (!getServerAlertRulesUrl()) return undefined;
    const refreshVisibleAlertRules = () => {
      if (document.visibilityState !== 'hidden') void refreshAlertRules();
    };
    const timer = window.setInterval(refreshVisibleAlertRules, ALERT_RULES_REFRESH_MS);
    window.addEventListener('focus', refreshVisibleAlertRules);
    document.addEventListener('visibilitychange', refreshVisibleAlertRules);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisibleAlertRules);
      document.removeEventListener('visibilitychange', refreshVisibleAlertRules);
    };
  }, [refreshAlertRules]);

  useEffect(() => {
    if (!settings.autoRefreshQuotes || !canSyncQuotes(settings)) return undefined;
    let cancelled = false;

    const runDuringSession = () => {
      if (cancelled || holdingsRef.current.length === 0) return;
      const now = new Date();
      setMarketNow(now);
      if (!isRegularSession(now)) return;
      const targetDate = marketSessionDateKey(now);
      const syncKey = buildDailyQuoteSyncKey(targetDate, holdingsRef.current, settings);
      const reason: QuoteRefreshReason = localStorage.getItem(DAILY_QUOTE_SYNC_KEY) === syncKey ? 'session' : 'daily';
      void refreshQuotes(reason, syncKey, targetDate);
    };

    runDuringSession();
    const timer = window.setInterval(runDuringSession, MARKET_SESSION_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [portfolio.holdings.length, refreshQuotes, settings, settings.autoRefreshQuotes, settings.quoteApiKey, settings.quoteProvider, settings.quoteProxyUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => setMarketNow(new Date()), SESSION_CLOCK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const metrics = useMemo(() => computeMetrics(portfolio, rates), [portfolio, rates]);
  const needsReviewCount = countNeedsReview(portfolio.holdings);
  const deltaEstimatedCount = metrics.holdingsMetrics.filter((metric) => metric.holding.quote?.source === 'delta_estimate').length;
  const dayChangeStatus = dayChangeSessionText(marketNow, quoteStatus.lastSyncedAt, deltaEstimatedCount);
  const latestAlert = useMemo(() => [...alertRules]
    .filter((rule) => rule.last_reminder_at)
    .sort((left, right) => String(right.last_reminder_at).localeCompare(String(left.last_reminder_at)))[0], [alertRules]);

  useEffect(() => {
    const date = getBeijingDateParts(new Date()).date;
    setValueHistory((current) => {
      const next = recordDailyValue(current, date, metrics.totalValue);
      saveValueHistory(next);
      return next;
    });
  }, [metrics.totalValue]);

  function addHolding(h: Omit<Holding, 'id'>) {
    setPortfolio((p) => ({ ...p, holdings: [...p.holdings, { ...h, id: generateId() }] }));
  }
  function updateHolding(id: string, patch: Partial<Holding>) {
    setPortfolio((p) => ({
      ...p,
      holdings: p.holdings.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
  }
  function deleteHolding(id: string) {
    setPortfolio((p) => ({ ...p, holdings: p.holdings.filter((h) => h.id !== id) }));
  }
  function setCash(cash: CashPosition[]) {
    setPortfolio((p) => ({ ...p, cash }));
  }
  function handleSaveSettings(next: AppSettings) {
    setSettings(next);
    saveSettings(next);
  }
  function setDisplayCurrency(displayCurrency: DisplayCurrency) {
    const next = { ...settings, displayCurrency };
    setSettings(next);
    saveSettings(next);
  }
  function importFromImages(result: ImportedPortfolio) {
    backupPortfolio(portfolio);
    setPortfolio((current) => applyImageImport(current, result, generateId));
    setLastImport({ mode: 'full', result });
    setTab('dashboard');
  }
  function importOptionDetails(result: ParsedOptionDetails) {
    backupPortfolio(portfolio);
    const applied = applyOptionDetails(portfolio, result, generateId);
    setPortfolio(applied.next);
    setLastImport({ mode: 'option', result: applied });
    setTab('dashboard');
  }
  function undoLastImport() {
    const backup = loadPortfolioBackup();
    if (!backup) return;
    setPortfolio(backup);
    clearPortfolioBackup();
    setLastImport(null);
  }
  async function upsertAlertRule(draft: AlertRuleDraft) {
    const url = getServerAlertRulesUrl();
    if (!url) throw new Error('目标提醒仅在 VPS 入口可用');
    setAlertRulesStatus({ loading: true, error: '' });
    try {
      const saved = await saveAlertRule(url, draft, settings.quantSyncToken.trim());
      setAlertRules((current) => {
        const index = current.findIndex((rule) => rule.id === saved.id);
        if (index < 0) return [...current, saved];
        return current.map((rule) => rule.id === saved.id ? saved : rule);
      });
      setAlertRulesStatus({ loading: false, error: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAlertRulesStatus({ loading: false, error: message });
      throw new Error(message, { cause: error });
    }
  }
  async function removeAlertRule(id: string) {
    const url = getServerAlertRulesUrl();
    if (!url) return;
    setAlertRulesStatus({ loading: true, error: '' });
    try {
      await deleteAlertRule(url, id, settings.quantSyncToken.trim());
      setAlertRules((current) => current.filter((rule) => rule.id !== id));
      setAlertRulesStatus({ loading: false, error: '' });
    } catch (error) {
      setAlertRulesStatus({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function changeTab(next: Tab) {
    if (next !== 'valuation') setValuationEditorDirty(false);
    setTab(next);
  }

  const tabIndex = ['dashboard', 'rotation', 'valuation', 'calculator', 'journal', 'settings'].indexOf(tab);
  const headerSyncBusy = quoteStatus.loading
    || quantStatus.loading
    || quantAnalysisStatus.loading
    || oneTapRefreshState.phase === 'requested'
    || oneTapRefreshState.phase === 'throttled'
    || oneTapRefreshState.phase === 'waiting';
  const headerSyncError = quoteStatus.error || quantStatus.error || quantAnalysisStatus.error;
  const serverSyncRequired = Boolean(getServerPortfolioPositionsUrl());
  const privateDataState = privateDataGateState({
    serverSyncRequired,
    pushedAt: quantStatus.pushedAt,
    loading: quantStatus.loading,
    error: quantStatus.error,
  });

  async function syncHeaderData() {
    if (headerSyncBusy) return;
    const canRequestRecompute = Boolean(getServerRefreshRequestUrl());
    if (canRequestRecompute && oneTapCooldownSeconds <= 0) {
      await refreshEverything();
      return;
    }
    setOneTapRefreshState({ phase: 'waiting', message: '正在同步行情和量化系统…' });
    await refreshAllExisting();
    setOneTapRefreshState({
      phase: 'done',
      message: '行情、持仓与量化分析已同步',
      completedAt: new Date().toISOString(),
    });
  }

  return (
    <div className={`portfolio-app ${tab === 'valuation' || tab === 'rotation' ? 'is-research-view' : ''} mx-auto min-h-full ${tab === 'valuation' || tab === 'rotation' ? 'max-w-[1760px]' : 'max-w-6xl'} px-2.5 py-1.5 sm:px-6 sm:py-5 md:py-8`}>
      <header className="portfolio-header elev-2 sticky top-0 z-40 -mx-2.5 mb-2 flex flex-col gap-1.5 border-b border-neutral/20 bg-surface-base/80 px-2.5 py-1.5 backdrop-blur-xl sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start justify-between gap-3 xl:contents">
          <div className="min-w-0">
            <h1 className="text-display text-lg font-semibold sm:text-3xl">我的投资组合</h1>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary sm:mt-1 sm:text-xs">
              <span className="sm:hidden">三券商自动同步</span>
              <span className="hidden sm:inline">三券商持仓由服务器跨设备同步 · 截图仅在你点击解析时发送给已选 AI</span>
            </p>
            {quantAnalysis && <SnapshotStamp snapshot={quantAnalysis} />}
          </div>
          <div data-testid="mobile-header-tools" className="flex shrink-0 items-center gap-0.5 rounded-xl bg-surface-raised/75 p-0.5 shadow-sm ring-1 ring-neutral/25 backdrop-blur-xl sm:gap-2 sm:bg-transparent sm:p-0 sm:shadow-none sm:ring-0">
            <label
              className="flex min-h-11 shrink-0 items-center rounded-lg px-1 text-[10px] text-ink-secondary active:bg-surface-overlay sm:rounded-xl sm:border sm:border-neutral/45 sm:bg-surface-raised sm:px-2.5 sm:text-xs"
              title={rateError || `1 USD ≈ ${rates.CNY.toFixed(3)} CNY · ${rates.updatedAt ?? '汇率日期未知'}`}
            >
              <span className="sr-only">显示货币</span>
              <select
                aria-label="显示货币"
                value={settings.displayCurrency}
                onChange={(event) => setDisplayCurrency(event.target.value as DisplayCurrency)}
                className="min-h-9 max-w-12 appearance-none bg-transparent text-center font-medium tabular-nums text-ink-secondary outline-none sm:max-w-16 sm:appearance-auto sm:text-left"
              >
                {(['USD', 'CNY', 'HKD', 'JPY', 'EUR', 'GBP'] as DisplayCurrency[]).map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void syncHeaderData()}
              disabled={headerSyncBusy}
              title={headerSyncError || oneTapRefreshState.message || '同步行情、券商持仓与量化分析'}
              className="flex min-h-11 min-w-10 shrink-0 items-center justify-center rounded-lg px-1 text-[15px] font-semibold text-buy hover:bg-buy/10 disabled:cursor-wait disabled:text-ink-muted sm:min-w-0 sm:gap-1 sm:rounded-xl sm:border sm:border-buy/40 sm:bg-buy/15 sm:px-3 sm:text-xs sm:hover:bg-buy/25 sm:disabled:border-neutral/40 sm:disabled:bg-neutral/20"
            >
              <span aria-hidden="true">↻</span>
              <span className="sr-only sm:hidden">{headerSyncBusy ? '同步中' : '同步'}</span>
              <span className="hidden sm:inline">{headerSyncBusy ? '同步中…' : '同步数据'}</span>
            </button>
            <ThemeControl />
          </div>
        </div>
        <div className="flex w-full items-center gap-2 xl:w-auto">
          <NotificationCenter snapshot={quantAnalysis} />
          <nav
            className="relative grid w-full grid-cols-6 rounded-xl bg-surface-raised/80 p-0.5 text-[11px] shadow-sm ring-1 ring-neutral/20 backdrop-blur-xl sm:rounded-2xl sm:p-1 sm:text-sm xl:w-[26rem]"
          >
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 left-0.5 top-0.5 w-[calc((100%_-_0.25rem)/6)] rounded-[0.65rem] bg-buy shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] sm:bottom-1 sm:left-1 sm:top-1 sm:w-[calc((100%_-_0.5rem)/6)] sm:rounded-xl"
              style={{ transform: `translateX(${tabIndex * 100}%)` }}
            />
            <TabBtn label="总览" active={tab === 'dashboard'} onClick={() => changeTab('dashboard')} />
            <TabBtn label="板块轮动" active={tab === 'rotation'} onClick={() => changeTab('rotation')} />
            <TabBtn label="决策" active={tab === 'valuation'} onClick={() => changeTab('valuation')} />
            <TabBtn label="卖出" active={tab === 'calculator'} onClick={() => changeTab('calculator')} />
            <TabBtn label="日志" active={tab === 'journal'} onClick={() => changeTab('journal')} />
            <TabBtn label="设置" active={tab === 'settings'} onClick={() => changeTab('settings')} />
          </nav>
        </div>
      </header>
      {tab !== 'settings' && privateDataState !== 'ready' && (
        <PrivateDataGate
          state={privateDataState}
          error={quantStatus.error}
          onRetry={() => void refreshQuantPositions()}
        />
      )}
      {tab === 'dashboard' && privateDataState === 'ready' && (
        <section className="space-y-3 md:space-y-5">
          <MarketIndicators snapshot={quantAnalysis} />
          {latestAlert && (
            <div className="rounded-2xl border border-trim/40 border-l-4 border-l-trim bg-trim/10 p-4 text-sm leading-relaxed text-ink-primary">
              <strong><span className="tabular-nums">{latestAlert.symbol}</span> 目标提醒已触发</strong> · <span className="tabular-nums">{latestAlert.last_reminder_at}</span>。只提醒不下单，请在券商 App 手动执行。
            </div>
          )}
          <Summary
            metrics={metrics}
            rates={rates}
            displayCurrency={settings.displayCurrency}
            onDisplayCurrencyChange={setDisplayCurrency}
            valueHistory={valueHistory}
            rateError={rateError}
            quoteStatus={quoteStatus}
            dayChangeStatusText={dayChangeStatus}
            canRefreshQuotes={portfolio.holdings.length > 0 && canSyncQuotes(settings)}
            onRefreshQuotes={() => refreshQuotes('manual')}
            exposureTargetPct={settings.exposureTargetPct}
            quantStatus={quantStatus}
            quantSyncEnabled={hasServerGateway()}
            quantGatewayAvailable={hasServerGateway()}
            quantTokenConfigured={Boolean(settings.quantSyncToken.trim())}
            onRefreshQuant={refreshQuantPositions}
            oneTapRefreshState={oneTapRefreshState}
            canOneTapRefresh={hasServerGateway()}
            oneTapCooldownSeconds={oneTapCooldownSeconds}
            onOneTapRefresh={refreshEverything}
            analysisSnapshot={quantAnalysis}
          />
          <BehaviorMirrorCard mirror={quantAnalysis?.behavior_mirror} />
          {lastImport && <ImportResultNotice result={lastImport} onClose={() => setLastImport(null)} onUndo={undoLastImport} />}
          <div className="rounded-xl border border-neutral/40 bg-surface-raised p-3">
            <h2 className="mb-2 text-sm font-semibold">资产与等效敞口</h2>
            <AllocationChart
              metrics={metrics}
              displayCurrency={settings.displayCurrency}
              rates={rates}
              analysisSnapshot={quantAnalysis}
            />
          </div>
        </section>
      )}

      {tab === 'calculator' && privateDataState === 'ready' && (
        <section className="space-y-4">
          <SellDecisionDashboard
            snapshot={quantAnalysis}
            holdings={portfolio.holdings}
            displayCurrency={settings.displayCurrency}
            rates={rates}
            selectedFamily={sellFamily}
            ttmHistory={quantAnalysis?.pe_history}
            onSelectedFamilyChange={setSellFamily}
            onRefresh={refreshEverything}
            refreshState={oneTapRefreshState}
            refreshCooldownSeconds={oneTapCooldownSeconds}
          />
          <StockForwardValuationExplorer
            valuation={quantAnalysis?.stock_forward_valuation}
            ttmHistory={quantAnalysis?.pe_history}
            selectedSymbol={sellFamily}
            onSelectedSymbolChange={setSellFamily}
          />
          <details className="rounded-xl border border-neutral/40 bg-surface-raised p-3">
            <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold leading-[2.75rem] marker:content-none">
              自定义目标价提醒
            </summary>
            <div className="mt-2 border-t border-neutral/25 pt-3">
              <AlertRulesPanel
                rules={alertRules}
                holdings={portfolio.holdings}
                holdingCosts={quantAnalysis?.holding_costs || {}}
                monitoredQuotes={monitoredQuotes}
                loading={alertRulesStatus.loading}
                error={alertRulesStatus.error}
                onCreate={upsertAlertRule}
                onUpdate={upsertAlertRule}
                onDelete={removeAlertRule}
              />
            </div>
          </details>
        </section>
      )}

      {tab === 'journal' && privateDataState === 'ready' && (
        <JournalPage displayCurrency={settings.displayCurrency} rates={rates} />
      )}
      {tab === 'settings' && (
        <section className="space-y-4">
          <SettingsPanel
            settings={settings}
            holdings={portfolio.holdings}
            holdingCosts={quantAnalysis?.holding_costs || {}}
            onSave={handleSaveSettings}
          />
          <DataActions
            onExport={() => exportJson(portfolio)}
            onImport={(next) => setPortfolio(next)}
            onClear={() => setPortfolio({ holdings: [], cash: [], updatedAt: new Date().toISOString() })}
          />
          <details className="rounded-xl border border-neutral/40 bg-surface-raised p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink-primary marker:content-none">
              <span>持仓与手动维护</span>
              <span className="text-xs font-normal tabular-nums text-ink-muted">
                {portfolio.holdings.length} 项{needsReviewCount > 0 ? ` · ${needsReviewCount} 项待核对` : ''} · 点击展开
              </span>
            </summary>
            <div className="mt-3 space-y-3 border-t border-neutral/25 pt-3">
              <details className="rounded-lg border border-neutral/35 bg-surface-overlay/25 p-3">
                <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem] text-ink-secondary">截图导入与期权补充</summary>
                <div className="mt-2"><ImageImportPanel settings={settings} onConfirm={importFromImages} onOptionDetails={importOptionDetails} onOpenSettings={() => setTab('settings')} /></div>
              </details>
              <details className="rounded-lg border border-neutral/35 bg-surface-overlay/25 p-3">
                <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem] text-ink-secondary">持仓明细与手动补充</summary>
                <div className="mt-2">
                  <HoldingsTable
                    metrics={metrics.holdingsMetrics}
                    displayCurrency={settings.displayCurrency}
                    rates={rates}
                    analysisSnapshot={quantAnalysis}
                    onAdd={addHolding}
                    onUpdate={updateHolding}
                    onDelete={deleteHolding}
                  />
                </div>
              </details>
              <details className="rounded-lg border border-neutral/35 bg-surface-overlay/25 p-3">
                <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem] text-ink-secondary">卖出、止盈与成本明细</summary>
                <div className="mt-2"><SellWindowSection snapshot={quantAnalysis} holdings={portfolio.holdings} displayCurrency={settings.displayCurrency} rates={rates} /></div>
              </details>
              <details className="rounded-lg border border-neutral/35 bg-surface-overlay/25 p-3">
                <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem] text-ink-secondary">现金明细</summary>
                <div className="mt-2"><CashEditor cash={portfolio.cash} rates={rates} onChange={setCash} /></div>
              </details>
            </div>
          </details>
        </section>
      )}

      {tab === 'rotation' && privateDataState === 'ready' && <SectorRotation snapshot={quantAnalysis} holdings={portfolio.holdings} onOpenDecision={symbol => { setDecisionSymbol(symbol); changeTab('valuation'); window.scrollTo({ top: 0 }); }} />}

      {tab === 'valuation' && privateDataState === 'ready' && (
        <section>
          <ValuationPanel
            initialSymbol={decisionSymbol}
            snapshot={quantAnalysis}
            onDirtyChange={setValuationEditorDirty}
            holdings={portfolio.holdings}
            monitoredQuotes={monitoredQuotes}
            quantLoading={quantAnalysisStatus.loading}
            quantError={quantAnalysisStatus.error}
            onRefreshQuant={refreshEverything}
            refreshState={oneTapRefreshState}
            refreshCooldownSeconds={oneTapCooldownSeconds}
            displayCurrency={settings.displayCurrency}
            rates={rates}
            valuationSettings={settings}
            totalAssets={metrics.totalValue}
          />
        </section>
      )}

      <footer className="mt-8 text-center text-xs text-ink-muted">
        持仓与决策从服务器自动读取；浏览器仅保存设置和备份。风险结果仅作教育与信息展示，不构成投资建议。
      </footer>
    </div>
  );
}

function PrivateDataGate({ state, error, onRetry }: {
  state: PrivateDataGateState;
  error: string;
  onRetry: () => void;
}) {
  const loading = state === 'loading';
  return (
    <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-5 text-center shadow-sm">
      <h2 className="text-base font-bold text-ink-primary">
        {loading ? '正在读取服务器数据…' : '服务器数据暂不可用'}
      </h2>
      <p className="mx-auto mt-2 max-w-xl break-words text-sm leading-relaxed text-ink-secondary">
        {loading
          ? '正在读取最新持仓、估值和决策。'
          : `未能读取服务器快照${error ? `：${error}` : ''}`}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {!loading && (
          <button type="button" onClick={onRetry} className="min-h-11 rounded-xl border border-neutral/45 px-4 text-sm font-semibold text-ink-primary">
            重新验证
          </button>
        )}
      </div>
    </section>
  );
}

function ImportResultNotice({ result: notice, onClose, onUndo }: { result: ImportNotice; onClose: () => void; onUndo: () => void }) {
  const issues = dedupeImportIssues(notice.result.issues);
  return (
    <div className="rounded-xl border border-gain/40 bg-gain/10 p-3 text-sm text-ink-primary">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{notice.mode === 'full' ? '截图识别已自动导入' : '期权详情已安全补充'}</div>
          {notice.mode === 'full' ? (
            <p className="mt-1 text-xs tabular-nums">
              本次已替换上一批截图导入（手动添加的条目未受影响）；共导入 {notice.result.holdings.length} 个持仓、{notice.result.cash.length} 个现金条目。
            </p>
          ) : (
            <p className="mt-1 text-xs tabular-nums">
              已更新 {notice.result.updated.length} 个期权、补充新增 {notice.result.added.length} 个；未动任何正股、ETF 与现金。
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gain hover:underline">关闭</button>
      </div>
      {issues.length > 0 && (
        <div className="mt-2 rounded-lg border border-trim/40 bg-trim/10 p-2 text-xs text-ink-primary">
          <div className="font-semibold">下一步建议补充</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                <span className="font-medium">{issue.priority === 'required' ? '需补充：' : '建议补充：'}{issue.field}</span> — {issue.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" onClick={onUndo} className="mt-2 rounded-md border border-gain/50 px-3 py-1.5 text-xs font-medium text-gain hover:bg-gain/10">
        撤销本次导入
      </button>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative z-10 min-h-11 min-w-0 rounded-lg px-1 py-1.5 font-medium transition-colors sm:rounded-xl sm:px-3 sm:py-2 ${
        active
          ? 'text-surface-base'
          : 'text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary'
      }`}
    >
      {label}
    </button>
  );
}

function exportJson(state: PortfolioState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

interface DataActionsProps {
  onExport: () => void;
  onImport: (state: PortfolioState) => void;
  onClear: () => void;
}

function DataActions({ onExport, onImport, onClear }: DataActionsProps) {
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as PortfolioState;
        onImport(parsed);
      } catch {
        alert('导入失败：文件不是有效的 JSON。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
  return (
    <div className="space-y-2 rounded-xl border border-neutral/40 bg-surface-raised p-3">
      <h2 className="text-sm font-semibold">数据导入 / 导出</h2>
      <div className="flex flex-wrap gap-2">
        <button onClick={onExport} className="rounded-md bg-surface-overlay px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary">
          导出 JSON
        </button>
        <label className="cursor-pointer rounded-md bg-surface-overlay px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary">
          导入 JSON
          <input type="file" accept="application/json" className="hidden" onChange={handleFile} />
        </label>
        <button
          onClick={() => {
            if (confirm('确定清空所有持仓和现金？此操作不可撤销。')) onClear();
          }}
          className="rounded-md bg-loss/10 px-3 py-1.5 text-sm text-loss hover:bg-loss/20"
        >
          清空数据
        </button>
      </div>
    </div>
  );
}
