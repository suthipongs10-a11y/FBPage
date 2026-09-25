import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, hashToken, newSessionToken } from './password';

describe('password hashing', () => {
  it('round-trips and rejects wrong password', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('uses a fresh salt each time', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });
  it('rejects malformed stored values without throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('session tokens are long and hashed deterministically', () => {
    const t = newSessionToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });
});
