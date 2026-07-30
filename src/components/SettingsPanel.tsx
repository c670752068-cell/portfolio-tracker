import { useState } from 'react';
import { analyzeCostCoverage, type CostGapReason } from '../costCoverage';
import { isInvalidEndpointUrl, looksLikeApiKey, sanitizeEndpointUrl } from '../endpointUrl';
import { KimiError, activeAiEndpoint, activeAiProviderLabel, testAiConnection } from '../kimi';
import { getServerAiProxyUrl, getServerQuoteProxyUrl, hasServerGateway, serverGatewayLabel } from '../runtimeConfig';
import type { AiProvider, AppSettings, Holding, QuantHoldingCost, QuoteProvider, ValuationIndexKey } from '../types';
import { VALUATION_ANCHOR_POLICY_TEXT } from '../valuationAnchorPolicy';
import { REFRESH_CADENCE } from '../refreshCadence';

interface SettingsPanelProps {
  settings: AppSettings;
  holdings?: readonly Holding[];
  holdingCosts?: Readonly<Record<string, QuantHoldingCost>>;
  onSave: (s: AppSettings) => void;
}

const COST_GAP_LABELS: Record<CostGapReason, string> = {
  option_no_source: '期权成本无量化来源',
  equity_no_source: '正股及 ETF 成本无来源',
  quant_coverage_incomplete: '量化成本覆盖不完整',
  manual_missing: '手动成本缺失',
};

const COST_GAP_GUIDANCE: Record<CostGapReason, string> = {
  option_no_source: '期权成本量化系统未提供，请在「持仓 → 补充期权详情」上传期权详情页截图',
  equity_no_source: '请在持仓表手动补填买入价',
  quant_coverage_incomplete: '量化系统对该标的的成本覆盖不完整，请在持仓表手动补填买入价，或联系量化侧确认该券商是否提供成本',
  manual_missing: '请在持仓表补填买入价',
};

const COVERAGE_LABELS: Record<string, string> = {
  unavailable: '券商未提供成本',
  partial: '成本不完整',
  missing: '无成本记录',
};

const VALUATION_INDEX_KEYS: readonly ValuationIndexKey[] = ['NDX', 'SOX', 'SPX', 'DJI', 'FANGPLUS'];

function CostCoverageCard({
  holdings,
  holdingCosts,
}: {
  holdings: readonly Holding[];
  holdingCosts: Readonly<Record<string, QuantHoldingCost>>;
}) {
  const analysis = analyzeCostCoverage(holdings, holdingCosts);
  const reasons: CostGapReason[] = ['option_no_source', 'equity_no_source', 'quant_coverage_incomplete', 'manual_missing'];
  return (
    <div className="rounded-lg border border-neutral/40 p-3 dark:border-neutral/60">
      <h3 className="text-sm font-semibold">成本数据覆盖</h3>
      <p className="mt-1 text-sm">已有成本 {analysis.costed} / 共 {analysis.total} 个持仓</p>
      {analysis.gaps.length === 0 ? (
        <p className="mt-2 text-sm font-medium text-gain dark:text-gain">全部持仓成本齐全</p>
      ) : reasons.map((reason) => {
        const rows = analysis.gaps.filter((gap) => gap.reason === reason);
        if (rows.length === 0) return null;
        return (
          <div className="mt-3 rounded-md bg-surface-overlay/30 p-2 text-xs dark:bg-surface-base" key={reason}>
            <div className="font-semibold">{COST_GAP_LABELS[reason]}</div>
            <ul className="mt-1 space-y-1 text-ink-secondary dark:text-ink-secondary">
              {rows.map((row, index) => {
                const quantCost = holdingCosts[row.symbol];
                const coverage = reason === 'quant_coverage_incomplete'
                  ? ` · ${COVERAGE_LABELS[quantCost?.coverage ?? 'missing']}`
                  : '';
                return <li key={`${row.symbol}-${row.assetType}-${row.broker ?? ''}-${index}`}>{row.symbol}{row.broker ? ` · ${row.broker}` : ''}{coverage}</li>;
              })}
            </ul>
            <p className="mt-2 text-trim dark:text-trim">{COST_GAP_GUIDANCE[reason]}</p>
          </div>
        );
      })}
    </div>
  );
}

