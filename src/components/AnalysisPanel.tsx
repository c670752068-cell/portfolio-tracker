import { useState } from 'react';
import { KimiError, analyzeWithKimi } from '../kimi';
import type { AppSettings, PortfolioMetrics, RiskFinding } from '../types';

interface AnalysisPanelProps {
  settings: AppSettings;
  metrics: PortfolioMetrics;
  localFindings: RiskFinding[];
}

export function AnalysisPanel({ settings, metrics, localFindings }: AnalysisPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<string>('');

  async function run() {
    setLoading(true);
    setError(null);
    setResult('');
    try {
      const content = await analyzeWithKimi(settings, metrics, localFindings);
      setResult(content);
    } catch (err: unknown) {
      if (err instanceof KimiError) {
        setError({ message: err.message, hint: err.hint });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError({ message: msg });
      }
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || metrics.totalValue <= 0;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Kimi 组合风险解读</h3>
        <button
          onClick={run}
          disabled={disabled}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {loading ? '分析中…' : '调用 Kimi 分析'}
        </button>
      </div>
      {!settings.kimiApiKey && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          未配置 Kimi API Key。请到「设置」中填入 Moonshot API Key。仅保存在本机浏览器，不会上传仓库。
        </div>
      )}
      <p className="text-xs leading-relaxed text-slate-500">
        AI 只基于当前已录入的数据生成教育性风险解读，不构成投资、交易或税务建议。期权将优先关注短到期、较大浮亏及已识别的 Delta 暴露。
      </p>
      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-100">
          <div className="font-semibold">分析失败：{error.message}</div>
          {error.hint && <div className="mt-1 opacity-90">{error.hint}</div>}
        </div>
      )}
      {result && (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-relaxed dark:bg-slate-900">
          {result}
        </pre>
      )}
    </div>
  );
}
