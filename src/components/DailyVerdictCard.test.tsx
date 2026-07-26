import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyVerdictCard } from './DailyVerdictCard';

describe('DailyVerdictCard', () => {
  it('stays hidden until the backend verdict is available', () => {
    expect(renderToStaticMarkup(<DailyVerdictCard />)).toBe('');
  });

  it('renders at most three backend points with the matching calm level', () => {
    const html = renderToStaticMarkup(
      <DailyVerdictCard
        verdict={{
          as_of: '2026-07-24',
          headline: '今天什么都别做，拿稳',
          level: 'hold',
          points: ['勿加仓', '按纪律持有', '等待窗口', '不应显示'],
          rule_version: '2.2',
        }}
      />,
    );

    expect(html).toContain('今日决断');
    expect(html).toContain('今天什么都别做，拿稳');
    expect(html).toContain('勿加仓');
    expect(html).toContain('按纪律持有');
    expect(html).toContain('等待窗口');
    expect(html).not.toContain('不应显示');
    expect(html).toContain('2026-07-24');
    expect(html).toContain('规则 2.2');
    expect(html).toContain('rounded-2xl');
    expect(html).toContain('border-l-neutral');
    expect(html).toContain('font-mono');
  });
});
