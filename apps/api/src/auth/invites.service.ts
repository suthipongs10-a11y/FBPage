/**
 * ลิงก์เชิญ + ลิงก์ตั้งรหัสใหม่ (ไม่ต้องมีระบบอีเมล — owner คัดลอกลิงก์ส่งทาง LINE) token อยู่ในลิงก์อย่างเดียว DB เก็บ sha256
 */
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Mailer, PrismaClient } from '@fbpm/database';
import { MAILER } from '../notifications/mailer.provider';
import type { WorkspaceRole } from '@fbpm/shared';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from './password';
import { AuthService, type SessionMeta } from './auth.service';
import type { AcceptInviteDto } from './dto';

const INVITE_TTL_MS = 7 * 86_400_000; const RESET_TTL_MS = 24 * 3_600_000;
/** ชื่อ workspace/ผู้ใช้เป็นข้อมูลที่ผู้ใช้กรอก — ต้อง escape ก่อนใส่ HTML ของอีเมล */
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

@Injectable()
export class InvitesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService, @Inject(AuthService) private readonly auth: AuthService, @Inject(MAILER) private readonly mailer: Mailer | null) {}

  async create(workspaceId: string, userId: string, role: WorkspaceRole, email: string | undefined, requestId: string) {
    if (role === 'owner') throw new BadRequestException('เชิญเป็น owner ไม่ได้');
    const token = newSessionToken();
    const inv = await this.prisma.workspaceInvite.create({ data: { workspaceId, email: email ?? null, role, tokenHash: hashToken(token), invitedById: userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) }, select: { id: true, role: true, email: true, expiresAt: true } });
    await this.audit.log({ workspaceId, userId, action: 'workspace.invite.create', resourceType: 'workspaceInvite', resourceId: inv.id, after: { role, email: email ?? null }, requestId });
    const url = `${this.env.APP_URL}/invite/${token}`;
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
    const emailed = email && this.mailer ? (await this.mailer.send({ to: email, subject: `คำเชิญเข้าร่วม ${ws?.name ?? 'workspace'}`, text: `คุณได้รับเชิญเข้าร่วม "${ws?.name}" ในบทบาท ${role}\n\nเปิดลิงก์เพื่อตอบรับ (ใช้ได้ 7 วัน ครั้งเดียว):\n${url}`, html: `<p>คุณได้รับเชิญเข้าร่วม <b>${esc(ws?.name)}</b> ในบทบาท <b>${esc(role)}</b></p><p><a href="${url}">ตอบรับคำเชิญ</a> (ใช้ได้ 7 วัน ครั้งเดียว)</p>` })).ok : false;
    return { ...inv, url, emailed };   // แสดงครั้งเดียว
  }
  list(workspaceId: string) {
    return this.prisma.workspaceInvite.findMany({ where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, role: true, email: true, expiresAt: true, createdAt: true } });
  }
  async revoke(workspaceId: string, userId: string, id: string, requestId: string) {
    const r = await this.prisma.workspaceInvite.deleteMany({ where: { id, workspaceId, acceptedAt: null } });
    if (!r.count) throw new NotFoundException('ไม่พบคำเชิญ');
    await this.audit.log({ workspaceId, userId, action: 'workspace.invite.revoke', resourceType: 'workspaceInvite', resourceId: id, requestId });
    return { ok: true };
  }

  private async valid(token: string) {
    const inv = await this.prisma.workspaceInvite.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, workspaceId: true, role: true, email: true, expiresAt: true, acceptedAt: true, workspace: { select: { name: true } } } });
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) return null;
    return inv;
  }
  async inspect(token: string) {
    const inv = await this.valid(token);
    if (!inv) return { valid: false as const };
    return { valid: true as const, workspaceName: inv.workspace.name, role: inv.role, email: inv.email };
  }

  /** รับคำเชิญ — ถ้าล็อกอินอยู่ใช้บัญชีนั้น ไม่งั้นต้องส่ง name+email+password เพื่อสร้างบัญชี (หรือ email+password ของบัญชีเดิม) */
  async accept(token: string, currentUserId: string | null, dto: AcceptInviteDto, meta: SessionMeta) {
    const inv = await this.valid(token);
    if (!inv) throw new NotFoundException('คำเชิญไม่ถูกต้องหรือหมดอายุ');
    let userId = currentUserId; let sessionToken: string | null = null;
    if (!userId) {
      if (!dto.email || !dto.password) throw new BadRequestException('ต้องระบุอีเมลและรหัสผ่าน');
      if (inv.email && inv.email !== dto.email) throw new BadRequestException('คำเชิญนี้ออกให้อีเมลอื่น');
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true, passwordHash: true, status: true } });
      if (existing) {
        if (existing.status !== 'ACTIVE' || !(await verifyPassword(dto.password, existing.passwordHash))) throw new UnauthorizedException('อีเมลนี้มีบัญชีอยู่แล้ว — รหัสผ่านไม่ถูกต้อง');
        userId = existing.id;
      } else {
        if (!dto.name) throw new BadRequestException('ต้องระบุชื่อ');
        userId = (await this.prisma.user.create({ data: { email: dto.email, name: dto.name, passwordHash: await hashPassword(dto.password) }, select: { id: true } })).id;
      }
      sessionToken = await this.auth.createSession(userId, meta);
    }
    const member = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } } }).catch(() => null);
    if (member) throw new ConflictException('คุณเป็นสมาชิก workspace นี้อยู่แล้ว');
    await this.prisma.$transaction([
      this.prisma.workspaceMember.create({ data: { workspaceId: inv.workspaceId, userId, role: inv.role } }),
      this.prisma.workspaceInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedById: userId } }),
    ]);
    await this.audit.log({ workspaceId: inv.workspaceId, userId, action: 'workspace.member.join', resourceType: 'workspaceMember', resourceId: userId, after: { role: inv.role, inviteId: inv.id }, requestId: meta.requestId });
    return { workspaceId: inv.workspaceId, workspaceName: inv.workspace.name, role: inv.role, token: sessionToken };
  }

  // ---------- ลิงก์ตั้งรหัสผ่านใหม่ (owner/admin สร้างให้สมาชิกใน workspace ของตน) ----------
  async createResetLink(workspaceId: string, adminId: string, targetUserId: string, requestId: string) {
    const member = await this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: targetUserId }, select: { role: true } });
    if (!member) throw new NotFoundException('ไม่พบสมาชิก');
    if (member.role === 'owner' && adminId !== targetUserId) throw new BadRequestException('สร้างลิงก์รีเซ็ตให้ owner ไม่ได้');
    const token = newSessionToken();
    const r = await this.prisma.passwordReset.create({ data: { userId: targetUserId, tokenHash: hashToken(token), createdById: adminId, expiresAt: new Date(Date.now() + RESET_TTL_MS) }, select: { id: true, expiresAt: true } });
    await this.audit.log({ workspaceId, userId: adminId, action: 'auth.reset.create', resourceType: 'user', resourceId: targetUserId, requestId });
    const url = `${this.env.APP_URL}/reset/${token}`;
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { email: true, name: true } });
    const emailed = target && this.mailer ? (await this.mailer.send({ to: target.email, subject: 'ลิงก์ตั้งรหัสผ่านใหม่', text: `สวัสดี ${target.name}\n\nผู้ดูแลสร้างลิงก์ตั้งรหัสผ่านใหม่ให้คุณ (ใช้ได้ 24 ชม. ครั้งเดียว):\n${url}`, html: `<p>สวัสดี ${esc(target.name)}</p><p>ผู้ดูแลสร้างลิงก์ตั้งรหัสผ่านใหม่ให้คุณ (ใช้ได้ 24 ชม. ครั้งเดียว)</p><p><a href="${url}">ตั้งรหัสผ่านใหม่</a></p>` })).ok : false;
    return { ...r, url, emailed };
  }
  /** ลืมรหัสผ่านด้วยตัวเอง — ตอบเหมือนกันเสมอ (ไม่เผยว่ามีอีเมลนี้ในระบบ) ส่งลิงก์ทางอีเมลเท่านั้น */
  async forgot(email: string, _requestId: string): Promise<{ ok: true; emailEnabled: boolean }> {
    if (!this.mailer) return { ok: true, emailEnabled: false };
    const u = await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (u) {
      const token = newSessionToken();
      await this.prisma.passwordReset.create({ data: { userId: u.id, tokenHash: hashToken(token), createdById: u.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
      const url = `${this.env.APP_URL}/reset/${token}`;
      await this.mailer.send({ to: email, subject: 'ตั้งรหัสผ่านใหม่ — AI Page Manager', text: `สวัสดี ${u.name}\n\nมีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีนี้ ถ้าไม่ใช่คุณให้เพิกเฉยอีเมลนี้\n\nลิงก์ (ใช้ได้ 24 ชม. ครั้งเดียว):\n${url}`, html: `<p>สวัสดี ${esc(u.name)}</p><p>มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีนี้ ถ้าไม่ใช่คุณให้เพิกเฉยอีเมลนี้</p><p><a href="${url}">ตั้งรหัสผ่านใหม่</a> (ใช้ได้ 24 ชม. ครั้งเดียว)</p>` });
    }
    return { ok: true, emailEnabled: true };
  }
  async inspectReset(token: string) {
    const r = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, select: { usedAt: true, expiresAt: true, user: { select: { email: true, name: true } } } });
    if (!r || r.usedAt || r.expiresAt.getTime() < Date.now()) return { valid: false as const };
    return { valid: true as const, email: r.user.email, name: r.user.name };
  }
  async resetPassword(token: string, password: string, meta: SessionMeta) {
    const r = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, userId: true, usedAt: true, expiresAt: true } });
    if (!r || r.usedAt || r.expiresAt.getTime() < Date.now()) throw new NotFoundException('ลิงก์ไม่ถูกต้องหรือหมดอายุ');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: r.userId }, data: { passwordHash: await hashPassword(password) } }),
      this.prisma.session.deleteMany({ where: { userId: r.userId } }),   // ออกจากทุกอุปกรณ์
      this.prisma.passwordReset.update({ where: { id: r.id }, data: { usedAt: new Date() } }),
    ]);
    const ws = await this.prisma.workspaceMember.findFirst({ where: { userId: r.userId }, select: { workspaceId: true } });
    if (ws) await this.audit.log({ workspaceId: ws.workspaceId, userId: r.userId, action: 'auth.reset.use', resourceType: 'user', resourceId: r.userId, requestId: meta.requestId });
    return { token: await this.auth.createSession(r.userId, meta) };
  }
  async changePassword(userId: string, current: string, next: string, requestId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await verifyPassword(current, u.passwordHash))) throw new UnauthorizedException('รหัสผ่านเดิมไม่ถูกต้อง');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    const ws = await this.prisma.workspaceMember.findFirst({ where: { userId }, select: { workspaceId: true } });
    if (ws) await this.audit.log({ workspaceId: ws.workspaceId, userId, action: 'auth.password.change', resourceType: 'user', resourceId: userId, requestId });
    return { ok: true };
  }
}
