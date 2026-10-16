/** Presentation only: the engine keeps positive drawdown magnitudes for comparisons. */
export function drawdownDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude === 0) return '0.00%';
  // Tiny real drawdowns must not turn into a fictitious negative zero.
  return magnitude < .005 ? `-${magnitude.toPrecision(2)}%` : `-${magnitude.toFixed(2)}%`;
}
