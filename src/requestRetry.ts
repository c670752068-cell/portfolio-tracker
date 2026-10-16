// 网络抖动或请求被中断时，一次失败不代表数据没了：先重试一次，仍失败才交给
// 调用方处理。只重试一次，刷新失败不会变成请求风暴。
export const RETRY_DELAY_MS = 2000;

interface RetryOptions {
  isAborted?: () => boolean;
  delayMs?: number;
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

export async function withSingleRetry<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { isAborted = () => false, delayMs = RETRY_DELAY_MS, wait = sleep } = options;
  try {
    return await run();
  } catch (caught) {
    if (isAborted()) throw caught;
    await wait(delayMs);
    if (isAborted()) throw caught;
    return run();
  }
}
