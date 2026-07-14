import { describe, expect, it } from 'vitest';
import {
  isMixedContentBlocked,
  looksLikeApiKey,
  sanitizeEndpointUrl,
} from './endpointUrl';

describe('sanitizeEndpointUrl', () => {
  it('keeps absolute http and https endpoints', () => {
    expect(sanitizeEndpointUrl('https://proxy.example.com/v1/chat/completions')).toBe(
      'https://proxy.example.com/v1/chat/completions',
    );
    expect(sanitizeEndpointUrl('http://67.215.255.196:8788/api/quotes')).toBe(
      'http://67.215.255.196:8788/api/quotes',
    );
  });

  it.each([
    'sk-xxx',
    'api.moonshot.cn/v1',
    '',
    '   ',
  ])('rejects a non-absolute endpoint: %j', (value) => {
    expect(sanitizeEndpointUrl(value)).toBe('');
  });
});

describe('endpoint input diagnostics', () => {
  it('recognises an API key pasted into a URL field', () => {
    expect(looksLikeApiKey('sk-FCCx-example')).toBe(true);
  });

  it('detects only https-page to http-endpoint mixed content', () => {
    const endpoint = 'http://67.215.255.196:8788/api/kimi/chat/completions';
    expect(isMixedContentBlocked(endpoint, 'https:')).toBe(true);
    expect(isMixedContentBlocked(endpoint, 'http:')).toBe(false);
  });
});
