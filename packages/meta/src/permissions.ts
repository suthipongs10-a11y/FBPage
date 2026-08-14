/**
 * Permission ที่ PAGE OS ต้องขอ (สเปกข้อ M0)
 *
 * สำคัญ: Meta ลาก permission พ่วงกันมา เช่น pages_manage_posts ต้องมี
 * pages_read_engagement + pages_show_list ด้วย → ต้องยื่นรีวิว "เป็นชุดเดียว"
 * ไม่ใช่ทีละตัว (สเปกข้อ 0)
 *
 * ─── ⚠️ สองตัวที่ชื่อคล้ายกันจนสลับกันได้ง่าย ───
 *
 * | permission | ให้อ่านอะไร |
 * |---|---|
 * | `pages_read_engagement` | เนื้อหาที่**เพจเขียนเอง** + ตัวเลข (ไลก์ ผู้ติดตาม ยอด engagement) |
 * | `pages_read_user_content` | เนื้อหาที่**คนอื่นเขียน** — คอมเมนต์ โพสต์ของผู้มาเยือน เรตติ้ง |
 *
 * เคยมีแค่ตัวแรก แล้วคิดว่าอ่านคอมเมนต์ได้ — **ไม่ได้** จะได้ array ว่าง
 * กลับมาโดยไม่มี error ให้เห็น ซึ่งเป็นอาการที่ไล่หาสาเหตุยากที่สุด
 * และกว่าจะรู้ก็ต้องยื่นรีวิวใหม่ทั้งชุด รอบละหลายสัปดาห์
 *
 * ทั้งโมดูลอ่านคอมเมนต์ (M3, M-K) และตัวซ่อน/ลบคอมเมนต์อัตโนมัติ
 * พึ่ง `pages_read_user_content` ทั้งหมด
 */

export const REQUIRED_PERMISSIONS = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_content_publish",
] as const;

export type RequiredPermission = (typeof REQUIRED_PERMISSIONS)[number];

/**
 * permission ที่พ่วงมาด้วยเสมอ — ใช้เช็คว่ายื่นรีวิวครบชุดหรือยัง
 *
 * ตรงนี้เลือก **ขอเผื่อไว้** เมื่อไม่แน่ใจ เพราะราคาของสองทางไม่เท่ากันเลย:
 * ขอเกินหนึ่งตัว = อธิบายเพิ่มอีกย่อหน้าในใบรีวิวชุดเดิม
 * ขอขาดหนึ่งตัว = ฟีเจอร์ตายเงียบ แล้วต้องยื่นใหม่ทั้งชุด รอบละหลายสัปดาห์
 */
export const PERMISSION_DEPENDENCIES: Record<string, string[]> = {
  pages_manage_posts: ["pages_read_engagement", "pages_show_list"],
  /**
   * ซ่อน/ลบ/ตอบคอมเมนต์ ต้องอ่านคอมเมนต์ให้ออกก่อน — ซึ่งเป็นงานของ
   * `pages_read_user_content` ไม่ใช่ `pages_read_engagement`
   */
  pages_manage_engagement: [
    "pages_read_user_content",
    "pages_read_engagement",
    "pages_show_list",
  ],
  pages_manage_metadata: ["pages_show_list"],
  pages_messaging: ["pages_show_list"],
  pages_read_engagement: ["pages_show_list"],
  pages_read_user_content: ["pages_show_list"],
  read_insights: ["pages_show_list"],
  instagram_basic: ["pages_show_list"],
  instagram_manage_messages: ["instagram_basic", "pages_show_list"],
  instagram_content_publish: ["instagram_basic", "pages_show_list"],
};

/**
 * ฟีเจอร์ไหนต้องใช้ permission อะไร — ใช้บอกลูกค้าว่าอะไรยังใช้ไม่ได้
 *
 * ตารางนี้คือสิ่งที่ทำให้หน้า Connection Status บอกได้ว่า "อ่านคอมเมนต์ไม่ได้
 * เพราะขาดสิทธิ์ตัวไหน" แทนที่จะปล่อยให้เจอ array ว่างแล้วเดาเอาเอง
 */
