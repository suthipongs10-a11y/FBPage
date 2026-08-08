/**
 * Messenger Profile — Welcome Message, Ice Breakers, Persistent Menu (M2)
 *
 * สเปก:
 *   - "Welcome Message + Ice Breakers (คำถามยอดฮิต 4 ข้อที่โชว์ก่อนลูกค้าพิมพ์)
 *      ตั้งผ่าน Messenger Profile API"
 *   - "Persistent Menu ต่อเพจ"
 *
 * ตัวนี้คือสิ่งที่ลูกค้าเห็นก่อนพิมพ์ข้อความแรก — ตั้งดีๆ ช่วยลดคำถามซ้ำได้เยอะ
 * และ Ice Breakers ที่ตรงกับกฎชั้น 1 จะทำให้บอทตอบได้ทันทีโดยไม่ต้องแตะ LLM
 */
import type { MetaGateway } from "@page-os/meta";
import type { PageBotConfig } from "./types.js";
import { applyTone } from "./tone.js";

/** Meta จำกัด Ice Breakers ไว้ 4 ข้อ */
export const MAX_ICE_BREAKERS = 4;
/** ความยาวสูงสุดของคำถามแต่ละข้อ */
export const MAX_ICE_BREAKER_CHARS = 80;

export interface PersistentMenuItem {
  title: string;
  /** postback payload หรือ URL */
  payload?: string;
  url?: string;
}

export class ProfileConfigError extends Error {
  override readonly name = "ProfileConfigError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface ProfilePayload {
  greeting?: Array<{ locale: string; text: string }>;
  ice_breakers?: Array<{ question: string; payload: string }>;
  persistent_menu?: Array<{
    locale: string;
    composer_input_disabled: boolean;
    call_to_actions: MenuAction[];
  }>;
}

/** ปุ่มในเมนูถาวร — เป็นได้สองแบบเท่านั้นตามที่ Meta รองรับ */
export type MenuAction =
  | { type: "web_url"; title: string; url: string }
  | { type: "postback"; title: string; payload: string };

/**
 * ประกอบ payload สำหรับ Messenger Profile API
 *
 * ตรวจข้อจำกัดของ Meta เองก่อนยิง — ยิงไปให้โดนปฏิเสธแล้วมาไล่อ่าน error
 * เสียเวลากว่า และ error ของ Meta เรื่องนี้อ่านยากมาก
 */
export function buildProfilePayload(
  config: PageBotConfig,
  menu: readonly PersistentMenuItem[] = [],
): ProfilePayload {
  const payload: ProfilePayload = {};

  if (config.welcomeMessage) {
    payload.greeting = [
      { locale: "default", text: applyTone(config.welcomeMessage, config) },
    ];
  }

  if (config.iceBreakers && config.iceBreakers.length > 0) {
    if (config.iceBreakers.length > MAX_ICE_BREAKERS) {
      throw new ProfileConfigError(
        `too many ice breakers: ${config.iceBreakers.length}`,
        `Meta ให้ตั้งคำถามยอดฮิตได้สูงสุด ${MAX_ICE_BREAKERS} ข้อ แต่ตั้งไว้ ${config.iceBreakers.length} ข้อ`,
      );
    }
    for (const ib of config.iceBreakers) {
      if (ib.question.length > MAX_ICE_BREAKER_CHARS) {
        throw new ProfileConfigError(
          `ice breaker too long: ${ib.question.length}`,
          `คำถาม "${ib.question.slice(0, 20)}..." ยาวเกิน ${MAX_ICE_BREAKER_CHARS} ตัวอักษร`,
        );
      }
      if (ib.payload.trim() === "") {
        throw new ProfileConfigError(
          "ice breaker missing payload",
          `คำถาม "${ib.question}" ยังไม่ได้ตั้งค่า payload ว่าให้บอททำอะไรเมื่อลูกค้ากด`,
        );
      }
    }
    payload.ice_breakers = config.iceBreakers.map((ib) => ({
      question: applyTone(ib.question, config),
      payload: ib.payload,
    }));
  }

  if (menu.length > 0) {
    if (menu.length > 3) {
      throw new ProfileConfigError(
        `persistent menu too large: ${menu.length}`,
        `เมนูถาวรระดับบนสุดใส่ได้ 3 ปุ่ม แต่ใส่มา ${menu.length} ปุ่ม`,
      );
    }
    payload.persistent_menu = [
      {
        locale: "default",
        // ปล่อยให้พิมพ์ได้เสมอ — ปิดช่องพิมพ์ทำให้ลูกค้าที่อยากถามอย่างอื่นติดตัน
        composer_input_disabled: false,
        call_to_actions: menu.map((m): MenuAction => {
          if (m.url) {
            return { type: "web_url", title: m.title, url: m.url };
          }
          if (!m.payload) {
            throw new ProfileConfigError(
              `menu item "${m.title}" has neither payload nor url`,
              `ปุ่มเมนู "${m.title}" ต้องระบุ payload หรือ URL อย่างใดอย่างหนึ่ง`,
            );
          }
          return { type: "postback", title: m.title, payload: m.payload };
        }),
      },
    ];
  }

  return payload;
}

export class MessengerProfileService {
  constructor(private readonly gateway: MetaGateway) {}

  /** ตั้งค่าโปรไฟล์ของเพจ (ทำตอน onboarding และเมื่อแก้ค่า) */
  async apply(
    config: PageBotConfig,
    menu: readonly PersistentMenuItem[] = [],
  ): Promise<ProfilePayload> {
    const payload = buildProfilePayload(config, menu);
    if (Object.keys(payload).length === 0) return payload;

    await this.gateway.call({
      pageId: config.pageId,
      method: "POST",
      path: `${config.pageId}/messenger_profile`,
      priority: "normal",
      params: payload as Record<string, object>,
    });
    return payload;
  }

  /** อ่านค่าที่ตั้งไว้ปัจจุบัน — ใช้แสดงในหน้าตั้งค่า */
  async read(pageId: string): Promise<ProfilePayload> {
    const res = await this.gateway.call<{ data?: ProfilePayload[] }>({
      pageId,
      path: `${pageId}/messenger_profile`,
      priority: "low",
      params: { fields: "greeting,ice_breakers,persistent_menu" },
    });
    return res.data?.data?.[0] ?? {};
  }

  /** ลบค่าที่ตั้งไว้ (ใช้ตอนเลิกดูแลเพจ) */
  async clear(pageId: string): Promise<void> {
    await this.gateway.call({
      pageId,
      method: "DELETE",
      path: `${pageId}/messenger_profile`,
      priority: "normal",
      params: { fields: ["greeting", "ice_breakers", "persistent_menu"] },
    });
  }
}

/**
 * เสนอ Ice Breakers จากกฎชั้น 1 ที่เพจตั้งไว้
 *
 * เหตุผล: คำถามที่โชว์ควรเป็นคำถามที่บอท **ตอบได้แน่นอน**
 * ถ้าโชว์คำถามที่ต้องพึ่ง LLM ลูกค้ากดแล้วอาจได้ "รอสักครู่นะคะ" ตั้งแต่ข้อความแรก
 */
export function suggestIceBreakers(
  rules: ReadonlyArray<{ id: string; keywords?: string[]; priority: number }>,
  max = MAX_ICE_BREAKERS,
): Array<{ question: string; payload: string }> {
  return [...rules]
    .filter((r) => (r.keywords?.length ?? 0) > 0)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, max)
    .map((r) => ({
      question: r.keywords![0]!,
      payload: `RULE:${r.id}`,
    }));
}
