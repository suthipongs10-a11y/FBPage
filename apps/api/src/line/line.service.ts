/**
 * แจ้งเตือนทาง LINE OA (Messaging API) — docs/LINE_PORTAL.md
 * workspace ใส่ channel secret + access token ของ LINE OA ตัวเอง (เข้ารหัสเก็บ) → ผู้ใช้ผูก LINE ด้วยรหัส 6 หลักที่ส่งในแชท OA
 * ทีม (clientId null) ได้แจ้งเตือนทุกลูกค้า · เจ้าของธุรกิจ (มี clientId) ได้เฉพาะของร้านตัวเอง
 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import type { PrismaClient } from '@fbpm/database';
import { LINE_CLIENT_ALLOWED, LINE_CLIENT_DEFAULT, LINE_TEAM_DEFAULT, lineAddFriendUrl, lineBotInfo, lineReply, sendLineTo, verifyLineSignature } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret } from '../common/crypto';

const CODE_TTL_MS = 30 * 60_000;
const ALL_TYPES = [...new Set([...LINE_TEAM_DEFAULT, ...LINE_CLIENT_ALLOWED])];
interface LineEvent { type: string; replyToken?: string; source?: { userId?: string }; message?: { type?: string; text?: string } }

@Injectable()
export class LineService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService) {}

  private webhookUrl(key: string) { return `${this.env.APP_URL.replace(/\/+$/, '')}/api/line/webhook/${key}`; }

  async status(workspaceId: string) {
    const ch = await this.prisma.lineChannel.findUnique({ where: { workspaceId }, select: { botBasicId: true, botName: true, webhookKey: true, updatedAt: true } });
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [recipients, sentMonth, failedMonth] = await Promise.all([
      this.prisma.lineRecipient.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { id: true, displayName: true, userId: true, clientId: true, types: true, active: true, createdAt: true } }),
      this.prisma.lineDelivery.count({ where: { workspaceId, status: 'SENT', kind: 'push', createdAt: { gte: monthStart } } }),
      this.prisma.lineDelivery.count({ where: { workspaceId, status: 'FAILED', createdAt: { gte: monthStart } } }),
    ]);
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: recipients.map(r => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } })).map(u => [u.id, u]));
    const clients = new Map((await this.prisma.client.findMany({ where: { workspaceId, id: { in: recipients.map(r => r.clientId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map(c => [c.id, c.name]));
    return {
      configured: !!ch, botBasicId: ch?.botBasicId ?? null, botName: ch?.botName ?? null, addFriendUrl: lineAddFriendUrl(ch?.botBasicId), webhookUrl: ch ? this.webhookUrl(ch.webhookKey) : null,
      sentThisMonth: sentMonth, failedThisMonth: failedMonth, maxPerRecipientPerDay: Number(process.env.LINE_MAX_PUSH_PER_DAY ?? 30) || 30,
      types: { team: LINE_TEAM_DEFAULT, client: LINE_CLIENT_ALLOWED, clientDefault: LINE_CLIENT_DEFAULT },
      recipients: recipients.map(r => ({ ...r, user: r.userId ? users.get(r.userId) ?? null : null, clientName: r.clientId ? clients.get(r.clientId) ?? null : null })),
    };
  }

  /** บันทึก LINE OA — ตรวจ token กับ LINE ก่อน (ได้ @basicId มาทำลิงก์เพิ่มเพื่อน) · ไม่คืน/ไม่ audit ค่าลับ */
  async configure(workspaceId: string, userId: string, dto: { channelSecret: string; accessToken: string }, requestId: string) {
    const info = await lineBotInfo(dto.accessToken);
    if (!info.ok) throw new UnprocessableEntityException(`LINE ไม่รับ access token นี้: ${info.error}`);
    const existing = await this.prisma.lineChannel.findUnique({ where: { workspaceId }, select: { webhookKey: true } });
    const data = { channelSecretEncrypted: encryptSecret(dto.channelSecret, this.env.AUTH_SECRET), accessTokenEncrypted: encryptSecret(dto.accessToken, this.env.AUTH_SECRET), botBasicId: info.basicId, botName: info.displayName };
    await this.prisma.lineChannel.upsert({ where: { workspaceId }, create: { workspaceId, webhookKey: existing?.webhookKey ?? randomBytes(18).toString('hex'), ...data }, update: data });
    await this.audit.log({ workspaceId, userId, action: 'LINE_CHANNEL_CONFIGURED', resourceType: 'lineChannel', after: { botBasicId: info.basicId, botName: info.displayName }, requestId });
    return this.status(workspaceId);
  }

  async remove(workspaceId: string, userId: string, requestId: string) {
    await this.prisma.$transaction([this.prisma.lineRecipient.deleteMany({ where: { workspaceId } }), this.prisma.lineLinkCode.deleteMany({ where: { workspaceId } }), this.prisma.lineChannel.deleteMany({ where: { workspaceId } })]);
    await this.audit.log({ workspaceId, userId, action: 'LINE_CHANNEL_REMOVED', resourceType: 'lineChannel', requestId });
    return { ok: true };
  }

  /** รหัส 6 หลัก (หมดอายุ 30 นาที) — ผู้ใช้เพิ่มเพื่อน OA แล้วส่งรหัสนี้ในแชท */
  async createLinkCode(workspaceId: string, userId: string, clientId: string | null) {
    const ch = await this.prisma.lineChannel.findUnique({ where: { workspaceId }, select: { botBasicId: true } });
    if (!ch) throw new ConflictException('ยังไม่ได้ตั้งค่า LINE OA ของทีม — ทีมงานต้องตั้งค่าในหน้าตั้งค่าก่อน');
    await this.prisma.lineLinkCode.deleteMany({ where: { workspaceId, OR: [{ expiresAt: { lt: new Date() } }, { userId, clientId, usedAt: null }] } });
    for (let i = 0; i < 5; i++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        const row = await this.prisma.lineLinkCode.create({ data: { workspaceId, code, userId, clientId, expiresAt: new Date(Date.now() + CODE_TTL_MS) }, select: { code: true, expiresAt: true } });
        return { ...row, botBasicId: ch.botBasicId, addFriendUrl: lineAddFriendUrl(ch.botBasicId) };
      } catch { /* รหัสชน → สุ่มใหม่ */ }
    }
    throw new ConflictException('สร้างรหัสไม่สำเร็จ ลองใหม่');
  }

  /** แก้ผู้รับ — scope: ทีม (workspace.manage) แก้ได้ทุกคน · พอร์ทัลแก้ได้เฉพาะของตัวเองในลูกค้านั้น */
  async updateRecipient(workspaceId: string, id: string, dto: { active?: boolean; types?: string[] }, scope?: { userId: string; clientId: string }) {
    const r = await this.prisma.lineRecipient.findFirst({ where: { id, workspaceId, ...(scope && { userId: scope.userId, clientId: scope.clientId }) }, select: { id: true, clientId: true } });
    if (!r) throw new NotFoundException('ไม่พบผู้รับ');
    if (dto.types) {
      const allowed: readonly string[] = r.clientId ? LINE_CLIENT_ALLOWED : ALL_TYPES;
      const bad = dto.types.filter(t => !allowed.includes(t)); if (bad.length) throw new BadRequestException(`ชนิดแจ้งเตือนไม่รองรับ: ${bad.join(', ')}`);
    }
    return this.prisma.lineRecipient.update({ where: { id }, data: { ...(dto.active !== undefined && { active: dto.active }), ...(dto.types && { types: [...new Set(dto.types)] }) }, select: { id: true, types: true, active: true, clientId: true } });
  }
  async removeRecipient(workspaceId: string, id: string, scope?: { userId: string; clientId: string }) {
    const r = await this.prisma.lineRecipient.deleteMany({ where: { id, workspaceId, ...(scope && { userId: scope.userId, clientId: scope.clientId }) } });
    if (!r.count) throw new NotFoundException('ไม่พบผู้รับ');
    return { ok: true };
  }
  recipientsFor(workspaceId: string, userId: string, clientId: string) {
    return this.prisma.lineRecipient.findMany({ where: { workspaceId, userId, clientId }, select: { id: true, displayName: true, types: true, active: true, createdAt: true } });
  }

  async test(workspaceId: string) {
    const recipients = await this.prisma.lineRecipient.findMany({ where: { workspaceId, active: true, clientId: null }, select: { id: true, lineUserId: true, clientId: true, types: true } });
    if (!recipients.length) throw new ConflictException('ยังไม่มีทีมงานคนไหนผูก LINE');
    return sendLineTo(this.prisma, this.env.AUTH_SECRET, workspaceId, recipients, () => '✅ ทดสอบแจ้งเตือนจาก SocialManage — ถ้าเห็นข้อความนี้ แปลว่าตั้งค่าเรียบร้อย');
  }

  /** webhook จาก LINE: ตรวจลายเซ็นด้วย channel secret ของ workspace นั้น → จับรหัสผูก / เลิกเป็นเพื่อน */
  async webhook(key: string, rawBody: Buffer | undefined, signature: string | undefined, body: { events?: LineEvent[] }) {
    const ch = await this.prisma.lineChannel.findUnique({ where: { webhookKey: key }, select: { workspaceId: true, channelSecretEncrypted: true, accessTokenEncrypted: true } });
    if (!ch) throw new NotFoundException();
    if (!verifyLineSignature(decryptSecret(ch.channelSecretEncrypted, this.env.AUTH_SECRET), rawBody, signature)) throw new ForbiddenException('ลายเซ็นไม่ถูกต้อง');
    const token = () => decryptSecret(ch.accessTokenEncrypted, this.env.AUTH_SECRET);
    let linked = 0;
    for (const ev of body.events ?? []) {
      const lineUserId = ev.source?.userId; if (!lineUserId) continue;
      if (ev.type === 'unfollow') { await this.prisma.lineRecipient.updateMany({ where: { workspaceId: ch.workspaceId, lineUserId }, data: { active: false } }); continue; }
      if (ev.type === 'follow' && ev.replyToken) { await lineReply(token(), ev.replyToken, 'สวัสดีครับ 👋 ส่ง "รหัส 6 หลัก" จากหน้าตั้งค่าแจ้งเตือนในระบบ เพื่อเริ่มรับแจ้งเตือนทาง LINE'); continue; }
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      const m = (ev.message.text ?? '').match(/\b(\d{6})\b/); if (!m) continue;
      const code = await this.prisma.lineLinkCode.findFirst({ where: { workspaceId: ch.workspaceId, code: m[1], usedAt: null, expiresAt: { gt: new Date() } } });
      if (!code) { if (ev.replyToken) await lineReply(token(), ev.replyToken, 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว — กดสร้างรหัสใหม่ในระบบ (รหัสใช้ได้ 30 นาที)'); continue; }
      const [user, client] = await Promise.all([this.prisma.user.findUnique({ where: { id: code.userId }, select: { name: true } }), code.clientId ? this.prisma.client.findUnique({ where: { id: code.clientId }, select: { name: true } }) : null]);
      const existing = await this.prisma.lineRecipient.findFirst({ where: { workspaceId: ch.workspaceId, lineUserId, clientId: code.clientId }, select: { id: true } });
      if (existing) await this.prisma.lineRecipient.update({ where: { id: existing.id }, data: { active: true, userId: code.userId, displayName: user?.name ?? null } });
      else await this.prisma.lineRecipient.create({ data: { workspaceId: ch.workspaceId, lineUserId, userId: code.userId, clientId: code.clientId, displayName: user?.name ?? null } });
      await this.prisma.lineLinkCode.update({ where: { id: code.id }, data: { usedAt: new Date() } });
      linked++;
      if (ev.replyToken) await lineReply(token(), ev.replyToken, `✅ เชื่อมแจ้งเตือนแล้ว${client ? ` สำหรับ ${client.name}` : ''} — จะส่งเรื่องสำคัญมาทางนี้ครับ`);
    }
    return { ok: true, linked };
  }
}
