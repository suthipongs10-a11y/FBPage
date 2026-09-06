/**
 * W-3 Web publisher (AGENTS_WEB.md) — โพสต์ ContentItem platform=WEB ที่ APPROVED/SCHEDULED ขึ้น WordPress แบบกันซ้ำด้วย ExternalOperation
 * ใช้ทั้ง API ("โพสต์ตอนนี้") และ worker (งานตั้งเวลา) — ตรวจ kill switch ทุกครั้ง: workspace.automationPaused, site.publishingPaused, WEB_PUBLISH_ENABLED
 * รหัสผ่าน WordPress ถอดรหัสเฉพาะในหน่วยความจำตอนยิงเท่านั้น ไม่อยู่ใน log/ผลลัพธ์
 */
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { decryptSecret } from '@fbpm/database';
import { WebError } from './types';
import { WordPressClient, slugify } from './wordpress';

export interface WebPublishDeps { prisma: PrismaClient; authSecret: string; webPublishEnabled: boolean; wpAllowInsecure?: boolean; fetchImpl?: typeof fetch }
export type WebPublishOutcome =
  | { status: 'PUBLISHED'; wpPostId: number; link: string; wpStatus: string; duplicateRecovered: boolean }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

const PUBLISHABLE = ['APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISH_FAILED'];
const SITE_WP_SELECT = { id: true, url: true, name: true, platform: true, wpUsername: true, wpAppPasswordEnc: true, wpStatus: true, publishingPaused: true, disconnectedAt: true, brand: { select: { client: { select: { workspaceId: true, workspace: { select: { automationPaused: true } } } } } } } as const;

export function wordpressClient(d: WebPublishDeps, site: { url: string; wpUsername: string | null; wpAppPasswordEnc: string | null }): WordPressClient {
  if (!site.wpUsername || !site.wpAppPasswordEnc) throw new WebError('เว็บนี้ยังไม่ได้เชื่อม WordPress (ใส่ username + Application Password ก่อน)', 'reconnect');
  return new WordPressClient({ baseUrl: site.url, username: site.wpUsername, appPassword: decryptSecret(site.wpAppPasswordEnc, d.authSecret) }, { allowInsecure: d.wpAllowInsecure, fetchImpl: d.fetchImpl });
}

/** ตรวจ credential กับ WordPress จริง → อัปเดต wpStatus/wpUserName (ไม่คืนรหัสผ่าน) */
export async function verifyWordPress(d: WebPublishDeps, siteId: string): Promise<{ status: string; userName: string | null; roles: string[]; canPublish: boolean; error: string | null }> {
  const site = await d.prisma.site.findUnique({ where: { id: siteId }, select: SITE_WP_SELECT });
  if (!site) throw new WebError('ไม่พบเว็บไซต์', 'notFound', 404);
  try {
    const me = await wordpressClient(d, site).me();
    const canPublish = me.capabilities.publish_posts === true || me.roles.some(r => ['administrator', 'editor', 'author'].includes(r));
    const status = canPublish ? 'OK' : 'AUTH_FAILED'; const error = canPublish ? null : `ผู้ใช้ ${me.name} ไม่มีสิทธิ์ publish_posts (บทบาท: ${me.roles.join(', ') || '-'})`;
    await d.prisma.site.update({ where: { id: siteId }, data: { wpStatus: status, wpUserName: me.name, wpCheckedAt: new Date(), wpLastError: error, platform: 'WORDPRESS' } });
    return { status, userName: me.name, roles: me.roles, canPublish, error };
  } catch (e) {
    const err = e instanceof WebError ? e : new WebError(e instanceof Error ? e.message : String(e), 'unknown');
    const status = err.code === 'forbidden' ? 'AUTH_FAILED' : err.code === 'notFound' ? 'NOT_WORDPRESS' : 'ERROR';
    await d.prisma.site.update({ where: { id: siteId }, data: { wpStatus: status, wpCheckedAt: new Date(), wpLastError: err.message.slice(0, 500) } });
    return { status, userName: null, roles: [], canPublish: false, error: err.message };
  }
}

