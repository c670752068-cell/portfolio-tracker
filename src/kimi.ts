import type {
  AiProvider,
  AppSettings,
  AssetType,
  CashPosition,
  Currency,
  ImportedPortfolio,
  ImportIssue,
  OptionDetails,
  ParsedOptionDetail,
  ParsedOptionDetails,
} from './types';
import { classifyAiFailure, isRetryableAiFailure, type AiFailureKind } from './aiFailure';
import { isMixedContentBlocked, sanitizeEndpointUrl } from './endpointUrl';
import { getServerAiProxyUrl, serverGatewayLabel } from './runtimeConfig';
import { crossCheckImportedPnl, mergeImportedHoldings } from './importMerge';

const KIMI_ENDPOINT = 'https://api.moonshot.cn/v1/chat/completions';
const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const REQUEST_TIMEOUT_MS = 180_000;
const PING_TIMEOUT_MS = 20_000;
const STANDARD_RETRY_DELAYS_MS = [30_000, 65_000];
const KIMI_VISION_MODELS = new Set([
  'kimi-k2.6',
  'kimi-k2.5',
  'moonshot-v1-8k-vision-preview',
  'moonshot-v1-32k-vision-preview',
  'moonshot-v1-128k-vision-preview',
]);
const ZHIPU_VISION_MODELS = new Set([
  'glm-4.6v-flash',
  'glm-4.6v',
  'glm-5v-turbo',
  'glm-4v-flash',
  'glm-4.1v-thinking-flash',
  'glm-4.1v-thinking-flashx',
]);

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string } };
type AiContent = string | Array<TextPart | ImagePart>;

interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: AiContent;
}

interface AiResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string; code?: string };
}

export interface ImageForImport {
  dataUrl: string;
  name: string;
}

export class KimiError extends Error {
  hint?: string;
  failureKind: AiFailureKind;
  constructor(message: string, hint?: string, failureKind: AiFailureKind = 'other') {
    super(message);
    this.name = 'KimiError';
    this.hint = hint;
    this.failureKind = failureKind;
  }
}

export interface AiRetryWaitInfo {
  attempt: number;
  total: number;
  delayMs: number;
  reason: string;
}

interface AiRequestOptions {
  maxTokens?: number;
  timeoutMs?: number;
  retryDelaysMs?: number[];
  onRetryWait?: (info: AiRetryWaitInfo) => void;
  modelOverride?: string;
}

interface ImageParseCallbacks {
  onRetryWait?: (info: AiRetryWaitInfo) => void;
  onNotice?: (text: string) => void;
}

interface AiRuntimeConfig {
  provider: AiProvider;
  label: string;
  endpoint: string;
  directEndpoint: string;
  apiKey: string;
  model: string;
  usesProxy: boolean;
  usesServerGateway: boolean;
}

export function activeAiProviderLabel(settings: AppSettings): string {
  return getAiRuntimeConfig(settings).label;
}

export function activeAiApiKey(settings: AppSettings): string {
  return getAiRuntimeConfig(settings).apiKey;
}

export function activeAiEndpoint(settings: AppSettings): string {
  return getAiRuntimeConfig(settings).endpoint;
}

export async function testAiConnection(settings: AppSettings): Promise<string> {
  const label = activeAiProviderLabel(settings);
  const content = await requestAi(
    settings,
    [{ role: 'user', content: '只回复 OK，用于测试 API 连接。' }],
    { maxTokens: 16, timeoutMs: PING_TIMEOUT_MS },
  );
  return `${label} 连接成功：${content.slice(0, 40) || 'OK'}`;
}

