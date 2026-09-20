import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, signState, verifyState } from './crypto';

const S = 'unit-test-secret-that-is-long-enough-32';
describe('crypto (§13)', () => {
  it('round-trips and never stores plaintext', () => {
    const enc = encryptSecret('EAAB-super-secret-token', S);
    expect(enc).not.toContain('EAAB');
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(enc, S)).toBe('EAAB-super-secret-token');
    expect(encryptSecret('x', S)).not.toBe(encryptSecret('x', S)); // iv สุ่ม
  });
  it('rejects wrong key or tampering', () => {
    const enc = encryptSecret('tok', S);
    expect(() => decryptSecret(enc, S + 'x')).toThrow();
    expect(() => decryptSecret(enc.slice(0, -2) + 'AA', S)).toThrow();
    expect(() => decryptSecret('garbage', S)).toThrow();
  });
  it('signs and verifies OAuth state', () => {
    const st = signState({ ws: 'w1', uid: 'u1' }, S);
    expect(verifyState(st, S)).toEqual({ ws: 'w1', uid: 'u1' });
    expect(verifyState(st, 'other-secret')).toBeNull();
    expect(verifyState(st + 'x', S)).toBeNull();
    expect(verifyState(undefined, S)).toBeNull();
  });
});
