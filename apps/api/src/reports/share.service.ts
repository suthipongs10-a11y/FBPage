/**
 * Report export + client share link (§34 ส่งรายงานให้ลูกค้า)
 * - PDF: เรนเดอร์ HTML ของรายงาน (Facebook หรือ YouTube) ด้วย Chromium เดียวกับ media service
 * - ลิงก์แชร์: token ที่เซ็นด้วย AUTH_SECRET (HMAC) มีวันหมดอายุ อ่านอย่างเดียว ไม่ต้องล็อกอิน — เพิกถอนได้ด้วยการหมุน AUTH_SECRET
 *   ข้อมูลที่เผยคือ data ของรายงานเท่านั้น (ไม่มี token/รหัสภายใน)
 */
import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { channelInWorkspace, pageInWorkspace, signState, verifyState } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { chromePdf, findChrome, fontFaceCss } from '../media/chromium';
import type { ReportData } from './reports.service';
import type { YtReportData } from '../youtube/reports.service';

export type ReportKind = 'facebook' | 'youtube';
interface ShareToken { k: ReportKind; r: string; ws: string; exp: number }
export interface SharedReport { kind: ReportKind; id: string; label: string; brand: string; client: string; createdAt: string; expiresAt: string | null; data: ReportData | YtReportData }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

@Injectable()
export class ShareService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService) {}

  private async load(kind: ReportKind, id: string, workspaceId?: string): Promise<SharedReport> {
    if (kind === 'facebook') {
      const r = await this.prisma.report.findFirst({ where: { id, ...(workspaceId && { page: pageInWorkspace(workspaceId) }) }, select: { id: true, createdAt: true, data: true, page: { select: { brand: { select: { name: true, client: { select: { name: true, workspaceId: true } } } } } } } });
      if (!r) throw new NotFoundException('ไม่พบรายงาน');
      const d = r.data as unknown as ReportData;
      return { kind, id: r.id, label: d.period.label, brand: r.page.brand.name, client: r.page.brand.client.name, createdAt: r.createdAt.toISOString(), expiresAt: null, data: d };
    }
    const r = await this.prisma.youTubeReport.findFirst({ where: { id, ...(workspaceId && { channel: channelInWorkspace(workspaceId) }) }, select: { id: true, createdAt: true, data: true, channel: { select: { brand: { select: { name: true, client: { select: { name: true } } } } } } } });
    if (!r) throw new NotFoundException('ไม่พบรายงาน');
    const d = r.data as unknown as YtReportData;
    return { kind, id: r.id, label: d.period.label, brand: r.channel.brand.name, client: r.channel.brand.client.name, createdAt: r.createdAt.toISOString(), expiresAt: null, data: d };
  }

  async createLink(workspaceId: string, userId: string, kind: ReportKind, id: string, days: number, requestId: string) {
    await this.load(kind, id, workspaceId);
    const exp = Date.now() + Math.min(365, Math.max(1, days)) * 86_400_000;
    const token = signState({ k: kind, r: id, ws: workspaceId, exp } satisfies ShareToken, this.env.AUTH_SECRET);
    await this.audit.log({ workspaceId, userId, action: 'report.share.create', resourceType: kind === 'facebook' ? 'report' : 'youtubeReport', resourceId: id, after: { days, expiresAt: new Date(exp).toISOString() }, requestId });
    return { url: `${this.env.APP_URL}/share/r/${token}`, expiresAt: new Date(exp).toISOString() };
  }

  async resolve(token: string): Promise<SharedReport> {
    const t = verifyState<ShareToken>(token, this.env.AUTH_SECRET);
    if (!t || t.exp < Date.now() || !['facebook', 'youtube'].includes(t.k)) throw new NotFoundException('ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว');
    const r = await this.load(t.k, t.r, t.ws);
    return { ...r, expiresAt: new Date(t.exp).toISOString() };
  }

  async pdf(kind: ReportKind, id: string, workspaceId?: string): Promise<{ buffer: Buffer; fileName: string }> {
    const r = await this.load(kind, id, workspaceId);
    return this.pdfOf(r);
  }
  async pdfByToken(token: string) { return this.pdfOf(await this.resolve(token)); }

  private async pdfOf(r: SharedReport): Promise<{ buffer: Buffer; fileName: string }> {
    const chrome = findChrome(this.env.CHROME_BIN);
    if (!chrome) throw new UnprocessableEntityException('ไม่พบ Chromium สำหรับสร้าง PDF — ตั้ง CHROME_BIN');
    const dir = resolve(this.env.MEDIA_DIR, '.tmp'); mkdirSync(dir, { recursive: true });
    const base = join(dir, `report-${r.id}-${Date.now()}`); const html = `${base}.html`; const out = `${base}.pdf`;
    await writeFile(html, renderReportHtml(r));
    try { await chromePdf(chrome, html, out); const buffer = await readFile(out); return { buffer, fileName: `report-${r.kind}-${r.label}.pdf` }; }
    catch (e) { throw new UnprocessableEntityException(`สร้าง PDF ไม่สำเร็จ: ${(e as Error).message.slice(0, 200)}`); }
    finally { await rm(html, { force: true }); await rm(out, { force: true }); }
  }
}

