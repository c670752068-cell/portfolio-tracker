import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';

describe('the removed conclusion bar stays off 总览', () => {
  it('does not render the quant conclusion or broadcast card', () => {
    const renders = appSource.match(/<DecisionStatusBar\b/g) ?? [];

    expect(renders).toHaveLength(0);
    expect(appSource).not.toContain("import { DecisionStatusBar }");
  });
});
