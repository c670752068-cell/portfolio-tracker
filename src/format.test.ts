import { describe, expect, it } from 'vitest';
import { formatSignedPct } from './format';

describe('formatSignedPct', () => {
  it('does not imply a direction for exactly zero change', () => {
    expect(formatSignedPct(0)).toBe('0.00%');
  });
});
