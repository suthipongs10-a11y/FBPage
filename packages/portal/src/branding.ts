/**
 * White-label ต่อลูกค้า (M9)
 *
 * สเปก: "ใส่โลโก้/สีของลูกค้าได้ + subdomain"
 *
 * ฟีเจอร์นี้ดูเหมือนงานตกแต่ง แต่จริงๆ มีสามเรื่องที่ผิดแล้วเจ็บ:
 *
 * 1. **โลโก้คือ URL ที่เราเอาไปวางในหน้าเว็บของเรา** — รับมาดิบๆ เท่ากับให้คนนอก
 *    ฝังอะไรก็ได้ลงหน้าเรา (SVG รันสคริปต์ได้, `data:` แนบเนื้อหาได้ทั้งก้อน)
 * 2. **subdomain คือ namespace ที่แชร์กับระบบเรา** — ปล่อยให้ตั้ง `www` หรือ `api`
 *    ได้เมื่อไหร่ ลูกค้าจะยึดเส้นทางของระบบไปเลย
 * 3. **สีที่ลูกค้าเลือกมักอ่านไม่ออก** — เจ้าของแบรนด์เลือกสีเหลืองพาสเทลเพราะ
 *    ตรงกับป้ายร้าน แล้วปุ่ม "อนุมัติ" กลายเป็นตัวหนังสือขาวบนพื้นเหลือง
 *    ซึ่งไม่ใช่เรื่องความสวย แต่คือลูกค้ากดอนุมัติไม่ได้
 */

export class BrandingError extends Error {
  override readonly name = "BrandingError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export interface BrandConfig {
  workspaceId: string;
  /** ชื่อที่แสดงบนหัวหน้า portal */
  displayName: string;
  /** URL โลโก้ — ต้องเป็น https และเป็นไฟล์ภาพที่ปลอดภัย */
  logoUrl?: string;
  /** สีหลัก เช่น "#1a73e8" */
  primaryColor: string;
  subdomain: string;
  /** ข้อความต้อนรับสั้นๆ บนหน้าแรกของ portal */
  welcomeTh?: string;
}

// ── subdomain ──────────────────────────────────────────────────────────────

/**
 * ชื่อที่จองไว้ ห้ามลูกค้าเอาไป
 *
 * นอกจากชื่อของระบบเราเองแล้ว ยังต้องกันชื่อที่ทำให้คนเข้าใจผิดว่าเป็นหน้าทางการ
 * (`secure`, `login`, `billing`) ซึ่งเป็นวัตถุดิบชั้นดีของอีเมลหลอกลวง
 */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "admin", "portal", "dashboard", "mail", "smtp",
  "webhook", "webhooks", "cdn", "static", "assets", "status", "docs",
  "help", "support", "billing", "pay", "payment", "login", "signin",
  "auth", "secure", "account", "accounts", "my", "internal", "staging",
  "dev", "test", "demo", "blog", "shop", "store", "pageos",
]);

export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 30;

/**
 * ตรวจ subdomain
 *
 * ห้ามขึ้นต้นด้วย `xn--` เพราะนั่นคือรูปแบบ punycode — ปล่อยไว้จะมีคนจด
 * ชื่อที่แสดงผลเป็นตัวอักษรหน้าตาเหมือนแบรนด์อื่น (homograph attack)
 */