export async function parsePortfolioImages(
  settings: AppSettings,
  images: ImageForImport[],
  callbacks: ImageParseCallbacks = {},
): Promise<ImportedPortfolio> {
  if (images.length === 0) throw new KimiError('请先选择至少一张持仓或期权详情截图。');
  const provider = settings.aiProvider ?? 'zhipu';
  const model = provider === 'kimi' ? settings.kimiModel : settings.zhipuModel;
  if (provider === 'kimi' && !KIMI_VISION_MODELS.has(model)) {
    throw new KimiError(
      '当前选择的模型不支持图片识别',
      '请到「设置」把模型改为 kimi-k2.6 或任一 vision-preview 模型后保存。',
    );
  }
  if (provider === 'zhipu' && !ZHIPU_VISION_MODELS.has(model)) {
    throw new KimiError(
      '当前选择的智谱模型不支持图片识别',
      '请到「设置」把智谱模型改为 glm-4.6v-flash、glm-5v-turbo 或 glm-4v-flash 后保存。',
    );
  }

  const imageParts: ImagePart[] = images.map((image) => ({
    type: 'image_url',
    image_url: { url: image.dataUrl },
  }));
  const content: Array<TextPart | ImagePart> = [
    {
      type: 'text',
      text: `你正在读取 ${images.length} 张券商持仓截图。识别股票、ETF、杠杆 ETF、基金、现金和期权，并把同一张/不同张截图中的数据互相核对。\n\n` +
        '只输出一个合法 JSON 对象，不要 Markdown、不要解释、不要使用 null 以外的非 JSON 值。数值必须是数字，货币必须是 USD、CNY、HKD 或 OTHER。\n' +
        'JSON 结构：\n' +
        '{"holdings":[{"symbol":"IGV","name":"iShares Expanded Tech-Software Sector ETF","assetType":"option","shares":2,"buyPrice":7.2,"currentPrice":18.413,"marketValue":3682.66,"costValue":1440,"reportedPnl":2242.66,"reportedPnlPct":1.5574,"sector":"科技","currency":"USD","confidence":"high","missingFields":[],"option":{"underlying":"IGV","optionType":"call","strike":80,"expiration":"2027-01-15","contractMultiplier":100,"delta":0.8024,"theta":-0.0231,"gamma":0.012,"vega":0.188,"impliedVolatility":0.3438,"underlyingPrice":94.59}}],"cash":[{"amount":5671.08,"currency":"USD"}],"issues":[{"field":"现金/可用资金截图","reason":"未看到完整现金或购买力，因此总资产与现金占比不完整","priority":"recommended"}],"sourceSummary":"已识别 3 个持仓和 1 个现金条目"}\n\n' +
        '规则：\n' +
        '1. 优先采用截图明确显示的“市值/Market Value/市值数量”，写入 marketValue；若未显示则根据数量×现价×期权合约乘数计算。\n' +
        '2. 期权 shares 是合约张数，contractMultiplier 通常为 100；必须读出标的、Call/Put、行权价、到期日、Delta、Theta、Gamma、Vega、隐含波动率和标的价格。看不到时用 null，并在 issues 中说明。可识别“DTE/距到期日/到期日/Delta/Theta/IV”等英文或中文字段。\n' +
        '3. 股票或 ETF 不要臆造行业、成本、价格或现金；看不到就用空字符串、0 或 null，并在 issues 中写明。\n' +
        '4. 杠杆 ETF 标记为 leveraged_etf；普通 ETF 标记为 etf。不要把期权的市值当作正股市值。\n' +
        '5. 如果截图不足，也必须输出已能确认的持仓和现金；issues 告诉用户还需要什么截图，例如“完整持仓页”“期权详情页”“现金/购买力页”。\n' +
        '6. 必须优先读取截图里券商直接显示的浮动盈亏金额和收益率，分别写入 reportedPnl 和 reportedPnlPct（小数形式）；看不到时用 null，不要自己计算。\n' +
        '7. symbol 必须是纯代码（大写字母、数字、点或连字号），绝不能包含空格、CALL、PUT；期权方向写入 option.optionType，标的代码写入 option.underlying。\n' +
        '8. 同一标的的多行分批持仓，除非是行权价或到期日不同的期权，否则合并为一条：shares 相加、buyPrice 加权平均。\n' +
        '9. SGOV、BIL、SHV、USFR 等货币基金/超短债 ETF 的 assetType 用 "etf"，不要标成 stock。',
    },
    ...imageParts,
  ];
  const messages: AiMessage[] = [
    { role: 'system', content: '你是金融截图数据录入助手。仅提取用户截图明确可见的数据；不提供投资建议。' },
    { role: 'user', content },
  ];
  let raw: string;
  try {
    raw = await requestAi(settings, messages, {
      retryDelaysMs: STANDARD_RETRY_DELAYS_MS,
      onRetryWait: callbacks.onRetryWait,
    });
  } catch (error: unknown) {
    const shouldFallback = error instanceof KimiError
      && isRetryableAiFailure(error.failureKind)
      && provider === 'zhipu'
      && model !== 'glm-4v-flash';
    if (!shouldFallback) throw error;
    callbacks.onNotice?.(`${model} 持续繁忙，已临时换用 glm-4v-flash 重试…`);
    raw = await requestAi(settings, messages, { modelOverride: 'glm-4v-flash' });
  }
  return normalizeImportedPortfolio(raw);
}

