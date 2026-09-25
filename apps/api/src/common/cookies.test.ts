import { describe, expect, it } from 'vitest';
import { parseCookies, serializeCookie } from './cookies';

describe('cookies', () => {
  it('parses multiple cookies and decodes values', () => {
    expect(parseCookies('a=1; fbpm_session=abc%20def; x=y=z')).toEqual({ a: '1', fbpm_session: 'abc def', x: 'y=z' });
  });
  it('handles missing header', () => { expect(parseCookies(undefined)).toEqual({}); });
  it('serializes with HttpOnly + SameSite by default', () => {
    expect(serializeCookie('s', 'v', { maxAgeSec: 60, secure: true })).toBe('s=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
  });
  it('clears with Max-Age=0', () => { expect(serializeCookie('s', '', { maxAgeSec: 0 })).toContain('Max-Age=0'); });
});
