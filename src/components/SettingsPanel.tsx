import { useState } from 'react';
import { isInvalidEndpointUrl, looksLikeApiKey, sanitizeEndpointUrl } from '../endpointUrl';
import { KimiError, activeAiEndpoint, activeAiProviderLabel, testAiConnection } from '../kimi';
import { getServerAiProxyUrl, getServerQuoteProxyUrl, hasServerGateway, serverGatewayLabel } from '../runtimeConfig';
import type { AiProvider, AppSettings, QuoteProvider } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
}

export function SettingsPanel({ settings, onSave }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string; hint?: string } | null>(null);
  const aiLabel = activeAiProviderLabel(draft);
  const serverGatewayEnabled = hasServerGateway();

  function save() {
    const endpointValues = [draft.proxyUrl, draft.zhipuProxyUrl];
    if (draft.quoteProvider === 'proxy') endpointValues.push(draft.quoteProxyUrl);
    if (endpointValues.some(looksLikeApiKey)) {
      setSaveError('这里应填代理网址，你粘贴的是 API Key；Key 请填到上方「API Key」输入框');
      return;
    }
    if (endpointValues.some(isInvalidEndpointUrl)) {
      setSaveError('代理 URL 必须是 http(s):// 开头的完整网址');
      return;
    }
    setSaveError('');
    onSave({
      ...draft,
      proxyUrl: sanitizeEndpointUrl(draft.proxyUrl),
      zhipuProxyUrl: sanitizeEndpointUrl(draft.zhipuProxyUrl),
      quoteProxyUrl: sanitizeEndpointUrl(draft.quoteProxyUrl),
      exposureTargetPct: draft.exposureTargetPct >= 50 && draft.exposureTargetPct <= 300
        ? draft.exposureTargetPct
        : 100,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function testConnection() {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      const message = await testAiConnection(draft);
      setAiTestResult({ ok: true, message });
    } catch (error: unknown) {
      if (error instanceof KimiError) setAiTestResult({ ok: false, message: error.message, hint: error.hint });
      else setAiTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTestingAi(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="text-sm font-semibold">设置</h3>
      {serverGatewayEnabled && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          已启用 {serverGatewayLabel()}：截图和行情请求先经过服务器（{serverGatewayLabel()}），手机不再直接连接 AI 接口。
        </div>
      )}
      <Field label="AI 识别服务">
        <select
          value={draft.aiProvider}
          onChange={(e) => { setDraft({ ...draft, aiProvider: e.target.value as AiProvider }); setAiTestResult(null); }}
          className={inputCls}
        >
          <option value="zhipu">智谱 GLM（推荐：先用这个识别截图）</option>
          <option value="kimi">Kimi / Moonshot（备用）</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">
          当前默认切到智谱。你手机上的 Kimi 已经表现为 90 秒超时，说明不是图片压缩问题，优先用智谱更稳。
        </p>
      </Field>
      {draft.aiProvider === 'zhipu' ? (
        <>
          <Field label="智谱 API Key（BigModel）">
            <input
              type="password"
              value={draft.zhipuApiKey}
              onChange={(e) => setDraft({ ...draft, zhipuApiKey: e.target.value })}
              placeholder="填入智谱开放平台 API Key"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-slate-500">
              仅保存在本机浏览器（localStorage）。解析图片时，Key 与图片会发送给智谱 API（或你填写的代理），不会进入 GitHub 仓库。
            </p>
          </Field>
          <Field label="智谱视觉模型">
            <select
              value={draft.zhipuModel}
              onChange={(e) => setDraft({ ...draft, zhipuModel: e.target.value })}
              className={inputCls}
            >
              <option value="glm-4.6v-flash">glm-4.6v-flash（推荐：免费/较快）</option>
              <option value="glm-4v-flash">glm-4v-flash（轻量免费）</option>
              <option value="glm-5v-turbo">glm-5v-turbo（更强，可能更贵）</option>
              <option value="glm-4.6v">glm-4.6v（更强）</option>
              <option value="glm-4.1v-thinking-flash">glm-4.1v-thinking-flash</option>
            </select>
          </Field>
          <Field label="智谱代理 URL（可选）">
            <input
              value={draft.zhipuProxyUrl}
              onChange={(e) => setDraft({ ...draft, zhipuProxyUrl: e.target.value })}
              placeholder="https://your-worker.workers.dev/zhipu/chat/completions"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-slate-500">
              {serverGatewayEnabled
                ? `当前会自动使用服务器转发（${getServerAiProxyUrl('zhipu')}），无需填写。只有要换其他代理时才填。填写后会覆盖服务器转发，通常应留空。`
                : '直连智谱失败时再填。README 里的 Worker 模板已支持 /zhipu/chat/completions。填写后会覆盖服务器转发，通常应留空。'}
            </p>
          </Field>
        </>
      ) : (
        <>
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
              <option value="kimi-k2.6">kimi-k2.6（图片识别 + 组合分析）</option>
              <option value="kimi-k2.5">kimi-k2.5</option>
              <option value="moonshot-v1-8k-vision-preview">moonshot-v1-8k-vision-preview</option>
              <option value="moonshot-v1-32k-vision-preview">moonshot-v1-32k-vision-preview</option>
              <option value="moonshot-v1-128k-vision-preview">moonshot-v1-128k-vision-preview</option>
            </select>
          </Field>
          <Field label="Kimi 代理 URL（可选）">
            <input
              value={draft.proxyUrl}
              onChange={(e) => setDraft({ ...draft, proxyUrl: e.target.value })}
              placeholder="https://your-worker.workers.dev/v1/chat/completions"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-slate-500">
              {serverGatewayEnabled
                ? `当前会自动使用服务器转发（${getServerAiProxyUrl('kimi')}），无需填写。填写后会覆盖服务器转发，通常应留空。`
                : '浏览器直连 Moonshot 可能超时。如仍出现 Load failed，部署 README 中的 Worker 代理并填入此处。填写后会覆盖服务器转发，通常应留空。'}
            </p>
          </Field>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={testConnection}
          disabled={testingAi}
          className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
        >
          {testingAi ? '测试中…' : `测试 ${aiLabel} 连接`}
        </button>
        {aiTestResult && (
          <span className={`text-xs ${aiTestResult.ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
            {aiTestResult.ok ? aiTestResult.message : `失败：${aiTestResult.message}`}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">当前生效接口：{activeAiEndpoint(draft)}</p>
      {aiTestResult?.hint && <p className="text-xs text-amber-600 dark:text-amber-300">{aiTestResult.hint}</p>}
      <Field label="等效仓位目标 %">
        <input
          type="number"
          min={50}
          max={300}
          step={5}
          value={draft.exposureTargetPct}
          onChange={(event) => setDraft({ ...draft, exposureTargetPct: Number(event.target.value) })}
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-500">
          等效仓位 = 正股 + 杠杆 ETF×倍数 + 期权 Delta 折算后的总敞口 ÷ 总资产。留现金子弹但用杠杆/期权把等效顶到目标，是本设置的用途。
        </p>
      </Field>
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h4 className="mb-2 text-sm font-semibold">量化系统同步</h4>
        <p className="mb-3 text-xs text-slate-500">
          持仓来自你 Mac 上的量化系统（IBKR+长桥+富途三券商聚合，每 45 分钟推送一次）。启用后，截图导入退为补充手段。
        </p>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.quantSyncEnabled}
              onChange={(event) => setDraft({ ...draft, quantSyncEnabled: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            启用量化系统持仓同步
          </label>
          <Field label="同步 Token">
            <input
              type="password"
              value={draft.quantSyncToken}
              onChange={(event) => setDraft({ ...draft, quantSyncToken: event.target.value })}
              placeholder="与 VPS 的 PORTFOLIO_SYNC_TOKEN 一致"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-slate-500">
              仅保存在本机浏览器 localStorage，不会进入仓库或导出的组合 JSON。
            </p>
          </Field>
          {!serverGatewayEnabled && (
            <p className="text-xs text-amber-600 dark:text-amber-300">量化同步仅在 VPS 入口可用；GitHub Pages 入口仍可使用其他功能。</p>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h4 className="mb-2 text-sm font-semibold">每日行情同步</h4>
        <div className="space-y-3">
          <Field label="行情源">
            <select
              value={draft.quoteProvider}
              onChange={(e) => setDraft({ ...draft, quoteProvider: e.target.value as QuoteProvider })}
              className={inputCls}
            >
              <option value="none">暂不自动同步</option>
              <option value="finnhub">Finnhub（需 API Key）</option>
              <option value="fmp">Financial Modeling Prep（需 API Key）</option>
              <option value="alphavantage">Alpha Vantage（日线/收盘价，需 API Key）</option>
              <option value="proxy">自建免费行情代理（Yahoo/NASDAQ Worker）</option>
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
                仅保存在本机浏览器。用于每天北京时间 7 点后刷新股票/ETF 价格、涨跌和组合占比；不会进入 GitHub 仓库。
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
                {serverGatewayEnabled
                  ? `本部署可直接使用服务器免费行情地址（${getServerQuoteProxyUrl()}）。`
                  : '使用 README 中的 Cloudflare Worker 模板可代理 Yahoo/NASDAQ 免费报价，URL 填到 /quotes。'}
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
            北京时间每天 7 点后自动刷新一次（同一天不重复刷）
          </label>
          <p className="text-xs text-slate-500">
            不是实时盯盘；适合每天看一次组合占比和当日涨跌。需要立刻更新时，可在「总览」手动刷新。
          </p>
        </div>
      </div>
      <button
        onClick={save}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        {saved ? '已保存 ✓' : '保存设置'}
      </button>
      {saveError && <p className="text-xs text-rose-600 dark:text-rose-300">{saveError}</p>}
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
