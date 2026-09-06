/** Email marketing core types (AGENTS_WEB.md W-4) — ไม่มี framework, ไม่มี SDK ผู้ให้บริการ (HTTP ล้วน) */
import type { EmailEventType, EmailProviderId } from '@fbpm/shared';

export class EmailError extends Error {
  constructor(message: string, public readonly code: 'auth' | 'network' | 'quota' | 'invalid' | 'blocked' | 'notFound' | 'unknown', public readonly httpStatus = 0) { super(message); this.name = 'EmailError'; }
}
export interface OutboundMessage {
  to: { email: string; name?: string | null }; from: { email: string; name: string }; replyTo?: string | null;
  subject: string; html: string; text: string;
  /** ส่งให้ผู้ให้บริการเป็น header/tag เพื่อโยง webhook กลับมาหาแคมเปญ (ไม่มีข้อมูลส่วนตัว) */
  campaignId: string; sendId: string; listUnsubscribeUrl: string;
}
export interface SendResult { messageId: string }
/** เหตุการณ์ที่ normalize แล้วจาก webhook ผู้ให้บริการ */
export interface NormalizedEvent { type: EmailEventType; email: string | null; providerMessageId: string | null; campaignId: string | null; sendId: string | null; occurredAt: Date; raw: unknown }
export interface ProviderAccountInfo { ok: boolean; accountEmail: string | null; detail: string | null }

export interface BulkMailProvider {
  readonly id: EmailProviderId;
  /** ตรวจว่า API key ใช้ได้ (อ่านอย่างเดียว) */
  verify(): Promise<ProviderAccountInfo>;
  send(msg: OutboundMessage): Promise<SendResult>;
  /** แปลง webhook payload → เหตุการณ์ (ตรวจลายเซ็นถ้ามี secret) — คืน [] เมื่อไม่รู้จัก */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string, secret: string | null): NormalizedEvent[];
}
export interface ProviderOptions { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }
