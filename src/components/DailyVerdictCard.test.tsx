import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyVerdictCard } from './DailyVerdictCard';

describe('DailyVerdictCard', () => {
  it('stays hidden until a verdict title is available', () => {
    expect(renderToStaticMarkup(<DailyVerdictCard />)).toBe('');
    expect(renderToStaticMarkup(<DailyVerdictCard title="   " />)).toBe('');
  });

  it('renders a calm decision card without deriving any missing data', () => {
    const html = renderToStaticMarkup(
      <DailyVerdictCard
        title="耐心等待"
        detail="今天没有需要执行的操作。"
        meta="数据截至 09:30"
        accent="buy"
      />,
    );

    expect(html).toContain('今日决断');
    expect(html).toContain('耐心等待');
    expect(html).toContain('今天没有需要执行的操作。');
    expect(html).toContain('数据截至 09:30');
    expect(html).toContain('rounded-2xl');
    expect(html).toContain('border-l-buy');
    expect(html).toContain('font-mono');
  });
});
