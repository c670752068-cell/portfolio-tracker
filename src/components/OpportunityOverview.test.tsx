import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import { OpportunityOverview } from './OpportunityOverview';

function findButton(node: ReactNode, text: string): ReactElement<{ onClick: () => void }> | null {
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (typeof element.type === 'function') {
    const component = element.type as (props: typeof element.props) => ReactNode;
    return findButton(component(element.props), text);
  }
  const label = renderToStaticMarkup(element);
  if (element.type === 'button' && label.includes(text)) {
    return element as ReactElement<{ onClick: () => void }>;
  }
  for (const child of Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children]) {
    const found = findButton(child, text);
    if (found) return found;
  }
  return null;
}

describe('OpportunityOverview', () => {
  it('renders buy, near, sell and idle groups from the server summary', () => {
    const html = renderToStaticMarkup(
      <OpportunityOverview snapshot={quantAnalysisFixture} />,
    );

    expect(html).toContain('今日机会一览');
    expect(html).toContain('条件已满足');
    expect(html).toContain('SOXL');
    expect(html).toContain('接近买入条件');
    expect(html).toContain('AMZN');
    expect(html).toContain('卖出窗口（持仓中有触发依据）');
    expect(html).toContain('MSFT');
    expect(html).toContain('（观察期）');
    expect(html).toContain('其余 1 只今日无操作窗口');
    expect(html).toContain('只提醒不下单');
  });

  it('treats all-empty groups as a deliberate wait state', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      summary: {
        ...quantAnalysisFixture.summary,
        buy_ready: [], buy_near: [], sell_ready: [],
        idle_symbols: ['AAPL', 'AMZN'], idle_count: 2,
      },
    };

    const html = renderToStaticMarkup(<OpportunityOverview snapshot={snapshot} />);

    expect(html).toContain('今日无操作窗口，耐心等待');
    expect(html).toContain('耐心等待也是操作');
  });

  it('sends a clicked row directly to the matching detail selector', () => {
    const onSelect = vi.fn();
    const tree = OpportunityOverview({ snapshot: quantAnalysisFixture, onSelect });

    findButton(tree, 'AMZN')?.props.onClick();
    findButton(tree, 'MSFT')?.props.onClick();

    expect(onSelect).toHaveBeenNthCalledWith(1, 'AMZN', 'buy');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'MSFT', 'sell');
  });

  it('renders a compact first-glance variant from the same summary', () => {
    const html = renderToStaticMarkup(
      <OpportunityOverview snapshot={quantAnalysisFixture} compact />,
    );

    expect(html).toContain('今日：条件满足 1 · 接近 1 · 卖出窗口 1');
    expect(html).toContain('🟢 SOXL');
    expect(html).toContain('🟡 AMZN');
    expect(html).toContain('🔴 MSFT');
    expect(html).not.toContain('卖出窗口（持仓中有触发依据）');
  });
});