export function SettingsPanel({ settings, holdings = [], holdingCosts = {}, onSave }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [savedSettings, setSavedSettings] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string; hint?: string } | null>(null);
  const aiLabel = activeAiProviderLabel(draft);
  const serverGatewayEnabled = hasServerGateway();
  const dirtyCount = Object.keys(draft).filter((key) => (
    JSON.stringify(draft[key as keyof AppSettings]) !== JSON.stringify(savedSettings[key as keyof AppSettings])
  )).length;

  function updateManualAnchor(index: ValuationIndexKey, rawValue: string) {
    const next = { ...draft.valuationManualAnchors };
    const value = Number(rawValue);
    if (rawValue.trim() === '' || !Number.isFinite(value) || value <= 0) delete next[index];
    else next[index] = value;
    setDraft({ ...draft, valuationManualAnchors: next });
  }

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
    const nextSettings = {
      ...draft,
      proxyUrl: sanitizeEndpointUrl(draft.proxyUrl),
      zhipuProxyUrl: sanitizeEndpointUrl(draft.zhipuProxyUrl),
      quoteProxyUrl: sanitizeEndpointUrl(draft.quoteProxyUrl),
      exposureTargetPct: draft.exposureTargetPct >= 50 && draft.exposureTargetPct <= 300
        ? draft.exposureTargetPct
        : 100,
    };
    onSave(nextSettings);
    setDraft(nextSettings);
    setSavedSettings(nextSettings);
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
    <div className="space-y-3 rounded-xl border border-neutral/40 bg-surface-raised p-3 dark:border-neutral/60 dark:bg-surface-raised">
      <h2 className="text-sm font-semibold">设置</h2>
      {serverGatewayEnabled && (
        <div className="rounded-md border border-gain/40 bg-gain/10 p-2 text-xs text-gain dark:border-gain/30 dark:bg-gain/20 dark:text-gain">
          已启用 {serverGatewayLabel()}：截图和行情请求先经过服务器，手机不再直接连接 AI 接口。
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
        <p className="mt-1 text-xs text-ink-muted">
          默认使用智谱（更稳定）。Kimi 作为备用，网络不佳时可能超时。
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
            <p className="mt-1 text-xs text-ink-muted">
              仅保存在本机浏览器（localStorage）。解析图片时，Key 与图片会发送给智谱 API（或你填写的代理），不会进入 GitHub 仓库。
            </p>
          </Field>
          <Field label="智谱视觉模型">
            <select
              value={draft.zhipuModel}
              onChange={(e) => setDraft({ ...draft, zhipuModel: e.target.value })}
              className={inputCls}
            >
              <option value="glm-4.6v-flash">glm-4.6v-flash（免费/快）</option>
              <option value="glm-4v-flash">glm-4v-flash（免费/轻量）</option>
              <option value="glm-5v-turbo">glm-5v-turbo（更强/更贵）</option>
              <option value="glm-4.6v">glm-4.6v（更强/免费额度低）</option>
              <option value="glm-4.1v-thinking-flash">glm-4.1v-thinking-flash（思维链/最慢）</option>
            </select>
          </Field>
          <Field label="智谱代理 URL（可选）">
            <input
              value={draft.zhipuProxyUrl}
              onChange={(e) => setDraft({ ...draft, zhipuProxyUrl: e.target.value })}
              placeholder="https://your-worker.workers.dev/zhipu/chat/completions"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-ink-muted">
              {serverGatewayEnabled
                ? '已自动使用服务器转发，无需填写。只有要换其他代理时才填。填写后会覆盖服务器转发，通常应留空。'
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
            <p className="mt-1 text-xs text-ink-muted">
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
            <p className="mt-1 text-xs text-ink-muted">
              {serverGatewayEnabled
                ? '已自动使用服务器转发，无需填写。填写后会覆盖服务器转发，通常应留空。'
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
          className="rounded-md bg-surface-overlay px-3 py-1.5 text-sm text-ink-primary hover:bg-neutral/40 disabled:cursor-not-allowed disabled:bg-neutral/60 dark:bg-surface-overlay dark:text-ink-primary dark:hover:bg-neutral"
        >
          {testingAi ? '测试中…' : `测试 ${aiLabel} 连接`}
        </button>
        {aiTestResult && (
          <span className={`text-xs ${aiTestResult.ok ? 'text-gain dark:text-gain' : 'text-loss dark:text-loss'}`}>
            {aiTestResult.ok ? aiTestResult.message : `失败：${aiTestResult.message}`}
          </span>
        )}
      </div>
      <p className="text-xs text-ink-muted">当前生效接口：{serverGatewayEnabled ? '已自动使用服务器转发' : activeAiEndpoint(draft)}</p>
      {serverGatewayEnabled && (
        <details className="rounded-md border border-neutral/40 p-2 text-xs text-ink-muted">
          <summary className="cursor-pointer">完整转发地址（仅排障时查看）</summary>
          <ul className="mt-2 space-y-1 break-all font-mono tabular-nums">
            <li>智谱：{getServerAiProxyUrl('zhipu')}</li>
            <li>Kimi：{getServerAiProxyUrl('kimi')}</li>
            <li>行情：{getServerQuoteProxyUrl()}</li>
          </ul>
        </details>
      )}
      {aiTestResult?.hint && <p className="text-xs text-trim dark:text-trim">{aiTestResult.hint}</p>}
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
        <p className="mt-1 text-xs text-ink-muted">
          等效仓位 =（正股 + 杠杆 ETF × 倍数 + 期权 Delta 折算）÷ 总资产。留现金子弹但用杠杆/期权把等效顶到目标，是本设置的用途。
        </p>
      </Field>
      <div className="rounded-lg border border-neutral/40 p-3 dark:border-neutral/60">
        <h3 className="mb-2 text-sm font-semibold">量化系统同步</h3>
        <p className="text-xs text-ink-muted">
          {serverGatewayEnabled
            ? `已启用跨设备自动同步：Mac 量化系统${REFRESH_CADENCE.brokers.interval}汇总 IBKR、长桥和富途后推送到 VPS；手机和电脑打开本网址会自动读取同一份持仓，不再需要分别填 Token。`
            : '请使用 VPS 入口打开网站，GitHub Pages 无法跨设备读取服务器持仓。'}
        </p>
      </div>
      <CostCoverageCard holdings={holdings} holdingCosts={holdingCosts} />
      <div className="rounded-lg border border-neutral/40 p-3 dark:border-neutral/60">
        <h3 className="mb-2 text-sm font-semibold">估值数据补充</h3>
        <Field label="Alpha Vantage PE API Key">
          <input
            type="password"
            value={draft.peApiKey ?? ''}
            onChange={(event) => setDraft({ ...draft, peApiKey: event.target.value })}
            placeholder="仅在量化 PE 序列缺失时使用"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-ink-muted">
            仅保存在本机浏览器；每个标的每天最多请求一次。量化系统已有 PE 序列时不会调用。
          </p>
        </Field>
      </div>
      <div className="rounded-lg border border-neutral/40 p-3 dark:border-neutral/60">
        <h3 className="mb-2 text-sm font-semibold">估值基准</h3>
        <p className="text-xs text-ink-muted">{VALUATION_ANCHOR_POLICY_TEXT}</p>
        <p className="mb-3 mt-1 text-xs text-ink-muted">
          手动锚点仅在对应指数填写后覆盖自动值。阈值表示当前 PE 高于锚点的距离分区，不改变量化系统的任何开窗结论。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="锚点窗口开始">
            <input
              type="date"
              value={draft.valuationAnchorStart}
              onChange={(event) => setDraft({ ...draft, valuationAnchorStart: event.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="锚点窗口结束">
            <input
              type="date"
              value={draft.valuationAnchorEnd}
              onChange={(event) => setDraft({ ...draft, valuationAnchorEnd: event.target.value })}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {VALUATION_INDEX_KEYS.map((index) => (
            <Field label={`${index} 手动锚点`} key={index}>
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.valuationManualAnchors[index] ?? ''}
                onChange={(event) => updateManualAnchor(index, event.target.value)}
                placeholder="留空则自动取窗口最低值"
                className={inputCls}
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="已进入锚点区阈值">
            <input
              type="number"
              min={0}
              step="0.1"
              value={draft.valuationAtAnchorPct}
              onChange={(event) => setDraft({ ...draft, valuationAtAnchorPct: Number(event.target.value) })}
              className={inputCls}
            />
          </Field>
          <Field label="接近锚点阈值">
            <input
              type="number"
              min={0}
              step="0.1"
              value={draft.valuationNearAnchorPct}
              onChange={(event) => setDraft({ ...draft, valuationNearAnchorPct: Number(event.target.value) })}
              className={inputCls}
            />
          </Field>
        </div>
      </div>
      <div className="rounded-lg border border-neutral/40 p-3 dark:border-neutral/60">
        <h3 className="mb-2 text-sm font-semibold">每日行情同步</h3>
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
              <p className="mt-1 text-xs text-ink-muted">
                仅保存在本机浏览器。用于{REFRESH_CADENCE.dailyFallback.interval}刷新股票/ETF 价格、涨跌和组合占比；不会进入 GitHub 仓库。
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
            <p className="mt-1 text-xs text-ink-muted">
                {serverGatewayEnabled
                  ? '本部署已自动使用服务器免费行情转发。'
                  : '使用 README 中的 Cloudflare Worker 模板可代理 Yahoo/NASDAQ 免费报价，URL 填到 /quotes。'}
              </p>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.autoRefreshQuotes}
              onChange={(e) => setDraft({ ...draft, autoRefreshQuotes: e.target.checked })}
              className="h-4 w-4 rounded border-neutral/60"
            />
            {REFRESH_CADENCE.dailyFallback.interval}自动刷新（同一天不重复刷）
          </label>
          <p className="text-xs text-ink-muted">
            不是实时盯盘；适合每天看一次组合占比和当日涨跌。需要立刻更新时，可在「总览」手动刷新。
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-neutral/40 p-3 dark:border-neutral/60">
        <h3 className="mb-2 text-sm font-semibold">刷新节奏</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="text-ink-muted"><tr><th className="pb-2">项目</th><th className="pb-2">节奏</th><th className="pb-2">范围</th></tr></thead>
            <tbody>
              {Object.values(REFRESH_CADENCE).map((item) => (
                <tr key={item.label}>
                  <td className="border-t border-neutral/20 py-2">{item.label}</td>
                  <td className="border-t border-neutral/20 py-2 tabular-nums">{item.interval}</td>
                  <td className="border-t border-neutral/20 py-2 text-ink-secondary">{item.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {saveError && <p className="text-xs text-loss dark:text-loss">{saveError}</p>}
      {dirtyCount > 0 && <SettingsSaveBar dirtyCount={dirtyCount} onSave={save} />}
      {saved && dirtyCount === 0 && <p className="text-xs font-medium text-gain">已保存 ✓</p>}
    </div>
  );
}

export function SettingsSaveBar({ dirtyCount, onSave }: { dirtyCount: number; onSave: () => void }) {
  return (
    <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 rounded-xl border border-neutral/40 bg-surface-raised/90 p-3 shadow-lg backdrop-blur-xl">
      <span className="text-sm font-medium text-ink-primary">{dirtyCount} 项未保存</span>
      <button
        type="button"
        onClick={onSave}
        className="min-h-11 rounded-xl bg-buy px-4 py-2 text-sm font-semibold text-surface-base hover:bg-buy/85"
      >
        保存设置
      </button>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-neutral/60 bg-surface-raised px-2 py-1.5 text-sm tabular-nums focus:border-buy focus:outline-none dark:border-neutral dark:bg-surface-base';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 font-medium">{label}</div>
      {children}
    </label>
  );
}