export async function parseOptionDetailImages(
  settings: AppSettings,
  images: ImageForImport[],
  callbacks: ImageParseCallbacks = {},
): Promise<ParsedOptionDetails> {
  if (images.length === 0) throw new KimiError('请先选择至少一张期权详情截图。');
  const provider = settings.aiProvider ?? 'zhipu';
  const model = provider === 'kimi' ? settings.kimiModel : settings.zhipuModel;
  if (provider === 'kimi' && !KIMI_VISION_MODELS.has(model)) {
    throw new KimiError('当前选择的模型不支持图片识别', '请到「设置」选择支持图片的 Kimi 模型。');
  }
  if (provider === 'zhipu' && !ZHIPU_VISION_MODELS.has(model)) {
    throw new KimiError('当前选择的智谱模型不支持图片识别', '请到「设置」选择支持图片的智谱模型。');
  }

  const imageParts: ImagePart[] = images.map((image) => ({
    type: 'image_url',
    image_url: { url: image.dataUrl },
  }));
  const content: Array<TextPart | ImagePart> = [
    {
      type: 'text',
      text: `你正在读取 ${images.length} 张期权合约详情页。只提取期权详情，不要输出股票持仓或现金。\n\n` +
        '只输出合法 JSON，不要 Markdown。结构：' +
        '{"options":[{"underlying":"IGV","optionType":"call","strike":80,"expiration":"2027-01-15","contractMultiplier":100,"delta":0.7921,"theta":-0.0246,"gamma":0.0119,"vega":0.1908,"impliedVolatility":0.363,"underlyingPrice":93.76,"premiumPrice":18.30,"contracts":2,"currency":"USD"}],"issues":[],"sourceSummary":"已识别 1 张期权详情"}\n\n' +
        '规则：\n' +
        '1. 读取标的代码、Call/Put、行权价、到期日、合约乘数、Delta、Theta、Gamma、Vega、隐含波动率、标的现价、期权现价 premiumPrice 和持仓张数 contracts。看不到用 null，禁止猜测。\n' +
        "2. 到期日可能显示为 270115、2027/01/15、JAN 15 '27 等格式，统一输出 YYYY-MM-DD。\n" +
        '3. impliedVolatility 用小数（36.3% 输出 0.363）；currency 仅用 USD、CNY、HKD 或 OTHER。\n' +
        '4. 一张截图对应一个合约；多张截图分别输出。只认截图明确显示的数据。',
    },
    ...imageParts,
  ];
  const messages: AiMessage[] = [
    { role: 'system', content: '你是期权详情页数据录入助手，只提取可见字段，不提供投资建议。' },
    { role: 'user', content },
  ];
  let raw: string;
  try {
    raw = await requestAi(settings, messages, {
      retryDelaysMs: STANDARD_RETRY_DELAYS_MS,
      onRetryWait: callbacks.onRetryWait,
    });
  } catch (error: unknown) {
    const shouldFallback = error instanceof KimiError
      && isRetryableAiFailure(error.failureKind)
      && provider === 'zhipu'
      && model !== 'glm-4v-flash';
    if (!shouldFallback) throw error;
    callbacks.onNotice?.(`${model} 持续繁忙，已临时换用 glm-4v-flash 重试…`);
    raw = await requestAi(settings, messages, { modelOverride: 'glm-4v-flash' });
  }
  return normalizeParsedOptionDetails(raw);
}

