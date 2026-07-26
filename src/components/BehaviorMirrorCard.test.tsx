import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BehaviorMirrorCard } from './BehaviorMirrorCard';

describe('BehaviorMirrorCard', () => {
  it('hides completely when the backend field is absent', () => {
    expect(renderToStaticMarkup(<BehaviorMirrorCard />)).toBe('');
  });

  it('shows sufficient samples with counts and positive discipline feedback', () => {
    const html = renderToStaticMarkup(
      <BehaviorMirrorCard
        mirror={{
          trades_analyzed: 42,
          sell_flycount: {
            n: 12,
            flew_pct: 66.7,
            avg_missed_60d_pct: 8.3,
            sample_sufficient: true,
          },
          chase_high: {
            n: 18,
            chased_pct: 44,
            avg_entry_drawdown_pct: -6.1,
            sample_sufficient: true,
          },
          weakness_labels: ['倾向卖飞', '倾向追高'],
          streak_days_following_rules: 4,
        }}
      />,
    );

    expect(html).toContain('行为镜子');
    expect(html).toContain('倾向卖飞');
    expect(html).toContain('样本 12');
    expect(html).toContain('倾向追高');
    expect(html).toContain('样本 18');
    expect(html).toContain('连续守规 4 天');
  });

  it('does not draw conclusions from insufficient samples', () => {
    const html = renderToStaticMarkup(
      <BehaviorMirrorCard
        mirror={{
          trades_analyzed: 3,
          sell_flycount: {
            n: 3,
            flew_pct: 66.7,
            avg_missed_60d_pct: 8.3,
            sample_sufficient: false,
          },
          chase_high: {
            n: 0,
            chased_pct: 0,
            avg_entry_drawdown_pct: 0,
            sample_sufficient: false,
          },
          weakness_labels: [],
          streak_days_following_rules: 1,
        }}
      />,
    );

    expect(html).toContain('数据积累中');
    expect(html).toContain('样本 3');
    expect(html).not.toContain('卖飞比例');
    expect(html).not.toContain('追高比例');
  });
});
