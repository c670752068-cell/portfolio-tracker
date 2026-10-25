// IBKR Flex 网络服务（v3）：服务器直接拉持仓，不需要 TWS、也不需要 IB Gateway，
// 所以 Mac 关机也能取。两步走：先用 token + 查询号换一个取件码，再用取件码换报表。
// token 由用户自己填在服务器的配置文件里，代码和仓库里都不出现。
export const FLEX_BASE_URL = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
export const FLEX_RETRY_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 6;

function tagValue(xml, tag) {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(String(xml || ''));
  return match ? match[1].trim() : null;
}

function attribute(fragment, name) {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(fragment);
  return match ? match[1] : null;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildSendRequestUrl(token, queryId) {
  return `${FLEX_BASE_URL}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`;
}

export function buildFetchUrl(url, referenceCode, token) {
  return `${url}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(token)}&v=3`;
}

export function parseSendResponse(xml) {
  const status = tagValue(xml, 'Status');
  if (status === 'Success') {
    return { ok: true, referenceCode: tagValue(xml, 'ReferenceCode'), url: tagValue(xml, 'Url') };
  }
  return {
    ok: false,
    errorCode: tagValue(xml, 'ErrorCode'),
    errorMessage: tagValue(xml, 'ErrorMessage') || '无法解析 IBKR 返回',
  };
}

/** 报表日期是 20261024 这种，转成 2026-10-24。 */
function reportDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(String(value || ''));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function parseFlexPositions(xml) {
  const text = String(xml || '');
  // 报表还在生成时 IBKR 返回的是另一种文档
  if (/Statement generation in progress/i.test(text) || tagValue(text, 'ErrorCode') === '1019') {
    return { pending: true, positions: [], accountId: null, asOf: null };
  }
  const statement = /<FlexStatement\b[^>]*>/i.exec(text)?.[0] || '';
  const positions = [...text.matchAll(/<OpenPosition\b[^>]*\/?>/gi)].flatMap((match) => {
    const fragment = match[0];
    const symbol = attribute(fragment, 'symbol');
    const qty = finite(attribute(fragment, 'position'));
    if (!symbol || qty === null || qty === 0) return [];
    const category = String(attribute(fragment, 'assetCategory') || '').toUpperCase();
    return [{
      symbol,
      qty,
      price: finite(attribute(fragment, 'markPrice')),
      costPrice: finite(attribute(fragment, 'costBasisPrice')),
      assetType: category === 'OPT' ? 'option' : category === 'FUT' ? 'future' : 'stock',
      currency: attribute(fragment, 'currency') || 'USD',
      underlying: attribute(fragment, 'underlyingSymbol'),
      multiplier: finite(attribute(fragment, 'multiplier')),
      accountId: attribute(fragment, 'accountId'),
      reportDate: reportDate(attribute(fragment, 'reportDate')),
    }];
  });
  return {
    pending: false,
    accountId: attribute(statement, 'accountId'),
    asOf: reportDate(attribute(statement, 'toDate')),
    positions,
  };
}

/**
 * 取一次持仓。get(url) 由调用方提供（测试里用假的），
 * 报表还没生成好会等一会儿再试，不会死等。
 */
export async function fetchIbkrFlexPositions({
  token, queryId, get, sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  maxAttempts = DEFAULT_MAX_ATTEMPTS, retryMs = FLEX_RETRY_MS,
}) {
  if (!token || !queryId) return { ok: false, reason: 'missing_token', positions: [] };
  const sent = parseSendResponse(await get(buildSendRequestUrl(token, queryId)));
  if (!sent.ok) {
    return {
      ok: false, reason: 'flex_error', errorCode: sent.errorCode, errorMessage: sent.errorMessage, positions: [],
    };
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const report = parseFlexPositions(await get(buildFetchUrl(sent.url, sent.referenceCode, token)));
    if (!report.pending) {
      return { ok: true, reason: null, ...report };
    }
    if (attempt < maxAttempts - 1) await sleep(retryMs);
  }
  return { ok: false, reason: 'not_ready', positions: [] };
}
