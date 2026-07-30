import { describe, expect, it } from 'vitest';
import { REFRESH_CADENCE } from './refreshCadence';

describe('REFRESH_CADENCE', () => {
  it('defines all five refresh scopes in one user-facing table', () => {
    expect(Object.values(REFRESH_CADENCE).map((item) => item.interval)).toEqual([
      '盘中每 5 分钟；其他时段每 25 分钟',
      '美股盘中每 35 分钟',
      '盘中每 35 分钟',
      '每 45 分钟',
      '北京时间每天 7 点后一次',
    ]);
  });
});
