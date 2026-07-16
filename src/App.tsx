import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AllocationChart } from './components/AllocationChart';
import { AnalysisPanel } from './components/AnalysisPanel';
import { AlertRulesPanel } from './components/AlertRulesPanel';
import { ConditionLookup } from './components/ConditionLookup';
import { CashEditor } from './components/CashEditor';
import { HoldingsTable } from './components/HoldingsTable';
import { ImageImportPanel } from './components/ImageImportPanel';
import { RiskList } from './components/RiskList';
import { SettingsPanel } from './components/SettingsPanel';
import { ScenarioCalculator } from './components/ScenarioCalculator';
import { Summary } from './components/Summary';
import { analyzePortfolio } from './analyzer';
import { deleteAlertRule, fetchAlertRules, saveAlertRule, type AlertRule, type AlertRuleDraft } from './alertRules';
import { fetchLatestExchangeRates, loadExchangeRates } from './exchangeRates';
import { canSyncQuotes, quoteSyncSetupHint, syncHoldingsWithQuotes } from './marketData';
import { MARKET_SESSION_REFRESH_MS, dayChangeSessionText, isRegularSession, marketSessionDateKey } from './marketSession';
import { computeMetrics } from './metrics';
import { fetchQuantAnalysis, isQuantAnalysisStale } from './quantAnalysis';
import { applyImageImport, applyOptionDetails, countNeedsReview, type OptionDetailsApplyResult } from './importMerge';
import { backupPortfolio, clearPortfolioBackup, loadPortfolio, loadPortfolioBackup, loadSettings, savePortfolio, saveSettings } from './storage';
import { applyQuantSync, fetchQuantPositions, isQuantSnapshotStale, mapQuantPositions, type QuantMappedPortfolio } from './quantSync';
import { getServerAlertRulesUrl, getServerPortfolioPositionsUrl, getServerQuantAnalysisUrl, hasServerGateway } from './runtimeConfig';
import type { AppSettings, CashPosition, DisplayCurrency, ExchangeRates, Holding, ImportedPortfolio, ParsedOptionDetails, PortfolioState, QuantAnalysisSnapshot } from './types';
import { loadValueHistory, recordDailyValue, saveValueHistory, type ValuePoint } from './valueHistory';
import './App.css';

