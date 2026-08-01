import { describe, expect, it } from 'vitest';
import { isHonestPass } from './gateHonesty';

describe('isHonestPass', () => {
  it('accepts a pass with a real reason', () => {
    expect(isHonestPass(true, '通过')).toBe(true);
    expect(isHonestPass(true, null)).toBe(true);
    expect(isHonestPass(true, undefined)).toBe(true);
  });

  it('rejects a pass whose reason says the inputs are missing', () => {
    expect(isHonestPass(true, '指数估值或 CNN 情绪数据缺失')).toBe(false);
    expect(isHonestPass(true, '价格暂无')).toBe(false);
    expect(isHonestPass(true, '数据源不可用')).toBe(false);
    expect(isHonestPass(true, '快照未生成')).toBe(false);
    expect(isHonestPass(true, '样本数据不足')).toBe(false);
  });

  it('never turns a non-pass into a pass', () => {
    expect(isHonestPass(false, '通过')).toBe(false);
    expect(isHonestPass(false, '指数估值或 CNN 情绪数据缺失')).toBe(false);
    expect(isHonestPass(undefined, '通过')).toBe(false);
  });
});
