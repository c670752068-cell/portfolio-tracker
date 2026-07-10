import { useState } from 'react';
import type { AppSettings, QuoteProvider } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
}

export function SettingsPanel({ settings, onSave }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);

  function save() {
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="text-sm font-semibold">设置</h3>
      <Field label="Kimi API Key（Moonshot）">
        <input
          type="password"
          value={draft.kimiApiKey}
          onChange={(e) => setDraft({ ...draft, kimiApiKey: e.target.value })}
          placeholder="sk-..."
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-500">
          仅保存在本机浏览器（localStorage）。解析图片时，Key 与图片会发送给 Kimi API（或你填写的代理），不会进入 GitHub 仓库。
        </p>
      </Field>
      <Field label="Kimi 视觉模型">
        <select
          value={draft.kimiModel}
          onChange={(e) => setDraft({ ...draft, kimiModel: e.target.value })}
          className={inputCls}
        >
          <option value="kimi-k2.6">kimi-k2.6（推荐：图片识别 + 组合分析）</option>
          <option value="kimi-k2.5">kimi-k2.5</option>
          <option value="moonshot-v1-8k-vision-preview">moonshot-v1-8k-vision-preview</option>
          <option value="moonshot-v1-32k-vision-preview">moonshot-v1-32k-vision-preview</option>
          <option value="moonshot-v1-128k-vision-preview">moonshot-v1-128k-vision-preview</option>
        </select>
      </Field>
      <Field label="代理 URL（可选，处理 CORS）">
        <input
          value={draft.proxyUrl}
          onChange={(e) => setDraft({ ...draft, proxyUrl: e.target.value })}
          placeholder="https://your-worker.workers.dev/v1/chat/completions"
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-500">
          浏览器直连 Moonshot 可能被 CORS 拦截。如失败，部署 README 中的 Cloudflare Worker 代理并填入此处。该代理需要把本网站域名加入允许列表。
        </p>
      </Field>
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h4 className="mb-2 text-sm font-semibold">行情同步</h4>
        <div className="space-y-3">
          <Field label="行情源">
            <select
              value={draft.quoteProvider}
              onChange={(e) => setDraft({ ...draft, quoteProvider: e.target.value as QuoteProvider })}
              className={inputCls}
            >
              <option value="none">暂不自动同步</option>
              <option value="finnhub">Finnhub（实时/准实时，需 API Key）</option>
              <option value="fmp">Financial Modeling Prep（需 API Key）</option>
              <option value="alphavantage">Alpha Vantage（日线/收盘价，需 API Key）</option>
              <option value="proxy">自建行情代理（NASDAQ Worker）</option>
            </select>
          </Field>
          {draft.quoteProvider !== 'none' && draft.quoteProvider !== 'proxy' && (
            <Field label="行情 API Key">
              <input
                type="password"
                value={draft.quoteApiKey}
                onChange={(e) => setDraft({ ...draft, quoteApiKey: e.target.value })}
                placeholder="行情服务的 API Key"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-500">
                仅保存在本机浏览器。用于刷新股票/ETF 当前价、今日涨跌和组合占比；不会进入 GitHub 仓库。
              </p>
            </Field>
          )}
          {draft.quoteProvider === 'proxy' && (
            <Field label="行情代理 URL">
              <input
                value={draft.quoteProxyUrl}
                onChange={(e) => setDraft({ ...draft, quoteProxyUrl: e.target.value })}
                placeholder="https://your-worker.workers.dev/quotes"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-500">
                使用 README 中的 Cloudflare Worker 模板可代理 NASDAQ 报价，URL 填到 /quotes。
              </p>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.autoRefreshQuotes}
              onChange={(e) => setDraft({ ...draft, autoRefreshQuotes: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            进入页面后自动刷新，并每 15 分钟刷新一次
          </label>
        </div>
      </div>
      <button
        onClick={save}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        {saved ? '已保存 ✓' : '保存设置'}
      </button>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 font-medium">{label}</div>
      {children}
    </label>
  );
}
