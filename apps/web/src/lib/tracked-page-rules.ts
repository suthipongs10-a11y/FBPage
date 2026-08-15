/**
 * กฎการรับรหัสเพจ/ช่อง — ฟังก์ชันบริสุทธิ์ล้วน
 *
 * แยกออกมาจาก `server/tracked-pages.ts` เพราะไฟล์นั้นมี `import "server-only"`
 * ซึ่งทำให้ import เข้ามาในเทสต์ไม่ได้เลย — เป็นรูปแบบเดียวกับที่
 * `workspace-mapping.ts` แยกออกจาก `server/workspace.ts`
 *
 * ─── ทำไมต้องดักตั้งแต่ตอนกรอก ───
 *
 * ถ้าปล่อยรหัสผิดรูปผ่านเข้าไป จะไปรู้ตัวตอนรอบ cron แรกซึ่งอีกหลายชั่วโมง
 * ข้างหน้า และสิ่งที่เห็นในหน้าจอคือ "ไม่มีข้อมูล" ซึ่งแยกไม่ออกเลยจาก
 * "ยังไม่ถึงรอบดึง" — คนจะรอทั้งวันแล้วสรุปว่าระบบพัง
 */
import type { TrackedKind, TrackedPlatform, TrackedSource } from "@page-os/listening";

/**
 * ตรวจรูปแบบรหัสตามแพลตฟอร์ม — คืนข้อความไทยถ้าผิด คืน null ถ้าผ่าน
 *
 * ข้อความบอก**วิธีหาค่าที่ถูก** ไม่ใช่แค่บอกว่าผิด เพราะรหัสทั้งสองแบบ
 * หายากพอๆ กัน และคนที่หาไม่เจอจะเลิกใช้ไปเลย
 */
export function validateExternalId(
  platform: TrackedPlatform,
  externalId: string,
): string | null {
  if (externalId === "") {
    return platform === "YOUTUBE" ? "ยังไม่ได้ใส่รหัสช่อง" : "ยังไม่ได้ใส่รหัสเพจ";
  }

  if (platform === "FACEBOOK") {
    // รหัสเพจของ Facebook เป็นตัวเลขล้วนเสมอ — ดักคนที่วาง URL มาทั้งเส้น
    return /^\d+$/.test(externalId)
      ? null
      : "รหัสเพจ Facebook ต้องเป็นตัวเลขล้วน — ถ้าก๊อป URL มา ให้เอาเฉพาะตัวเลข " +
          "(หาได้จากหน้าเพจ → เกี่ยวกับ → ความโปร่งใสของเพจ → รหัสเพจ)";
  }

  /**
   * รหัสช่อง YouTube ขึ้นต้นด้วย `UC` และยาว 24 ตัวเสมอ
   *
   * คนมักหยิบ `@ชื่อช่อง` มาแทน เพราะนั่นคือสิ่งที่เห็นบน URL สมัยใหม่
   * — แต่ `channels.list` รับเฉพาะรหัส `UC...` การแปลง handle เป็นรหัสต้องยิง
   * API เพิ่มอีกครั้ง จึงบอกวิธีหาเองดีกว่า (ประหยัดโควตาด้วย)
   */
  if (externalId.startsWith("@")) {
    return (
      `"${externalId}" เป็นชื่อเรียกช่อง (handle) ไม่ใช่รหัสช่อง — ` +
      "เปิดหน้าช่องนั้น กด “เพิ่มเติม” ในส่วนข้อมูล แล้วดู “แชร์ช่อง → คัดลอกรหัสช่อง” " +
      "จะได้ค่าที่ขึ้นต้นด้วย UC"
    );
  }
  return /^UC[0-9A-Za-z_-]{22}$/.test(externalId)
    ? null
    : "รหัสช่อง YouTube ขึ้นต้นด้วย UC และยาว 24 ตัว — ที่ใส่มายาว " +
        `${externalId.length} ตัว (หาได้จากหน้าช่อง → เกี่ยวกับ → แชร์ช่อง → คัดลอกรหัสช่อง)`;
}

/**
 * แหล่งข้อมูลที่ควรตั้งให้ตอนเพิ่ม
 *
 * ─── ความต่างที่กำหนดกฎนี้ ───
 *
 * | | Facebook | YouTube |
 * |---|---|---|
 * | อ่านของ**ตัวเอง** | ต้องเชื่อม Page Access Token | แค่มี API key |
 * | อ่านของ**คนอื่น** | ต้องมีสิทธิ์ Page Public Content Access | แค่มี API key |
 *
 * เพจ Facebook ที่เราไม่ได้เป็นแอดมินจึงตั้งเป็น `EXTERNAL` — ถ้าตั้งเป็น
 * `META_API` ระบบจะยิงไปทุกชั่วโมงแล้วโดนปฏิเสธทุกชั่วโมง เปลืองโควตาที่ใช้
 * ร่วมกับงานที่ลูกค้ารออยู่จริง โดยไม่ได้ข้อมูลอะไรกลับมาเลย
 *
 * **ฝั่ง YouTube ไม่มีข้อจำกัดนี้เลย** ช่องคู่แข่งจึงเป็น `YOUTUBE_API`
 * ได้ทันทีเหมือนช่องของเราเอง
 */
export function sourceFor(args: {
  platform: TrackedPlatform;
  kind: TrackedKind;
}): TrackedSource {
  if (args.platform === "YOUTUBE") return "YOUTUBE_API";
  return args.kind === "OWNED" ? "META_API" : "EXTERNAL";
}

/** คำเรียกสิ่งที่กำลังพูดถึง — ใช้ประกอบข้อความให้อ่านแล้วไม่สะดุด */
export function nounTh(platform: TrackedPlatform): string {
  return platform === "YOUTUBE" ? "ช่อง" : "เพจ";
}
