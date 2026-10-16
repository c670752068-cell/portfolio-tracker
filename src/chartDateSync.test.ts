import { describe, expect, it, vi } from 'vitest';
import { createChartDateStore, createChartScrollGroup, tradingDateIndex } from './chartDateSync';

const pane = (width = 336, content = 700) => ({ clientWidth: width, scrollWidth: content, scrollLeft: 0 } as HTMLElement);

describe('linked technical chart dates', () => {
  it('aligns all panes to latest and propagates native scrolling without feedback', () => {
    const group = createChartScrollGroup();
    const a = pane(); const b = pane();
    group.register(a); group.register(b);
    expect([a.scrollLeft, b.scrollLeft]).toEqual([364, 364]);
    group.scroll(a); group.scroll(b); // programmatic events
    a.scrollLeft = 120; group.scroll(a); group.scroll(b);
    expect(b.scrollLeft).toBe(120);
    b.scrollLeft = 50; group.scroll(b); group.scroll(a);
    expect(a.scrollLeft).toBeCloseTo(50);
    group.latest();
    expect([a.scrollLeft, b.scrollLeft]).toEqual([364, 364]);
  });

  it('keeps latest visible after a wide-to-mobile resize and preserves a historical position', () => {
    const group = createChartScrollGroup(); const a = pane(900, 900); const b = pane(900, 900);
    group.register(a); group.register(b);
    Object.assign(a, { clientWidth: 336, scrollWidth: 700 });
    Object.assign(b, { clientWidth: 336, scrollWidth: 700 });
    group.align();
    expect(a.scrollLeft).toBe(364);
    group.scroll(a); group.scroll(b);
    a.scrollLeft = 182; group.scroll(a); group.scroll(b);
    Object.assign(a, { clientWidth: 400 }); Object.assign(b, { clientWidth: 400 });
    group.align();
    expect([a.scrollLeft, b.scrollLeft]).toEqual([150, 150]);
    const volume = pane(400); const remove = group.register(volume);
    expect(volume.scrollLeft).toBe(150);
    remove(); group.latest(); expect(volume.scrollLeft).toBe(150);
  });

  it('shares dates without notifying for repeated points and resolves non-trading dates', () => {
    const store = createChartDateStore(); const changed = vi.fn(); const remove = store.subscribe(changed);
    store.setDate('2026-09-08'); store.setDate('2026-09-08');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe('2026-09-08');
    store.setDate(null); expect(store.getSnapshot()).toBeNull();
    remove(); store.setDate('2026-09-09'); expect(changed).toHaveBeenCalledTimes(2);
    const dates = ['2026-09-04', '2026-09-08', '2026-09-09'];
    expect(tradingDateIndex(dates, '2026-09-07')).toBe(0);
    expect(tradingDateIndex(dates, '2026-09-08')).toBe(1);
    expect(tradingDateIndex(dates, '2026-12-01')).toBe(2);
  });
});