/** เหตุผลที่ห้ามโพสต์ตอนนี้ — null = โพสต์ได้ */
export async function webPublishBlockReason(d: WebPublishDeps, contentId: string): Promise<string | null> {
  const c = await d.prisma.contentItem.findUnique({ where: { id: contentId }, select: { platform: true, status: true, webMeta: { select: { title: true, bodyHtml: true } }, site: { select: SITE_WP_SELECT } } });
  if (!c) return 'ไม่พบคอนเทนต์';
  if (c.platform !== 'WEB' || !c.site) return 'คอนเทนต์นี้ไม่ใช่บทความเว็บ';
  if (!PUBLISHABLE.includes(c.status)) return `สถานะ ${c.status} เผยแพร่ไม่ได้ — ต้องอนุมัติก่อน`;
  if (!d.webPublishEnabled) return 'ระบบยังไม่เปิดให้โพสต์ขึ้นเว็บลูกค้า (WEB_PUBLISH_ENABLED ไม่ได้ตั้งเป็น true)';
  if (c.site.brand.client.workspace.automationPaused) return 'ระบบอัตโนมัติของ workspace ถูกหยุดไว้ (สวิตช์ฉุกเฉิน)';
  if (c.site.publishingPaused) return 'เว็บนี้ถูกหยุดการโพสต์ไว้';
  if (c.site.disconnectedAt) return 'เว็บไซต์นี้ถูกปิดการดูแลแล้ว';
  if (!c.site.wpUsername || !c.site.wpAppPasswordEnc) return 'เว็บนี้ยังไม่ได้เชื่อม WordPress';
  if (c.site.wpStatus === 'AUTH_FAILED') return 'WordPress ปฏิเสธ credential — เชื่อมใหม่ก่อน';
  if (!c.webMeta?.title || !c.webMeta.bodyHtml) return 'บทความต้องมีชื่อเรื่องและเนื้อหาก่อนเผยแพร่';
  return null;
}

export async function publishWebContent(d: WebPublishDeps, contentId: string, opts: { requestId: string; scheduledPublish?: boolean; asDraft?: boolean } = { requestId: 'n/a' }): Promise<WebPublishOutcome> {
  const blocked = await webPublishBlockReason(d, contentId);
  if (blocked) return { status: 'SKIPPED', reason: blocked };
  const c = await d.prisma.contentItem.findUniqueOrThrow({ where: { id: contentId }, select: { id: true, retryCount: true, scheduledAt: true, webMeta: true, site: { select: SITE_WP_SELECT } } });
  const site = c.site!; const m = c.webMeta!; const workspaceId = site.brand.client.workspaceId;
  const slug = m.slug?.trim() || slugify(m.title!);
  const target: 'publish' | 'draft' = opts.asDraft ? 'draft' : 'publish';
  const idempotencyKey = `web-publish:${contentId}`;
  const requestHash = createHash('sha256').update(JSON.stringify({ siteId: site.id, title: m.title, slug, body: m.bodyHtml, excerpt: m.excerpt, target })).digest('hex');

  const existingOp = await d.prisma.externalOperation.findUnique({ where: { idempotencyKey } });
  if (existingOp?.externalId) {
    // เคยสร้างโพสต์แล้ว → ไม่ยิงซ้ำ (ถ้าเนื้อหาเปลี่ยนหลังเผยแพร่ ให้ใช้ "อัปเดต" แยกต่างหาก)
    const link = m.wpLink ?? `${site.url}/?p=${existingOp.externalId}`;
    return finalize(d, c.id, Number(existingOp.externalId), link, m.wpStatus ?? target, true);
  }
  if (existingOp && existingOp.requestHash !== requestHash) await d.prisma.externalOperation.update({ where: { id: existingOp.id }, data: { requestHash, status: 'PENDING', error: null } });
  const op = existingOp ?? await d.prisma.externalOperation.create({ data: { workspaceId, provider: 'wordpress', operationType: 'publish-post', idempotencyKey, requestHash, status: 'PENDING' } });
  await d.prisma.contentItem.update({ where: { id: c.id }, data: { status: 'PUBLISHING', lastError: null } });
  await d.prisma.webContentMetadata.update({ where: { contentItemId: c.id }, data: { slug } });

  try {
    const wp = wordpressClient(d, site);
    // รอบก่อนอาจส่งถึง WordPress แล้วแต่เราไม่ได้รับคำตอบ → หาโพสต์ slug เดิมก่อน
    if (existingOp || c.retryCount > 0) {
      const dup = await wp.findPostBySlug(slug);
      if (dup) { await d.prisma.externalOperation.update({ where: { id: op.id }, data: { externalId: String(dup.id), status: 'SUCCEEDED', error: null } }); return finalize(d, c.id, dup.id, dup.link, dup.status, true); }
    }
    const [tags, categories] = await Promise.all([wp.ensureTerms('tags', m.tags), wp.ensureTerms('categories', m.categories)]);
    const post = await wp.createPost({ title: m.title!, content: m.bodyHtml!, excerpt: m.excerpt ?? undefined, slug, status: target, tags, categories, meta: {} });
    await d.prisma.externalOperation.update({ where: { id: op.id }, data: { externalId: String(post.id), status: 'SUCCEEDED', error: null } });
    return finalize(d, c.id, post.id, post.link, post.status, false);
  } catch (e) {
    const err = e instanceof WebError ? e : new WebError(e instanceof Error ? e.message : String(e), 'unknown');
    const retryable = err.code === 'network' || err.code === 'quota';
    await d.prisma.externalOperation.update({ where: { id: op.id }, data: { status: retryable ? 'PENDING' : 'FAILED', error: err.message.slice(0, 500) } });
    await d.prisma.contentItem.update({ where: { id: c.id }, data: { status: 'PUBLISH_FAILED', retryCount: { increment: 1 }, lastError: err.message.slice(0, 500) } });
    if (err.code === 'forbidden') await d.prisma.site.update({ where: { id: site.id }, data: { wpStatus: 'AUTH_FAILED', wpLastError: err.message.slice(0, 500), wpCheckedAt: new Date() } });
    return { status: 'FAILED', error: err.message, retryable };
  }
}

