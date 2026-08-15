/**
 * ด่านตรวจก่อนสั่งซ่อน/ลบคอมเมนต์ — ฟังก์ชันบริสุทธิ์ล้วน
 *
 * แยกจาก `server/moderate-comments.ts` เพราะไฟล์นั้นมี `import "server-only"`
 * ซึ่ง import เข้ามาในเทสต์ไม่ได้ — และตรรกะตรงนี้เป็นส่วนที่**ผิดแล้วเจ็บ**:
 * ปล่อยผ่านผิดคือยิงคำสั่งไปที่ช่องที่เราไม่มีสิทธิ์ ซึ่งเสียโควตา 50 หน่วย
 * ต่อครั้งโดยไม่มีอะไรเกิดขึ้น
 */
import type { TrackedPlatform } from "@page-os/listening";

export type ModerationAction = "hide" | "unhide" | "delete";

export interface ModerationGroup {
  channelName: string;
  platform: TrackedPlatform;
  owned: boolean;
}

export const VERB_TH: Record<ModerationAction, string> = {
  hide: "ซ่อน",
  unhide: "เอาการซ่อนออกจาก",
  delete: "ลบ",
};

/** สถานะที่จดลง DB หลังทำสำเร็จ — ตรงกับที่ YouTube ใช้ ยกเว้น `deleted` ที่เป็นของเรา */
export const STATUS_OF: Record<ModerationAction, string> = {
  hide: "rejected",
  unhide: "published",
  delete: "deleted",
};

/** แปลงค่าที่มาจากฟอร์มเป็น action ที่รู้จัก — ค่าแปลกๆ ตกไปที่ตัวที่ปลอดภัยที่สุด */
export function parseAction(raw: unknown): ModerationAction {
  const v = String(raw ?? "");
  /**
   * ค่าที่ไม่รู้จักตกไปที่ `hide` เพราะเป็นตัวเดียวในสามที่**ย้อนกลับได้**
   * — ถ้าตกไปที่ `delete` การส่งค่าเพี้ยนมาจะกลายเป็นลบถาวรโดยไม่ได้ตั้งใจ
   */
  return v === "unhide" || v === "delete" ? v : "hide";
}

/**
 * ตรวจว่าสั่งได้ไหม — คืนข้อความไทยเมื่อสั่งไม่ได้ คืน `null` เมื่อผ่าน
 *
 * ตรวจ**ก่อน**ยิงเสมอ ไม่ใช่ยิงแล้วรอให้ปฏิเสธ เพราะ call ที่โดนปฏิเสธก็
 * กินโควตา 50 หน่วยไปแล้วเหมือนกัน
 */
export function blockReasonTh(args: {
  groups: readonly ModerationGroup[];
  action: ModerationAction;
}): string | null {
  const verb = VERB_TH[args.action];

  if (args.groups.length === 0) {
    return "ไม่พบคอมเมนต์ที่เลือก — อาจถูกลบไปแล้ว ลองรีเฟรชหน้า";
  }

  /**
   * ฝั่ง Facebook มีตัวจัดการอยู่ใน `packages/moderation` ซึ่งต่อกับ Gateway
   * คนละตัวและยังไม่ได้ต่อเข้าหน้านี้ — บอกตรงๆ ดีกว่าปล่อยให้กดแล้วเงียบ
   */
  const fb = args.groups.find((g) => g.platform !== "YOUTUBE");
  if (fb !== undefined) {
    return (
      `ตอนนี้${verb}คอมเมนต์ได้เฉพาะฝั่ง YouTube — คอมเมนต์ที่เลือกมีของเพจ ` +
      `"${fb.channelName}" (Facebook) ปนอยู่ด้วย ` +
      "ให้เลือกเฉพาะคอมเมนต์ของช่อง YouTube ก่อน"
    );
  }

  const notOurs = args.groups.find((g) => !g.owned);
  if (notOurs !== undefined) {
    return (
      `${verb}คอมเมนต์บนช่อง "${notOurs.channelName}" ไม่ได้ — ` +
      "YouTube ให้จัดการคอมเมนต์ได้เฉพาะช่องที่เราเป็นเจ้าของ " +
      'ช่องนี้อยู่ในรายการแบบ "ช่องที่อยากส่อง" ซึ่งอ่านได้แต่แก้ไขไม่ได้'
    );
  }

  return null;
}

/** ตรวจว่าตั้งค่าครบพอจะสั่งได้ไหม — คืนข้อความไทยเมื่อยังขาด */
export function missingConfigTh(args: {
  hasApiKey: boolean;
  hasOAuth: boolean;
}): string | null {
  if (!args.hasApiKey) {
    return "ยังไม่ได้ตั้ง YOUTUBE_API_KEY ในไฟล์ .env — รัน pnpm configure แล้วใส่ค่า";
  }
  if (!args.hasOAuth) {
    return (
      "ยังเชื่อมบัญชี YouTube ไม่ครบ — การซ่อน/ลบคอมเมนต์ต้องใช้ OAuth " +
      "(API key อ่านได้อย่างเดียว) ต้องตั้ง YOUTUBE_OAUTH_CLIENT_ID, " +
      "YOUTUBE_OAUTH_CLIENT_SECRET และ YOUTUBE_OAUTH_REFRESH_TOKEN ในไฟล์ .env " +
      "โดยขอสิทธิ์ youtube.force-ssl"
    );
  }
  return null;
}
