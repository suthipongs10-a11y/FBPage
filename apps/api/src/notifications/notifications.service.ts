/** Notification service (§65) — in-app + webhook ภายนอก; domain code เรียก notify() เท่านั้น */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { dispatchWebhook, encryptSecret, notify, type NotifyInput } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';

const SELECT = { id: true, type: true, severity: true, title: true, body: true, href: true, resourceType: true, resourceId: true, readAt: true, createdAt: true } as const;

@Injectable()
export class NotificationsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService) {}

  notify(workspaceId: string, input: NotifyInput) { return notify(this.prisma, this.env.AUTH_SECRET, workspaceId, input).catch(() => ({ id: '', created: false })); }

  async list(workspaceId: string, unreadOnly = false, limit = 50) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { workspaceId, ...(unreadOnly && { readAt: null }) }, orderBy: { createdAt: 'desc' }, take: Math.min(200, limit), select: SELECT }),
      this.prisma.notification.count({ where: { workspaceId, readAt: null } }),
    ]);
    return { items, unread };
  }
  async markRead(workspaceId: string, id: string) {
    const r = await this.prisma.notification.updateMany({ where: { id, workspaceId }, data: { readAt: new Date() } });
    if (!r.count) throw new NotFoundException('ไม่พบการแจ้งเตือน');
    return { ok: true };
  }
  async markAllRead(workspaceId: string) { const r = await this.prisma.notification.updateMany({ where: { workspaceId, readAt: null }, data: { readAt: new Date() } }); return { ok: true, count: r.count }; }

  async webhookSettings(workspaceId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { notifyWebhookHint: true, notifyWebhookEncrypted: true } });
    return { configured: !!ws.notifyWebhookEncrypted, hint: ws.notifyWebhookHint };
  }
  async setWebhook(workspaceId: string, userId: string, url: string | null, requestId: string) {
    let hint: string | null = null;
    if (url) { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new NotFoundException('ต้องเป็น http(s) URL'); hint = `${u.host}${u.pathname.slice(0, 12)}…`; }
    await this.prisma.workspace.update({ where: { id: workspaceId }, data: { notifyWebhookEncrypted: url ? encryptSecret(url, this.env.AUTH_SECRET) : null, notifyWebhookHint: hint } });
    await this.audit.log({ workspaceId, userId, action: url ? 'notifications.webhook.set' : 'notifications.webhook.remove', resourceType: 'workspace', resourceId: workspaceId, after: { hint }, requestId });
    return { configured: !!url, hint };
  }
  async testWebhook(workspaceId: string) {
    const ok = await dispatchWebhook(this.prisma, this.env.AUTH_SECRET, workspaceId, { type: 'info', title: 'ทดสอบการแจ้งเตือนจาก Facebook AI Page Manager', body: 'ถ้าเห็นข้อความนี้ แปลว่า webhook ใช้งานได้' });
    return { ok };
  }
}