async function requestAi(
  settings: AppSettings,
  messages: AiMessage[],
  options: AiRequestOptions = {},
): Promise<string> {
  const config = getAiRuntimeConfig(settings);
  if (!config.apiKey.trim()) {
    throw new KimiError(`未配置 ${config.label} API Key`, `请在「设置」中填入 ${config.label} API Key。`);
  }
  if (isMixedContentBlocked(config.endpoint)) {
    throw new KimiError(
      '当前页面是 HTTPS，无法请求 HTTP 接口（浏览器安全限制）',
      '请改用 http://67.215.255.196:8788/ 访问本应用，或等待网关支持 HTTPS。',
    );
  }
  const timeoutMs = options.timeoutMs ?? (config.usesServerGateway ? 190_000 : REQUEST_TIMEOUT_MS);
  const retryDelaysMs = options.retryDelaysMs ?? [];
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    let response: Response;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const requestModel = options.modelOverride ?? config.model;
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: requestModel,
          messages,
          temperature: temperatureForModel(config.provider, requestModel),
          max_tokens: options.maxTokens ?? 3500,
          // Screenshot extraction only needs structured facts. Explicitly disabling
          // reasoning on GLM avoids a slow, unnecessary thinking pass.
          ...(config.provider === 'zhipu' ? { thinking: { type: 'disabled' } } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒`
        : error instanceof Error ? error.message : String(error);
      throw new KimiError(
        `网络请求失败：${message}`,
        networkHint(config),
      );
    } finally {
      window.clearTimeout(timeoutId);
    }

    let data: AiResponse;
    try {
      data = (await response.json()) as AiResponse;
    } catch {
      throw new KimiError(`响应非 JSON（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      const providerMessage = data.error?.message ?? data.error?.code ?? `HTTP ${response.status}`;
      const failureKind = classifyAiFailure(response.status, data.error?.code, providerMessage);
      const retryDelayMs = retryDelaysMs[attemptIndex];
      if (isRetryableAiFailure(failureKind) && retryDelayMs != null) {
        options.onRetryWait?.({
          attempt: attemptIndex + 2,
          total: retryDelaysMs.length + 1,
          delayMs: retryDelayMs,
          reason: providerMessage,
        });
        await waitForRetry(retryDelayMs);
        continue;
      }
      throw new KimiError(
        providerMessage,
        failureHint(failureKind, response.status, data, config),
        failureKind,
      );
    }
    const responseContent = data.choices?.[0]?.message?.content;
    if (!responseContent) throw new KimiError(`${config.label} 返回为空，请重试或减少截图数量。`);
    return responseContent;
  }
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function failureHint(
  failureKind: AiFailureKind,
  status: number,
  data: AiResponse,
  config: AiRuntimeConfig,
): string | undefined {
  if (failureKind === 'overload') {
    return '智谱这个免费模型当前过载（平台侧拥堵，不是你的账号问题）。已自动重试仍未成功。建议：① 换时间段（北京时间早上 7–9 点最空）② 到「设置」换一个视觉模型 ③ 在智谱控制台完成实名认证或开通付费额度，可提高优先级。';
  }
  if (failureKind === 'rate_limit') {
    return '这是 API 账户/模型的并发或频率限制，不是域名、VPN 或截图问题。前端已自动等待并重试过，请稍后再试或检查账号额度。';
  }
  if (status === 404 && data.error?.code === 'not_found') {
    return '请求路径不存在：多半是「代理 URL」填错了。清空该输入框并保存，即可恢复使用服务器转发。';
  }
  if (failureKind === 'auth') {
    return '请检查 API Key 是否正确、是否过期，或确认该 Key 有视觉模型权限。';
  }
  if (failureKind === 'bad_image') {
    return `模型或接口没有接受图片输入。请使用 ${config.provider === 'zhipu' ? 'glm-4.6v-flash / glm-5v-turbo' : 'kimi-k2.6'}。`;
  }
  return undefined;
}