export function validateSubdomain(raw: string): string {
  const s = raw.trim().toLowerCase();

  if (s.length < SUBDOMAIN_MIN || s.length > SUBDOMAIN_MAX) {
    throw new BrandingError(
      `subdomain length ${s.length}`,
      `ชื่อลิงก์ต้องยาว ${SUBDOMAIN_MIN}-${SUBDOMAIN_MAX} ตัวอักษร`,
    );
  }
  if (!/^[a-z0-9-]+$/.test(s)) {
    throw new BrandingError(
      "subdomain charset",
      "ชื่อลิงก์ใช้ได้เฉพาะ a-z, 0-9 และขีดกลาง (ภาษาไทยและช่องว่างใช้ไม่ได้)",
    );
  }
  if (s.startsWith("-") || s.endsWith("-")) {
    throw new BrandingError(
      "subdomain hyphen edge",
      "ชื่อลิงก์ขึ้นต้นหรือลงท้ายด้วยขีดกลางไม่ได้",
    );
  }
  if (s.startsWith("xn--")) {
    throw new BrandingError(
      "punycode prefix",
      'ชื่อลิงก์ขึ้นต้นด้วย "xn--" ไม่ได้',
    );
  }
  if (RESERVED_SUBDOMAINS.has(s)) {
    throw new BrandingError(
      `reserved subdomain ${s}`,
      `"${s}" เป็นชื่อที่ระบบใช้อยู่ กรุณาเลือกชื่ออื่น`,
    );
  }
  return s;
}

/** เสนอชื่อลิงก์จากชื่อแบรนด์ — ภาษาไทยแปลงเป็น subdomain ไม่ได้ ต้องให้กรอกเอง */
export function suggestSubdomain(displayName: string): string | null {
  const ascii = displayName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length < SUBDOMAIN_MIN) return null;
  const trimmed = ascii.slice(0, SUBDOMAIN_MAX).replace(/-+$/, "");
  return RESERVED_SUBDOMAINS.has(trimmed) ? null : trimmed;
}

// ── โลโก้ ──────────────────────────────────────────────────────────────────

/**
 * นามสกุลที่ยอมรับ
 *
 * ไม่รับ `.svg` โดยเจตนา — SVG เป็นเอกสาร XML ที่ฝัง `<script>` และ
 * `<foreignObject>` ได้ พอเอามาแสดงในหน้าเราก็กลายเป็นโค้ดที่รันในโดเมนเรา
 * ลูกค้าที่มีโลโก้เป็น SVG ให้แปลงเป็น PNG ตอนอัปโหลดแทน
 */
const ALLOWED_IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

export function validateLogoUrl(raw: string): string {
  const s = raw.trim();
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new BrandingError(
      "logo url unparseable",
      "ลิงก์โลโก้ไม่ถูกต้อง ต้องเป็น URL เต็มที่ขึ้นต้นด้วย https://",
    );
  }

  if (url.protocol !== "https:") {
    throw new BrandingError(
      `logo protocol ${url.protocol}`,
      "ลิงก์โลโก้ต้องเป็น https:// เท่านั้น",
    );
  }
  // URL ที่มีชื่อผู้ใช้/รหัสผ่านฝังอยู่ = ความลับที่จะไปโผล่ใน HTML ของหน้าเว็บ
  if (url.username !== "" || url.password !== "") {
    throw new BrandingError(
      "credentials in url",
      "ลิงก์โลโก้ต้องไม่มีชื่อผู้ใช้หรือรหัสผ่านอยู่ในลิงก์",
    );
  }

  const path = url.pathname.toLowerCase();
  if (path.endsWith(".svg")) {
    throw new BrandingError(
      "svg not allowed",
      "ไฟล์ SVG ใช้เป็นโลโก้ไม่ได้ (ฝังสคริปต์ได้) กรุณาแปลงเป็น PNG ก่อน",
    );
  }
  if (!ALLOWED_IMAGE_EXT.some((e) => path.endsWith(e))) {
    throw new BrandingError(
      "unsupported image type",
      `ไฟล์โลโก้ต้องเป็น ${ALLOWED_IMAGE_EXT.join(" / ")}`,
    );
  }
  return url.toString();
}

// ── สี ─────────────────────────────────────────────────────────────────────

export function normalizeHexColor(raw: string): string {
  const s = raw.trim().toLowerCase();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) {
    throw new BrandingError(
      `bad color ${raw}`,
      'สีต้องอยู่ในรูปแบบ #rrggbb เช่น "#1a73e8"',
    );
  }
  const hex = m[1]!;
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return `#${full}`;
}

