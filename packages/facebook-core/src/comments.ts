/** ซิงก์คอมเมนต์ของโพสต์ในช่วงล่าสุด (§23, §33) — ใช้ร่วม API/worker; ไม่มีสิทธิ์ → บันทึก NO_PERMISSION ไม่โยน error ใส่ผู้ใช้ซ้ำๆ */
import type { Prisma } from '@fbpm/database';
import { CommentsPermissionError } from './facebook.service';
import { loadPageToken, type SyncDeps } from './sync';

export interface SyncCommentsResult { status: 'OK' | 'NO_PERMISSION' | 'ERROR'; posts: number; imported: number; updated: number; error?: string }

export async function syncComments(d: SyncDeps, pageId: string, opts: { days?: number; postIds?: string[]; limitPerPost?: number } = {}): Promise<SyncCommentsResult> {
  const { token } = await loadPageToken(d, pageId);
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const posts = await d.prisma.facebookPost.findMany({ where: { pageId, ...(opts.postIds ? { id: { in: opts.postIds } } : { publishedAt: { gte: since } }) }, select: { id: true, facebookPostId: true }, orderBy: { publishedAt: 'desc' }, take: 60 });
  let imported = 0; let updated = 0;
  try {
    for (const p of posts) {
      const comments = await d.fb.getComments(p.facebookPostId, token, { limit: opts.limitPerPost ?? 100 });
      for (const c of comments) {
        const data = { postId: p.id, parentCommentId: c.parentId, fromId: c.fromId, fromName: c.fromName, message: c.message, createdTime: c.createdTime, permalink: c.permalink, isHidden: c.isHidden, rawData: c.raw as Prisma.InputJsonValue };
        const existing = await d.prisma.pageComment.findUnique({ where: { pageId_facebookCommentId: { pageId, facebookCommentId: c.id } }, select: { id: true } });
        if (existing) { await d.prisma.pageComment.update({ where: { id: existing.id }, data }); updated++; }
        else { await d.prisma.pageComment.create({ data: { pageId, facebookCommentId: c.id, ...data } }); imported++; }
      }
    }
    await d.prisma.facebookPage.update({ where: { id: pageId }, data: { commentsStatus: 'OK', commentsSyncedAt: new Date() } });
    return { status: 'OK', posts: posts.length, imported, updated };
  } catch (e) {
    if (e instanceof CommentsPermissionError) { await d.prisma.facebookPage.update({ where: { id: pageId }, data: { commentsStatus: 'NO_PERMISSION', commentsSyncedAt: new Date() } }); return { status: 'NO_PERMISSION', posts: posts.length, imported, updated, error: e.message }; }
    const msg = e instanceof Error ? e.message : String(e);
    await d.prisma.facebookPage.update({ where: { id: pageId }, data: { commentsStatus: 'ERROR', commentsSyncedAt: new Date() } });
    return { status: 'ERROR', posts: posts.length, imported, updated, error: msg.slice(0, 300) };
  }
}
