import { describe, expect, it } from 'vitest';
import { parsePanicDrop } from './panicDrop';

describe('恐慌性下跌数据', () => {
  it('解析接口返回', () => {
    const parsed = parsePanicDrop({
      panic: {
        as_of: '2026-11-05', window_open: true, anchor_close: 6900.5, recovered_on: null,
        last_panic: { date: '2026-11-05', sp500: -4.36, dow: -3.44, nasdaq: -5.52, panic: true },
        days: [
          { date: '2026-11-05', sp500: -4.36, dow: -3.44, nasdaq: -5.52, panic: true },
          { date: '2026-11-04', sp500: 1.58, dow: 3.03, nasdaq: 1.44, panic: false },
        ],
      },
    });

    expect(parsed).toMatchObject({ asOf: '2026-11-05', windowOpen: true, anchorClose: 6900.5, recoveredOn: null });
    expect(parsed.lastPanic).toMatchObject({ date: '2026-11-05', sp500: -4.36 });
    expect(parsed.days).toHaveLength(2);
    expect(parsed.days[1]).toMatchObject({ dow: 3.03, panic: false });
  });

  it('返回坏了窗口状态是 null，不当成「没有恐慌」', () => {
    expect(parsePanicDrop(null)).toEqual({ asOf: null, windowOpen: null, anchorClose: null, recoveredOn: null, lastPanic: null, days: [] });
    expect(parsePanicDrop({ panic: { window_open: 'yes', days: 'x' } })).toMatchObject({ windowOpen: null, days: [] });
  });
});
