/**
 * นำเข้าคอนเทนต์จาก AI ภายนอก (ChatGPT / Claude / Gemini) ตามแพ็กเกจมาตรฐาน fbpm-content-v1
 * ช่องทาง: วาง/อัปโหลดในหน้าเว็บ (paste) · URL รับไฟล์ของแบรนด์ + คีย์ (api) · โฟลเดอร์ Google Drive ที่แชร์ให้ service account (gdrive)
 * → ตรวจรูปแบบ + กฎ (import-format.ts) + ตรวจกับ DB (เพจ, ซ้ำ, ไฟล์แนบ) → สร้างร่างรออนุมัติ (การ์ดหัวข่าว + รูป) → ประตูอนุมัติ/ตั้งเวลาเดิม
 * ไม่โพสต์เองเด็ดขาด · รูปจากลิงก์ดาวน์โหลดแบบกัน SSRF + ตรวจไบต์ · คีย์ URL รับไฟล์เก็บเป็น hash · คีย์ service account เข้ารหัส
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Prisma, PrismaClient } from '@fbpm/database';
import { brandInWorkspace, pageInWorkspace } from '@fbpm/database';
import { GOOGLE_DOC_MIME, canonicalNewsUrl, downloadImage, driveDownload, driveFolderIdFrom, driveListFolder, normalizeTitle, parseServiceAccount, serviceAccountToken, sha256, sniffImage, type DriveFile } from '@fbpm/web-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { ContentService } from '../content/content.service';
import { MediaService } from '../media/media.service';
import { MediaGenService } from '../media/media-gen.service';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { checkRateLimit } from '../common/rate-limit.guard';
import { NewsService } from './news.service';
import { PACKAGE_EXAMPLE, PACKAGE_FORMAT, aiInstructions, checkPackage, statusOf, type Check, type ImageRef, type NormalizedPost, type PackageReport, type PostReport } from './import-format';
import type { ImportCheckDto, ImportDto, InboxDto } from './dto';

export const IMPORT_PROMPT = 'content-import-v1';
const TITLE_DEDUPE_DAYS = 14;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const DRIVE_TICK_MS = 10 * 60_000;
const DRIVE_LOCK = 'content-import:drive-lock';
const DRIVE_MAX_FILE_AGE_DAYS = 7;       // เชื่อมโฟลเดอร์ครั้งแรกไม่ดึงไฟล์เก่าทั้งหมด
const DRIVE_MAX_PACKAGES_PER_POLL = 10;
const PACKAGE_EXT = /\.(json|txt|md)$/i;
const IMPORT_SELECT = { id: true, brandId: true, channel: true, fileName: true, status: true, postCount: true, draftCount: true, report: true, createdAt: true, updatedAt: true } as const;
/** ผลตรวจที่ขึ้นกับ DB — ตรวจใหม่ทุกครั้งก่อนสร้างร่าง */
const DB_CHECKS = ['DUPLICATE', 'PAGE_NOT_FOUND', 'NO_PAGE', 'UPLOAD_MISSING', 'FILE_MISSING'];
const CHANNEL_LABEL: Record<string, string> = { paste: 'วาง/อัปโหลด', api: 'URL รับไฟล์', gdrive: 'Google Drive', research: 'โต๊ะค้นคว้า' };

type Channel = 'paste' | 'api' | 'gdrive' | 'research';
type FileSource = { uploads: Record<string, string>; drive?: { token: string; files: DriveFile[] } };
export interface PostResult { contentId?: string; newsItemId?: string; error?: string; imageErrors?: string[]; cardError?: string | null }
type StoredPost = PostReport & { result?: PostResult; pageId?: string | null };
type StoredReport = Omit<PackageReport, 'posts'> & { posts: StoredPost[] };

const sha256Buf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const errMsg = (e: unknown) => (e as Error & { response?: { message?: string } }).response?.message ?? (e as Error).message;
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