function channelLuminance(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** ความสว่างสัมพัทธ์ตาม WCAG */
export function relativeLuminance(hex: string): number {
  const h = normalizeHexColor(hex).slice(1);
  const r = channelLuminance(parseInt(h.slice(0, 2), 16));
  const g = channelLuminance(parseInt(h.slice(2, 4), 16));
  const b = channelLuminance(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** อัตราส่วนความต่างของสองสี (1 = เหมือนกัน, 21 = ดำกับขาว) */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** เกณฑ์ WCAG AA สำหรับข้อความขนาดปกติ */
export const MIN_CONTRAST_AA = 4.5;
/** เกณฑ์สำหรับข้อความใหญ่และองค์ประกอบ UI (WCAG 1.4.11) */
export const MIN_CONTRAST_UI = 3;
/** พื้นหลังของหน้า portal — สีแบรนด์ถูกวางบนพื้นนี้เวลาใช้เป็นลิงก์/ไอคอน */
const PORTAL_BG = "#ffffff";

/**
 * เลือกสีตัวอักษรบนพื้นสีแบรนด์ให้อ่านออก
 *
 * ไม่ให้ลูกค้าเลือกเอง เพราะคนที่เลือกสีแบรนด์ไม่ได้คิดเรื่องความอ่านง่าย
 *
 * มีสามตัวเลือก เรียงตามความน่าใช้: ขาว (บนพื้นเข้ม) → `#111111` (บนพื้นสว่าง
 * ดำสนิทบนสีสดดูบาดตา) → ดำสนิท (ทางออกสุดท้าย)
 *
 * **ต้องดูครบทั้งสามตัว ไม่ใช่เทียบทีละคู่** — มีสีช่วงแคบๆ ที่ทั้งขาวและ
 * `#111111` ไม่ถึงเกณฑ์ แต่ดำสนิทผ่าน เช่น `#0077dd` (ขาว 4.48, soft 4.21,
 * ดำสนิท 4.69) ถ้าเทียบแค่ "ขาวชนะ soft ไหม" จะได้ขาวที่ 4.48 ซึ่งตกเกณฑ์
 *
 * ทางคณิตศาสตร์ ขาวหรือดำสนิทอย่างน้อยหนึ่งตัวผ่านเสมอ: ดำสนิทตกเกณฑ์เมื่อ
 * ความสว่าง < 0.175 ส่วนขาวตกเกณฑ์เมื่อความสว่าง > 0.183 — เป็นจริงพร้อมกันไม่ได้
 */
export function readableTextOn(
  background: string,
): "#ffffff" | "#111111" | "#000000" {
  const onWhite = contrastRatio(background, "#ffffff");
  const onSoft = contrastRatio(background, "#111111");
  const onBlack = contrastRatio(background, "#000000");

  if (onWhite >= MIN_CONTRAST_AA && onWhite >= onSoft) return "#ffffff";
  if (onSoft >= MIN_CONTRAST_AA) return "#111111";
  if (onBlack >= MIN_CONTRAST_AA) return "#000000";
  // ไม่ควรถึงบรรทัดนี้ตามที่พิสูจน์ไว้ข้างบน แต่ถ้าถึง เอาตัวที่ดีที่สุดไว้ก่อน
  return onWhite >= onBlack ? "#ffffff" : "#000000";
}

export interface BrandWarning {
  field: string;
  th: string;
}

/**
 * ตรวจสีแบรนด์
 *
 * ⚠️ สิ่งที่ **ไม่ต้องตรวจ**: ความอ่านง่ายของตัวหนังสือบนปุ่ม
 *
 * เพราะ `readableTextOn()` เลือกดำหรือขาวให้อยู่แล้ว และทางคณิตศาสตร์
 * ไม่มีสีไหนที่ทั้งดำและขาวอ่านไม่ออกพร้อมกัน: ตัวอักษรดำจะได้คอนทราสต์ต่ำกว่า
 * 4.5 ก็ต่อเมื่อความสว่าง < 0.175 ส่วนตัวอักษรขาวจะต่ำกว่า 4.5 ก็ต่อเมื่อ
 * ความสว่าง > 0.183 — สองเงื่อนไขนี้เป็นจริงพร้อมกันไม่ได้ ปุ่มจึงอ่านออกเสมอ
 *
 * เรื่องที่พังจริงคือตอนเอาสีแบรนด์ไปใช้เป็น **ตัวหนังสือหรือไอคอนบนพื้นขาว**
 * ของหน้า portal — สีเหลืองพาสเทลของร้านเบเกอรี่จะหายไปกับพื้น
 * ตัวนี้จึงวัดสีแบรนด์เทียบกับพื้นหลังของหน้า ไม่ใช่เทียบกับตัวหนังสือบนปุ่ม
 */
export function checkBrandColor(primary: string): BrandWarning[] {
  const warnings: BrandWarning[] = [];
  const onBg = contrastRatio(primary, PORTAL_BG);

  if (onBg < MIN_CONTRAST_UI) {
    warnings.push({
      field: "primaryColor",
      th: `สีนี้อ่อนจนเกือบกลืนกับพื้นขาว (ความต่าง ${onBg.toFixed(1)} ต้องการอย่างน้อย ${MIN_CONTRAST_UI}) — ระบบจะใช้เป็นสีพื้นปุ่มเท่านั้น ไม่เอาไปทำตัวหนังสือหรือลิงก์`,
    });
  } else if (onBg < MIN_CONTRAST_AA) {
    warnings.push({
      field: "primaryColor",
      th: `สีนี้ใช้กับปุ่มและหัวข้อใหญ่ได้ แต่ตัวหนังสือเล็กจะอ่านยาก (ความต่าง ${onBg.toFixed(1)} ต้องการ ${MIN_CONTRAST_AA})`,
    });
  }
  return warnings;
}

export interface BrandCheckResult {
  config: BrandConfig;
  /** สีตัวอักษรที่ต้องใช้บนพื้นสีแบรนด์ */
  onPrimary: "#ffffff" | "#111111" | "#000000";
  warnings: BrandWarning[];
  th: string;
}

/**
 * ตรวจและทำให้เป็นมาตรฐานทั้งชุด
 *
 * โยน error เฉพาะเรื่องที่ยอมไม่ได้ (subdomain ชนของระบบ, โลโก้เป็น SVG)
 * ส่วนเรื่องที่แค่ "ไม่สวย/อ่านยาก" คืนเป็นคำเตือนให้คนตัดสินใจเอง
 */
export function prepareBranding(input: BrandConfig): BrandCheckResult {
  const displayName = input.displayName.trim();
  if (displayName === "") {
    throw new BrandingError(
      "empty display name",
      "ต้องใส่ชื่อที่จะแสดงบนหน้า portal ของลูกค้า",
    );
  }

  const config: BrandConfig = {
    workspaceId: input.workspaceId,
    displayName,
    primaryColor: normalizeHexColor(input.primaryColor),
    subdomain: validateSubdomain(input.subdomain),
    ...(input.logoUrl !== undefined && input.logoUrl.trim() !== ""
      ? { logoUrl: validateLogoUrl(input.logoUrl) }
      : {}),
    ...(input.welcomeTh !== undefined ? { welcomeTh: input.welcomeTh.trim() } : {}),
  };

  const warnings = checkBrandColor(config.primaryColor);
  if (config.logoUrl === undefined) {
    warnings.push({
      field: "logoUrl",
      th: "ยังไม่ได้ใส่โลโก้ — หน้า portal จะแสดงชื่อร้านเป็นตัวหนังสือแทน",
    });
  }

  return {
    config,
    onPrimary: readableTextOn(config.primaryColor),
    warnings,
    th:
      warnings.length === 0
        ? "ตั้งค่าแบรนด์เรียบร้อย พร้อมเปิดให้ลูกค้าเข้าใช้"
        : `ตั้งค่าได้ แต่มี ${warnings.length} เรื่องที่ควรดู`,
  };
}
