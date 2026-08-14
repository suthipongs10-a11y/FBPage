/**
 * สัญญาณพฤติกรรมผิดปกติในคอมเมนต์ — "บัญชีจริง vs น่าสงสัย"
 *
 * ─── อ่านตรงนี้ก่อนแตะโค้ดนี้ ───
 *
 * ฟีเจอร์นี้ชี้นิ้วไปที่**คนจริง** ถ้าผิดพลาดคือกล่าวหาลูกค้าตัวจริงว่าเป็นบัญชีปลอม
 * ซึ่งเสียหายกว่าการไม่มีฟีเจอร์นี้เลย ทุกการตัดสินใจในไฟล์นี้จึงเอียงไปทาง
 * **"ไม่ชี้ดีกว่าชี้ผิด"** อย่างจงใจ
 *
 * สิ่งที่ไฟล์นี้ทำ: รายงาน**สิ่งที่สังเกตเห็นได้** พร้อมบอกว่าเห็นจากอะไร
 * สิ่งที่ไฟล์นี้ **ไม่ทำ**: ตัดสินว่าใครเป็นบอท — เพราะข้อมูลที่ Meta ให้มา
 * (ชื่อ, รหัสเฉพาะเพจ, ข้อความ, เวลา) ไม่พอจะสรุปแบบนั้นได้เลย
 *
 * ─── สัญญาณที่ใช้ และทำไมถึงใช้แค่นี้ ───
 *
 * | สัญญาณ | สังเกตจาก | ทำไมเชื่อได้ |
 * |---|---|---|
 * | ข้อความซ้ำเป๊ะจากคนหลายคน | ≥3 บัญชี ข้อความเดียวกัน **ภายใน 2 ชม.** | แคมเปญลงพร้อมกัน คนจริงกระจายเป็นวัน |
 * | คนเดิมพิมพ์ข้อความเดิมซ้ำ | ≥5 ครั้ง **ภายใน 1 ชม.** | ถามซ้ำเพราะไม่มีคนตอบ ไม่เร็วขนาดนี้ |
 * | คอมเมนต์รัวในเวลาสั้น | ≥5 คอมเมนต์ใน 60 วินาที | เร็วเกินกว่าคนพิมพ์เองไหว |
 *
 * **เงื่อนไขเวลาคือหัวใจ** — audit จับได้ว่าถ้าดูแค่ "ข้อความเหมือนกัน"
 * โดยไม่ดูเวลา จะติดธงคนจริง 212 จาก 400 คน เพราะคนไทยพิมพ์ประโยคสำเร็จรูป
 * เหมือนกันเป็นเรื่องปกติ
 *
 * ─── สิ่งที่จงใจ**ไม่**ใช้เป็นสัญญาณ ───
 *
 * - **ไม่มีชื่อ / ไม่มีรหัส** → นั่นคือการตั้งค่าความเป็นส่วนตัวของเจ้าตัว
 *   ไม่ใช่พฤติกรรมน่าสงสัย ถ้านับจะไปเหมาเอาคนที่หวงข้อมูลทั้งหมด
 * - **ชื่อดูแปลก / เป็นภาษาอังกฤษปนตัวเลข** → เดาจากชื่อคนคือการตัดสินคน
 *   จากสิ่งที่เขาเลือกไม่ได้ และอคติทางวัฒนธรรมสูงมาก
 * - **คอมเมนต์เยอะ** → นั่นคือแฟนตัวยง ไม่ใช่บอท
 */

/**
 * ความยาวขั้นต่ำที่ข้อความจะถูกนับว่า "ซ้ำ" ได้
 *
 * ⚠️ ตัวเลขนี้เคยตั้งไว้ที่ 15 แล้ว audit จับได้ว่า**ติดธงคนจริง 212 จาก 400 คน**
 * เพราะ 15 ตัวอักษรไทยคือแค่ 4–5 คำ ซึ่งประโยคทั่วไปที่คนละคนพิมพ์เหมือนกันจริงๆ
 * ("ของถึงแล้วค่ะ ขอบคุณมาก" · "สวยมากเลยค่ะ ชอบสีนี้") ยาวเท่านั้นพอดี
 *
 * 30 ตัวอักษรคือประโยคที่มีเนื้อหาจริง ไม่ใช่วลีสำเร็จรูป
 */
