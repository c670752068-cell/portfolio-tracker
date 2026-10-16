import { describe, expect, it, vi } from 'vitest';
import { RETRY_DELAY_MS, withSingleRetry } from './requestRetry';

const wait = () => Promise.resolve();

describe('请求失败后自动重试一次', () => {
  it('第一次就成功时不重试', async () => {
    const run = vi.fn().mockResolvedValue('ok');

    await expect(withSingleRetry(run, { wait })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('第一次失败、第二次成功时返回第二次的结果', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('行情读取失败（502）'))
      .mockResolvedValue('ok');

    await expect(withSingleRetry(run, { wait })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('两次都失败时抛出第二次的错误，且只请求两次，不形成请求风暴', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('第一次失败'))
      .mockRejectedValueOnce(new Error('第二次失败'))
      .mockResolvedValue('不应该走到第三次');

    await expect(withSingleRetry(run, { wait })).rejects.toThrow('第二次失败');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('请求已被中断时不重试，也不等待', async () => {
    const run = vi.fn().mockRejectedValue(new Error('aborted'));
    const sleep = vi.fn(wait);

    await expect(withSingleRetry(run, { wait: sleep, isAborted: () => true })).rejects.toThrow('aborted');
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('等待期间被中断就放弃第二次请求', async () => {
    let aborted = false;
    const run = vi.fn().mockRejectedValue(new Error('行情读取失败（502）'));

    await expect(withSingleRetry(run, {
      isAborted: () => aborted,
      wait: () => { aborted = true; return Promise.resolve(); },
    })).rejects.toThrow('行情读取失败（502）');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('等待一次，间隔用默认的 2～3 秒', async () => {
    const run = vi.fn().mockRejectedValue(new Error('失败'));
    const sleep = vi.fn(wait);

    await expect(withSingleRetry(run, { wait: sleep })).rejects.toThrow('失败');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(RETRY_DELAY_MS);
    expect(RETRY_DELAY_MS).toBeGreaterThanOrEqual(2000);
    expect(RETRY_DELAY_MS).toBeLessThanOrEqual(3000);
  });
});
