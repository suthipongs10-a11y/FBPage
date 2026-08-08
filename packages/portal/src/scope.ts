/**
 * ขอบเขตที่ลูกค้าคนหนึ่งมองเห็นได้ (M9)
 *
 * สเปกเขียนสิ่งที่ห้ามเห็นไว้ชัดเจน: **"ไม่ให้เห็น: ต้นทุน, ลูกค้ารายอื่น, ค่า config บอท"**
 *
 * ⚠️ ไฟล์นี้คือไฟล์ที่ผิดแล้วจบธุรกิจ
 *
 * Client Portal เปิดให้คนนอกองค์กรเข้าถึงระบบเดียวกับที่เก็บข้อมูลลูกค้าทุกราย
 * ถ้าลูกค้า ก เห็นปฏิทินของลูกค้า ข แม้แค่ครั้งเดียว เอเจนซี่จบทั้งสองราย
 * และถ้าเห็นต้นทุนหรือ prompt ของบอท ก็เท่ากับยกวิธีทำงานให้ไปทำเองฟรีๆ
 *
 * วิธีที่ระบบแบบนี้รั่วในความเป็นจริงมีสองทางเสมอ:
 *   1. ลืมใส่เงื่อนไข workspace ในการ query สักที่หนึ่ง
 *   2. เอา id จาก URL ไปใช้ตรงๆ โดยไม่ตรวจว่าเป็นของคนที่ล็อกอินอยู่ (IDOR)
 *
 * จึงออกแบบให้ **สร้าง view ของ portal โดยไม่มี scope ไม่ได้** (ทุกฟังก์ชันรับ
 * `PortalScope` เป็นอาร์กิวเมนต์แรก) แล้วปิดท้ายด้วย `assertNoLeak()` ที่สแกน
 * ผลลัพธ์สุดท้ายอีกชั้น — เผื่อกรณีที่ลืมกรองในขั้นตอนกลาง
 */