export const MIN_DUPLICATE_LENGTH = 30;

/** กี่คอมเมนต์ในกี่มิลลิวินาที ถึงเรียกว่ารัว */
export const BURST_COUNT = 5;
export const BURST_WINDOW_MS = 60_000;

/**
 * ข้อความเดียวกันต้องมาจากกี่บัญชี ถึงเรียกว่าประสานกัน
 *
 * ⚠️ เคยตั้งไว้ที่ 3 แล้ว audit เจอว่ายังลากคนจริงติดมา — คนสามคนบังเอิญพิมพ์
 * ประโยคเดียวกันในวันเดียวกันเกิดขึ้นได้จริงในเพจที่มีคนเยอะ
 *
 * และในเชิงความหมาย "แคมเปญ 3 บัญชี" ก็แทบไม่ใช่แคมเปญ — ถ้ามีแค่นั้นจริง
 * คนดูแลเพจอ่านคอมเมนต์เองก็เห็นอยู่แล้ว ไม่ต้องมีเครื่องมือมาบอก
 *
 * เลข 5 จึงเลือกตามหลัก "ไม่ชี้ดีกว่าชี้ผิด" ของไฟล์นี้ — ยอมพลาดแคมเปญเล็ก
 * เพื่อไม่ให้กล่าวหาลูกค้าตัวจริงแม้แต่คนเดียว
 */
export const COORDINATED_ACCOUNTS = 5;

/**
 * ...และต้องเกิดขึ้น**ใกล้กันในเวลา**ด้วย
 *
 * นี่คือเงื่อนไขที่ทำให้สัญญาณนี้เชื่อถือได้จริง ไม่ใช่แค่ความยาวข้อความ:
 * คนจริงที่บังเอิญพิมพ์ประโยคเหมือนกันจะกระจายกันเป็นวันเป็นสัปดาห์
 * ส่วนแคมเปญที่จ้างมาลงพร้อมกันภายในไม่กี่นาทีถึงไม่กี่ชั่วโมง
 *
 * audit ยืนยันว่าเงื่อนไขเวลาคือตัวที่ตัด false positive ได้จริง —
 * ลำพังความยาวอย่างเดียวยังลากคนจริงติดมาเพียบ
 */
export const COORDINATED_WINDOW_MS = 2 * 3_600_000;

/**
 * คนเดิมพิมพ์ข้อความเดิมกี่ครั้ง **ภายในกี่มิลลิวินาที** ถึงเรียกว่าซ้ำผิดปกติ
 *
 * ⚠️ เคยตั้งไว้ที่ "3 ครั้ง ไม่จำกัดเวลา" ซึ่งผิดชัดๆ — ลูกค้าจริงเอาคำถามเดิม
 * ไปถามใต้หลายโพสต์เป็นเรื่องปกติมาก ("สั่ง 2 ชิ้นค่ะ รบกวนทักกลับด้วยนะคะ")
 * ต้องมีเงื่อนไขเวลาถึงจะแยก "ถามซ้ำเพราะไม่มีใครตอบ" ออกจาก "สแปม" ได้
 */
export const SELF_REPEAT_TIMES = 5;
export const SELF_REPEAT_WINDOW_MS = 3_600_000;

export interface ScanComment {
  /** page-scoped id จาก Meta — `null` เมื่อคนคอมเมนต์ไม่ได้ให้สิทธิ์แอปเรา */
  authorId: string | null;
  authorName: string | null;
  message: string | null;
  createdAtMs: number;
  trackedPageId: string;
}

export type SignalKey = "coordinated" | "selfRepeat" | "burst";

export interface AccountSignal {
  key: SignalKey;
  labelTh: string;
  /** สิ่งที่เห็นจริงๆ พร้อมตัวเลข — ไม่ใช่ข้อสรุป */
  detailTh: string;
}

