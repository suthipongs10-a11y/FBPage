/**
 * ตัวเทียบเพจ/ช่อง — ฟังก์ชันบริสุทธิ์ล้วน ไม่แตะฐานข้อมูล
 *
 * แยกออกมาจาก `server/insights.ts` เพราะไฟล์นั้นมี `import "server-only"`
 * ซึ่งทำให้ import เข้ามาในเทสต์ไม่ได้ — รูปแบบเดียวกับ `workspace-mapping.ts`
 * และ `tracked-page-rules.ts`
 */
import { compareGap, compareWithStrongest, type GapResult, type GapSide } from "@page-os/listening";
import type { PageInsight } from "@/lib/server/insights";

/** แปลง `PageInsight` เป็นรูปที่ตัวเทียบช่องว่างรับ */
export function toGapSide(p: PageInsight): GapSide {
  return {
    pageId: p.id,
    pageName: p.name,
    posts: p.posts,
    followers: p.followers ?? 0,
    engagement: p.engagement,
  };
}

/**
 * เทียบเพจของเรากับคู่แข่งที่แรงที่สุด**ในแพลตฟอร์มเดียวกัน**
 *
 * "เพจของเรา" = เพจที่ `kind === "OWNED"` ตัวแรก ถ้าไม่ได้ระบุมา — คนที่ยังไม่เคย
 * ตั้งค่าอะไรเลยจะได้เห็นของที่มีความหมายทันทีโดยไม่ต้องเลือกก่อน
 *
 * ─── ทำไมต้องกรองแพลตฟอร์มก่อนเทียบ ───
 *
 * `engagement` = รีแอ็กชัน + **แชร์** + คอมเมนต์ แต่ YouTube **ไม่มีตัวเลข
 * การแชร์ให้เลย** (เก็บเป็น 0 เสมอ) ช่อง YouTube จึงขาดองค์ประกอบทั้งก้อน
 * ที่เพจ Facebook มี — เทียบข้ามฝั่งแล้วช่อง YouTube จะดูแย่กว่าความจริงเสมอ
 * โดยที่ตัวเลขบนหน้าจอไม่มีอะไรบอกว่าเทียบกันไม่ได้
 *
 * (ตรงกันข้าม YouTube มียอดวิวที่ Facebook ไม่มี — ไม่ใช่ว่าฝั่งไหนดีกว่า
 * แต่คือ**คนละหน่วยวัด** เอามาลบกันไม่ได้ตั้งแต่ต้น)
 */
export function gapAgainstStrongest(args: {
  pages: PageInsight[];
  ourPageId?: string | undefined;
}): { ours: PageInsight | null; result: GapResult } {
  const ours =
    args.pages.find((p) => p.id === args.ourPageId) ??
    args.pages.find((p) => p.kind === "OWNED") ??
    null;

  if (ours === null) {
    return {
      ours: null,
      result: {
        ok: false,
        reasonTh: 'ยังไม่ได้บอกว่าเพจไหนเป็นของเรา — เพิ่มเพจแบบ "เพจของเรา" ก่อน',
      },
    };
  }

  const samePlatform = args.pages.filter((p) => p.platform === ours.platform);

  return {
    ours,
    result: compareWithStrongest({
      ours: toGapSide(ours),
      others: samePlatform.map(toGapSide),
    }),
  };
}

/** มีทั้งเพจ Facebook และช่อง YouTube ปนกันอยู่ไหม — หน้าจอต้องบอกเมื่อมี */
export function hasMixedPlatforms(pages: readonly PageInsight[]): boolean {
  return (
    pages.some((p) => p.platform === "FACEBOOK") &&
    pages.some((p) => p.platform === "YOUTUBE")
  );
}

/**
 * เทียบสองเพจที่เลือกมาเอง
 *
 * ถ้าเลือกข้ามแพลตฟอร์มจะ**ปฏิเสธ** ไม่ใช่คำนวณให้แล้วเติมคำเตือนตัวเล็กๆ —
 * ตัวเลขที่เทียบกันไม่ได้ตั้งแต่ต้นไม่ควรถูกแสดงเลย เพราะคนอ่านจะจำตัวเลข
 * ไปมากกว่าจำคำเตือน (ดูเหตุผลเต็มที่ `gapAgainstStrongest`)
 */
export function gapBetween(args: {
  pages: PageInsight[];
  ourId: string;
  theirId: string;
}): GapResult {
  const ours = args.pages.find((p) => p.id === args.ourId);
  const theirs = args.pages.find((p) => p.id === args.theirId);
  if (ours === undefined || theirs === undefined) {
    return { ok: false, reasonTh: "ไม่พบเพจที่เลือก — อาจถูกเอาออกจากระบบไปแล้ว" };
  }
  if (ours.platform !== theirs.platform) {
    return {
      ok: false,
      reasonTh:
        "เทียบข้ามแพลตฟอร์มไม่ได้ — YouTube ไม่มีตัวเลขการแชร์ ส่วน Facebook ไม่มียอดวิว " +
        "ตัวเลข engagement ของสองฝั่งจึงประกอบขึ้นจากคนละอย่าง เอามาลบกันแล้วไม่มีความหมาย " +
        "เลือกให้เป็นแพลตฟอร์มเดียวกันทั้งคู่ก่อน",
    };
  }
  return compareGap({ ours: toGapSide(ours), theirs: toGapSide(theirs) });
}
