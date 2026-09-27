/**
 * ดูแลคอมเมนต์อัตโนมัติ — ทุก 3 นาทีในโปรเซส API (ใช้ AI gateway ชุดเดียวกับการกดเอง) กันรันซ้อนด้วย Redis lock
 * เฉพาะเพจที่เปิดไว้ · workspace ที่กดหยุดฉุกเฉิน/เพจที่อ่านคอมเมนต์ไม่ได้ถูกข้าม · ปิดทั้งระบบด้วย COMMENT_AUTOMATION_ENABLED=false
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import type { PrismaClient } from '@fbpm/database';
import { PRISMA } from '../database/prisma.service';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { CommentsService } from './comments.service';

const TICK_MS = 3 * 60_000;
const LOCK_KEY = 'comment-automation:lock';

@Injectable()
export class CommentAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CommentAutomation');
  private timer: NodeJS.Timeout | null = null; private first: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CommentsService) private readonly comments: CommentsService,
  ) {}

  onModuleInit() {
    if (this.env.APP_ENV === 'test' || !this.env.COMMENT_AUTOMATION_ENABLED) return;
    const run = () => { void this.tick().catch(e => this.log.error(`tick ล้ม: ${(e as Error).message}`)); };
    this.first = setTimeout(run, 45_000); this.timer = setInterval(run, TICK_MS);
  }
  onModuleDestroy() { if (this.first) clearTimeout(this.first); if (this.timer) clearInterval(this.timer); }

  async tick() {
    const lockId = randomUUID();
    // Redis ของ API เป็น lazyConnect — ต้องเชื่อมก่อน ไม่งั้น SET ล้มเงียบ ๆ แล้วถูกมองว่า "มีรอบอื่นถือล็อก" ตลอดไป
    if (this.redis.status === 'wait') await this.redis.connect().catch(() => undefined);
    if ((await this.redis.set(LOCK_KEY, lockId, 'EX', 10 * 60, 'NX').catch(() => null)) !== 'OK') return { skipped: 'locked' as const, runs: [] };
    try {
      const rows = await this.prisma.commentAutomation.findMany({ where: { enabled: true, page: { disconnectedAt: null, tokenStatus: 'VALID', commentsStatus: { not: 'NO_PERMISSION' } }, workspace: { automationPaused: false } }, select: { workspaceId: true, pageId: true } });
      const runs: { pageId: string; ok: boolean; error?: string }[] = [];
      // ทีละเพจ — ไม่ยิง Graph/AI พร้อมกันหลายเพจ
      for (const r of rows) {
        try { await this.comments.runAutomation(r.workspaceId, r.pageId, `comment-auto-${Date.now()}`); runs.push({ pageId: r.pageId, ok: true }); }
        catch (e) { runs.push({ pageId: r.pageId, ok: false, error: (e as Error).message }); }
      }
      return { runs };
    } finally {
      if ((await this.redis.get(LOCK_KEY).catch(() => null)) === lockId) await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }
}