/**
 * ระดับ = **จำนวนสัญญาณอิสระที่พบ** ไม่ใช่คะแนนถ่วงน้ำหนักที่เสกขึ้นมา
 *
 * เลือกแบบนี้เพราะอธิบายให้คนฟังได้ตรงๆ ว่าทำไมถึงติดธง — น้ำหนักแบบ
 * "0.35 × A + 0.2 × B" อธิบายไม่ได้และไม่มีใครตรวจสอบได้ว่าตัวเลขมาจากไหน
 */
export type SuspicionLevel = "clear" | "watch" | "high";

export interface AccountFinding {
  /** ชื่อที่จะแสดง — บัญชีที่ไม่รู้ชื่อจะไม่ถูกรายงานเลย */
  name: string;
  comments: number;
  signals: AccountSignal[];
  level: SuspicionLevel;
}

export interface ScanResult {
  /** จำนวนบัญชีที่นับได้ (มีชื่อหรือรหัส) */
  accountsScanned: number;
  /** บัญชีที่พบสัญญาณอย่างน้อยหนึ่งอย่าง เรียงจากมากไปน้อย */
  flagged: AccountFinding[];
  /** สัดส่วนบัญชีที่ติดธง (0–100) */
  flaggedPct: number;
  /** คอมเมนต์ที่เอามาสแกนจริง */
  commentsScanned: number;
  /**
   * ข้อความที่หน้าจอ**ต้อง**แสดงคู่กับผลลัพธ์เสมอ
   * เพราะตัวเลขนี้ถูกอ่านผิดได้ง่ายมากว่าเป็นคำตัดสิน
   */
  caveatTh: string;
}

export const SCAN_CAVEAT_TH =
  "นี่คือ**สัญญาณ**ที่สังเกตเห็นจากรูปแบบการคอมเมนต์ ไม่ใช่คำตัดสินว่าเป็นบัญชีปลอม " +
  "คนจริงก็ติดธงได้ (เช่น ก๊อปข้อความเดิมไปตอบหลายโพสต์) — ให้เปิดดูคอมเมนต์จริง " +
  "ประกอบทุกครั้งก่อนสรุป และห้ามใช้เป็นหลักฐานเพียงอย่างเดียว";

/** normalize ข้อความก่อนเทียบว่าซ้ำ — ต่างกันแค่ช่องว่างถือว่าเหมือนกัน */
function normalizeMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * ข้อความนี้ยาวและมีเนื้อพอจะเอามานับว่า "ซ้ำ" ไหม
 *
 * ด่านนี้สำคัญที่สุดในไฟล์ — "❤️" "สนใจค่ะ" "cf 1" "ครับ" ถูกพิมพ์เป๊ะๆ
 * โดยคนจริงเป็นพันคนทุกวัน ถ้านับข้อความสั้นด้วย ทุกเพจจะขึ้นว่า
 * "80% ของบัญชีน่าสงสัย" ซึ่งไร้ประโยชน์และใส่ร้ายคนไปทั่ว
 */
function countsAsDuplicate(normalized: string): boolean {
  if (normalized.length < MIN_DUPLICATE_LENGTH) return false;
  // ต้องมีตัวอักษรจริง ไม่ใช่อิโมจิหรือเครื่องหมายล้วน
  return /[\p{L}\p{N}]/u.test(normalized);
}

interface Bucket {
  name: string;
  comments: ScanComment[];
}

/** คีย์ที่ใช้แทน "คนคนหนึ่ง" — รหัสก่อน ไม่มีค่อยใช้ชื่อ */
function personKey(c: ScanComment): string | null {
  return c.authorId ?? c.authorName;
}

/**
 * สแกนหาสัญญาณผิดปกติ
 *
 * คืนเฉพาะบัญชีที่พบสัญญาณ — บัญชีที่ปกติไม่ต้องอยู่ในผลลัพธ์ให้รก
 */
