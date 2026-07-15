import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AllocationChart } from './components/AllocationChart';
import { AnalysisPanel } from './components/AnalysisPanel';
import { CashEditor } from './components/CashEditor';
import { HoldingsTable } from './components/HoldingsTable';
import { ImageImportPanel } from './components/ImageImportPanel';
import { RiskList } from './components/RiskList';
import { SettingsPanel } from './components/SettingsPanel';
import { Summary } from './components/Summary';
import { analyzePortfolio } from './analyzer';
import { fetchLatestExchangeRates, loadExchangeRates } from './exchangeRates';
import { canSyncQuotes, quoteSyncSetupHint, syncHoldingsWithQuotes } from './marketData';
import { computeMetrics } from './metrics';
import { applyImageImport, countNeedsReview } from './importMerge';
import { loadPortfolio, loadSettings, savePortfolio, saveSettings } from './storage';
import type { AppSettings, CashPosition, DisplayCurrency, ExchangeRates, Holding, ImportedPortfolio, PortfolioState } from './types';
import { loadValueHistory, recordDailyValue, saveValueHistory, type ValuePoint } from './valueHistory';
import './App.css';

type Tab = 'dashboard' | 'holdings' | 'analysis' | 'settings';
type QuoteRefreshReason = 'manual' | 'daily';

const DAILY_QUOTE_SYNC_KEY = 'portfolio-tracker:daily-quote-sync-key-v1';
const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const BEIJING_QUOTE_REFRESH_HOUR = 7;

interface QuoteStatus {
  loading: boolean;
  lastSyncedAt: string | null;
  error: string;
  summary: string;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getBeijingQuoteTargetDate(now = new Date()): string {
  const parts = getBeijingDateParts(now);
  if (parts.hour >= BEIJING_QUOTE_REFRESH_HOUR) return parts.date;
  return formatBeijingDate(new Date(Date.parse(`${parts.date}T00:00:00+08:00`) - 24 * 60 * 60 * 1000));
}

function getMsUntilNextBeijingSeven(now = new Date()): number {
  const parts = getBeijingDateParts(now);
  const todaySeven = Date.parse(`${parts.date}T${String(BEIJING_QUOTE_REFRESH_HOUR).padStart(2, '0')}:00:00+08:00`);
  const nextSeven = todaySeven > now.getTime() ? todaySeven : todaySeven + 24 * 60 * 60 * 1000;
  return Math.max(60 * 1000, nextSeven - now.getTime());
}

function getBeijingDateParts(date: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour: Number(lookup.hour ?? 0),
  };
}

function formatBeijingDate(date: Date): string {
  return getBeijingDateParts(date).date;
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
  const [lastImport, setLastImport] = useState<ImportedPortfolio | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const holdingsRef = useRef(portfolio.holdings);
  const quoteRefreshInFlightRef = useRef(false);

  useEffect(() => {
    savePortfolio(portfolio);
    holdingsRef.current = portfolio.holdings;
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
      const nextDailySyncKey = dailySyncKey ?? buildDailyQuoteSyncKey(getBeijingQuoteTargetDate(), currentHoldings, settings);
      localStorage.setItem(DAILY_QUOTE_SYNC_KEY, nextDailySyncKey);
      const prefix = reason === 'daily'
        ? `每日快照（北京时间 ${dailyTargetDate ?? getBeijingQuoteTargetDate()}）`
        : '已手动刷新';
      setQuoteStatus({
        loading: false,
        lastSyncedAt: result.updatedAt,
        error: result.failedSymbols.length > 0 ? result.failedSymbols.map((item) => `${item.symbol}: ${item.reason}`).join('；') : '',
        summary: `${prefix} ${result.updatedSymbols.length}/${result.requestedSymbols.length} 个标的${failedText}${skippedText}`,
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

  useEffect(() => {
    if (!settings.autoRefreshQuotes || !canSyncQuotes(settings)) return undefined;
    let timer: number | undefined;
    let cancelled = false;

    const runIfDue = () => {
      if (cancelled || holdingsRef.current.length === 0) return;
      const targetDate = getBeijingQuoteTargetDate();
      const syncKey = buildDailyQuoteSyncKey(targetDate, holdingsRef.current, settings);
      if (localStorage.getItem(DAILY_QUOTE_SYNC_KEY) !== syncKey) {
        void refreshQuotes('daily', syncKey, targetDate);
      }
    };

    const scheduleNextCheck = () => {
      timer = window.setTimeout(() => {
        runIfDue();
        scheduleNextCheck();
      }, getMsUntilNextBeijingSeven() + 1000);
    };

    runIfDue();
    scheduleNextCheck();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [portfolio.holdings.length, refreshQuotes, settings, settings.autoRefreshQuotes, settings.quoteApiKey, settings.quoteProvider, settings.quoteProxyUrl]);

  const metrics = useMemo(() => computeMetrics(portfolio, rates), [portfolio, rates]);
  const findings = useMemo(() => analyzePortfolio(metrics), [metrics]);
  const needsReviewCount = countNeedsReview(portfolio.holdings);

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
    setPortfolio((current) => applyImageImport(current, result, generateId));
    setLastImport(result);
    setTab('dashboard');
  }

  return (
    <div className="mx-auto min-h-full max-w-5xl px-3 py-4 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">我的投资组合</h1>
          <p className="text-xs text-slate-500">本地存储 · 截图仅在你点击解析时发送给已选 AI · 手机/桌面通用</p>
        </div>
        <nav className="flex flex-wrap gap-1 text-xs sm:text-sm">
          <TabBtn label="总览" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
          <TabBtn
            label={<>持仓 {needsReviewCount > 0 && <span className="text-amber-400">●{needsReviewCount}</span>}</>}
            active={tab === 'holdings'}
            onClick={() => setTab('holdings')}
          />
          <TabBtn label="分析" active={tab === 'analysis'} onClick={() => setTab('analysis')} />
          <TabBtn label="设置" active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>
      </header>

      {tab === 'dashboard' && (
        <section className="space-y-4">
          <Summary
            metrics={metrics}
            rates={rates}
            displayCurrency={settings.displayCurrency}
            onDisplayCurrencyChange={setDisplayCurrency}
            valueHistory={valueHistory}
            rateError={rateError}
            quoteStatus={quoteStatus}
            canRefreshQuotes={portfolio.holdings.length > 0 && canSyncQuotes(settings)}
            onRefreshQuotes={() => refreshQuotes('manual')}
          />
          {lastImport && <ImportResultNotice result={lastImport} onClose={() => setLastImport(null)} />}
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
          <ImageImportPanel settings={settings} onConfirm={importFromImages} onOpenSettings={() => setTab('settings')} />
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
          <AnalysisPanel settings={settings} metrics={metrics} localFindings={findings} />
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

function ImportResultNotice({ result, onClose }: { result: ImportedPortfolio; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">截图识别已自动导入</div>
          <p className="mt-1 text-xs">
            本次已替换上一批截图导入（手动添加的条目未受影响）；共导入 {result.holdings.length} 个持仓、{result.cash.length} 个现金条目。
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-emerald-700 hover:underline dark:text-emerald-200">关闭</button>
      </div>
      {result.issues.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
          <div className="font-semibold">下一步建议补充</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                <span className="font-medium">{issue.priority === 'required' ? '需补充：' : '建议补充：'}{issue.field}</span> — {issue.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
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