type Tab = 'dashboard' | 'holdings' | 'analysis' | 'conditions' | 'calculator' | 'settings';
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
  | { mode: 'option'; result: OptionDetailsApplyResult }
  | { mode: 'quant'; result: QuantMappedPortfolio };

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
  const [quantAnalysisStatus, setQuantAnalysisStatus] = useState<QuantAnalysisStatus>({ loading: false, error: '', stale: false });
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertRulesStatus, setAlertRulesStatus] = useState<AlertRulesStatus>({ loading: false, error: '' });
  const [lastImport, setLastImport] = useState<ImportNotice | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [marketNow, setMarketNow] = useState(() => new Date());
  const holdingsRef = useRef(portfolio.holdings);
  const portfolioRef = useRef(portfolio);
  const quoteRefreshInFlightRef = useRef(false);
  const quantAutoSyncKeyRef = useRef('');
  const quantAnalysisAutoLoadKeyRef = useRef('');
  const alertRulesAutoLoadKeyRef = useRef('');

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
      setQuoteStatus({
        loading: false,
        lastSyncedAt: result.updatedAt,
        error: result.failedSymbols.length > 0 ? result.failedSymbols.map((item) => `${item.symbol}: ${item.reason}`).join('；') : '',
        summary: `${prefix} ${result.updatedSymbols.length}/${result.requestedSymbols.length} 个标的${optionText}${failedText}${skippedText}`,
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

  const refreshQuantPositions = useCallback(async () => {
    const url = getServerPortfolioPositionsUrl();
    if (!url) {
      setQuantStatus((status) => ({ ...status, loading: false, error: '量化同步仅在 VPS 入口可用' }));
      return;
    }
    setQuantStatus((status) => ({ ...status, loading: true, error: '' }));
    try {
      const snapshot = await fetchQuantPositions(url, settings.quantSyncToken.trim());
      const current = portfolioRef.current;
      const mapped = mapQuantPositions(snapshot.payload, current);
      backupPortfolio(current);
      const next = applyQuantSync(current, mapped);
      portfolioRef.current = next;
      setPortfolio(next);
      setLastImport({ mode: 'quant', result: mapped });
      setQuantStatus({
        loading: false,
        asOf: snapshot.payload.as_of,
        pushedAt: snapshot.pushed_at,
        stale: isQuantSnapshotStale(snapshot.pushed_at),
        error: '',
        summary: `已同步 ${mapped.holdings.length} 个持仓、${mapped.cash.length} 个推算现金条目`,
      });
    } catch (error) {
      setQuantStatus((status) => ({
        ...status,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [settings.quantSyncToken]);

  const refreshQuantAnalysis = useCallback(async () => {
    const url = getServerQuantAnalysisUrl();
    if (!url) {
      setQuantAnalysisStatus({ loading: false, error: '量化条件查询仅在 VPS 入口可用', stale: false });
      return;
    }
    setQuantAnalysisStatus((status) => ({ ...status, loading: true, error: '' }));
    try {
      const snapshot = await fetchQuantAnalysis(url);
      setQuantAnalysis(snapshot);
      setQuantAnalysisStatus({ loading: false, error: '', stale: isQuantAnalysisStale(snapshot.generated_at) });
    } catch (error) {
      setQuantAnalysisStatus((status) => ({
        ...status,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const refreshAlertRules = useCallback(async () => {
    const url = getServerAlertRulesUrl();
    if (!url) {
      setAlertRulesStatus({ loading: false, error: '目标提醒仅在 VPS 入口可用' });
      return;
    }
    setAlertRulesStatus({ loading: true, error: '' });
    try {
      setAlertRules(await fetchAlertRules(url));
      setAlertRulesStatus({ loading: false, error: '' });
    } catch (error) {
      setAlertRulesStatus({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    const url = getServerPortfolioPositionsUrl();
    if (!url) return;
    const key = url;
    if (quantAutoSyncKeyRef.current === key) return;
    quantAutoSyncKeyRef.current = key;
    void refreshQuantPositions();
  }, [refreshQuantPositions]);

  useEffect(() => {
    const url = getServerQuantAnalysisUrl();
    if (!url || quantAnalysisAutoLoadKeyRef.current === url) return;
    quantAnalysisAutoLoadKeyRef.current = url;
    void refreshQuantAnalysis();
  }, [refreshQuantAnalysis]);

  useEffect(() => {
    const url = getServerAlertRulesUrl();
    if (!url || alertRulesAutoLoadKeyRef.current === url) return;
    alertRulesAutoLoadKeyRef.current = url;
    void refreshAlertRules();
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
  const findings = useMemo(() => analyzePortfolio(metrics, settings.exposureTargetPct), [metrics, settings.exposureTargetPct]);
  const needsReviewCount = countNeedsReview(portfolio.holdings);
  const deltaEstimatedCount = metrics.holdingsMetrics.filter((metric) => metric.holding.quote?.source === 'delta_estimate').length;
  const dayChangeStatus = dayChangeSessionText(marketNow, quoteStatus.lastSyncedAt, deltaEstimatedCount);
  const alertSymbols = useMemo(() => [...new Set(portfolio.holdings.map((holding) => (
    holding.assetType === 'option' ? holding.option?.underlying || holding.symbol : holding.symbol
  )).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort(), [portfolio.holdings]);
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
      const saved = await saveAlertRule(url, draft);
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
      await deleteAlertRule(url, id);
      setAlertRules((current) => current.filter((rule) => rule.id !== id));
      setAlertRulesStatus({ loading: false, error: '' });
    } catch (error) {
      setAlertRulesStatus({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="mx-auto min-h-full max-w-5xl px-3 py-4 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">我的投资组合</h1>
          <p className="text-xs text-slate-500">三券商持仓由服务器跨设备同步 · 截图仅在你点击解析时发送给已选 AI</p>
        </div>
        <nav className="flex flex-wrap gap-1 text-xs sm:text-sm">
          <TabBtn label="总览" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
          <TabBtn
            label={<>持仓 {needsReviewCount > 0 && <span className="text-amber-400">●{needsReviewCount}</span>}</>}
            active={tab === 'holdings'}
            onClick={() => setTab('holdings')}
          />
          <TabBtn label="分析" active={tab === 'analysis'} onClick={() => setTab('analysis')} />
          <TabBtn label="条件查询" active={tab === 'conditions'} onClick={() => setTab('conditions')} />
          <TabBtn label="计算器" active={tab === 'calculator'} onClick={() => setTab('calculator')} />
          <TabBtn label="设置" active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>
      </header>

      {tab === 'dashboard' && (
        <section className="space-y-4">
          {latestAlert && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <strong>{latestAlert.symbol} 目标提醒已触发</strong> · {latestAlert.last_reminder_at}。只提醒不下单，请在券商 App 手动执行。
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
            quantTokenConfigured={true}
            onRefreshQuant={refreshQuantPositions}
          />
          {lastImport && <ImportResultNotice result={lastImport} onClose={() => setLastImport(null)} onUndo={undoLastImport} />}
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-2 text-sm font-semibold">资产占比</h3>
            <AllocationChart metrics={metrics} displayCurrency={settings.displayCurrency} rates={rates} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-2 text-sm font-semibold">本地风险扫描</h3>
            <RiskList findings={findings} />
          </div>
        </section>
      )}

      {tab === 'holdings' && (
        <section className="space-y-4">
          <ImageImportPanel settings={settings} onConfirm={importFromImages} onOptionDetails={importOptionDetails} onOpenSettings={() => setTab('settings')} />
          <HoldingsTable
            metrics={metrics.holdingsMetrics}
            displayCurrency={settings.displayCurrency}
            rates={rates}
            onAdd={addHolding}
            onUpdate={updateHolding}
            onDelete={deleteHolding}
          />
          <CashEditor cash={portfolio.cash} rates={rates} onChange={setCash} />
        </section>
      )}

      {tab === 'analysis' && (
        <section className="space-y-4">
          <RiskList findings={findings} />
          <AnalysisPanel onOpenConditionLookup={() => setTab('conditions')} />
        </section>
      )}

      {tab === 'conditions' && (
        <ConditionLookup
          snapshot={quantAnalysis}
          loading={quantAnalysisStatus.loading}
          error={quantAnalysisStatus.error}
          onRefresh={refreshQuantAnalysis}
        />
      )}

      {tab === 'calculator' && (
        <section className="space-y-4">
          <ScenarioCalculator metrics={metrics} displayCurrency={settings.displayCurrency} rates={rates} />
          <AlertRulesPanel
            rules={alertRules}
            symbols={alertSymbols}
            holdingCosts={quantAnalysis?.holding_costs || {}}
            loading={alertRulesStatus.loading}
            error={alertRulesStatus.error}
            onCreate={upsertAlertRule}
            onUpdate={upsertAlertRule}
            onDelete={removeAlertRule}
          />
        </section>
      )}

      {tab === 'settings' && (
        <section className="space-y-4">
          <SettingsPanel settings={settings} onSave={handleSaveSettings} />
          <DataActions
            onExport={() => exportJson(portfolio)}
            onImport={(next) => setPortfolio(next)}
            onClear={() => setPortfolio({ holdings: [], cash: [], updatedAt: new Date().toISOString() })}
          />
        </section>
      )}

      <footer className="mt-8 text-center text-xs text-slate-400">
        数据保存在浏览器 localStorage；清除浏览器数据会丢失。风险结果仅作教育与信息展示，不构成投资建议；建议定期导出 JSON 备份。
      </footer>
    </div>
  );
}

function ImportResultNotice({ result: notice, onClose, onUndo }: { result: ImportNotice; onClose: () => void; onUndo: () => void }) {
  const issues = notice.result.issues;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{notice.mode === 'full' ? '截图识别已自动导入' : notice.mode === 'option' ? '期权详情已安全补充' : '量化系统持仓已同步'}</div>
          {notice.mode === 'full' ? (
            <p className="mt-1 text-xs">
              本次已替换上一批截图导入（手动添加的条目未受影响）；共导入 {notice.result.holdings.length} 个持仓、{notice.result.cash.length} 个现金条目。
            </p>
          ) : notice.mode === 'option' ? (
            <p className="mt-1 text-xs">
              已更新 {notice.result.updated.length} 个期权、补充新增 {notice.result.added.length} 个；未动任何正股、ETF 与现金。
            </p>
          ) : (
            <p className="mt-1 text-xs">
              已替换量化同步与截图导入条目；共同步 {notice.result.holdings.length} 个持仓、{notice.result.cash.length} 个推算现金条目，手工条目未受影响。
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-xs text-emerald-700 hover:underline dark:text-emerald-200">关闭</button>
      </div>
      {issues.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
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
      <button type="button" onClick={onUndo} className="mt-2 rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-100 dark:hover:bg-emerald-900/40">
        {notice.mode === 'quant' ? '撤销本次同步' : '撤销本次导入'}
      </button>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 font-medium transition ${
        active
          ? 'bg-indigo-600 text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'
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
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="text-sm font-semibold">数据导入 / 导出</h3>
      <div className="flex flex-wrap gap-2">
        <button onClick={onExport} className="rounded-md bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-700">
          导出 JSON
        </button>
        <label className="cursor-pointer rounded-md bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-700">
          导入 JSON
          <input type="file" accept="application/json" className="hidden" onChange={handleFile} />
        </label>
        <button
          onClick={() => {
            if (confirm('确定清空所有持仓和现金？此操作不可撤销。')) onClear();
          }}
          className="rounded-md bg-rose-100 px-3 py-1.5 text-sm text-rose-700 dark:bg-rose-900/40 dark:text-rose-200"
        >
          清空数据
        </button>
      </div>
    </div>
  );
}
