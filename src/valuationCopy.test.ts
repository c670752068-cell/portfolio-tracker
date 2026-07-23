import { describe, expect, it } from 'vitest';

const sourceModules = import.meta.glob('./**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('read-only valuation copy contract', () => {
  it('contains none of the forbidden action phrases in production source', () => {
    const productionSource = Object.entries(sourceModules)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .map(([, source]) => source)
      .join('\n');
    const forbidden = ['建议' + '买入', '可' + '买', '触发' + '买入'];

    forbidden.forEach((phrase) => expect(productionSource).not.toContain(phrase));
  });
});
