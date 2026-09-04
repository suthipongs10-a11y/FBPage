import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const good = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'x'.repeat(40),
};

describe('env validation (§82)', () => {
  it('accepts a minimal valid config and applies defaults', () => {
    const e = loadEnv(good);
    expect(e.API_PORT).toBe(4000);
    expect(e.APP_ENV).toBe('development');
    expect(e.META_GRAPH_API_VERSION).toBe('v26.0');
  });
  it('rejects a short AUTH_SECRET with a readable message', () => {
    expect(() => loadEnv({ ...good, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });
  it('rejects a malformed Graph version', () => {
    expect(() => loadEnv({ ...good, META_GRAPH_API_VERSION: '26' })).toThrow(/META_GRAPH_API_VERSION/);
  });
  it('coerces API_PORT', () => {
    expect(loadEnv({ ...good, API_PORT: '4100' }).API_PORT).toBe(4100);
  });
});
