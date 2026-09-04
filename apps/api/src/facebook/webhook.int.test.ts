/** Webhook endpoint (§14): verify handshake, signature check, normalization, enqueue */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUES } from '@fbpm/shared';
import { createApp } from '../app.factory';
import { normalizeWebhook } from './webhook.controller';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

describe('normalizeWebhook', () => {
  it('maps feed comment add → COMMENT_CREATED and post → POST_UPDATED', () => {
    const ev = normalizeWebhook({ object: 'page', entry: [{ id: '111', time: 1700000000, changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '111_1_9', post_id: '111_1', message: 'ราคา?', from: { id: 'u', name: 'A' }, created_time: 1700000000 } },
      { field: 'feed', value: { item: 'status', verb: 'add', post_id: '111_5' } },
      { field: 'mention', value: {} },
    ] }] });
    expect(ev.map(e => e.type)).toEqual(['COMMENT_CREATED', 'POST_UPDATED', 'UNKNOWN']);
    expect(ev[0]).toMatchObject({ facebookPageId: '111', postId: '111_1', commentId: '111_1_9', fromName: 'A' });
  });
});

run('webhook endpoint (integration)', () => {
  let app: INestApplication; let base: string; let q: Queue;
  beforeAll(async () => {
    process.env.APP_ENV = 'test'; process.env.AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars'; process.env.META_APP_SECRET = 'whsecret'; process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-me';
    ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const u = new URL(process.env.REDIS_URL!); q = new Queue(QUEUES.facebookWebhook, { connection: { host: u.hostname, port: Number(u.port) || 6379 } });
  }, 30_000);
  afterAll(async () => { delete process.env.META_APP_SECRET; delete process.env.META_WEBHOOK_VERIFY_TOKEN; await q.obliterate({ force: true }).catch(() => undefined); await q.close(); await app.close(); });

  it('GET handshake echoes the challenge only with the right verify token', async () => {
    const ok = await fetch(`${base}/facebook/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    expect(ok.status).toBe(200); expect(await ok.text()).toBe('12345');
    expect((await fetch(`${base}/facebook/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status).toBe(403);
  });

  it('POST requires a valid X-Hub-Signature-256 and enqueues normalized events', async () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: '111', time: 1, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: `c_${Date.now()}`, post_id: '111_1', message: 'hi' } }] }] });
    const bad = await fetch(`${base}/facebook/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }, body });
    expect(bad.status).toBe(403);
    const sig = 'sha256=' + createHmac('sha256', 'whsecret').update(body).digest('hex');
    const ok = await fetch(`${base}/facebook/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ received: 1 });
    const jobs = await q.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(jobs.some(j => (j.data as { type: string }).type === 'COMMENT_CREATED')).toBe(true);
  });
});
