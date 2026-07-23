import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUANT_ANALYSIS_REFRESH_MS,
  QUANT_ANALYSIS_RESUME_REFRESH_MS,
  startQuantAnalysisAutoRefresh,
} from './quantAnalysis';

class VisibilityTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

describe('quant analysis auto refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the documented 25-minute interval', () => {
    expect(QUANT_ANALYSIS_REFRESH_MS).toBe(25 * 60 * 1000);
  });

  it('refreshes the quant snapshot every 25 minutes', () => {
    const refresh = vi.fn();
    const visibility = new VisibilityTarget();
    const stop = startQuantAnalysisAutoRefresh(refresh, visibility);

    vi.advanceTimersByTime(QUANT_ANALYSIS_REFRESH_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('clears the interval and visibility listener on cleanup', () => {
    const refresh = vi.fn();
    const visibility = new VisibilityTarget();
    const removeSpy = vi.spyOn(visibility, 'removeEventListener');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const stop = startQuantAnalysisAutoRefresh(refresh, visibility);

    stop();
    vi.advanceTimersByTime(QUANT_ANALYSIS_REFRESH_MS);
    visibility.dispatchEvent(new Event('visibilitychange'));

    expect(refresh).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('refreshes after returning visible when the last refresh is more than five minutes old', () => {
    const refresh = vi.fn();
    const visibility = new VisibilityTarget();
    const stop = startQuantAnalysisAutoRefresh(refresh, visibility);

    visibility.visibilityState = 'hidden';
    vi.advanceTimersByTime(QUANT_ANALYSIS_RESUME_REFRESH_MS + 1);
    visibility.visibilityState = 'visible';
    visibility.dispatchEvent(new Event('visibilitychange'));

    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not refresh after only four minutes in the background', () => {
    const refresh = vi.fn();
    const visibility = new VisibilityTarget();
    const stop = startQuantAnalysisAutoRefresh(refresh, visibility);

    visibility.visibilityState = 'hidden';
    vi.advanceTimersByTime(4 * 60 * 1000);
    visibility.visibilityState = 'visible';
    visibility.dispatchEvent(new Event('visibilitychange'));

    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});