export function getAiRuntimeConfig(settings: AppSettings): AiRuntimeConfig {
  const provider = settings.aiProvider === 'kimi' ? 'kimi' : 'zhipu';
  if (provider === 'kimi') {
    const proxy = sanitizeEndpointUrl(settings.proxyUrl);
    const serverProxy = getServerAiProxyUrl(provider);
    return {
      provider,
      label: 'Kimi',
      endpoint: proxy || serverProxy || KIMI_ENDPOINT,
      directEndpoint: KIMI_ENDPOINT,
      apiKey: settings.kimiApiKey,
      model: settings.kimiModel || 'kimi-k2.6',
      usesProxy: Boolean(proxy || serverProxy),
      usesServerGateway: Boolean(!proxy && serverProxy),
    };
  }
  const proxy = sanitizeEndpointUrl(settings.zhipuProxyUrl);
  const serverProxy = getServerAiProxyUrl(provider);
  return {
    provider,
    label: '智谱 GLM',
    endpoint: proxy || serverProxy || ZHIPU_ENDPOINT,
    directEndpoint: ZHIPU_ENDPOINT,
    apiKey: settings.zhipuApiKey,
    model: settings.zhipuModel || 'glm-4.6v-flash',
    usesProxy: Boolean(proxy || serverProxy),
    usesServerGateway: Boolean(!proxy && serverProxy),
  };
}

function networkHint(config: AiRuntimeConfig): string {
  if (config.usesServerGateway) {
    return `${serverGatewayLabel()}没有在限定时间内返回。服务器已接管手机到模型的长连接；请稍后只重试一次。若持续失败，错误通常是 API 账户限流或模型服务端拥堵，而不是手机 VPN。`;
  }
  if (config.usesProxy) {
    return `你的 ${config.label} 代理没有成功转发请求。请检查代理 URL、允许域名，以及代理是否能访问 ${config.directEndpoint}。`;
  }
  if (config.provider === 'zhipu') {
    return '请求还没成功返回。多数是手机网络到智谱接口不稳、浏览器拦截或服务端处理超时。可先在「设置」点连接测试；如果仍失败，请填入 Cloudflare Worker / Vercel 代理 URL。';
  }
  return '请求还没成功返回。当前压缩已生效，若仍超时，多数是 Kimi 视觉请求处理慢或手机网络到 Moonshot 不稳。建议切换到智谱 GLM，或填入 Cloudflare Worker / Vercel 代理 URL。VPN/Clash 不能直接嵌入 GitHub Pages 网页。';
}

function temperatureForModel(provider: AiProvider, model: string): number {
  if (provider === 'kimi' && model.startsWith('kimi-k2')) return 1;
  return 0.1;
}

function normalizeImportedPortfolio(raw: string): ImportedPortfolio {
  let data: unknown;
  try {
    data = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new KimiError('AI 的识别结果不是可读取的 JSON', '请重试；若仍失败，可减少截图数量或改用清晰的原始截图。');
  }
  if (!isRecord(data)) throw new KimiError('AI 的识别结果格式不正确');
  const issues = asIssues(data.issues);
  const mergedHoldings = mergeImportedHoldings(Array.isArray(data.holdings)
    ? data.holdings.map((holding) => normalizeHolding(holding, issues)).filter((holding): holding is ImportedPortfolio['holdings'][number] => holding !== null)
    : []);
  const holdings = mergedHoldings.map((holding) => crossCheckImportedPnl(holding, issues));
  const cash = Array.isArray(data.cash) ? data.cash.map(normalizeCash).filter((item): item is CashPosition => item !== null) : [];
  if (holdings.length === 0 && cash.length === 0) {
    throw new KimiError('未能从截图中确认任何持仓或现金', '请上传包含代码、数量与市值的完整持仓页；期权请再附上合约详情页。');
  }
  return {
    holdings,
    cash,
    issues,
    sourceSummary: asText(data.sourceSummary) || `已识别 ${holdings.length} 个持仓和 ${cash.length} 个现金条目`,
  };
}

function normalizeParsedOptionDetails(raw: string): ParsedOptionDetails {
  let data: unknown;
  try {
    data = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new KimiError('AI 的期权识别结果不是可读取的 JSON', '请重试或减少截图数量。');
  }
  if (!isRecord(data)) throw new KimiError('AI 的期权识别结果格式不正确');
  const issues = asIssues(data.issues);
  const options = Array.isArray(data.options)
    ? data.options.map((option) => normalizeParsedOptionDetail(option, issues)).filter((option): option is ParsedOptionDetail => option !== null)
    : [];
  return {
    options,
    issues,
    sourceSummary: asText(data.sourceSummary) || `已识别 ${options.length} 张期权详情`,
  };
}

