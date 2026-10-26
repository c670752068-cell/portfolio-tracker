import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataSourceStatusPanel } from './DataSourceStatusPanel';
import type { DataSourceStatus } from '../dataSources';

const status: DataSourceStatus = {
  generatedAt: '2026-10-25T14:00:00.000Z',
  macAlive: false,
  sources: [
    { key: 'positions', name: '持仓与现金', location: 'mac', updatedAt: '2026-10-24T20:19:00.000Z', ageMinutes: 1061, stale: true, note: '由 Mac 上的量化系统推送' },
    { key: 'realtime_quotes', name: '实时报价', location: 'server', updatedAt: null, ageMinutes: null, stale: false, note: '服务器自己取' },
    { key: 'server_opend', name: '服务器 OpenD', location: 'server', updatedAt: null, ageMinutes: null, stale: false, ready: false, reason: 'not_configured' },
  ],
};

describe('设置页的数据状态', () => {
  it('每一项写清楚跑在哪、最后什么时候更新', () => {
    const html = renderToStaticMarkup(<DataSourceStatusPanel status={status} />);

    expect(html).toContain('data-data-sources="true"');
    expect(html).toContain('持仓与现金');
    expect(html).toContain('本机（Mac）');
    expect(html).toContain('18 小时前 · 已过期');
    expect(html).toContain('实时报价');
    expect(html).toContain('服务器实时取数');
  });

  it('Mac 那边停了就在最上面说一句', () => {
    const html = renderToStaticMarkup(<DataSourceStatusPanel status={status} />);
    expect(html).toContain('Mac 上的推送已经停了');
  });

  it('服务器 OpenD 还没配置时写「未配置」', () => {
    const html = renderToStaticMarkup(<DataSourceStatusPanel status={status} />);
    expect(html).toContain('未配置');
  });

  it('还没读到状态时不画表', () => {
    expect(renderToStaticMarkup(<DataSourceStatusPanel status={null} />)).toContain('读取中');
  });
});

describe('服务器 OpenD 这一行', () => {
  const statusWith = (opend: Record<string, unknown>) => ({
    version: 1,
    generated_at: '2026-10-26T03:30:00.000Z',
    macAlive: true,
    sources: [{ key: 'server_opend', name: '服务器 OpenD', location: 'server', updatedAt: null, ageMinutes: null, stale: false, ...opend }],
  }) as never;

  it('在跑的时候显示「运行中」，不再说未配置', () => {
    const html = renderToStaticMarkup(
      <DataSourceStatusPanel status={statusWith({ ready: true, reason: null })} />,
    );
    expect(html).toContain('运行中');
    expect(html).not.toContain('未配置');
  });

  it('还没配置时才说「未配置」', () => {
    const html = renderToStaticMarkup(
      <DataSourceStatusPanel status={statusWith({ ready: false, reason: 'not_configured' })} />,
    );
    expect(html).toContain('未配置');
  });

  it('配置了但连不上时说「连不上」', () => {
    const html = renderToStaticMarkup(
      <DataSourceStatusPanel status={statusWith({ ready: false, reason: 'connect_refused' })} />,
    );
    expect(html).toContain('连不上');
  });
});
