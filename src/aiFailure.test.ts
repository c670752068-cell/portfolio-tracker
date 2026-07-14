import { describe, expect, it } from 'vitest';
import { classifyAiFailure, isRetryableAiFailure } from './aiFailure';

describe('classifyAiFailure', () => {
  it.each([
    [503, undefined, 'Service unavailable'],
    [500, undefined, '当前模型访问量过大，请稍后再试'],
    [500, undefined, 'server busy'],
  ])('classifies overload from status/message', (status, code, message) => {
    expect(classifyAiFailure(status, code, message)).toBe('overload');
  });

  it.each([
    [429, undefined, 'Too many requests'],
    [400, '1302', '请求失败'],
    [400, undefined, '并发请求过多'],
  ])('classifies rate limits from status/code/message', (status, code, message) => {
    expect(classifyAiFailure(status, code, message)).toBe('rate_limit');
  });

  it('classifies authentication failures', () => {
    expect(classifyAiFailure(401, undefined, 'unauthorized')).toBe('auth');
  });

  it('classifies invalid image requests', () => {
    expect(classifyAiFailure(400, undefined, 'invalid image payload')).toBe('bad_image');
  });

  it('uses other for unrelated errors', () => {
    expect(classifyAiFailure(500, 'unknown', 'unexpected failure')).toBe('other');
  });

  it('marks only overload and rate limits as retryable', () => {
    expect(isRetryableAiFailure('overload')).toBe(true);
    expect(isRetryableAiFailure('rate_limit')).toBe(true);
    expect(isRetryableAiFailure('auth')).toBe(false);
    expect(isRetryableAiFailure('bad_image')).toBe(false);
    expect(isRetryableAiFailure('other')).toBe(false);
  });
});
