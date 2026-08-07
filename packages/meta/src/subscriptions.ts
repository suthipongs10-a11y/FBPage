/**
 * Webhook subscription ต่อเพจ
 *
 * สเปกข้อ M0: หน้า Connection Status ต้องบอกได้ว่า "webhook subscribed หรือยัง"
 * และสเปกข้อ M1 กำหนดว่าต้อง subscribe field อะไรบ้าง
 *
 * ถ้าไม่ subscribe = ข้อความลูกค้าจะไม่เข้าระบบเลยทั้งที่ token ปกติดี
 * ซึ่งเป็นอาการที่หาสาเหตุยากที่สุดอันหนึ่ง จึงต้องตรวจให้เห็นตั้งแต่หน้าแรก
 */
import type { MetaGateway } from "./gateway.js";
import { MetaApiError } from "./errors.js";

/** field ที่ระบบต้องใช้ (สเปกข้อ M1) */
export const REQUIRED_WEBHOOK_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_reactions",
  "feed",
  "ratings",
] as const;

export interface WebhookSubscriptionStatus {
  pageId: string;
  subscribed: boolean;
  /** field ที่ subscribe ไว้จริง */
  fields: string[];
  /** field ที่ระบบต้องใช้แต่ยังไม่ได้ subscribe */
  missingFields: string[];
  ok: boolean;
  th: string;
}

export class SubscriptionService {
  constructor(private readonly gateway: MetaGateway) {}

  /** ดูว่าเพจนี้ subscribe webhook ไว้ครบไหม */
  async check(
    pageId: string,
    required: readonly string[] = REQUIRED_WEBHOOK_FIELDS,
  ): Promise<WebhookSubscriptionStatus> {
    let fields: string[] = [];
    let subscribed = false;

    try {
      const res = await this.gateway.call<{
        data?: Array<Record<string, unknown>>;
      }>({
        pageId,
        path: `${pageId}/subscribed_apps`,
        priority: "high",
        params: { fields: "subscribed_fields" },
      });

      const apps = res.data?.data ?? [];
      subscribed = apps.length > 0;
      for (const app of apps) {
        const f = app["subscribed_fields"];
        if (Array.isArray(f)) fields.push(...(f as string[]));
      }
      fields = [...new Set(fields)].sort();
    } catch (err) {
      const e = err instanceof MetaApiError ? err : undefined;
      return {
        pageId,
        subscribed: false,
        fields: [],
        missingFields: [...required],
        ok: false,
        th: e
          ? `ตรวจ webhook ไม่สำเร็จ: ${e.th}`
          : "ตรวจ webhook ไม่สำเร็จ — ดู log ประกอบ",
      };
    }

    const have = new Set(fields);
    const missingFields = required.filter((f) => !have.has(f));

    if (!subscribed) {
      return {
        pageId,
        subscribed: false,
        fields,
        missingFields: [...required],
        ok: false,
        th: "ยังไม่ได้ subscribe webhook — ข้อความและคอมเมนต์จะไม่เข้าระบบ กดปุ่มเชื่อม webhook ก่อน",
      };
    }
    if (missingFields.length > 0) {
      return {
        pageId,
        subscribed: true,
        fields,
        missingFields,
        ok: false,
        th: `subscribe webhook แล้ว แต่ยังขาด field: ${missingFields.join(", ")} — บางอย่างจะไม่เข้าระบบ`,
      };
    }
    return {
      pageId,
      subscribed: true,
      fields,
      missingFields: [],
      ok: true,
      th: "webhook ปกติ ครบทุก field",
    };
  }

  /** สั่ง subscribe (ใช้ตอน onboarding หรือกดซ่อมจากหน้า Connection Status) */
  async subscribe(
    pageId: string,
    fields: readonly string[] = REQUIRED_WEBHOOK_FIELDS,
  ): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "POST",
      path: `${pageId}/subscribed_apps`,
      priority: "high",
      params: { subscribed_fields: fields.join(",") },
    });
  }

  /** ยกเลิก (ใช้ตอนเลิกดูแลเพจ — ไม่งั้น webhook จะยิงมาเรื่อยๆ) */
  async unsubscribe(pageId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "DELETE",
      path: `${pageId}/subscribed_apps`,
      priority: "normal",
    });
  }
}
