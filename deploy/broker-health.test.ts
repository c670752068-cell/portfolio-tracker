import { describe, expect, it } from 'vitest';
import { BROKER_NAMES, brokerHealthReadings } from './broker-health.mjs';

const snapshot = {
  freshness: {
    broker_health: [
      { broker: 'IBKR', available: true, as_of: '2026-10-19', error_code: null },
      { broker: 'LONGPORT', available: false, as_of: null, error_code: 'LONGPORT_SDK' },
      { broker: 'FUTU', available: true, as_of: '2026-10-20', error_code: null },
    ],
  },
};

describe('券商同步失败要写系统提醒', () => {
  it('失败的写一条「❗ 系统」，带上错误码', () => {
    const readings = brokerHealthReadings(snapshot);
    const longport = readings.find((item) => item.key === 'broker:LONGPORT')!;

    expect(longport).toMatchObject({ state: 'triggered', category: 'system', icon: '❗', symbol: null });
    expect(longport.text).toContain('长桥');
    expect(longport.text).toContain('LONGPORT_SDK');
    expect(longport.text).toContain('上一份');
  });

  it('正常的写「正常」状态，恢复时才会落成一行「已恢复」', () => {
    const readings = brokerHealthReadings(snapshot);
    const ibkr = readings.find((item) => item.key === 'broker:IBKR')!;

    expect(ibkr).toMatchObject({ state: 'normal', icon: '✅' });
    expect(ibkr.text).toContain('已恢复');
    expect(ibkr.text).toContain('2026-10-19');
  });

  it('三家券商的中文名', () => {
    expect(BROKER_NAMES).toMatchObject({ IBKR: 'IBKR', LONGPORT: '长桥', FUTU: '富途' });
  });

  it('快照里没有 broker_health 就什么都不写', () => {
    expect(brokerHealthReadings({})).toEqual([]);
    expect(brokerHealthReadings(null)).toEqual([]);
    expect(brokerHealthReadings({ freshness: { broker_health: 'x' } })).toEqual([]);
  });

  it('顶层也有一份时同样认得', () => {
    expect(brokerHealthReadings({
      broker_health: [{ broker: 'FUTU', available: false, error_code: 'TIMEOUT' }],
    })).toHaveLength(1);
  });
});
