import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, encryptSecret } from '@fbpm/database';
import { createApp } from '../app.factory';
import { _resetRateLimits } from '../common/rate-limit.guard';

const run = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;
run('TikTok brand drafts without platform or AI credentials', () => {
  let app: INestApplication; let db: PrismaClient; let base = ''; let cookie = ''; let otherCookie = '';
  let ws = ''; let otherWs = ''; let uid = ''; let brand = ''; let otherBrand = ''; let secondBrand = ''; let draft = '';
  const stamp = Date.now(); const secret = 'offline-test-only-secret-32-characters-long';
  async function http(method: string, path: string, body?: unknown, session = cookie) {
    const r = await fetch(base + path, { method, headers: { cookie: session, 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const text = await r.text(); return { status: r.status, body: JSON.parse(text), text, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  beforeAll(async () => {
    Object.assign(process.env, { APP_ENV: 'test', AUTH_SECRET: secret, SOCIAL_PUBLISHING_ENABLED: 'false' });
    for (const k of ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', 'TIKTOK_MOCK_BASE_URL', 'GOOGLE_AI_API_KEY']) delete process.env[k];
    _resetRateLimits(); ({ app } = await createApp()); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); db = new PrismaClient();
    for (const suffix of ['a', 'b']) {
      const r = await http('POST', '/auth/register', { email: `offline-${suffix}-${stamp}@test.local`, name: suffix, password: 'offline-test-password-12345' }); expect(r.status).toBe(201);
      const u = await db.user.findUniqueOrThrow({ where: { email: `offline-${suffix}-${stamp}@test.local` }, include: { memberships: true } });
      const c = await db.client.create({ data: { workspaceId: u.memberships[0]!.workspaceId, name: suffix, brands: { create: { name: `Brand ${suffix}` } } }, include: { brands: true } });
      if (suffix === 'a') { ws = u.memberships[0]!.workspaceId; uid = u.id; cookie = r.cookie; brand = c.brands[0]!.id; secondBrand = (await db.brand.create({ data: { clientId: c.id, name: 'Another brand' } })).id; }
      else { otherWs = u.memberships[0]!.workspaceId; otherCookie = r.cookie; otherBrand = c.brands[0]!.id; }
    }
  }, 40_000);
  afterAll(async () => {
    if (db) {
      const ids = [ws, otherWs].filter(Boolean);
      await db.contentItem.deleteMany({ where: { platform: 'TIKTOK', tiktokBrand: { client: { workspaceId: { in: ids } } } } });
      await db.tikTokAccount.deleteMany({ where: { workspaceId: { in: ids } } });
      await db.workspace.deleteMany({ where: { id: { in: ids } } });
      await db.user.deleteMany({ where: { email: { in: [`offline-a-${stamp}@test.local`, `offline-b-${stamp}@test.local`] } } });
      await db.$disconnect();
    }
    await app?.close();
  });
  it('creates a real brand-owned draft while connection is unconfigured, with no fabricated account', async () => {
    expect((await http('GET', `/workspaces/${ws}/tiktok/health`)).body.configured).toBe(false);
    expect((await http('POST', `/workspaces/${ws}/tiktok/content`, { title: 'Missing brand' })).status).toBe(400);
    expect((await http('POST', `/workspaces/${ws}/tiktok/content`, { brandId: otherBrand, title: 'Cross tenant' })).status).toBe(404);
    const r = await http('POST', `/workspaces/${ws}/tiktok/content`, { brandId: brand, title: 'ร่างก่อนเชื่อมบัญชี', script: 'สคริปต์ที่ทีมเตรียมไว้', caption: 'คำบรรยาย', hashtags: ['ทดสอบ'] });
    expect(r.status, r.text).toBe(201); draft = r.body.id; expect(r.body.tiktokAccountId).toBeNull(); expect(r.body.tiktokBrandId).toBe(brand);
    expect(await db.tikTokAccount.count({ where: { workspaceId: ws } })).toBe(0);
    const list = await http('GET', `/workspaces/${ws}/content`); expect(list.body.some((c: { id: string }) => c.id === draft)).toBe(true);
  });
  it('exports Thai text and restricts draft exports and repurposing sources to the correct tenant/brand', async () => {
    const exported = await http('GET', `/workspaces/${ws}/tiktok/content/${draft}/export`); expect(exported.status).toBe(200);
    expect(exported.body.text).toContain('สคริปต์ที่ทีมเตรียมไว้'); expect(exported.body.text).toContain('#ทดสอบ'); expect(exported.body.filename).toMatch(/^tiktok-draft-.*\.txt$/);
    expect((await http('GET', `/workspaces/${otherWs}/tiktok/content/${draft}/export`, undefined, otherCookie)).status).toBe(404);
    const source = await http('POST', `/workspaces/${ws}/tiktok/content`, { brandId: secondBrand, title: 'Wrong source brand' }); expect(source.status).toBe(201);
    const sources = await http('GET', `/workspaces/${ws}/tiktok/brands/${brand}/sources`); expect(sources.body.map((c: { id: string }) => c.id)).toContain(draft); expect(sources.body.map((c: { id: string }) => c.id)).not.toContain(source.body.id);
    expect((await http('GET', `/workspaces/${ws}/tiktok/brands/${otherBrand}/sources`)).status).toBe(404);
    expect((await http('GET', `/workspaces/${ws}/tiktok/brands`)).body).toHaveLength(2);
  });
  it('allows human review and approval without keys but prevents sending before an account is chosen', async () => {
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${draft}/submit`, { reviewed: true })).status).toBe(200);
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${draft}/decision`, { approve: true })).status).toBe(200);
    expect((await http('POST', `/workspaces/${ws}/tiktok/content/${draft}/send`, { confirm: true })).status).toBe(409);
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: draft } })).status).toBe('APPROVED');
    expect(await db.externalOperation.count({ where: { workspaceId: ws, provider: 'TIKTOK' } })).toBe(0);
  });
  it('assigns only an active account of the same brand, rechecks roles and expires old approval', async () => {
    // Explicit database fixtures for assignment policy only; no OAuth grant or network is simulated as real.
    const make = (brandId: string, workspaceId: string) => db.tikTokAccount.create({ data: { brandId, workspaceId, openId: `fixture-${brandId}`, displayName: 'Test fixture', accessTokenEncrypted: encryptSecret('fixture-token', secret), refreshTokenEncrypted: encryptSecret('fixture-refresh', secret), tokenExpiresAt: new Date(Date.now() + 3600000), refreshExpiresAt: new Date(Date.now() + 7200000) } });
    const target = await make(brand, ws); const wrong = await make(secondBrand, ws); const cross = await make(otherBrand, otherWs);
    const path = `/workspaces/${ws}/tiktok/content/${draft}/account`;
    expect((await http('PATCH', path, { accountId: wrong.id })).status).toBe(409);
    expect((await http('PATCH', path, { accountId: cross.id })).status).toBe(404);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: ws, userId: uid } }, data: { role: 'viewer' } });
    expect((await http('PATCH', path, { accountId: target.id })).status).toBe(403);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: ws, userId: uid } }, data: { role: 'owner' } });
    const r = await http('PATCH', path, { accountId: target.id }); expect(r.status, r.text).toBe(200); expect(r.body.status).toBe('DRAFT'); expect(r.body.tiktokAccountId).toBe(target.id); expect(r.body.tiktokMeta.confirmedAt).toBeNull();
    expect(await db.approvalRequest.count({ where: { contentId: draft, status: 'APPROVED' } })).toBe(0);
  });
});
