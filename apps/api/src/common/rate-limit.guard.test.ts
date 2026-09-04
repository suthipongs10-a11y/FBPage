import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, _resetRateLimits } from './rate-limit.guard';

describe('rate limit', () => {
  beforeEach(() => _resetRateLimits());
  it('allows up to the limit then blocks with retry-after', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k', 3, 1000, 0).allowed).toBe(true);
    const r = checkRateLimit('k', 3, 1000, 0);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(1);
  });
  it('resets after the window', () => {
    for (let i = 0; i < 4; i++) checkRateLimit('k', 3, 1000, 0);
    expect(checkRateLimit('k', 3, 1000, 1001).allowed).toBe(true);
  });
});
