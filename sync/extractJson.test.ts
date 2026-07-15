import { describe, expect, it } from 'vitest';
import { extractFirstJsonObject } from './extractJson.mjs';

describe('extractFirstJsonObject', () => {
  it('parses a normal positions-status JSON object', () => {
    expect(extractFirstJsonObject('{"positions":[],"net_liquidation":100}')).toEqual({
      positions: [],
      net_liquidation: 100,
    });
  });

  it('ignores SDK log lines before and after the first complete object', () => {
    const output = [
      '2026-07-15 07:00:00 | INFO | OpenD connected',
      '{"as_of":"2026-07-14","meta":{"note":"brace } inside string"},"positions":[{"symbol":"MSFT"}],"net_liquidation":200}',
      '2026-07-15 07:00:02 | INFO | connection closed {not json}',
    ].join('\n');

    expect(extractFirstJsonObject(output)).toEqual(expect.objectContaining({
      as_of: '2026-07-14',
      positions: [{ symbol: 'MSFT' }],
      net_liquidation: 200,
    }));
  });

  it('throws a clear error when stdout contains no JSON object', () => {
    expect(() => extractFirstJsonObject('SDK connected\nno portfolio available')).toThrow('没有 JSON 对象');
  });
});