export class PortalScopeError extends Error {
  override readonly name: string = "PortalScopeError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

/** ข้อมูลรั่วออกนอกขอบเขต — แยกชนิดไว้เพื่อให้ alert แยกความรุนแรงได้ */
export class PortalLeakError extends PortalScopeError {
  override readonly name = "PortalLeakError";
  readonly findings: LeakFinding[];
  constructor(findings: LeakFinding[]) {
    super(
      `portal leak: ${findings.map((f) => f.reason).join(",")}`,
      "ระบบตรวจพบข้อมูลที่ไม่ควรแสดงในหน้าลูกค้า จึงหยุดไว้ก่อน — ทีมงานได้รับแจ้งแล้ว",
    );
    this.findings = findings;
  }
}

export interface PortalPermissions {
  /** กดอนุมัติ/ขอแก้โพสต์ได้ */
  approve: boolean;
  /** ดูรายงานรายเดือนได้ */
  viewReports: boolean;
  /** ดูรายชื่อ lead ได้ */
  viewLeads: boolean;
}

export const DEFAULT_PERMISSIONS: PortalPermissions = {
  approve: true,
  viewReports: true,
  viewLeads: true,
};

export interface PortalScope {
  workspaceId: string;
  clientName: string;
  /**
   * เพจที่ session นี้เห็นได้
   *
   * คำนวณตอน **ออก session** ไม่ใช่ตอน query แต่ละครั้ง — ถ้าคำนวณตอน query
   * แปลว่ามีโอกาสที่บาง query จะลืมคำนวณ ซึ่งเป็นรูรั่วที่หาไม่เจอด้วยการอ่านโค้ด
   */
  pageIds: readonly string[];
  permissions: PortalPermissions;
  /** อีเมลที่ล็อกอินเข้ามา — ใช้บันทึก audit ว่าใครกดอนุมัติ */
  email: string;
}

export function inScope(scope: PortalScope, pageId: string): boolean {
  return scope.pageIds.includes(pageId);
}

/**
 * ตรวจว่าเพจนี้เป็นของลูกค้าที่ล็อกอินอยู่จริง
 *
 * ข้อความไทยจงใจไม่บอกว่า "เพจนี้เป็นของลูกค้ารายอื่น" — การบอกแบบนั้น
 * ยืนยันให้คนที่กำลังเดา id ว่าเดาถูก ("เพจนี้มีอยู่จริงแต่ไม่ใช่ของคุณ")
 * ตอบเหมือนกันทั้งกรณีไม่มีจริงและกรณีไม่ใช่ของเขา
 */
export function assertPageInScope(scope: PortalScope, pageId: string): void {
  if (!inScope(scope, pageId)) {
    throw new PortalScopeError(
      `page ${pageId} not in workspace ${scope.workspaceId}`,
      "ไม่พบเพจนี้ในบัญชีของคุณ",
    );
  }
}

export function assertCan(
  scope: PortalScope,
  what: keyof PortalPermissions,
): void {
  if (!scope.permissions[what]) {
    throw new PortalScopeError(
      `permission denied: ${what}`,
      "บัญชีของคุณไม่ได้เปิดสิทธิ์ส่วนนี้ไว้ — ติดต่อทีมงานถ้าต้องการใช้",
    );
  }
}

/** เก็บเฉพาะรายการที่อยู่ในขอบเขต — ใช้แทนการกรองเองทุกที่ */
export function onlyInScope<T extends { pageId: string }>(
  scope: PortalScope,
  rows: readonly T[],
): T[] {
  return rows.filter((r) => inScope(scope, r.pageId));
}

// ── ด่านสุดท้าย: สแกนผลลัพธ์ก่อนส่งออกจากเซิร์ฟเวอร์ ────────────────────────

export interface LeakFinding {
  path: string;
  reason: string;
  th: string;
}

/**
 * ชื่อฟิลด์ที่ห้ามหลุดไปหน้าลูกค้า
 *
 * มาจากสเปกตรงๆ ("ต้นทุน, ลูกค้ารายอื่น, ค่า config บอท") บวกของที่ชัดว่าเป็นความลับ
 * เทียบแบบ "ชื่อฟิลด์มีคำนี้อยู่" ไม่ใช่เท่ากันเป๊ะ เพราะของจริงมาในหลายชื่อ
 * (`cost`, `unitCost`, `costPerPost`) และ **ยอมจับผิดดีกว่าปล่อยผ่าน**
 */
export const FORBIDDEN_KEY_PATTERNS = [
  "cost",
  "margin",
  "ต้นทุน",
  "กำไร",
  "botconfig",
  "systemprompt",
  "knowledgebase",
  "toneprofile",
  "botflow",
  "token",
  "secret",
  "apikey",
  "encrypted",
  "internalnote",
] as const;

/**
 * ชื่อฟิลด์ที่ห้ามแบบตรงตัว
 *
 * แยกจากรายการ substring เพราะคำพวกนี้เป็นคำทั่วไปเกินกว่าจะเทียบแบบมีอยู่ในชื่อ
 * — `flow` จะไปโดน `cashflow`, `tone` จะไปโดน `milestone`
 * ถ้าเทียบหลวมเกินไป คนจะเริ่มปิดการตรวจแทนที่จะแก้ข้อมูล
 */
export const FORBIDDEN_EXACT_KEYS = new Set([
  "flow",
  "flows",
  "nodes",
  "tone",
  "prompt",
  "knowledge",
  "profit",
  "rate",
  "unitPrice",
  "clients",
  "workspaces",
]);

/** ฟิลด์ที่ชื่อมีคำต้องห้าม แต่ปลอดภัยจริงและจำเป็นต้องใช้ */
const ALLOWED_EXACT_KEYS = new Set([
  // สถานะโทเคนไม่ใช่ตัวโทเคน — ลูกค้าต้องเห็นว่า "ต้องกดเชื่อมเพจใหม่"
  "tokenState",
  "needsReconnect",
]);

function keyIsForbidden(key: string): string | null {
  if (ALLOWED_EXACT_KEYS.has(key)) return null;
  if (FORBIDDEN_EXACT_KEYS.has(key)) return `forbidden field "${key}"`;
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_PATTERNS.find((p) => lower.includes(p)) ?? null;
}

/** ชื่อฟิลด์ที่ถือว่าเป็นรหัสเพจ ต้องเช็คว่าอยู่ในขอบเขต */
const PAGE_ID_KEYS = new Set(["pageid", "page_id", "fbpageid", "fb_page_id"]);
const PAGE_ID_LIST_KEYS = new Set(["pageids", "page_ids"]);

/**
 * สแกนผลลัพธ์ก่อนส่งให้ลูกค้า
 *
 * นี่คือตาข่ายอันสุดท้าย ไม่ใช่ด่านแรก — ด่านแรกคือการกรองด้วย `onlyInScope()`
 * ตั้งแต่ต้นทาง ตัวนี้มีไว้จับกรณีที่คนเขียนโค้ดใหม่ลืมกรอง ซึ่งจะเกิดขึ้นแน่นอน
 * เมื่อมีคนมาแก้โค้ดนี้ในอีกหกเดือน
 */
export function findLeaks(payload: unknown, scope: PortalScope): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    // กันวัตถุที่อ้างถึงตัวเองจนวนไม่รู้จบ
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const here = path === "" ? key : `${path}.${key}`;
      const lower = key.toLowerCase();

      const forbidden = keyIsForbidden(key);
      if (forbidden !== null) {
        findings.push({
          path: here,
          reason: `forbidden key (${forbidden})`,
          th: `ฟิลด์ "${key}" เป็นข้อมูลภายใน ห้ามแสดงในหน้าลูกค้า`,
        });
      }

      if (PAGE_ID_KEYS.has(lower) && typeof value === "string") {
        if (!inScope(scope, value)) {
          findings.push({
            path: here,
            reason: "page out of scope",
            th: "มีรหัสเพจที่ไม่ใช่ของลูกค้ารายนี้ปนอยู่ในข้อมูล",
          });
        }
      }

      if (PAGE_ID_LIST_KEYS.has(lower) && Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === "string" && !inScope(scope, v)) {
            findings.push({
              path: here,
              reason: "page out of scope",
              th: "มีรหัสเพจที่ไม่ใช่ของลูกค้ารายนี้ปนอยู่ในข้อมูล",
            });
          }
        }
      }

      if (
        lower === "workspaceid" &&
        typeof value === "string" &&
        value !== scope.workspaceId
      ) {
        findings.push({
          path: here,
          reason: "workspace mismatch",
          th: "มีข้อมูลของบัญชีอื่นปนอยู่",
        });
      }

      walk(value, here);
    }
  };

  walk(payload, "");
  return findings;
}

/** เจอข้อมูลรั่ว = ไม่ส่งอะไรออกไปเลย ไม่ใช่ส่งบางส่วน */
export function assertNoLeak(payload: unknown, scope: PortalScope): void {
  const findings = findLeaks(payload, scope);
  if (findings.length > 0) throw new PortalLeakError(findings);
}
