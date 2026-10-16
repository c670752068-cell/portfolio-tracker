import { describe, expect, it } from 'vitest';
import { drawdownDisplay } from './drawdownDisplay';

describe('drawdown presentation only', () => {
  it.each([[5.95, '-5.95%'], [-5.95, '-5.95%'], [0, '0.00%'], [-0, '0.00%'], [.004, '-0.0040%'], [null, '—'], [undefined, '—'], [NaN, '—'], [Infinity, '—']] as const)('formats %s as %s without altering the input', (value, label) => {
    expect(drawdownDisplay(value)).toBe(label);
  });
});