function normalizeParsedOptionDetail(value: unknown, issues: ImportIssue[]): ParsedOptionDetail | null {
  if (!isRecord(value)) return null;
  const underlying = asText(value.underlying).toUpperCase();
  if (!underlying) {
    issues.push({ field: '期权标的代码', reason: '详情页未能确认标的代码，未自动导入该条。', priority: 'required' });
    return null;
  }
  const optionTypeText = asText(value.optionType).toLowerCase();
  const impliedVolatility = nullableNumber(value.impliedVolatility);
  return {
    underlying,
    optionType: optionTypeText === 'put' || optionTypeText === 'p' ? 'put' : 'call',
    strike: nullableNonNegative(value.strike),
    expiration: normalizeOptionExpiration(asText(value.expiration)),
    contractMultiplier: (nullableNumber(value.contractMultiplier) ?? 0) > 0 ? nullableNumber(value.contractMultiplier)! : 100,
    delta: nullableNumber(value.delta),
    theta: nullableNumber(value.theta),
    gamma: nullableNumber(value.gamma),
    vega: nullableNumber(value.vega),
    impliedVolatility: impliedVolatility != null && Math.abs(impliedVolatility) > 1.5
      ? impliedVolatility / 100
      : impliedVolatility,
    underlyingPrice: nullableNonNegative(value.underlyingPrice),
    premiumPrice: nullableNonNegative(value.premiumPrice),
    contracts: nullableNonNegative(value.contracts),
    currency: asCurrency(value.currency),
  };
}

function normalizeHolding(value: unknown, issues: ImportIssue[]): ImportedPortfolio['holdings'][number] | null {
  if (!isRecord(value)) return null;
  const assetType = asAssetType(value.assetType);
  const rawSymbol = asText(value.symbol).toUpperCase();
  const optionSymbolMatch = rawSymbol.match(/^([A-Z][A-Z0-9.-]{0,9})\s+(CALL|PUT)$/);
  const symbol = optionSymbolMatch?.[1] ?? rawSymbol;
  const name = asText(value.name);
  if (!symbol && !name) return null;
  const currency = asCurrency(value.currency);
  const multiplier = assetType === 'option' ? positiveOr(value.option, 'contractMultiplier', 100) : 1;
  const shares = nonNegative(value.shares);
  const marketValueOverride = nullableNonNegative(value.marketValue);
  const costOverride = nullableNonNegative(value.costValue);
  let currentPrice = nonNegative(value.currentPrice);
  let buyPrice = nonNegative(value.buyPrice);
  if (currentPrice === 0 && marketValueOverride != null && shares > 0) currentPrice = marketValueOverride / (shares * multiplier);
  if (buyPrice === 0 && costOverride != null && shares > 0) buyPrice = costOverride / (shares * multiplier);

  let option = assetType === 'option' ? normalizeOption(value.option, symbol, multiplier) : undefined;
  if (
    option
    && optionSymbolMatch
    && (!isRecord(value.option) || !asText(value.option.underlying))
  ) {
    option = {
      ...option,
      underlying: optionSymbolMatch[1],
      optionType: optionSymbolMatch[2].toLowerCase() as 'call' | 'put',
    };
  }
  const missingFields = asTextArray(value.missingFields);
  const reportedPnlPctValue = nullableNumber(value.reportedPnlPct);
  if (assetType === 'option') {
    if (!option?.expiration) missingFields.push('期权到期日');
    if (option?.delta == null) missingFields.push('期权 Delta');
    if (option?.underlyingPrice == null) missingFields.push('标的现价');
    if (missingFields.length > 0) {
      issues.push({
        field: `${symbol || name} 期权详情`,
        reason: `缺少 ${unique(missingFields).join('、')}，短期到期与等效正股风险可能无法完整计算。`,
        priority: 'recommended',
      });
    }
  }
  if (marketValueOverride == null && (shares === 0 || currentPrice === 0)) {
    issues.push({
      field: `${symbol || name} 市值`,
      reason: '未读取到市值，且数量或现价不足以计算市值。该条目的资产占比会显示为 0，确认后请手动补全。',
      priority: 'required',
    });
  }
  if (costOverride == null && buyPrice === 0) {
    issues.push({
      field: `${symbol || name} 成本/买入价`,
      reason: '未读取到成本，组合总盈亏不会把该条目当作 0 成本计算；请确认导入后手动补全。',
      priority: 'recommended',
    });
  }
  return {
    symbol: symbol || name,
    name,
    shares,
    buyPrice,
    currentPrice,
    sector: asText(value.sector) || '未分类',
    currency,
    assetType,
    option,
    marketValueOverride: marketValueOverride ?? undefined,
    costOverride: costOverride ?? undefined,
    missingFields: unique(missingFields),
    confidence: asConfidence(value.confidence),
    reportedPnl: nullableNumber(value.reportedPnl),
    reportedPnlPct: reportedPnlPctValue != null && Math.abs(reportedPnlPctValue) > 1.5
      ? reportedPnlPctValue / 100
      : reportedPnlPctValue,
    source: 'image-import',
    note: '由截图识别导入；请在确认后核对关键数值。',
  };
}