export function scanForSuspicion(comments: readonly ScanComment[]): ScanResult {
  // ── จัดคอมเมนต์เข้ากลุ่มของแต่ละคน ────────────────────────────────────
  const people = new Map<string, Bucket>();
  for (const c of comments) {
    const key = personKey(c);
    if (key === null) continue;
    const name = c.authorName;
    // ไม่รู้ชื่อ = เอาไปขึ้นจอไม่ได้ และรายงานว่า "บัญชีไม่ทราบชื่อน่าสงสัย" ก็ไร้ประโยชน์
    if (name === null || name.trim() === "") continue;

    const found = people.get(key);
    if (found === undefined) people.set(key, { name, comments: [c] });
    else found.comments.push(c);
  }

  // ── หา "กลุ่มที่ลงพร้อมกัน" ของแต่ละข้อความ ──────────────────────────
  /** ข้อความ → ครั้งที่ถูกพิมพ์ (ใครพิมพ์ เมื่อไหร่) */
  const byMessage = new Map<string, Array<{ person: string; atMs: number }>>();
  for (const [key, bucket] of people) {
    for (const c of bucket.comments) {
      if (c.message === null) continue;
      const norm = normalizeMessage(c.message);
      if (!countsAsDuplicate(norm)) continue;
      const list = byMessage.get(norm);
      if (list === undefined) byMessage.set(norm, [{ person: key, atMs: c.createdAtMs }]);
      else list.push({ person: key, atMs: c.createdAtMs });
    }
  }

  /**
   * ข้อความไหนเข้าข่าย "ประสานกัน" และมีใครร่วมบ้าง
   *
   * เงื่อนไขคือ ≥3 **บัญชีที่ต่างกัน** พิมพ์ข้อความเดียวกันภายในหน้าต่างเวลาเดียว
   * — ดูแค่ "กี่บัญชีทั้งหมด" ไม่พอ เพราะคนจริงที่พิมพ์ประโยคเหมือนกันตลอดเดือน
   * ก็นับได้เกิน 3 เหมือนกัน
   */
  const coordinatedGroups = new Map<string, { people: Set<string>; size: number }>();
  for (const [norm, events] of byMessage) {
    const cluster = maxDistinctInWindow(events, COORDINATED_WINDOW_MS);
    if (cluster.size >= COORDINATED_ACCOUNTS) {
      coordinatedGroups.set(norm, { people: cluster.people, size: cluster.size });
    }
  }

  const flagged: AccountFinding[] = [];

  for (const [key, bucket] of people) {
    const signals: AccountSignal[] = [];

    // ── 1. ร่วมอยู่ในกลุ่มที่ลงข้อความเดียวกันพร้อมกัน ──────────────────
    let sharedWith = 0;
    let sharedSample = "";
    for (const c of bucket.comments) {
      if (c.message === null) continue;
      const group = coordinatedGroups.get(normalizeMessage(c.message));
      // ต้องเป็นคนที่อยู่ใน**ช่วงเวลาที่กระจุกกัน**จริง ไม่ใช่แค่เคยพิมพ์ข้อความนี้
      if (group === undefined || !group.people.has(key)) continue;
      if (group.size > sharedWith) {
        sharedWith = group.size;
        sharedSample = c.message;
      }
    }
    if (sharedWith >= COORDINATED_ACCOUNTS) {
      const hours = Math.round(COORDINATED_WINDOW_MS / 3_600_000);
      signals.push({
        key: "coordinated",
        labelTh: "ข้อความเหมือนกันเป๊ะกับบัญชีอื่น",
        detailTh:
          `มี ${sharedWith} บัญชีพิมพ์ข้อความนี้เหมือนกันทุกตัวอักษรภายใน ${hours} ชม.: ` +
          `“${trim(sharedSample)}”`,
      });
    }

    // ── 2. คนเดิมพิมพ์ข้อความเดิมซ้ำรัวๆ ────────────────────────────────
    /** ข้อความของตัวเอง → เวลาที่พิมพ์แต่ละครั้ง */
    const ownTimes = new Map<string, number[]>();
    for (const c of bucket.comments) {
      if (c.message === null) continue;
      const norm = normalizeMessage(c.message);
      if (!countsAsDuplicate(norm)) continue;
      const list = ownTimes.get(norm);
      if (list === undefined) ownTimes.set(norm, [c.createdAtMs]);
      else list.push(c.createdAtMs);
    }
    let repeatMax = 0;
    let repeatSample = "";
    for (const [norm, times] of ownTimes) {
      const n = maxInWindow(times, SELF_REPEAT_WINDOW_MS);
      if (n > repeatMax) {
        repeatMax = n;
        repeatSample = norm;
      }
    }
    if (repeatMax >= SELF_REPEAT_TIMES) {
      const mins = Math.round(SELF_REPEAT_WINDOW_MS / 60_000);
      signals.push({
        key: "selfRepeat",
        labelTh: "พิมพ์ข้อความเดิมซ้ำหลายครั้ง",
        detailTh: `พิมพ์ข้อความเดิม ${repeatMax} ครั้งภายใน ${mins} นาที: “${trim(repeatSample)}”`,
      });
    }

    // ── 3. คอมเมนต์รัวในเวลาสั้น ────────────────────────────────────────
    const burst = maxInWindow(
      bucket.comments.map((c) => c.createdAtMs),
      BURST_WINDOW_MS,
    );
    if (burst >= BURST_COUNT) {
      signals.push({
        key: "burst",
        labelTh: "คอมเมนต์รัวในเวลาสั้น",
        detailTh: `${burst} คอมเมนต์ภายใน ${Math.round(BURST_WINDOW_MS / 1000)} วินาที`,
      });
    }

    if (signals.length === 0) continue;
    flagged.push({
      name: bucket.name,
      comments: bucket.comments.length,
      signals,
      // สองสัญญาณอิสระขึ้นไปถึงจะเรียกว่าเข้าข่ายชัด — หนึ่งอย่างคือ "น่าดูต่อ"
      level: signals.length >= 2 ? "high" : "watch",
    });
    void key;
  }

  flagged.sort(
    (a, b) =>
      b.signals.length - a.signals.length ||
      b.comments - a.comments ||
      a.name.localeCompare(b.name, "th"),
  );

  return {
    accountsScanned: people.size,
    flagged,
    flaggedPct: people.size === 0 ? 0 : (flagged.length / people.size) * 100,
    commentsScanned: comments.length,
    caveatTh: SCAN_CAVEAT_TH,
  };
}

