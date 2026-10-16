/** Shared scroll position without React updates on every native scroll event. */
export function createChartScrollGroup() {
  const elements = new Set<HTMLElement>();
  const expected = new WeakMap<HTMLElement, number>();
  let fraction = 1;
  const apply = (element: HTMLElement) => {
    const target = Math.max(0, element.scrollWidth - element.clientWidth) * fraction;
    if (Math.abs(element.scrollLeft - target) < 1) return;
    expected.set(element, target);
    element.scrollLeft = target;
  };
  const align = () => elements.forEach(apply);
  return {
    register(element: HTMLElement) {
      elements.add(element);
      apply(element);
      return () => { elements.delete(element); expected.delete(element); };
    },
    scroll(element: HTMLElement) {
      const pending = expected.get(element);
      expected.delete(element);
      if (pending !== undefined && Math.abs(pending - element.scrollLeft) < 1) return;
      const maximum = element.scrollWidth - element.clientWidth;
      if (maximum <= 0) return;
      fraction = Math.min(1, Math.max(0, element.scrollLeft / maximum));
      elements.forEach((other) => { if (other !== element) apply(other); });
    },
    align,
    latest() { fraction = 1; align(); },
    reveal(index: number, count: number) {
      // The axes reserve the same left/right space in every linked chart.
      const first = elements.values().next().value as HTMLElement | undefined;
      if (!first || count < 2) return;
      const maximum = first.scrollWidth - first.clientWidth;
      if (maximum <= 0) return;
      const x = 68 + (first.scrollWidth - 152) * index / (count - 1);
      fraction = Math.min(1, Math.max(0, (x - first.clientWidth / 2) / maximum));
      align();
    },
  };
}

/** Only the date readout and cursor subscribe, not thousands of historical bars. */
export function createChartDateStore() {
  let date: string | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => date,
    setDate(next: string | null) {
      if (date === next) return;
      date = next;
      listeners.forEach((listener) => listener());
    },
  };
}

/** A holiday/weekend selection resolves to the last available trading date. */
export function tradingDateIndex(dates: readonly string[], date: string): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dates[middle] <= date) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}