export function isValidTicker(symbol: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol.trim().toUpperCase());
}

function normalizeCash(value: unknown): CashPosition | null {
  if (!isRecord(value)) return null;
  const amount = nullableNonNegative(value.amount);
  if (amount == null) return null;
  return { amount, currency: asCurrency(value.currency), source: 'image-import' };
}

function normalizeOption(value: unknown, fallbackSymbol: string, multiplier: number): OptionDetails {
  const option = isRecord(value) ? value : {};
  const typeText = asText(option.optionType).toLowerCase();
  return {
    underlying: asText(option.underlying).toUpperCase() || fallbackSymbol,
    optionType: typeText === 'put' || typeText === 'p' ? 'put' : 'call',
    strike: nullableNonNegative(option.strike),
    expiration: normalizeDate(asText(option.expiration)),
    contractMultiplier: multiplier,
    delta: nullableNumber(option.delta),
    theta: nullableNumber(option.theta),
    gamma: nullableNumber(option.gamma),
    vega: nullableNumber(option.vega),
    impliedVolatility: nullableNumber(option.impliedVolatility),
    underlyingPrice: nullableNonNegative(option.underlyingPrice),
  };
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function asIssues(value: unknown): ImportIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    if (!isRecord(issue)) return [];
    const field = asText(issue.field);
    const reason = asText(issue.reason);
    if (!field && !reason) return [];
    return [{ field: field || '待补充数据', reason: reason || '截图未包含该项', priority: issue.priority === 'required' ? 'required' : 'recommended' }];
  });
}

function asAssetType(value: unknown): AssetType {
  const input = asText(value).toLowerCase();
  return ['stock', 'etf', 'leveraged_etf', 'option', 'fund', 'other'].includes(input) ? input as AssetType : 'stock';
}

function asCurrency(value: unknown): Currency {
  const input = asText(value).toUpperCase();
  return input === 'CNY' || input === 'HKD' || input === 'OTHER' ? input : 'USD';
}

function asConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'low' ? value : 'medium';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableNonNegative(value: unknown): number | null {
  const number = nullableNumber(value);
  return number != null && number >= 0 ? number : null;
}

function nonNegative(value: unknown): number {
  return nullableNonNegative(value) ?? 0;
}

function positiveOr(value: unknown, key: string, fallback: number): number {
  return isRecord(value) && (nullableNumber(value[key]) ?? 0) > 0 ? nullableNumber(value[key])! : fallback;
}

function normalizeDate(value: string): string | null {
  const match = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function normalizeOptionExpiration(value: string): string | null {
  const input = value.trim().toUpperCase();
  const standard = normalizeDate(input);
  if (standard) return standard;
  const compact = input.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (compact) return `20${compact[1]}-${compact[2]}-${compact[3]}`;
  const english = input.match(/^([A-Z]{3})\s+(\d{1,2})\s+['’]?(\d{2}|\d{4})$/);
  if (!english) return null;
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(english[1]) + 1;
  if (month === 0) return null;
  const year = english[3].length === 2 ? `20${english[3]}` : english[3];
  return `${year}-${String(month).padStart(2, '0')}-${english[2].padStart(2, '0')}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
