/**
 * Permission ที่ PAGE OS ต้องขอ (สเปกข้อ M0)
 *
 * สำคัญ: Meta ลาก permission พ่วงกันมา เช่น pages_manage_posts ต้องมี
 * pages_read_engagement + pages_show_list ด้วย → ต้องยื่นรีวิว "เป็นชุดเดียว"
 * ไม่ใช่ทีละตัว (สเปกข้อ 0)
 */

export const REQUIRED_PERMISSIONS = [
  "pages_show_list",
  "pages_read_engagement",
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

/** permission ที่พ่วงมาด้วยเสมอ — ใช้เช็คว่ายื่นรีวิวครบชุดหรือยัง */
export const PERMISSION_DEPENDENCIES: Record<string, string[]> = {
  pages_manage_posts: ["pages_read_engagement", "pages_show_list"],
  pages_manage_engagement: ["pages_read_engagement", "pages_show_list"],
  pages_manage_metadata: ["pages_show_list"],
  pages_messaging: ["pages_show_list"],
  pages_read_engagement: ["pages_show_list"],
  read_insights: ["pages_show_list"],
  instagram_basic: ["pages_show_list"],
  instagram_manage_messages: ["instagram_basic", "pages_show_list"],
  instagram_content_publish: ["instagram_basic", "pages_show_list"],
};

/** ฟีเจอร์ไหนต้องใช้ permission อะไร — ใช้บอกลูกค้าว่าอะไรยังใช้ไม่ได้ */
export const FEATURE_PERMISSIONS: Record<string, string[]> = {
  "M1 Unified Inbox": ["pages_messaging", "pages_read_engagement"],
  "M2 Chatbot": ["pages_messaging"],
  "M3 Comment Automation": ["pages_manage_engagement", "pages_read_engagement"],
  "M4 Publishing": ["pages_manage_posts"],
  "M5 IG Publishing": ["instagram_content_publish", "instagram_basic"],
  "M7 Analytics": ["read_insights", "pages_read_engagement"],
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
