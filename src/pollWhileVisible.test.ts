import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollWhileVisible } from './pollWhileVisible';

describe('页面在前台才定时取数', () => {
  let visibility: 'visible' | 'hidden';
  let listeners: Set<() => void>;
  const fire = () => listeners.forEach((listener) => listener());

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    listeners = new Set();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', {
      get visibilityState() { return visibility; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('打开就取一次，之后按间隔取', () => {
    const pull = vi.fn();
    pollWhileVisible(pull, 1_000);

    expect(pull).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(pull).toHaveBeenCalledTimes(3);
  });

  it('在后台打开不取，回到前台马上补取，不等下一轮', () => {
    visibility = 'hidden';
    const pull = vi.fn();
    pollWhileVisible(pull, 300_000);
    expect(pull).not.toHaveBeenCalled();

    visibility = 'visible';
    fire();
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('切到后台那一下不取，定时也不取', () => {
    const pull = vi.fn();
    pollWhileVisible(pull, 1_000);

    visibility = 'hidden';
    fire();
    vi.advanceTimersByTime(5_000);
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('停止后不再取', () => {
    const pull = vi.fn();
    const stop = pollWhileVisible(pull, 1_000);

    stop();
    fire();
    vi.advanceTimersByTime(5_000);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
