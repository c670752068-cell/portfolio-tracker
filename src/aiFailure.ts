export type AiFailureKind = 'overload' | 'rate_limit' | 'auth' | 'bad_image' | 'other';

/** 根据 HTTP 状态、错误码、错误文案分类失败原因 */
export function classifyAiFailure(
  status: number | null,
  code: string | null | undefined,
  message: string,
): AiFailureKind {
  if (/访问量过大|系统繁忙|服务不可用|稍后再试|overloaded|server busy|503/i.test(message) || status === 503) {
    return 'overload';
  }
  if (
    status === 429
    || code === '1302'
    || /rate.?limit|速率限制|请求过于频繁|并发/i.test(message)
  ) {
    return 'rate_limit';
  }
  if (status === 401) return 'auth';
  if (status === 400 && /image/i.test(message)) return 'bad_image';
  return 'other';
}

/** overload 与 rate_limit 都值得自动重试 */
export function isRetryableAiFailure(kind: AiFailureKind): boolean {
  return kind === 'overload' || kind === 'rate_limit';
}
