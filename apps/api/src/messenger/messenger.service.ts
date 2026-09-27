import { BadGatewayException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { decryptSecret, type PrismaClient } from '@fbpm/database';
import { randomUUID } from 'node:crypto';
import { generateMessengerReply, ingestMessenger, inWindow, messengerEvents, MessengerError, MessengerSendError, MESSENGER_QUEUE, MetaMessenger, scopedPage, type MessengerDeps } from '@fbpm/messenger-core';
import { Queue } from 'bullmq';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../ai/gateway.service';
import { connectionFromUrl } from '../jobs/queue.service';

const messages: Record<string, string> = {
  AI_NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่า AI — ใส่ API key ของผู้ให้บริการอย่างน้อย 1 รายที่หน้า "โมเดล AI"',
  AI_BUDGET: 'งบ AI เดือนนี้ถูกใช้หมดแล้ว — เพิ่มงบที่หน้า "โมเดล AI"',
  AI_AUTH: 'API key ของ AI ใช้งานไม่ได้ ตรวจคีย์และชื่อโมเดลที่หน้า "โมเดล AI"',
  AI_RATE_LIMIT: 'ผู้ให้บริการ AI จำกัดการเรียกชั่วคราว กรุณาทดลองใหม่ภายหลัง',
  AI_FAILED: 'ทดลองคำตอบไม่สำเร็จ กรุณาตรวจโมเดลและการเชื่อมต่อที่หน้า "โมเดล AI"',
  DAILY_LIMIT: 'ใช้ AI แชทครบเพดานรายวันแล้ว',
};
@Injectable()
export class MessengerService {
  readonly deps: MessengerDeps;
  private queue: Queue | null = null;
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService, @Inject(AiGatewayService) private readonly ai: AiGatewayService) {
    this.deps = { prisma, secret: env.AUTH_SECRET, appId: env.META_APP_ID, ai: ai.ctx, transport: new MetaMessenger({ version: env.META_GRAPH_API_VERSION, ...(env.APP_ENV === 'test' && { testBaseUrl: env.META_GRAPH_BASE_URL, testMode: true }) }), testMode: env.APP_ENV === 'test' };
  }
  async onModuleDestroy() { await this.queue?.close(); }
  private q() { return this.queue ??= new Queue(MESSENGER_QUEUE, { connection: connectionFromUrl(this.env.REDIS_URL) }); }
  async receive(body: unknown) {
    const ids = await ingestMessenger(this.deps, messengerEvents(body));
    for (const id of ids) await this.q().add('reply', { conversationId: id }, { jobId: `reply-${id}-${Date.now()}`, delay: 1200, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 200, removeOnFail: 200 });
  }
  async settings(workspaceId: string) {
    const [settings, usage, ws] = await Promise.all([
      this.prisma.messengerSettings.findUnique({ where: { workspaceId }, select: { dailyLimit: true, validatedAt: true } }),
      this.prisma.messengerDailyUsage.findUnique({ where: { workspaceId_day: { workspaceId, day: new Date().toISOString().slice(0, 10) } }, select: { requests: true } }),
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { automationPaused: true } }),
    ]);
    const ai = await this.ai.resolve(workspaceId, 'community').catch(() => null);
    return {
      settings, automaticSendEnabled: this.env.MESSENGER_AUTO_SEND_ENABLED === 'true', requestsToday: usage?.requests ?? 0, automationPaused: ws.automationPaused,
      // โมเดลที่แชทจะใช้จริง มาจากการตั้งค่า AI กลาง (บทบาท community) — ไม่มี key แยกของโมดูลนี้
      ai: ai && { provider: ai.provider, model: ai.model, source: ai.source },
      webhookConfigured: !!(this.env.META_APP_ID && this.env.META_APP_SECRET && this.env.META_WEBHOOK_VERIFY_TOKEN), webhookPath: '/api/facebook/webhook',
    };
  }
  async saveSettings(workspaceId: string, userId: string, b: { dailyLimit: number }, requestId: string) {
    await this.prisma.$transaction(async tx => {
      await tx.messengerSettings.upsert({ where: { workspaceId }, create: { workspaceId, dailyLimit: b.dailyLimit }, update: { dailyLimit: b.dailyLimit, revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { workspaceId, userId, action: 'messenger.ai.configure', resourceType: 'workspace', resourceId: workspaceId, after: { dailyLimit: b.dailyLimit }, requestId } });
    });
    return this.settings(workspaceId);
  }
  pages(workspaceId: string) {
    return this.prisma.facebookPage.findMany({ where: { brand: { client: { workspaceId } } }, orderBy: { name: 'asc' }, select: { id: true, facebookPageId: true, name: true, tokenStatus: true, disconnectedAt: true, brand: { select: { id: true, name: true } }, messengerConfig: true, _count: { select: { conversations: true } } } });
  }
  private async page(workspaceId: string, id: string) {
    const page = await this.prisma.facebookPage.findFirst({ where: scopedPage(workspaceId, id), include: { messengerConfig: true, connection: true } });
    if (!page) throw new NotFoundException(); return page;
  }
  async savePage(workspaceId: string, userId: string, id: string, b: { enabled: boolean; instructions: string; fallbackMessage: string; reviewDrafts?: boolean }, requestId: string) {
    const page = await this.page(workspaceId, id);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`messenger-page:${page.facebookPageId}`}))::text`;
      const current = await tx.facebookPage.findFirstOrThrow({ where: scopedPage(workspaceId, id), include: { messengerConfig: true, connection: true } });
      if (b.enabled) {
        await tx.$queryRaw`SELECT "workspaceId" FROM "MessengerSettings" WHERE "workspaceId" = ${workspaceId} FOR UPDATE`;
        const settings = await tx.messengerSettings.findUnique({ where: { workspaceId } });
        if (!settings?.validatedAt) throw new UnprocessableEntityException('ทดลองคำตอบให้สำเร็จก่อนเปิดตอบอัตโนมัติ');
        if (!current.messengerConfig?.subscribedAt || current.disconnectedAt || current.tokenStatus !== 'VALID' || current.connection.status !== 'ACTIVE') throw new UnprocessableEntityException('เชื่อมเพจและกดเชื่อมรับข้อความให้สำเร็จก่อน');
        const duplicate = await tx.messengerPageConfig.findFirst({ where: { enabled: true, pageId: { not: id }, page: { facebookPageId: page.facebookPageId } } });
        if (duplicate) throw new ConflictException('เพจ Facebook นี้เปิด AI ในแบรนด์หรือพื้นที่ทำงานอื่นแล้ว');
      }
      await tx.messengerPageConfig.upsert({ where: { pageId: id }, create: { pageId: id, ...b, enabledAt: b.enabled ? new Date() : null }, update: { ...b, ...(b.enabled && !current.messengerConfig?.enabled && { enabledAt: new Date() }), revision: { increment: 1 } } });
      await tx.messengerMessage.updateMany({ where: { conversation: { pageId: id }, status: { in: ['PENDING', 'GENERATING'] } }, data: { status: 'SKIPPED', error: 'PAGE_SETTINGS_CHANGED' } });
      await tx.auditLog.create({ data: { workspaceId, userId, action: 'messenger.page.configure', resourceType: 'facebookPage', resourceId: id, after: { enabled: b.enabled, ...(b.reviewDrafts !== undefined && { reviewDrafts: b.reviewDrafts }) }, requestId } });
    }); return { ok: true };
  }
  async subscribe(workspaceId: string, userId: string, id: string, requestId: string) {
    const p = await this.page(workspaceId, id);
    if (!(this.env.META_APP_ID && this.env.META_APP_SECRET && this.env.META_WEBHOOK_VERIFY_TOKEN)) throw new UnprocessableEntityException('ตั้งค่า Meta App และ webhook ในระบบก่อน');
    if (p.disconnectedAt || p.tokenStatus !== 'VALID' || p.connection.status !== 'ACTIVE') throw new UnprocessableEntityException('เชื่อมเพจใหม่ก่อน');
    if (!p.connection.scopes.includes('pages_messaging')) throw new UnprocessableEntityException('เชื่อม Facebook ใหม่ด้วยสิทธิ์ pages_messaging ก่อน');
    try { await this.deps.transport.subscribe(p.facebookPageId, decryptSecret(p.pageAccessTokenEncrypted, this.env.AUTH_SECRET)); }
    catch { throw new BadGatewayException('เชื่อมรับข้อความไม่สำเร็จ ตรวจสิทธิ์ Meta และ token ของเพจ'); }
    await this.prisma.messengerPageConfig.upsert({ where: { pageId: id }, create: { pageId: id, subscribedAt: new Date() }, update: { subscribedAt: new Date(), revision: { increment: 1 } } });
    await this.audit.log({ workspaceId, userId, action: 'messenger.page.subscribe', resourceType: 'facebookPage', resourceId: id, requestId }); return { ok: true };
  }
  async preview(workspaceId: string, userId: string, id: string, text: string, requestId: string) {
    await this.page(workspaceId, id);
    try {
      const r = await generateMessengerReply(this.deps, workspaceId, id, [{ role: 'user', text }]);
      await this.prisma.messengerSettings.updateMany({ where: { workspaceId, revision: r.settingsRevision }, data: { validatedAt: new Date() } });
      await this.audit.log({ workspaceId, userId, action: 'messenger.preview', resourceType: 'facebookPage', resourceId: id, requestId }); return r.reply;
    } catch (e) { throw new BadGatewayException(messages[e instanceof MessengerError ? e.code : 'AI_FAILED'] ?? messages.AI_FAILED); }
  }
  async conversations(workspaceId: string, pageId: string) {
    await this.page(workspaceId, pageId);
    return this.prisma.messengerConversation.findMany({ where: { pageId, page: { brand: { client: { workspaceId } } } }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, psid: true, mode: true, needsAttention: true, lastError: true, lastCustomerAt: true, updatedAt: true } });
  }
  async conversation(workspaceId: string, id: string) {
    const c = await this.prisma.messengerConversation.findFirst({ where: { id, page: { brand: { client: { workspaceId } } } }, select: { id: true, pageId: true, psid: true, mode: true, needsAttention: true, lastError: true, lastCustomerAt: true, messages: { orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 100 } } });
    if (!c) throw new NotFoundException(); return { ...c, messages: c.messages.reverse() };
  }
  async mode(workspaceId: string, userId: string, id: string, mode: 'AUTO' | 'HUMAN', requestId: string) {
    await this.conversation(workspaceId, id);
    await this.prisma.$transaction(async tx => {
      await tx.messengerConversation.update({ where: { id }, data: { mode, revision: { increment: 1 }, needsAttention: false, lastError: null } });
      await tx.messengerMessage.updateMany({ where: { conversationId: id, status: { in: ['PENDING', 'GENERATING'] } }, data: { status: 'SKIPPED', error: 'CONVERSATION_MODE_CHANGED' } });
      await tx.auditLog.create({ data: { workspaceId, userId, action: 'messenger.conversation.mode', resourceType: 'messengerConversation', resourceId: id, after: { mode }, requestId } });
    }); return { ok: true };
  }
  /**
   * แอดมินส่งข้อความจากแอป — ใช้ส่งร่างของ AI (แก้ก่อนได้) หรือพิมพ์ตอบเอง
   * ส่งได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุดเท่านั้น (กฎ Messenger) · แนบ metadata ให้ echo รู้ว่าเป็นข้อความของระบบ ไม่สลับเป็น "แอดมินตอบนอกระบบ"
   * ผลไม่แน่นอน (timeout/5xx) = UNKNOWN ห้ามส่งซ้ำอัตโนมัติ ให้คนไปตรวจในกล่องข้อความ Facebook ก่อน
   */
  async send(workspaceId: string, userId: string, id: string, b: { text: string; messageId?: string; resumeAi?: boolean }, requestId: string) {
    const conv = await this.prisma.messengerConversation.findFirst({ where: { id, page: { brand: { client: { workspaceId } } } }, include: { page: { include: { connection: true } } } });
    if (!conv) throw new NotFoundException();
    const page = conv.page;
    if (page.disconnectedAt || page.tokenStatus !== 'VALID' || page.connection.status !== 'ACTIVE') throw new UnprocessableEntityException('เพจหลุดการเชื่อมต่อหรือ token หมดอายุ — เชื่อมเพจใหม่ก่อนส่ง');
    if (!inWindow(conv.lastCustomerAt)) throw new UnprocessableEntityException('เกิน 24 ชั่วโมงหลังลูกค้าทักล่าสุด — Messenger ไม่ให้เพจส่งข้อความเองแล้ว ตอบผ่านกล่องข้อความ Facebook (ใช้แท็กข้อความ) หรือรอลูกค้าทักใหม่');
    const resumeAi = b.resumeAi ?? true;
    const reusable = ['DRAFT', 'SKIPPED', 'SUPERSEDED', 'FAILED'];
    const rowId = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`messenger-page:${page.facebookPageId}`}))::text`;
      let target: string;
      if (b.messageId) {
        const m = await tx.messengerMessage.findFirst({ where: { id: b.messageId, conversationId: id } });
        if (!m) throw new NotFoundException('ไม่พบข้อความนี้ในบทสนทนา');
        if (m.direction === 'OUT' && !m.externalId.startsWith('manual:')) throw new ConflictException('ข้อความนี้ส่งจากนอกระบบแล้ว');
        const moved = await tx.messengerMessage.updateMany({ where: { id: m.id, status: { in: reusable } }, data: { status: 'SENDING', replyText: b.text, replyAction: 'manual', processingAt: new Date(), error: null } });
        if (!moved.count) throw new ConflictException(m.status === 'UNKNOWN' ? 'ข้อความนี้อาจส่งถึงลูกค้าแล้ว (ผลไม่แน่นอน) — ตรวจในกล่องข้อความ Facebook ก่อน ห้ามส่งซ้ำ' : 'ข้อความนี้ถูกส่งหรือกำลังส่งอยู่แล้ว');
        target = m.id;
      } else {
        target = (await tx.messengerMessage.create({ data: { conversationId: id, externalId: `manual:${randomUUID()}`, direction: 'OUT', text: b.text, occurredAt: new Date(), status: 'SENDING', replyText: b.text, replyAction: 'manual', processingAt: new Date() } })).id;
      }
      // หยุด AI ที่อาจกำลังคิดคำตอบของบทสนทนานี้อยู่ (revision เปลี่ยน = คำตอบเก่าถูกทิ้ง)
      await tx.messengerConversation.update({ where: { id }, data: { mode: 'HUMAN', revision: { increment: 1 } } });
      await tx.messengerMessage.updateMany({ where: { conversationId: id, status: { in: ['PENDING', 'GENERATING'] } }, data: { status: 'SKIPPED', error: 'HUMAN_REPLIED' } });
      return target;
    });
    try {
      const mid = await this.deps.transport.send(page.facebookPageId, decryptSecret(page.pageAccessTokenEncrypted, this.env.AUTH_SECRET), conv.psid, b.text, `fbpm-messenger:${rowId}`);
      // echo อาจมาถึงก่อน HTTP ตอบ และตั้ง SENT ไว้แล้ว — อัปเดตซ้ำได้ ไม่มีผลเสีย
      await this.prisma.messengerMessage.update({ where: { id: rowId }, data: { status: 'SENT', replyMessageId: mid, sentAt: new Date(), error: null } });
      await this.prisma.messengerConversation.update({ where: { id }, data: { mode: resumeAi ? 'AUTO' : 'HUMAN', revision: { increment: 1 }, needsAttention: false, lastError: null } });
      await this.audit.log({ workspaceId, userId, action: 'messenger.manual_send', resourceType: 'messengerConversation', resourceId: id, after: { messageId: rowId, resumeAi }, requestId });
      return { ok: true, messageId: rowId, mode: resumeAi ? 'AUTO' : 'HUMAN' };
    } catch (e) {
      const uncertain = !(e instanceof MessengerSendError) || e.uncertain;
      const code = e instanceof MessengerSendError ? e.code : 'META_OUTCOME_UNKNOWN';
      await this.prisma.messengerMessage.updateMany({ where: { id: rowId, status: 'SENDING' }, data: { status: uncertain ? 'UNKNOWN' : 'FAILED', error: code } });
      await this.prisma.messengerConversation.update({ where: { id }, data: { needsAttention: true, lastError: code } });
      await this.audit.log({ workspaceId, userId, action: 'messenger.manual_send_failed', resourceType: 'messengerConversation', resourceId: id, after: { messageId: rowId, code }, requestId });
      throw new BadGatewayException(uncertain ? 'ไม่แน่ใจว่าข้อความถึงลูกค้าหรือยัง — ตรวจในกล่องข้อความ Facebook ก่อน ห้ามกดส่งซ้ำ' : 'Meta ไม่รับข้อความ — ตรวจว่า token มีสิทธิ์ pages_messaging และยังอยู่ในช่วง 24 ชม. แล้วลองใหม่');
    }
  }
  /** เช็คลิสต์ว่าเพจนี้พร้อมให้ AI ตอบแชทหรือยัง — ข้อไหนไม่ผ่านบอกวิธีแก้ ไม่มี token/secret ในผลลัพธ์ */
  async readiness(workspaceId: string, id: string) {
    const p = await this.page(workspaceId, id);
    const [settings, lastIn, ai] = await Promise.all([
      this.prisma.messengerSettings.findUnique({ where: { workspaceId }, select: { validatedAt: true } }),
      this.prisma.messengerMessage.findFirst({ where: { direction: 'IN', conversation: { pageId: id } }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
      this.ai.resolve(workspaceId, 'community').catch(() => null),
    ]);
    const config = p.messengerConfig;
    const autoSendEnv = this.env.MESSENGER_AUTO_SEND_ENABLED === 'true';
    const checks = [
      { key: 'webhook', ok: !!(this.env.META_APP_ID && this.env.META_APP_SECRET && this.env.META_WEBHOOK_VERIFY_TOKEN), hint: 'ตั้ง META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN ใน .env ของเซิร์ฟเวอร์ แล้วใส่ Callback URL …/api/facebook/webhook ใน Meta App (ดู docs/MESSENGER.md)' },
      { key: 'page', ok: !p.disconnectedAt && p.tokenStatus === 'VALID' && p.connection.status === 'ACTIVE', hint: 'เชื่อมเพจใหม่ที่หน้า "เพจ"' },
      { key: 'scope', ok: p.connection.scopes.includes('pages_messaging'), hint: 'กด "เชื่อม Facebook สำหรับแชท" เพื่อขอสิทธิ์ pages_messaging' },
      { key: 'subscribed', ok: !!config?.subscribedAt, hint: 'กด "เชื่อมรับข้อความ" ของเพจนี้' },
      { key: 'ai', ok: !!ai, hint: 'ตั้งคีย์ AI และบทบาท community ที่หน้า "โมเดล AI"' },
      { key: 'tested', ok: !!settings?.validatedAt, hint: 'กด "ทดลองคำตอบ" ให้สำเร็จหนึ่งครั้ง' },
      { key: 'enabled', ok: !!config?.enabled, hint: 'เปิดสวิตช์ "ให้ AI ตอบเพจนี้"' },
      { key: 'received', ok: !!lastIn, hint: 'ลองทักเพจจากบัญชีอื่น — ถ้าไม่ขึ้นในรายการ แปลว่า webhook ยังไม่ถึงเซิร์ฟเวอร์ (ตรวจ Callback URL, ฟิลด์ messages และแอปต้องเป็นโหมด Live)' },
    ];
    const mode = !config?.enabled ? 'OFF' : autoSendEnv && !config.reviewDrafts ? 'AUTO_SEND' : 'DRAFT_REVIEW';
    return { checks, mode, autoSendEnabled: autoSendEnv, reviewDrafts: !!config?.reviewDrafts, lastInboundAt: lastIn?.occurredAt ?? null, webhookPath: '/api/facebook/webhook', webhookFields: ['messages', 'message_echoes'] };
  }
}
