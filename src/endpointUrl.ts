/** 仅接受绝对 http(s) URL；其余（空串、API Key、相对路径、乱码）一律返回 '' */
export function sanitizeEndpointUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : '';
  } catch {
    return '';
  }
}

/** 值非空但不是合法绝对 http(s) URL 时为 true（用于设置页报错） */
export function isInvalidEndpointUrl(value: string): boolean {
  return Boolean(value.trim()) && !sanitizeEndpointUrl(value);
}

/** 疑似把 API Key 当 URL 填了（以 sk- 开头且不含 ://） */
export function looksLikeApiKey(value: string): boolean {
  const trimmed = value.trim();
  return /^sk-/i.test(trimmed) && !trimmed.includes('://');
}

/** 当前页面是 https 而目标是 http → 浏览器必然拦截 */
export function isMixedContentBlocked(endpoint: string, pageProtocol?: string): boolean {
  const sanitized = sanitizeEndpointUrl(endpoint);
  if (!sanitized) return false;
  const currentProtocol = pageProtocol ?? (typeof window === 'undefined' ? '' : window.location.protocol);
  return currentProtocol === 'https:' && new URL(sanitized).protocol === 'http:';
}
