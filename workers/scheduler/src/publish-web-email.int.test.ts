/** Worker integration — web-publish (WordPress mock) และ email-send (ผู้ให้บริการ mock) — idempotent เมื่องานถูกรันซ้ำ (ต้องมี DATABASE_URL + REDIS_URL) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient, encryptSecret } from '@fbpm/database';
import { MOCK_WP_APP_PASSWORD, MOCK_WP_USER, startMockWeb } from '@fbpm/web-core';
import { MOCK_BREVO_KEY, startMockEmailProvider } from '@fbpm/email-core';
import { EMAIL_JOBS, WEB_JOBS } from '@fbpm/shared';

const HAS_DB = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const run = HAS_DB ? describe : describe.skip;

run('worker web-publish + email-send', () => {
  let web: Awaited<ReturnType<typeof startMockWeb>>; let mail: Awaited<ReturnType<typeof startMockEmailProvider>>; let prisma: PrismaClient; let mod: typeof import('./main');
  const SECRET = 'worker-web-test-secret-at-least-32-characters!!';
  let ws = ''; let userId = ''; let contentId = ''; let campaignId = '';
  const job = <T,>(data: T, name: string, attemptsMade = 0) => ({ id: `j-${Math.random().toString(36).slice(2)}`, name, data, attemptsMade, opts: { attempts: 3 } } as unknown as Job<T>);
  beforeAll(async () => {
    web = await startMockWeb(); mail = await startMockEmailProvider();
    Object.assign(process.env, { WEB_MOCK_BASE_URL: web.url, WEB_ALLOW_PRIVATE_TARGETS: 'true', WEB_PUBLISH_ENABLED: 'true', WEB_WP_ALLOW_INSECURE: 'true', EMAIL_MOCK_BASE_URL: mail.url, EMAIL_SEND_ENABLED: 'true', APP_URL: 'http://127.0.0.1:3000', AUTH_SECRET: SECRET });
    mod = await import('./main'); prisma = new PrismaClient();
    const user = await prisma.user.create({ data: { email: `pubworker-${Date.now()}@test.local`, name: 'W', passwordHash: 'x' } }); userId = user.id;
    const w = await prisma.workspace.create({ data: { name: 'W', slug: `pubw-${Date.now()}` } }); ws = w.id;
    const client = await prisma.client.create({ data: { workspaceId: ws, name: 'C' } });
    const brand = await prisma.brand.create({ data: { clientId: client.id, name: 'B' } });
    const site = await prisma.site.create({ data: { brandId: brand.id, url: web.siteUrl, name: 'mock', platform: 'WORDPRESS', monitorEnabled: false, wpUsername: MOCK_WP_USER, wpAppPasswordEnc: encryptSecret(MOCK_WP_APP_PASSWORD, SECRET), wpStatus: 'OK' } });
    contentId = (await prisma.contentItem.create({ data: { platform: 'WEB', siteId: site.id, status: 'SCHEDULED', contentType: 'ARTICLE', title: 'บทความตั้งเวลา', scheduledAt: new Date(), webMeta: { create: { title: 'บทความตั้งเวลา', bodyHtml: '<p>เนื้อหา</p>', tags: ['ภูเก็ต'] } } } })).id;
    await prisma.emailProviderAccount.create({ data: { workspaceId: ws, provider: 'brevo', apiKeyEnc: encryptSecret(MOCK_BREVO_KEY, SECRET), status: 'OK' } });
    const list = await prisma.emailList.create({ data: { brandId: brand.id, name: 'L', fromEmail: 'news@test.local', fromName: 'ทีม' } });
    await prisma.emailSubscriber.createMany({ data: [{ listId: list.id, email: 'a@test.local', consentAt: new Date(), unsubscribeToken: `t1-${Date.now()}` }, { listId: list.id, email: 'b@test.local', consentAt: new Date(), unsubscribeToken: `t2-${Date.now()}`, status: 'UNSUBSCRIBED' }] });
    campaignId = (await prisma.emailCampaign.create({ data: { workspaceId: ws, listId: list.id, name: 'C', subject: 'สวัสดี', bodyHtml: '<p>hi {{name}}</p>', status: 'SCHEDULED', scheduledAt: new Date() } })).id;
  }, 30_000);
  afterAll(async () => {
    for (const k of ['WEB_MOCK_BASE_URL', 'WEB_ALLOW_PRIVATE_TARGETS', 'WEB_PUBLISH_ENABLED', 'WEB_WP_ALLOW_INSECURE', 'EMAIL_MOCK_BASE_URL', 'EMAIL_SEND_ENABLED']) delete process.env[k];
    await prisma.workspace.deleteMany({ where: { id: ws } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect(); web.server.close(); mail.server.close();
  });

  it('web-publish posts the scheduled article to WordPress once; a second run recovers the duplicate instead of re-posting', async () => {
    const r = await mod.web.handlePublish(job({ contentId }, WEB_JOBS.publishContent)) as { status: string; duplicateRecovered?: boolean };
    expect(r.status).toBe('PUBLISHED'); expect(r.duplicateRecovered).toBe(false); expect(web.state.wp.posts).toHaveLength(1);
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: contentId } })).status).toBe('PUBLISHED');
    await prisma.contentItem.update({ where: { id: contentId }, data: { status: 'PUBLISH_FAILED' } });
    const again = await mod.web.handlePublish(job({ contentId }, WEB_JOBS.publishContent, 1)) as { status: string; duplicateRecovered?: boolean };
    expect(again.duplicateRecovered).toBe(true); expect(web.state.wp.posts).toHaveLength(1);
    expect(await mod.web.handlePublish(job({ contentId }, WEB_JOBS.publishContent))).toMatchObject({ skipped: 'status PUBLISHED' });
  });
  it('email-send sends to subscribed recipients only and is idempotent on retry; transient provider failure throws for BullMQ retry', async () => {
    mail.state.failNext = 1;
    await expect(mod.email.handleSend(job({ campaignId }, EMAIL_JOBS.sendCampaign))).rejects.toThrow();   // ส่งไม่ครบ → retry
    expect((await prisma.emailCampaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe('SEND_FAILED');
    const r = await mod.email.handleSend(job({ campaignId }, EMAIL_JOBS.sendCampaign, 1)) as { status: string; sent: number };
    expect(r.status).toBe('SENT'); expect(r.sent).toBe(1); expect(mail.state.messages).toHaveLength(1); expect(mail.state.messages[0]!.to).toBe('a@test.local');
    const c = await prisma.emailCampaign.findUniqueOrThrow({ where: { id: campaignId } }); expect(c.status).toBe('SENT'); expect(c.sentCount).toBe(1); expect(c.recipientCount).toBe(1); expect(c.openedCount).toBeNull();
    expect(await mod.email.handleSend(job({ campaignId }, EMAIL_JOBS.sendCampaign))).toMatchObject({ skipped: 'status SENT' });
  });
});
