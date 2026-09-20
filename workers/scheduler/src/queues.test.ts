import { describe, expect, it } from 'vitest';
import { redisConnectionFromUrl, QUEUES } from './queues';

describe('redisConnectionFromUrl', () => {
  it('parses host/port', () => {
    expect(redisConnectionFromUrl('redis://localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
  });
  it('parses password, db and tls', () => {
    expect(redisConnectionFromUrl('rediss://:p%40ss@cache.example.com:6380/2')).toEqual({ host: 'cache.example.com', port: 6380, password: 'p@ss', db: 2, tls: {} });
  });
  it('defines every queue from §46', () => {
    expect(Object.values(QUEUES).sort()).toEqual(['ai', 'analytics', 'facebook-publish', 'facebook-sync', 'facebook-webhook', 'maintenance', 'media', 'reports']);
  });
});
