import type {
  AppSettings,
  PortfolioMetrics,
  RiskFinding,
} from './types';

const DEFAULT_ENDPOINT = 'https://api.moonshot.cn/v1/chat/completions';

interface KimiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface KimiResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string };
}

export class KimiError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'KimiError';
    this.hint = hint;
  }
}

function buildPrompt(metrics: PortfolioMetrics, localFindings: RiskFinding[]): KimiMessage[] {
  const summary = {
    totalValue: round(metrics.totalValue),
    totalCost: round(metrics.totalCost),
    totalPnl: round(metrics.totalPnl),
    totalPnlPct: pct(metrics.totalPnlPct),
    cashWeight: pct(metrics.cashWeight),
    sectorWeights: Object.fromEntries(
      Object.entries(metrics.sectorWeights).map(([k, v]) => [k, pct(v)]),
    ),
    holdings: metrics.holdingsMetrics.map((m) => ({
      symbol: m.holding.symbol,
      name: m.holding.name,
      sector: m.holding.sector,
      shares: m.holding.shares,
      buyPrice: m.holding.buyPrice,
      currentPrice: m.holding.currentPrice,
      marketValue: round(m.marketValue),
      weight: pct(m.weight),
      pnlPct: pct(m.pnlPct),
    })),
    localFindings: localFindings.map((f) => `[${f.level}] ${f.title} — ${f.detail}`),
  };

  return [
    {
      role: 'system',
      content:
        '你是一名严谨、克制的投资组合分析师。基于用户提供的持仓和已有的本地风险提示，给出结构化中文分析。' +
        '严格遵守：1) 不做买卖推荐 2) 不预测短期价格 3) 客观指出集中度/行业/现金比/盈亏分布问题 4) 给出 3-5 条可执行的再平衡思路。' +
        '输出 Markdown，使用「## 总体结论」「## 主要风险」「## 再平衡建议」三个二级标题。',
    },
    {
      role: 'user',
      content: '组合快照（JSON）：\n```json\n' + JSON.stringify(summary, null, 2) + '\n```',
    },
  ];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export async function analyzeWithKimi(
  settings: AppSettings,
  metrics: PortfolioMetrics,
  localFindings: RiskFinding[],
): Promise<string> {
  if (!settings.kimiApiKey) {
    throw new KimiError('未配置 Kimi API Key', '请在「设置」中填入 Moonshot API Key。');
  }

  const endpoint = settings.proxyUrl?.trim() || DEFAULT_ENDPOINT;
  const messages = buildPrompt(metrics, localFindings);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.kimiApiKey}`,
      },
      body: JSON.stringify({
        model: settings.kimiModel || 'moonshot-v1-8k',
        messages,
        temperature: 0.3,
      }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new KimiError(
      `网络请求失败：${msg}`,
      '浏览器直连 Moonshot API 可能被 CORS 拦截。请在「设置」中填入你的代理 URL（如 Cloudflare Worker / Vercel Function），参考 README 中的代理示例。',
    );
  }

  let data: KimiResponse;
  try {
    data = (await response.json()) as KimiResponse;
  } catch {
    throw new KimiError(`响应非 JSON（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new KimiError(
      data.error?.message ?? `HTTP ${response.status}`,
      response.status === 401 ? '请检查 API Key 是否正确、是否过期。' : undefined,
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new KimiError('Kimi 返回为空');
  }
  return content;
}
