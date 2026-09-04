import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaClient } from '@fbpm/database';
import { pageInWorkspace } from '@fbpm/database';
import { PageNotSyncable, loadPageToken, syncPage, type FacebookService, type SyncDeps, type SyncPageResult } from '@fbpm/facebook-core';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { FACEBOOK } from './facebook.provider';
import { rethrowGraph } from './graph-errors';
import { NotificationsService } from '../notifications/notifications.service';

export type SyncResult = SyncPageResult;

/** ห่อ syncPage ของ facebook-core ด้วยการตรวจ tenant (§57) และแปลง error เป็น HTTP (§59) */
@Injectable()
export class SyncService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FACEBOOK) private readonly fb: FacebookService,
    @Inject(ENV) private readonly env: Env,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  get deps(): SyncDeps { return { prisma: this.prisma, fb: this.fb, authSecret: this.env.AUTH_SECRET, apiVersion: this.env.META_GRAPH_API_VERSION }; }

  private async assertPage(workspaceId: string, pageId: string): Promise<void> {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, ...pageInWorkspace(workspaceId) }, select: { id: true } });
    if (!page) throw new NotFoundException('ไม่พบเพจ');
  }

  async pageToken(workspaceId: string, pageId: string): Promise<{ id: string; facebookPageId: string; token: string }> {
    await this.assertPage(workspaceId, pageId);
    try { return await loadPageToken(this.deps, pageId); }
    catch (e) { if (e instanceof PageNotSyncable) throw new UnprocessableEntityException(e.message); throw e; }
  }

  async syncPage(workspaceId: string, pageId: string, opts: { days?: number; limit?: number } = {}): Promise<SyncResult> {
    await this.assertPage(workspaceId, pageId);
    try { return await syncPage(this.deps, pageId, opts); }
    catch (e) {
      if (e instanceof PageNotSyncable) throw new UnprocessableEntityException(e.message);
      const p = await this.prisma.facebookPage.findUnique({ where: { id: pageId }, select: { name: true, tokenStatus: true } });
      if (p?.tokenStatus === 'INVALID') await this.notifications.notify(workspaceId, { type: 'reconnect_required', severity: 'bad', title: `เพจ ${p.name} ต้องเชื่อมต่อใหม่`, body: 'token ของเพจใช้ไม่ได้แล้ว — วาง token ใหม่ในหน้าเพจ', href: '/pages', resourceType: 'facebookPage', resourceId: pageId, dedupeKey: `token:${pageId}` });
      rethrowGraph(e);
    }
  }
}