/** อัปเดตโพสต์ที่เผยแพร่แล้วบน WordPress ด้วยเนื้อหาปัจจุบัน (คนสั่งเท่านั้น — ไม่อัตโนมัติ) */
export async function updatePublishedWebContent(d: WebPublishDeps, contentId: string): Promise<WebPublishOutcome> {
  const c = await d.prisma.contentItem.findUnique({ where: { id: contentId }, select: { id: true, status: true, webMeta: true, site: { select: SITE_WP_SELECT } } });
  if (!c?.site || !c.webMeta?.wpPostId) return { status: 'SKIPPED', reason: 'บทความนี้ยังไม่เคยเผยแพร่' };
  if (!d.webPublishEnabled) return { status: 'SKIPPED', reason: 'ระบบยังไม่เปิดให้โพสต์ขึ้นเว็บลูกค้า (WEB_PUBLISH_ENABLED)' };
  if (c.site.publishingPaused || c.site.brand.client.workspace.automationPaused) return { status: 'SKIPPED', reason: 'การโพสต์ถูกหยุดไว้' };
  try {
    const wp = wordpressClient(d, c.site); const m = c.webMeta; const wpPostId = m.wpPostId!;
    const [tags, categories] = await Promise.all([wp.ensureTerms('tags', m.tags), wp.ensureTerms('categories', m.categories)]);
    const post = await wp.updatePost(wpPostId, { title: m.title ?? undefined, content: m.bodyHtml ?? undefined, excerpt: m.excerpt ?? undefined, tags, categories });
    await d.prisma.webContentMetadata.update({ where: { contentItemId: c.id }, data: { wpLink: post.link, wpStatus: post.status } });
    return { status: 'PUBLISHED', wpPostId: post.id, link: post.link, wpStatus: post.status, duplicateRecovered: false };
  } catch (e) { const err = e instanceof WebError ? e : new WebError(String(e), 'unknown'); return { status: 'FAILED', error: err.message, retryable: err.code === 'network' }; }
}

async function finalize(d: WebPublishDeps, contentId: string, wpPostId: number, link: string, wpStatus: string, duplicateRecovered: boolean): Promise<WebPublishOutcome> {
  await d.prisma.webContentMetadata.update({ where: { contentItemId: contentId }, data: { wpPostId, wpLink: link, wpStatus } });
  await d.prisma.contentItem.update({ where: { id: contentId }, data: { status: 'PUBLISHED', externalPostId: String(wpPostId), publishedAt: new Date(), lastError: null } as Prisma.ContentItemUncheckedUpdateInput });
  return { status: 'PUBLISHED', wpPostId, link, wpStatus, duplicateRecovered };
}
