import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalysisPanel } from './AnalysisPanel';

describe('AnalysisPanel', () => {
  it('routes analysis to quant conditions without exposing a Kimi/Zhipu analysis button', () => {
    const html = renderToStaticMarkup(
      <AnalysisPanel onOpenConditionLookup={() => undefined} />,
    );

    expect(html).toContain('条件查询');
    expect(html).toContain('量化系统');
    expect(html).not.toContain('调用智谱分析');
    expect(html).not.toContain('调用 Kimi 分析');
    expect(html).not.toContain('API Key');
  });
});