export const FEATURE_PERMISSIONS: Record<string, string[]> = {
  "M1 Unified Inbox": ["pages_messaging", "pages_read_engagement"],
  "M2 Chatbot": ["pages_messaging"],
  "M3 Comment Automation": [
    "pages_manage_engagement",
    "pages_read_user_content",
  ],
  "M4 Publishing": ["pages_manage_posts"],
  "M5 IG Publishing": ["instagram_content_publish", "instagram_basic"],
  "M7 Analytics": ["read_insights", "pages_read_engagement"],
  /**
   * โมดูลฟังเสียง — อ่านคอมเมนต์ จัดหมวด หาแฟนตัวยง สแกนบัญชีน่าสงสัย
   *
   * ต้องมีทั้งคู่: `pages_read_user_content` ให้**ตัวข้อความคอมเมนต์**
   * ส่วน `pages_read_engagement` ให้**ยอดของโพสต์** (รีแอ็กชัน แชร์)
   * ที่เอาไปคิด engagement กับส่วนแบ่งเสียง
   */
  "M-K ฟังเสียง / อ่านคอมเมนต์": [
    "pages_read_user_content",
    "pages_read_engagement",
  ],
};

export interface PermissionGap {
  missing: string[];
  /** ฟีเจอร์ที่ใช้ไม่ได้เพราะ permission ขาด */
  blockedFeatures: string[];
  ok: boolean;
}

/** เทียบ scope ที่ token มีจริง กับที่ระบบต้องการ */
export function checkPermissions(
  granted: readonly string[],
  required: readonly string[] = REQUIRED_PERMISSIONS,
): PermissionGap {
  const have = new Set(granted);
  const missing = required.filter((p) => !have.has(p));
  const blockedFeatures = Object.entries(FEATURE_PERMISSIONS)
    .filter(([, needs]) => needs.some((n) => !have.has(n)))
    .map(([feature]) => feature);
  return { missing, blockedFeatures, ok: missing.length === 0 };
}

/** ขยาย permission ที่ขอ ให้รวมตัวที่พ่วงมาด้วย (กันยื่นรีวิวไม่ครบ) */
export function expandWithDependencies(
  requested: readonly string[],
): string[] {
  const out = new Set<string>();
  const visit = (p: string): void => {
    if (out.has(p)) return;
    out.add(p);
    for (const dep of PERMISSION_DEPENDENCIES[p] ?? []) visit(dep);
  };
  for (const p of requested) visit(p);
  return [...out].sort();
}

/** scope string สำหรับใส่ใน OAuth dialog */
export function oauthScopeString(
  permissions: readonly string[] = REQUIRED_PERMISSIONS,
): string {
  return expandWithDependencies(permissions).join(",");
}

/**
 * เตือนเรื่องสิทธิ์ที่ขาด — คืน `undefined` เมื่อครบ
 *
 * ─── ทำไมต้องเตือนตรงนี้ ไม่ใช่ปล่อยให้ไปเจอเอง ───
 *
 * token จาก Graph API Explorer ติ๊กสิทธิ์มาไม่ครบเป็นเรื่องปกติมาก
 * โดยเฉพาะ `pages_read_user_content` ที่ต้องเลื่อนหาในรายการยาวเหยียด
 *
 * ถ้าไม่เตือน สิ่งที่เกิดคือ: เชื่อมสำเร็จ → เห็นคำว่า "เรียบร้อย" → เปิดหน้า
 * อ่านคอมเมนต์ → **เห็นศูนย์** → นึกว่าเพจไม่มีคนคอมเมนต์ หรือนึกว่าโปรแกรมพัง
 * เพราะ Meta ไม่ได้โยน error ออกมา มันคืน array ว่างเฉยๆ
 */
export function describeMissingScopesTh(granted: readonly string[]): string | undefined {
  const gap = checkPermissions(granted);
  if (gap.ok) return undefined;

  const features =
    gap.blockedFeatures.length > 0
      ? ` — ฟีเจอร์ที่จะยังใช้ไม่ได้: ${gap.blockedFeatures.join(" · ")}`
      : "";
  return (
    `token นี้ขาดสิทธิ์ ${gap.missing.join(", ")}${features} ` +
    `(ระบบจะไม่ขึ้น error แต่จะได้ข้อมูลว่างเปล่ากลับมา) — ` +
    `ถ้าเอา token มาจาก Graph API Explorer ให้ติ๊กสิทธิ์ที่ขาดแล้วสร้างใหม่`
  );
}
