import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';

describe('unified buy and sell refresh wiring', () => {
  it('routes both decision surfaces through the full server recompute flow', () => {
    expect(appSource).toContain('<ValuationPanel');
    expect(appSource).toContain('onRefreshQuant={refreshEverything}');
    expect(appSource).toContain('<SellDecisionDashboard');
    expect(appSource).toContain('onRefresh={refreshEverything}');
    expect(appSource).not.toContain('onRefreshQuant={refreshQuantAnalysis}');
    expect(appSource).not.toContain("message: '服务器刷新凭证未配置'");
  });
});