/** HTML สำหรับพิมพ์ A4 — เนื้อหาเดียวกับ text ของรายงาน จัดเป็นหัวข้อ/ตาราง (ตัวเลขที่ไม่มี = "ไม่มีข้อมูล" เสมอ) */
export function renderReportHtml(r: SharedReport): string {
  const na = 'ไม่มีข้อมูล'; const n = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? na : `${Math.round(v * 10) / 10}${unit}`);
  const sec = (title: string, body: string) => `<section><h2>${esc(title)}</h2>${body}</section>`;
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  const kpi = (items: [string, string][]) => `<div class="kpis">${items.map(([l, v]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>`;
  let title = ''; let body = ''; let summary: ReportData['summary'] = null; let limitations: string[] = [];
  if (r.kind === 'facebook') {
    const d = r.data as ReportData; title = `รายงานเพจ ${d.page.name}`; summary = d.summary; limitations = d.dataLimitations;
    body += kpi([['ผู้ติดตาม', n(d.page.followers)], ['โพสต์', `${d.publishing.posts} (ก่อน ${d.publishing.postsPrevPeriod})`], ['ต่อสัปดาห์', String(d.publishing.perWeek)], ['แชร์รวม', n(d.engagement.sharesTotal)], ['ข้อมูลเพจครบ', `${d.page.completeness}%`]]);
    body += sec('การเผยแพร่', `<p>โพสต์ ${d.publishing.posts} รายการ · วันที่มีโพสต์ ${d.publishing.activeDays} · เว้นนานสุด ${d.publishing.longestGapDays} วัน · โพสต์ผ่านระบบ ${d.publishing.bySystem}</p>`);
    if (d.topPosts.length) body += sec('โพสต์เด่น', `<table><tr><th>โพสต์</th><th>แชร์</th><th>รีแอคชัน</th><th>คอมเมนต์</th></tr>${d.topPosts.map(p => `<tr><td>${esc(p.message.slice(0, 120))}</td><td>${n(p.shares)}</td><td>${n(p.reactions)}</td><td>${n(p.comments)}</td></tr>`).join('')}</table>`);
    if (d.pillars.length) body += sec('ตามเสาคอนเทนต์', `<table><tr><th>เสา</th><th>โพสต์</th><th>แชร์</th></tr>${d.pillars.map(p => `<tr><td>${esc(p.pillar)}</td><td>${p.posts}</td><td>${n(p.shares)}</td></tr>`).join('')}</table>`);
    body += sec('งานในระบบ', `<p>ร่าง ${d.content.created} · อนุมัติ ${d.content.approved} · ไม่อนุมัติ ${d.content.rejected} · เผยแพร่ ${d.content.published} · ตั้งเวลาไว้ ${d.content.scheduledNext} · AI ร่าง ${d.content.aiDrafted}</p>`);
  } else {
    const d = r.data as YtReportData; title = `รายงานช่อง YouTube ${d.channel.title}`; summary = d.summary; limitations = d.dataLimitations;
    body += kpi([['ผู้ติดตาม', n(d.channel.subscribers)], ['วิดีโอ', `${d.publishing.videos} (ก่อน ${d.publishing.videosPrevPeriod})`], ['วิว', n(d.channelMetrics.views)], ['watch time (นาที)', n(d.channelMetrics.watchMinutes)], ['ผู้ติดตามที่ได้', n(d.channelMetrics.subscribersGained)], ['รายได้ (USD)', n(d.channelMetrics.revenueUsd)]]);
    body += sec('การเผยแพร่', `<p>วิดีโอยาว ${d.publishing.longForm} · Shorts ${d.publishing.shorts} · ไลฟ์ ${d.publishing.live} · เฉลี่ย ${d.publishing.perWeek}/สัปดาห์ · ผ่านระบบ ${d.publishing.bySystem}</p>`);
    if (d.topVideos.length) body += sec('วิดีโอเด่น', `<table><tr><th>วิดีโอ</th><th>วิว</th><th>AVD (วิ)</th><th>sub+</th></tr>${d.topVideos.map(v => `<tr><td>${esc(v.title)}</td><td>${n(v.views)}</td><td>${n(v.avgViewDuration)}</td><td>${n(v.subscribersGained)}</td></tr>`).join('')}</table>`);
    if (d.formats.length) body += sec('ตามรูปแบบ', `<table><tr><th>รูปแบบ</th><th>วิดีโอ</th><th>วิวกลาง</th><th>AVD กลาง</th></tr>${d.formats.map(f => `<tr><td>${esc(f.format)}</td><td>${f.videos}</td><td>${n(f.medianViews)}</td><td>${n(f.medianAvd)}</td></tr>`).join('')}</table>`);
    body += sec('คอมเมนต์', `<p>ทั้งหมด ${d.comments.total} · คำถาม ${d.comments.questions} · คำขอ ${d.comments.requests} · ร้องเรียน ${d.comments.complaints} · ลีด ${d.comments.leads} · ค้างตอบ ${d.comments.unresolved}</p>${list(d.comments.clusters.map(c => `${c.label} (${c.size})`))}`);
    body += sec('งานในระบบ', `<p>ร่าง ${d.content.created} · อนุมัติ ${d.content.approved} · อัปโหลด ${d.content.uploaded} · เผยแพร่ ${d.content.published} · ตั้งเวลาไว้ ${d.content.scheduledNext}</p>`);
  }
  if (summary) body += sec('สรุปผู้บริหาร', `<p>${esc(summary.executiveSummary)}</p>${(([['เกิดอะไรขึ้น', summary.whatHappened], ['ทำไม', summary.whyItHappened], ['ควรทำซ้ำ', summary.repeat], ['ควรหยุด', summary.stop], ['ควรทดลอง', summary.experiments], ['เดือนหน้าเน้น', summary.nextMonthFocus]] as [string, string[]][]).filter(([, xs]) => xs.length).map(([h, xs]) => `<h3>${esc(h)}</h3>${list(xs)}`).join(''))}`);
  if (limitations.length) body += sec('ข้อจำกัดของข้อมูล', list(limitations));
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)} — ${esc(r.label)}</title><style>${fontFaceCss()}
@page{size:A4;margin:18mm 16mm}body{font-family:'Loma','Noto Sans Thai',sans-serif;color:#111;font-size:12px;line-height:1.5;margin:0}
h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:16px 0 6px;border-bottom:1px solid #ddd;padding-bottom:2px}h3{font-size:12px;margin:10px 0 2px}
.meta{color:#666;font-size:11px;margin-bottom:12px}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0}.kpi{border:1px solid #ddd;border-radius:6px;padding:8px}.kpi .v{font-size:18px;font-weight:700}.kpi .l{color:#666;font-size:11px}
table{border-collapse:collapse;width:100%;font-size:11px}th,td{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;vertical-align:top}th{color:#666;font-weight:400}ul{margin:4px 0;padding-left:18px}
.foot{margin-top:20px;color:#888;font-size:10px}</style></head><body>
<h1>${esc(title)}</h1><div class="meta">${esc(r.client)} · ${esc(r.brand)} · ช่วง ${esc(r.label)} · สร้างเมื่อ ${new Date(r.createdAt).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</div>
${body}
<div class="foot">ตัวเลขทั้งหมดมาจาก API ทางการของแพลตฟอร์มตามสิทธิ์ที่ได้รับ · ค่าที่อ่านไม่ได้แสดงเป็น "ไม่มีข้อมูล" ไม่ใช่ 0</div>
</body></html>`;
}