/**
 * หาช่วงเวลาที่มี **บัญชีต่างกันมากที่สุด** พิมพ์ข้อความเดียวกัน
 *
 * ต่างจากการนับ "มีกี่บัญชีทั้งหมด" ตรงที่ต้องอยู่ในหน้าต่างเวลาเดียวกัน —
 * นี่คือสิ่งที่แยก "แคมเปญลงพร้อมกัน" ออกจาก "คนจริงพิมพ์ประโยคสำเร็จรูป
 * เหมือนกันกระจายทั้งเดือน" ซึ่ง audit พิสูจน์แล้วว่าเป็น false positive หลัก
 */
function maxDistinctInWindow(
  events: ReadonlyArray<{ person: string; atMs: number }>,
  windowMs: number,
): { size: number; people: Set<string> } {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const counts = new Map<string, number>();
  let best = { size: 0, people: new Set<string>() };
  let start = 0;

  for (let end = 0; end < sorted.length; end++) {
    const e = sorted[end] as { person: string; atMs: number };
    counts.set(e.person, (counts.get(e.person) ?? 0) + 1);

    while ((sorted[end] as { atMs: number }).atMs - (sorted[start] as { atMs: number }).atMs > windowMs) {
      const out = sorted[start] as { person: string };
      const left = (counts.get(out.person) ?? 1) - 1;
      if (left === 0) counts.delete(out.person);
      else counts.set(out.person, left);
      start++;
    }

    if (counts.size > best.size) {
      best = { size: counts.size, people: new Set(counts.keys()) };
    }
  }
  return best;
}

/** จำนวนสูงสุดที่อยู่ในหน้าต่างเวลาเดียวกัน — sliding window บนเวลาที่เรียงแล้ว */
function maxInWindow(times: readonly number[], windowMs: number): number {
  if (times.length === 0) return 0;
  const sorted = [...times].sort((a, b) => a - b);
  let best = 1;
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    // เลื่อนขอบซ้ายจนกว่าช่วงจะไม่เกินหน้าต่าง
    while ((sorted[end] as number) - (sorted[start] as number) > windowMs) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/** ตัดข้อความตัวอย่างให้สั้นพอใส่ในบรรทัดเดียว */
function trim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 60 ? clean : `${clean.slice(0, 60)}…`;
}
