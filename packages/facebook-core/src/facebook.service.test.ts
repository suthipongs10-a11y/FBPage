import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FacebookService, FacebookApiError } from './index';
import { normalizePostMetrics, pageCompleteness, toSnapshot } from './metrics';
import { startMockGraph, type MockState } from './mock-graph';

let url: string; let state: MockState; let close: () => void;
beforeAll(async () => { const m = await startMockGraph(); url = m.url; state = m.state; close = () => m.server.close(); });
afterAll(() => close());
const svc = () => new FacebookService({ baseUrl: url, version: 'v26.0', maxRetries: 2, sleep: async () => undefined });

describe('FacebookService (mock Graph, §77)', () => {
  it('inspects a user token and lists pages with tasks + page tokens', async () => {
    const info = await svc().inspectUserToken('USER_OK');
    expect(info.user.name).toBe('Test User');
    expect(info.grantedScopes).toContain('pages_manage_posts');
    const pages = await svc().listPages('USER_OK');
    expect(pages.map(p => p.id)).toEqual(['111', '222']);
    expect(pages[1]?.tasks).toContain('MANAGE');
    expect(pages[0]?.accessToken).toBe('PAGE_111');
  });

  it('turns an invalid token into a token error with a user-facing message', async () => {
    await expect(svc().inspectUserToken('BAD')).rejects.toBeInstanceOf(FacebookApiError);
    try { await svc().inspectUserToken('BAD'); } catch (e) { expect((e as FacebookApiError).isTokenError).toBe(true); expect((e as FacebookApiError).userMessage).toMatch(/เชื่อมต่อเพจใหม่/); }
  });

  it('falls back when likes/comments summary is denied and reports availability honestly', async () => {
    const { posts, availability } = await svc().getPosts('111', 'PAGE_111');
    expect(availability).toEqual({ likes: false, comments: false, shares: true });
    expect(posts).toHaveLength(2);
    const m = Object.fromEntries(posts[0]!.metrics.map(x => [x.metric, x.value]));
    expect(m.shares).toBe(3);
    expect(m.reactions).toBeNull();   // ไม่ใช่ 0
    expect(m.comments).toBeNull();
  });

  it('reads full metrics when the summary fields are allowed', async () => {
    state.denyEngagementSummary = false;
    const { availability } = await svc().getPosts('111', 'PAGE_111');
    expect(availability.likes).toBe(true);
    state.denyEngagementSummary = true;
  });

  it('filters by since', async () => {
    const { posts } = await svc().getPosts('111', 'PAGE_111', { since: new Date(Date.now() - 1.5 * 86400000) });
    expect(posts.map(p => p.id)).toEqual(['111_2']);
  });

  it('retries on rate limit then succeeds', async () => {
    state.rateLimitNext = 1;
    const p = await svc().getPage('222', 'PAGE_222');
    expect(p.name).toBe('Phuket Maids Service');
    expect(p.fanCount).toBe(1829);
  });

  it('publishes text, schedules, and validates schedule window', async () => {
    const r = await svc().createPost('111', 'PAGE_111', { message: 'hello' });
    expect(r.externalId).toMatch(/^111_new/);
    expect(state.published.at(-1)?.body.message).toBe('hello');
    await expect(svc().createPost('111', 'PAGE_111', { message: 'x', scheduledAt: new Date(Date.now() + 60_000) })).rejects.toThrow(/10 นาที/);
    const s = await svc().createPost('111', 'PAGE_111', { message: 'later', scheduledAt: new Date(Date.now() + 3_600_000) });
    expect(s.scheduled).toBe(true);
    expect(state.published.at(-1)?.body.published).toBe('false');
  });

  it('multi-photo post uploads unpublished photos then attaches them', async () => {
    const before = state.published.length;
    await svc().createPhotoPost('111', 'PAGE_111', { message: 'pics', photos: [{ url: 'http://x/a.jpg' }, { url: 'http://x/b.jpg' }] });
    const calls = state.published.slice(before);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.body.published).toBe('false');
    expect(calls[2]?.body['attached_media[1]']).toContain('media_fbid');
  });

  it('multi-photo post with local files uploads multipart', async () => {
    const { writeFileSync, rmSync } = await import('node:fs');
    const f = `/tmp/fbpm-test-${Date.now()}.png`; writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const before = state.published.length;
      const r = await svc().createPhotoPost('111', 'PAGE_111', { message: 'file', photos: [f] });
      expect(r.externalId).toMatch(/^111_new/);
      expect(state.published.slice(before)).toHaveLength(2);
    } finally { rmSync(f, { force: true }); }
  });

  it('validatePageToken never throws', async () => {
    expect(await svc().validatePageToken('111', 'PAGE_111')).toEqual({ valid: true });
    expect((await svc().validatePageToken('111', 'WRONG')).valid).toBe(false);
  });
});

describe('metric adapter (§60, ADR-001)', () => {
  it('null when not available, 0 when available but absent', () => {
    const m = normalizePostMetrics({ id: '1', created_time: '2026-01-01T00:00:00Z' }, { likes: false, comments: false, shares: true });
    const s = toSnapshot(m);
    expect(s.shares?.value).toBe(0);
    expect(s.reactions?.value).toBeNull();
  });
  it('page completeness matches CLI audit semantics', () => {
    const r = pageCompleteness({ name: 'x', about: 'a', phone: '+66', picture: { data: { url: 'u', is_silhouette: false } } });
    expect(r.score).toBe(Math.round((3 / 11) * 100));
    expect(r.missing.map(x => x.key)).toContain('description');
  });
});
