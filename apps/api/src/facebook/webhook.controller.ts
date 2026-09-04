/**
 * Meta Webhooks (§14): ตรวจลายเซ็น → normalize เป็น SocialEvent → เข้าคิว → ตอบ 200 ทันที (ไม่รัน AI ในคำขอนี้)
 * ตั้งค่าในแอป Meta: Callback URL = <API_URL>/facebook/webhook, Verify token = META_WEBHOOK_VERIFY_TOKEN, subscribe fields: feed
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Query, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Queue } from 'bullmq';
import { JOBS, QUEUES, type SocialEvent } from '@fbpm/shared';
import { ENV, type Env } from '../config/env';

interface FeedChange { field: string; value: Record<string, unknown> }
interface Entry { id: string; time?: number; changes?: FeedChange[]; messaging?: { sender?: { id?: string }; message?: { text?: string } }[] }

export function normalizeWebhook(body: { object?: string; entry?: Entry[] }): SocialEvent[] {
  const out: SocialEvent[] = [];
  for (const e of body.entry ?? []) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      if (ch.field === 'feed' && v.item === 'comment' && (v.verb === 'add' || v.verb === 'edited')) {
        const from = v.from as { id?: string; name?: string } | undefined;
        out.push({ type: 'COMMENT_CREATED', facebookPageId: e.id, postId: (v.post_id as string) ?? null, commentId: String(v.comment_id), message: (v.message as string) ?? null, fromId: from?.id ?? null, fromName: from?.name ?? null, createdTime: new Date(Number(v.created_time ?? e.time ?? Date.now() / 1000) * 1000).toISOString() });
      } else if (ch.field === 'feed' && (v.item === 'post' || v.item === 'status' || v.item === 'photo' || v.item === 'video')) {
        out.push({ type: 'POST_UPDATED', facebookPageId: e.id, postId: String(v.post_id ?? ''), verb: String(v.verb ?? '') });
      } else out.push({ type: 'UNKNOWN', facebookPageId: e.id, field: ch.field, raw: v });
    }
    for (const m of e.messaging ?? []) out.push({ type: 'MESSAGE_RECEIVED', facebookPageId: e.id, senderId: m.sender?.id ?? '', text: m.message?.text ?? null });
  }
  return out;
}

export function verifySignature(appSecret: string, rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

@ApiTags('facebook')
@Controller('facebook/webhook')
export class WebhookController {
  private queue: Queue | null = null;
  constructor(@Inject(ENV) private readonly env: Env) {}
  private q(): Queue {
    if (!this.queue) { const u = new URL(this.env.REDIS_URL); this.queue = new Queue(QUEUES.facebookWebhook, { connection: { host: u.hostname, port: Number(u.port) || 6379, ...(u.password && { password: decodeURIComponent(u.password) }) } }); }
    return this.queue;
  }

  /** Meta ยืนยัน endpoint */
  @Get()
  verify(@Query('hub.mode') mode: string | undefined, @Query('hub.verify_token') token: string | undefined, @Query('hub.challenge') challenge: string | undefined, @Res() res: Response) {
    if (!this.env.META_WEBHOOK_VERIFY_TOKEN) throw new ServiceUnavailableException('ยังไม่ได้ตั้ง META_WEBHOOK_VERIFY_TOKEN');
    if (mode !== 'subscribe' || token !== this.env.META_WEBHOOK_VERIFY_TOKEN) throw new ForbiddenException('verify token ไม่ตรง');
    res.type('text/plain').send(challenge ?? '');
  }

  @Post() @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: { object?: string; entry?: Entry[] }) {
    if (!this.env.META_APP_SECRET) throw new ServiceUnavailableException('ยังไม่ได้ตั้ง META_APP_SECRET');
    if (!verifySignature(this.env.META_APP_SECRET, req.rawBody, req.headers['x-hub-signature-256'] as string | undefined)) throw new ForbiddenException('ลายเซ็นไม่ถูกต้อง');
    const events = normalizeWebhook(body);
    const q = this.q();
    await Promise.all(events.map((ev, i) => q.add(JOBS.webhookEvent, ev, { jobId: `wh-${ev.facebookPageId}-${'commentId' in ev ? ev.commentId : `${Date.now()}-${i}`}`.replace(/[^\w-]/g, '_'), attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000 })));
    return { received: events.length };
  }
}
