import { useEffect, useMemo, useState } from 'react';
import { AllocationChart } from './components/AllocationChart';
import { AnalysisPanel } from './components/AnalysisPanel';
import { CashEditor } from './components/CashEditor';
import { HoldingsTable } from './components/HoldingsTable';
import { RiskList } from './components/RiskList';
import { SettingsPanel } from './components/SettingsPanel';
import { Summary } from './components/Summary';
import { analyzePortfolio } from './analyzer';
import { computeMetrics } from './metrics';
import { loadPortfolio, loadSettings, savePortfolio, saveSettings } from './storage';
import type { AppSettings, CashPosition, Holding, PortfolioState } from './types';
import './App.css';

type Tab = 'dashboard' | 'holdings' | 'analysis' | 'settings';

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function App() {
  const [portfolio, setPortfolio] = useState<PortfolioState>(() => loadPortfolio());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [tab, setTab] = useState<Tab>('dashboard');

  useEffect(() => {
    savePortfolio(portfolio);
  }, [portfolio]);

  const metrics = useMemo(() => computeMetrics(portfolio), [portfolio]);
  const findings = useMemo(() => analyzePortfolio(metrics), [metrics]);

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

  return (
    <div className="mx-auto min-h-full max-w-5xl px-3 py-4 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">我的投资组合</h1>
          <p className="text-xs text-slate-500">本地存储 · 不上传 · 手机/桌面通用</p>
        </div>
        <nav className="flex flex-wrap gap-1 text-xs sm:text-sm">
          <TabBtn label="总览" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
          <TabBtn label="持仓" active={tab === 'holdings'} onClick={() => setTab('holdings')} />
          <TabBtn label="分析" active={tab === 'analysis'} onClick={() => setTab('analysis')} />
          <TabBtn label="设置" active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>
      </header>

      {tab === 'dashboard' && (
        <section className="space-y-4">
          <Summary metrics={metrics} />
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-2 text-sm font-semibold">资产占比</h3>
            <AllocationChart metrics={metrics} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-2 text-sm font-semibold">本地风险扫描</h3>
            <RiskList findings={findings} />
          </div>
        </section>
      )}

      {tab === 'holdings' && (
        <section className="space-y-4">
          <HoldingsTable
            metrics={metrics.holdingsMetrics}
            onAdd={addHolding}
            onUpdate={updateHolding}
            onDelete={deleteHolding}
          />
          <CashEditor cash={portfolio.cash} onChange={setCash} />
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
        数据保存在浏览器 localStorage；清除浏览器数据会丢失。建议定期导出 JSON 备份。
      </footer>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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