@Injectable()
export class ContentImportService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ContentImport');
  private timer: NodeJS.Timeout | null = null; private first: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(MediaGenService) private readonly gen: MediaGenService,
    @Inject(NewsService) private readonly news: NewsService,
  ) {}

  onModuleInit() {
    if (this.env.APP_ENV === 'test' || !this.env.NEWS_AUTOMATION_ENABLED) return;
    const run = () => { void this.pollDrive().catch(e => this.log.error(`ดึง Drive ล้ม: ${(e as Error).message}`)); };
    this.first = setTimeout(run, 90_000); this.timer = setInterval(run, DRIVE_TICK_MS);
  }
  onModuleDestroy() { if (this.first) clearTimeout(this.first); if (this.timer) clearInterval(this.timer); }

  private get checkOpts() { return { allowHttpImages: this.env.WEB_ALLOW_PRIVATE_TARGETS }; }
  private get mock() { return this.env.WEB_MOCK_BASE_URL?.replace(/\/+$/, ''); }
  private get driveOpts() { return this.mock ? { baseUrl: `${this.mock}/google` } : {}; }
  private async brand(workspaceId: string, brandId: string) {
    const b = await this.prisma.brand.findFirst({ where: { id: brandId, ...brandInWorkspace(workspaceId) }, select: { id: true, name: true } });
    if (!b) throw new NotFoundException('ไม่พบแบรนด์');
    return b;
  }
  private brandPages(workspaceId: string, brandId: string) {
    return this.prisma.facebookPage.findMany({ where: { brandId, ...pageInWorkspace(workspaceId), disconnectedAt: null }, select: { id: true, name: true, facebookPageId: true } });
  }

  // ---------- เทมเพลต ----------
  async template(workspaceId: string, brandId: string) {
    await this.brand(workspaceId, brandId);
    const pages = await this.brandPages(workspaceId, brandId);
    return { format: PACKAGE_FORMAT, example: PACKAGE_EXAMPLE, instructions: aiInstructions(pages.map(p => p.name)) };
  }

  // ---------- ตั้งค่ากล่องรับ ----------
  private inboxView(i: { pageId: string | null; theme: string; imageFallback: string; autoDraft: boolean; keyHash: string | null; keyHint: string | null; keyCreatedAt: Date | null; driveEnabled: boolean; driveFolderId: string | null; driveClientEmail: string | null; driveCredentialsEnc: string | null; driveLastPolledAt: Date | null; driveLastError: string | null } | null) {
    if (!i) return { configured: false, pageId: null, theme: 'dark', imageFallback: 'stock', autoDraft: true, hasKey: false, keyHint: null, keyCreatedAt: null, driveEnabled: false, driveFolderId: null, driveClientEmail: null, driveConfigured: false, driveLastPolledAt: null, driveLastError: null };
    return { configured: true, pageId: i.pageId, theme: i.theme, imageFallback: i.imageFallback, autoDraft: i.autoDraft, hasKey: !!i.keyHash, keyHint: i.keyHint, keyCreatedAt: i.keyCreatedAt, driveEnabled: i.driveEnabled, driveFolderId: i.driveFolderId, driveClientEmail: i.driveClientEmail, driveConfigured: !!(i.driveCredentialsEnc && i.driveFolderId), driveLastPolledAt: i.driveLastPolledAt, driveLastError: i.driveLastError };
  }
  async getInbox(workspaceId: string, brandId: string) {
    await this.brand(workspaceId, brandId);
    return this.inboxView(await this.prisma.contentInbox.findUnique({ where: { brandId } }));
  }

  async setInbox(workspaceId: string, userId: string, brandId: string, dto: InboxDto, requestId: string) {
    await this.brand(workspaceId, brandId);
    if (dto.pageId) {
      const p = await this.prisma.facebookPage.findFirst({ where: { id: dto.pageId, ...pageInWorkspace(workspaceId) }, select: { brandId: true, disconnectedAt: true } });
      if (!p || p.disconnectedAt) throw new NotFoundException('ไม่พบเพจ');
      if (p.brandId !== brandId) throw new BadRequestException('เพจนี้ไม่ได้อยู่ในแบรนด์นี้');
    }
    const data: Prisma.ContentInboxUncheckedUpdateInput = {
      ...(dto.pageId !== undefined && { pageId: dto.pageId }), ...(dto.theme && { theme: dto.theme }), ...(dto.imageFallback && { imageFallback: dto.imageFallback }),
      ...(dto.autoDraft !== undefined && { autoDraft: dto.autoDraft }), ...(dto.driveEnabled !== undefined && { driveEnabled: dto.driveEnabled }),
    };
    if (dto.driveFolder !== undefined) {
      if (dto.driveFolder === null || dto.driveFolder === '') data.driveFolderId = null;
      else { const id = driveFolderIdFrom(dto.driveFolder); if (!id) throw new BadRequestException('ลิงก์/รหัสโฟลเดอร์ Google Drive ไม่ถูกต้อง'); data.driveFolderId = id; }
    }
    if (dto.driveCredentials !== undefined) {
      if (dto.driveCredentials === null) { data.driveCredentialsEnc = null; data.driveClientEmail = null; }
      else { let sa; try { sa = parseServiceAccount(dto.driveCredentials); } catch (e) { throw new BadRequestException((e as Error).message); } data.driveCredentialsEnc = encryptSecret(JSON.stringify({ type: 'service_account', ...sa }), this.env.AUTH_SECRET); data.driveClientEmail = sa.client_email; }
    }
    const saved = await this.prisma.contentInbox.upsert({ where: { brandId }, create: { ...(data as Prisma.ContentInboxUncheckedCreateInput), workspaceId, brandId, createdById: userId }, update: { ...data, createdById: userId } });
    // ตั้ง Drive ครบแล้ว → ทดสอบอ่านโฟลเดอร์ทันที (1 คำขอ) ให้เห็นปัญหาสิทธิ์ตั้งแต่ตอนตั้ง
    let row = saved;
    if (saved.driveCredentialsEnc && saved.driveFolderId && (dto.driveCredentials || dto.driveFolder)) {
      let driveLastError: string | null = null;
      try { await this.driveFiles(saved.driveCredentialsEnc, saved.driveFolderId); } catch (e) { driveLastError = errMsg(e); }
      row = await this.prisma.contentInbox.update({ where: { brandId }, data: { driveLastError } });
    }
    await this.audit.log({ workspaceId, userId, action: 'content_import.inbox_update', resourceType: 'brand', resourceId: brandId, after: { pageId: row.pageId, theme: row.theme, imageFallback: row.imageFallback, autoDraft: row.autoDraft, driveEnabled: row.driveEnabled, driveFolderId: row.driveFolderId, driveClientEmail: row.driveClientEmail, credentialsChanged: dto.driveCredentials !== undefined }, requestId });
    return this.inboxView(row);
  }

  /** สร้าง/เปลี่ยนคีย์ URL รับไฟล์ — แสดงคีย์เต็มครั้งเดียว เก็บแค่ hash */
  async rotateKey(workspaceId: string, userId: string, brandId: string, requestId: string) {
    await this.brand(workspaceId, brandId);
    const key = `fbin_${randomBytes(24).toString('base64url')}`;
    const data = { keyHash: hashKey(key), keyHint: `…${key.slice(-4)}`, keyCreatedAt: new Date() };
    await this.prisma.contentInbox.upsert({ where: { brandId }, create: { workspaceId, brandId, createdById: userId, ...data }, update: data });
    await this.audit.log({ workspaceId, userId, action: 'content_import.key_rotate', resourceType: 'brand', resourceId: brandId, after: { keyHint: data.keyHint }, requestId });
    return { key, keyHint: data.keyHint, endpoint: '/inbox/content' };
  }
  async revokeKey(workspaceId: string, userId: string, brandId: string, requestId: string) {
    await this.brand(workspaceId, brandId);
    await this.prisma.contentInbox.updateMany({ where: { brandId, workspaceId }, data: { keyHash: null, keyHint: null, keyCreatedAt: null } });
    await this.audit.log({ workspaceId, userId, action: 'content_import.key_revoke', resourceType: 'brand', resourceId: brandId, requestId });
    return { ok: true };
  }

  // ---------- ไฟล์รูปที่อัปโหลดมากับแพ็กเกจ ----------
  async upload(workspaceId: string, userId: string, name: string, bytes: Buffer) {
    if (bytes.byteLength === 0) throw new BadRequestException('ไฟล์ว่าง');
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new BadRequestException('ไฟล์ใหญ่เกิน 12 MB');
    const mime = sniffImage(bytes);
    if (!mime) throw new BadRequestException('ไฟล์นี้ไม่ใช่รูป JPEG/PNG/WebP');
    const dir = resolve(this.env.MEDIA_DIR, workspaceId); mkdirSync(dir, { recursive: true });
    const path = join(dir, `upload-${Date.now()}-${randomBytes(4).toString('hex')}.${EXT[mime]}`);
    await writeFile(path, bytes);
    const a = await this.prisma.mediaAsset.create({ data: { workspaceId, kind: 'upload', path, mimeType: mime, bytes: bytes.byteLength, sha256: sha256Buf(bytes), meta: { name: name.slice(0, 200) } as Prisma.InputJsonValue, createdById: userId }, select: { id: true } });
    return { id: a.id, name, mimeType: mime, bytes: bytes.byteLength };
  }

  // ---------- ตรวจ ----------
  async check(workspaceId: string, brandId: string, dto: ImportCheckDto) {
    await this.brand(workspaceId, brandId);
    const inbox = await this.prisma.contentInbox.findUnique({ where: { brandId }, select: { pageId: true } });
    return this.enrich(workspaceId, brandId, checkPackage(dto.text, this.checkOpts), { defaultPageId: dto.pageId ?? inbox?.pageId ?? null, files: { uploads: dto.files ?? {} } });
  }

  /** ตรวจกับ DB: เพจ, ซ้ำกับของเดิม/ในแพ็กเกจเดียวกัน, ไฟล์แนบมีจริง */
  private async enrich(workspaceId: string, brandId: string, rep: PackageReport, o: { defaultPageId: string | null; files: FileSource }): Promise<StoredReport> {
    const pages = await this.brandPages(workspaceId, brandId);
    const seenUrl = new Set<string>(); const seenTitle = new Set<string>();
    const since = new Date(Date.now() - TITLE_DEDUPE_DAYS * 86_400_000);
    const uploadIds = [...new Set(rep.posts.flatMap(p => p.post?.images ?? []).map(i => i.kind === 'upload' ? i.id : i.kind === 'file' ? o.files.uploads[i.name] : undefined).filter((x): x is string => !!x))];
    const uploads = new Set((uploadIds.length ? await this.prisma.mediaAsset.findMany({ where: { id: { in: uploadIds }, workspaceId, kind: 'upload' }, select: { id: true } }) : []).map(a => a.id));
    const driveNames = new Set((o.files.drive?.files ?? []).map(f => f.name));
    const out: StoredPost[] = [];
    for (const r of rep.posts) {
      const s: StoredPost = { ...r, checks: [...r.checks] };
      const add = (c: Check) => s.checks.push(c);
      const p = r.post;
      if (p) {
        // เพจ: ชื่อตรงตัว / page id ของ Facebook / id ในระบบ — ต้องอยู่แบรนด์นี้
        const want = p.page?.trim().toLowerCase();
        const page = want ? pages.find(x => x.name.trim().toLowerCase() === want || x.facebookPageId === p.page || x.id === p.page) : pages.find(x => x.id === o.defaultPageId) ?? (pages.length === 1 ? pages[0] : undefined);
        if (!page) add({ level: 'error', code: want ? 'PAGE_NOT_FOUND' : 'NO_PAGE', message: want ? `ไม่พบเพจ "${p.page}" ในแบรนด์นี้` : 'ไม่ได้ระบุเพจ — เลือกเพจตอนนำเข้า หรือใส่ "page" ในแพ็กเกจ' });
        s.pageId = page?.id ?? null;
        // ซ้ำ: ลิงก์ที่มาเดียวกัน/หัวข้อเดียวกันที่เคยเป็นโพสต์แล้ว หรือซ้ำกันเองในแพ็กเกจ
        const { urlHash, titleHash } = this.hashes(p);
        const dup = await this.prisma.newsItem.findFirst({ where: { brandId, OR: [{ urlHash, contentId: { not: null } }, { titleHash, contentId: { not: null }, fetchedAt: { gte: since } }] }, select: { id: true } });
        if (dup || seenUrl.has(urlHash) || seenTitle.has(titleHash)) add({ level: 'error', code: 'DUPLICATE', message: 'ซ้ำกับโพสต์ที่มีอยู่แล้ว (ที่มาหรือหัวข้อเดียวกันภายใน 14 วัน)' });
        seenUrl.add(urlHash); seenTitle.add(titleHash);
        for (const img of p.images) {
          if (img.kind === 'upload' && !uploads.has(img.id)) add({ level: 'error', code: 'UPLOAD_MISSING', message: `ไม่พบไฟล์อัปโหลด ${img.id}` });
          if (img.kind === 'file' && !(o.files.uploads[img.name] && uploads.has(o.files.uploads[img.name]!)) && !driveNames.has(img.name)) add({ level: 'error', code: 'FILE_MISSING', message: `อ้างรูป "${img.name}" แต่ไม่ได้แนบไฟล์นี้มาด้วย` });
        }
      }
      s.status = statusOf(s.checks);
      out.push(s);
    }
    return { ...rep, posts: out };
  }

  private hashes(p: NormalizedPost) {
    const url = p.sources[0]?.url;
    return {
      url: url ?? '',
      urlHash: p.dedupeKey ? sha256(`key:${p.dedupeKey}`) : url ? sha256(canonicalNewsUrl(url)) : sha256(`original:${normalizeTitle(p.caption.slice(0, 500))}`),
      titleHash: sha256(normalizeTitle(p.title)),
    };
  }

  // ---------- นำเข้า ----------
  async importPaste(workspaceId: string, userId: string, brandId: string, dto: ImportDto, requestId: string) {
    await this.brand(workspaceId, brandId);
    return this.importPackage({ workspaceId, userId, brandId, channel: 'paste', input: dto.text, fileName: dto.fileName ?? null, pageId: dto.pageId, theme: dto.theme, imageFallback: dto.imageFallback, draft: dto.draft, files: { uploads: dto.files ?? {} }, requestId });
  }

  /** ปลายทางสาธารณะ POST /inbox/content — ยืนยันตัวด้วยคีย์ของแบรนด์ (Bearer) */
  async receive(key: string | undefined, body: unknown, ip: string, requestId: string) {
    if (!checkRateLimit(`inbox-ip:${ip}`, 30, 60_000).allowed) throw new UnprocessableEntityException('ส่งถี่เกินไป — ลองใหม่ในอีกสักครู่');
    const inbox = key?.startsWith('fbin_') ? await this.prisma.contentInbox.findUnique({ where: { keyHash: hashKey(key) }, select: { workspaceId: true, brandId: true, createdById: true, autoDraft: true, workspace: { select: { automationPaused: true } } } }) : null;
    if (!inbox) return null;
    if (!checkRateLimit(`inbox-key:${inbox.brandId}`, 20, 60_000).allowed) throw new UnprocessableEntityException('ส่งถี่เกินไป (เกิน 20 แพ็กเกจ/นาที)');
    const input = typeof body === 'string' ? body : (body && typeof body === 'object' && typeof (body as { text?: unknown }).text === 'string') ? (body as { text: string }).text : body;
    const fileName = body && typeof body === 'object' && typeof (body as { fileName?: unknown }).fileName === 'string' ? String((body as { fileName: string }).fileName).slice(0, 200) : null;
    const r = await this.importPackage({ workspaceId: inbox.workspaceId, userId: inbox.createdById, brandId: inbox.brandId, channel: 'api', input, fileName, draft: inbox.autoDraft && !inbox.workspace.automationPaused, files: { uploads: {} }, requestId });
    const rep = r.report as unknown as StoredReport;
    return { importId: r.id, status: r.status, drafted: r.draftCount, posts: rep.posts.map(p => ({ index: p.index, title: p.title, status: p.status, checks: p.checks, contentId: p.result?.contentId ?? null, error: p.result?.error ?? null })), parseError: rep.parseError };
  }

  /** โต๊ะค้นคว้าส่งแพ็กเกจที่ AI ในระบบเขียน เข้าทางตรวจ/สร้างร่างเดียวกับการนำเข้า */
  importResearch(a: { workspaceId: string; userId: string; brandId: string; input: unknown; fileName: string; pageId?: string; theme?: string; imageFallback?: string; requestId: string }) {
    return this.importPackage({ ...a, channel: 'research', draft: true, files: { uploads: {} } });
  }

  private async importPackage(a: { workspaceId: string; userId: string; brandId: string; channel: Channel; input: unknown; fileName: string | null; externalId?: string; pageId?: string; theme?: string; imageFallback?: string; draft: boolean; files: FileSource; requestId: string }) {
    const inbox = await this.prisma.contentInbox.findUnique({ where: { brandId: a.brandId }, select: { pageId: true, theme: true, imageFallback: true } });
    const defaultPageId = a.pageId ?? inbox?.pageId ?? null;
    const rep = await this.enrich(a.workspaceId, a.brandId, checkPackage(a.input, this.checkOpts), { defaultPageId, files: a.files });
    const row = await this.prisma.contentImport.create({ data: { workspaceId: a.workspaceId, brandId: a.brandId, channel: a.channel, externalId: a.externalId ?? null, fileName: a.fileName, status: rep.parseError ? 'FAILED' : 'CHECKED', postCount: rep.posts.length, report: rep as unknown as Prisma.InputJsonValue, payload: { theme: a.theme ?? inbox?.theme ?? 'dark', imageFallback: a.imageFallback ?? inbox?.imageFallback ?? 'stock', defaultPageId, uploads: a.files.uploads } as Prisma.InputJsonValue, createdById: a.userId }, select: { id: true } });
    await this.audit.log({ workspaceId: a.workspaceId, userId: a.userId, action: 'content_import.receive', resourceType: 'contentImport', resourceId: row.id, after: { channel: a.channel, fileName: a.fileName, posts: rep.posts.length, fail: rep.posts.filter(p => p.status === 'FAIL').length, parseError: !!rep.parseError }, requestId: a.requestId });
    if (a.draft && !rep.parseError) return this.draftImport(a.workspaceId, a.userId, row.id, a.requestId, a.files);
    return this.prisma.contentImport.findUniqueOrThrow({ where: { id: row.id }, select: IMPORT_SELECT });
  }

  /** สร้างร่างจากแพ็กเกจที่ตรวจแล้ว — เฉพาะโพสต์ที่ไม่มี error และยังไม่เคยสร้าง */
  async draftImport(workspaceId: string, userId: string, importId: string, requestId: string, files?: FileSource) {
    const row = await this.prisma.contentImport.findFirst({ where: { id: importId, workspaceId }, select: { id: true, brandId: true, channel: true, fileName: true, status: true, report: true, payload: true } });
    if (!row) throw new NotFoundException('ไม่พบรายการนำเข้า');
    if (row.status === 'DISMISSED') throw new UnprocessableEntityException('รายการนี้ถูกซ่อนแล้ว');
    const payload = (row.payload ?? {}) as { theme?: string; imageFallback?: string; defaultPageId?: string | null; uploads?: Record<string, string> };
    const fs: FileSource = files ?? { uploads: payload.uploads ?? {} };
    // นำเข้าจาก Drive แล้วกดสร้างร่างทีหลัง → อ่านรายการไฟล์ในโฟลเดอร์ใหม่ (รูปที่อ้างด้วยชื่อไฟล์)
    if (!files && row.channel === 'gdrive') {
      const inbox = await this.prisma.contentInbox.findUnique({ where: { brandId: row.brandId }, select: { driveFolderId: true, driveCredentialsEnc: true } });
      if (inbox?.driveFolderId && inbox.driveCredentialsEnc) fs.drive = await this.driveFiles(inbox.driveCredentialsEnc, inbox.driveFolderId).catch(() => undefined);
    }
    const rep = row.report as unknown as StoredReport;
    if (rep.parseError) throw new UnprocessableEntityException(rep.parseError);
    // ตรวจกับ DB อีกรอบ (อาจมีโพสต์ซ้ำเกิดขึ้นระหว่างรอ) — คงผลลัพธ์เดิมของโพสต์ที่สร้างไปแล้ว
    let posts: StoredPost[] = rep.posts;
    if (rep.posts.some(p => !p.result?.contentId)) {
      const base: PackageReport = { ...rep, posts: rep.posts.map(p => ({ ...p, checks: p.checks.filter(c => !DB_CHECKS.includes(c.code)) })) };
      const fresh = await this.enrich(workspaceId, row.brandId, base, { defaultPageId: payload.defaultPageId ?? null, files: fs });
      posts = rep.posts.map((p, i) => p.result?.contentId ? p : fresh.posts[i]!);
    }
    for (const p of posts) {
      if (p.result?.contentId || p.status === 'FAIL' || !p.post || !p.pageId) continue;
      try { p.result = await this.draftPost(workspaceId, userId, row, p.index, p.post, p.pageId, payload.theme ?? 'dark', payload.imageFallback ?? 'stock', fs, requestId); }
      catch (e) { p.result = { error: errMsg(e) }; }
    }
    const drafted = posts.filter(p => p.result?.contentId).length;
    const status = drafted === 0 ? 'FAILED' : drafted === posts.length ? 'DRAFTED' : 'PARTIAL';
    return this.prisma.contentImport.update({ where: { id: row.id }, data: { status, draftCount: drafted, report: { ...rep, posts } as unknown as Prisma.InputJsonValue }, select: IMPORT_SELECT });
  }

  private async draftPost(workspaceId: string, userId: string, row: { id: string; brandId: string; channel: string; fileName: string | null }, index: number, p: NormalizedPost, pageId: string, theme: string, fallback: string, fs: FileSource, requestId: string): Promise<PostResult> {
    const page = await this.prisma.facebookPage.findFirstOrThrow({ where: { id: pageId }, select: { id: true, name: true } });
    const { url, urlHash, titleHash } = this.hashes(p);
    const source = p.sources[0]?.name ?? null;
    // ที่มาต่อท้ายให้เอง (ถ้ายังไม่มีลิงก์ในข้อความ) + เครดิตภาพ
    const lines = [p.caption];
    const srcs = p.sources.filter(s => !p.caption.includes(s.url)).slice(0, 3);
    if (srcs.length) lines.push('', `ที่มา: ${srcs.map(s => s.name).join(', ')}`, ...srcs.map(s => s.url));
    const credits = [...new Set(p.images.map(i => i.credit).filter((c): c is string => !!c && !p.caption.includes(c)))];
    let caption = lines.join('\n'); if (credits.length) caption += `\nภาพประกอบ: ${credits.join(', ')}`;
    const notes = { import: { importId: row.id, index, channel: row.channel, fileName: row.fileName }, news: url ? { url, source } : undefined, risk: p.risk, riskReasons: p.riskReasons, needsCheck: p.needsCheck, suggestedAt: p.scheduleAt };
    const content = await this.content.create(workspaceId, userId, { pageId: page.id, contentType: 'post', title: p.title.slice(0, 120), caption, hashtags: p.hashtags, mediaBrief: `การ์ด: ${p.card.headline}`, mediaPaths: [], objective: 'engagement', contentPillar: p.category?.slice(0, 60) ?? (p.type === 'news' ? 'ข่าว' : 'นำเข้า') }, requestId, { provider: 'import', model: row.channel, promptVersion: IMPORT_PROMPT, notes });

    // รูป: ลิงก์ (ดาวน์โหลดกัน SSRF) / ไฟล์อัปโหลด / ไฟล์ในโฟลเดอร์ Drive
    const imageErrors: string[] = []; const photos: { path: string; bytes: Buffer; mime: string; credit?: string }[] = [];
    for (const img of p.images) {
      try { photos.push(await this.loadImage(workspaceId, userId, content.id, img, fs)); } catch (e) { imageErrors.push(`${img.kind === 'url' ? img.url.slice(0, 60) : img.kind === 'file' ? img.name : img.id}: ${errMsg(e)}`); }
    }
    let photo: string | undefined; let photoLabel: string | undefined;
    if (photos[0]) { photo = MediaGenService.dataUrl(photos[0].bytes, photos[0].mime); photoLabel = photos[0].credit ? `ภาพ: ${photos[0].credit}` : undefined; }
    else if (fallback === 'stock') {
      try { const st = await this.news.stockPhoto(workspaceId, userId, content.id, (p.photoQuery || p.category || p.title).slice(0, 80), new Set()); photo = MediaGenService.dataUrl(st.bytes, st.mimeType); photoLabel = `ภาพ: ${st.credit}`; photos.push({ path: st.asset.path, bytes: st.bytes, mime: st.mimeType, credit: st.credit }); caption += `\nภาพประกอบ: ${st.credit}`; }
      catch (e) { imageErrors.push(`คลังภาพ: ${errMsg(e)}`); }
    } else if (fallback === 'ai') {
      try { const g = await this.gen.generate(workspaceId, userId, { contentId: content.id, prompt: p.imagePrompt || `Symbolic editorial illustration about: ${p.title}`, attach: false, override: null, idempotencyKey: `import-${row.id}-${index}` }, requestId); photo = MediaGenService.dataUrl(await readFile(g.asset.path), g.asset.mimeType); photoLabel = 'ภาพประกอบจาก AI'; }
      catch (e) { imageErrors.push(`ภาพ AI: ${errMsg(e)}`); }
    }
    let cardError: string | null = null;
    try { await this.media.renderCard(workspaceId, userId, content.id, { template: 'news', data: { theme: theme as never, kicker: p.card.kicker ?? p.category ?? (p.type === 'news' ? 'ข่าว' : page.name.slice(0, 24)), title: p.card.headline, sub: p.card.sub, footer: source ? `ที่มา: ${source}` : undefined, brand: page.name.slice(0, 60), photo, photoLabel }, attach: true }, requestId, { provider: 'import', model: row.channel }); }
    catch (e) { cardError = errMsg(e); }
    // การ์ดขึ้นก่อน ตามด้วยรูปเต็มใบ (โพสต์หลายรูป)
    if (photos.length) await this.prisma.contentItem.update({ where: { id: content.id }, data: { mediaPaths: { push: photos.map(x => x.path) }, contentType: 'photo', caption } });
    else if (caption !== content.caption) await this.prisma.contentItem.update({ where: { id: content.id }, data: { caption } });
    await this.content.submit(workspaceId, userId, content.id, requestId);

    // ผูกกับกล่องข่าว (ข่าวเดิมจาก RSS ที่ยังไม่เขียน → ใช้แถวเดิม) ให้ขึ้นแท็บ "เขียนแล้ว" และใช้กันซ้ำ
    const angle = { headlineTh: p.card.headline, why: `นำเข้าจาก ${CHANNEL_LABEL[row.channel] ?? row.channel}${row.fileName ? ` · ${row.fileName}` : ''}`, category: p.category ?? (p.type === 'news' ? 'ข่าว' : 'โพสต์ของเพจ'), risk: p.risk, riskReasons: p.riskReasons, imported: true };
    const existing = await this.prisma.newsItem.findUnique({ where: { brandId_urlHash: { brandId: row.brandId, urlHash } }, select: { id: true } });
    const item = existing
      ? await this.prisma.newsItem.update({ where: { id: existing.id }, data: { status: 'DRAFTED', contentId: content.id, angle }, select: { id: true } })
      : await this.prisma.newsItem.create({ data: { workspaceId, brandId: row.brandId, url, urlHash, titleHash, title: p.title.slice(0, 300), snippet: p.caption.slice(0, 300), sourceName: source ?? 'นำเข้า', status: 'DRAFTED', score: null, angle, contentId: content.id }, select: { id: true } });
    await this.audit.log({ workspaceId, userId, action: 'content_import.draft', resourceType: 'contentItem', resourceId: content.id, after: { importId: row.id, index, pageId: page.id, images: photos.length, imageErrors: imageErrors.length, cardError: !!cardError, risk: p.risk, needsCheck: p.needsCheck.length }, requestId });
    return { contentId: content.id, newsItemId: item.id, ...(imageErrors.length && { imageErrors }), cardError };
  }

  private async loadImage(workspaceId: string, userId: string, contentId: string, img: ImageRef, fs: FileSource): Promise<{ path: string; bytes: Buffer; mime: string; credit?: string }> {
    const uploadId = img.kind === 'upload' ? img.id : img.kind === 'file' ? fs.uploads[img.name] : undefined;
    if (uploadId) {
      const a = await this.prisma.mediaAsset.findFirst({ where: { id: uploadId, workspaceId, kind: 'upload' }, select: { id: true, path: true, mimeType: true } });
      if (!a) throw new Error('ไม่พบไฟล์อัปโหลด');
      await this.prisma.mediaAsset.update({ where: { id: a.id }, data: { contentId } });
      return { path: a.path, bytes: await readFile(a.path), mime: a.mimeType, ...(img.credit && { credit: img.credit }) };
    }
    let bytes: Buffer; let mime: string; let meta: Record<string, unknown>;
    if (img.kind === 'url') {
      const r = await downloadImage(img.url, { allowPrivate: this.env.WEB_ALLOW_PRIVATE_TARGETS });
      bytes = r.bytes; mime = r.mimeType; meta = { url: img.url };
    } else if (img.kind === 'file' && fs.drive) {
      const f = fs.drive.files.find(x => x.name === img.name);
      if (!f) throw new Error('ไม่พบไฟล์ในโฟลเดอร์');
      bytes = await driveDownload(fs.drive.token, f, { ...this.driveOpts, maxBytes: MAX_UPLOAD_BYTES });
      const m = sniffImage(bytes); if (!m) throw new Error('ไฟล์ไม่ใช่รูป JPEG/PNG/WebP'); mime = m; meta = { driveFileId: f.id, name: f.name };
    } else throw new Error('ไม่ได้แนบไฟล์นี้');
    const dir = resolve(this.env.MEDIA_DIR, workspaceId); mkdirSync(dir, { recursive: true });
    const path = join(dir, `import-${Date.now()}-${randomBytes(4).toString('hex')}.${EXT[mime] ?? (extname(img.kind === 'file' ? img.name : '').slice(1) || 'jpg')}`);
    await writeFile(path, bytes);
    await this.prisma.mediaAsset.create({ data: { workspaceId, contentId, kind: 'import', path, mimeType: mime, bytes: bytes.byteLength, sha256: sha256Buf(bytes), meta: { ...meta, ...(img.credit && { credit: img.credit }) } as Prisma.InputJsonValue, createdById: userId } });
    return { path, bytes, mime, ...(img.credit && { credit: img.credit }) };
  }

  // ---------- ประวัติ ----------
  async list(workspaceId: string, brandId: string) {
    await this.brand(workspaceId, brandId);
    return this.prisma.contentImport.findMany({ where: { brandId, workspaceId, status: { not: 'DISMISSED' } }, orderBy: { createdAt: 'desc' }, take: 30, select: IMPORT_SELECT });
  }
  async dismiss(workspaceId: string, userId: string, importId: string, requestId: string) {
    const r = await this.prisma.contentImport.findFirst({ where: { id: importId, workspaceId }, select: { id: true } });
    if (!r) throw new NotFoundException('ไม่พบรายการนำเข้า');
    await this.prisma.contentImport.update({ where: { id: r.id }, data: { status: 'DISMISSED' } });
    await this.audit.log({ workspaceId, userId, action: 'content_import.dismiss', resourceType: 'contentImport', resourceId: r.id, requestId });
    return { ok: true };
  }

  // ---------- Google Drive ----------
  private async driveFiles(credentialsEnc: string, folderId: string) {
    const sa = parseServiceAccount(decryptSecret(credentialsEnc, this.env.AUTH_SECRET));
    const token = await serviceAccountToken(sa, undefined, this.driveOpts);
    return { token, files: await driveListFolder(token, folderId, this.driveOpts) };
  }

  /** ทุก 10 นาที: ทุกแบรนด์ที่เปิด Drive (และ workspace ไม่ได้กดหยุดฉุกเฉิน) — กันรันซ้อนด้วย Redis lock */
  async pollDrive() {
    const lockId = randomBytes(8).toString('hex');
    if ((await this.redis.set(DRIVE_LOCK, lockId, 'EX', 15 * 60, 'NX').catch(() => null)) !== 'OK') return { skipped: 'locked' as const, runs: [] };
    try {
      const inboxes = await this.prisma.contentInbox.findMany({ where: { driveEnabled: true, driveFolderId: { not: null }, driveCredentialsEnc: { not: null }, workspace: { automationPaused: false } }, select: { workspaceId: true, brandId: true } });
      const runs = [];
      for (const i of inboxes) runs.push(await this.pollDriveOne(i.workspaceId, i.brandId).catch(e => ({ brandId: i.brandId, error: errMsg(e) })));
      return { runs };
    } finally {
      if ((await this.redis.get(DRIVE_LOCK).catch(() => null)) === lockId) await this.redis.del(DRIVE_LOCK).catch(() => undefined);
    }
  }

  async pollDriveOne(workspaceId: string, brandId: string, requestId = `drive-${Date.now()}`) {
    await this.brand(workspaceId, brandId);
    const inbox = await this.prisma.contentInbox.findUnique({ where: { brandId }, select: { driveFolderId: true, driveCredentialsEnc: true, createdById: true, autoDraft: true, workspace: { select: { automationPaused: true } } } });
    if (!inbox?.driveFolderId || !inbox.driveCredentialsEnc) throw new UnprocessableEntityException('ยังไม่ได้ตั้งค่าโฟลเดอร์ Google Drive');
    let drive: { token: string; files: DriveFile[] };
    try { drive = await this.driveFiles(inbox.driveCredentialsEnc, inbox.driveFolderId); }
    catch (e) { await this.prisma.contentInbox.update({ where: { brandId }, data: { driveLastPolledAt: new Date(), driveLastError: errMsg(e) } }); throw new UnprocessableEntityException(errMsg(e)); }
    const cutoff = Date.now() - DRIVE_MAX_FILE_AGE_DAYS * 86_400_000;
    const candidates = drive.files.filter(f => (PACKAGE_EXT.test(f.name) || f.mimeType === GOOGLE_DOC_MIME) && (!f.modifiedTime || Date.parse(f.modifiedTime) >= cutoff));
    const extId = (f: DriveFile) => `${f.id}:${f.md5Checksum || f.modifiedTime || ''}`;
    const done = new Set((await this.prisma.contentImport.findMany({ where: { workspaceId, channel: 'gdrive', externalId: { in: candidates.map(extId) } }, select: { externalId: true } })).map(r => r.externalId));
    const todo = candidates.filter(f => !done.has(extId(f))).slice(0, DRIVE_MAX_PACKAGES_PER_POLL);
    const results: { file: string; status: string; drafted: number }[] = [];
    for (const f of todo) {
      let text: string;
      try { text = (await driveDownload(drive.token, f, { ...this.driveOpts, maxBytes: 2 * 1024 * 1024 })).toString('utf8'); }
      catch (e) { results.push({ file: f.name, status: `ERROR: ${errMsg(e)}`, drafted: 0 }); continue; }
      try {
        const r = await this.importPackage({ workspaceId, userId: inbox.createdById, brandId, channel: 'gdrive', input: text, fileName: f.name, externalId: extId(f), draft: inbox.autoDraft && !inbox.workspace.automationPaused, files: { uploads: {}, drive }, requestId });
        results.push({ file: f.name, status: r.status, drafted: r.draftCount });
      } catch (e) { results.push({ file: f.name, status: `ERROR: ${errMsg(e)}`, drafted: 0 }); }
    }
    await this.prisma.contentInbox.update({ where: { brandId }, data: { driveLastPolledAt: new Date(), driveLastError: null } });
    return { brandId, files: drive.files.length, imported: results.length, results };
  }
}
