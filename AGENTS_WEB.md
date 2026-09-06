# AGENTS_WEB.md — Website Care module (โมดูลใน monorepo เดียวกับ Facebook/YouTube)

> อ่านคู่กับ `AGENTS.md` (กฎหลัก) และ `AGENTS_YOUTUBE.md` (pattern การเพิ่มแพลตฟอร์ม) — กฎที่ซ้ำกันไม่เขียนซ้ำที่นี่

## 1. เป้าหมาย
ลูกค้าเอเจนซี่ 1 ราย มีทั้งเพจ ช่อง และเว็บไซต์ ระบบต้อง "ดูแลเว็บ" ในแอปเดียว: รู้ก่อนลูกค้าว่าเว็บล่ม/ใบรับรองใกล้หมด/ช้า/SEO พื้นฐานพัง, เห็นว่าคนเข้าเว็บจากคำค้นอะไร, และ (ระยะถัดไป) ผลิตคอนเทนต์เว็บจากคลิป/โพสต์ที่มีอยู่แล้วโดยผ่านการอนุมัติ

## 2. ขอบเขตเป็นระดับ (ทำตามลำดับ)
| ระดับ | สิ่งที่ทำ | ต้องมี | สถานะ |
| --- | --- | --- | --- |
| **W-1 Monitoring** | uptime (HTTP + คำที่ต้องเจอในหน้า), latency, redirect, SSL หมดอายุ, SEO audit พื้นฐาน (title/description/h1/canonical/robots/og/lang/viewport/alt), ลิงก์เสียภายใน (จำกัดจำนวน), Core Web Vitals ผ่าน PageSpeed Insights API, incident + แจ้งเตือน/ฟื้นตัว | ไม่ต้องมี key (PageSpeed key ไม่บังคับ) | ทำในรอบนี้ |
| **W-2 Search analytics** | Google Search Console: clicks/impressions/CTR/position รายวัน, คำค้นและหน้ายอดนิยม, ปัญหา index, กราฟแนวโน้ม, SEO Analyst (AI) แยก observed/inference/recommendation | Google OAuth client เดิม + scope `webmasters.readonly` | ทำในรอบนี้ |
| **W-3 Web content** | ContentItem `platform=WEB`: AI ร่างบทความจากคลิป YouTube/โพสต์ FB/ข้อมูลแบรนด์ → อนุมัติ → โพสต์ขึ้น WordPress (REST + application password) แบบ idempotent · Shopify/Wix ต่อภายหลัง | WordPress ของลูกค้า | ทำแล้ว |
| **W-4 Email marketing** | รายชื่อผู้รับ + consent (PDPA) + unsubscribe, แคมเปญ/จดหมายข่าว, สถิติเปิด/คลิก/bounce ผ่านผู้ให้บริการส่งจำนวนมาก (Brevo/Resend) — **ไม่ใช้ SMTP แจ้งเตือนภายในส่งจำนวนมาก** | ผู้ให้บริการ + โดเมนส่ง SPF/DKIM | ทำแล้ว |
| **นอกขอบเขต** | สร้าง/โฮสต์เว็บให้ลูกค้าในแอปนี้ — ให้ใช้ WordPress/Webflow แล้วต่อผ่าน W-3 | | |

## 3. โมเดลข้อมูล (Prisma)
- `Site` — brandId, url (origin ที่ normalize แล้ว), name, platform (WORDPRESS|SHOPIFY|CUSTOM|UNKNOWN), monitorEnabled, checkIntervalMin (ค่าเริ่มต้น 15), expectedText (คำที่ต้องพบในหน้าแรก), lastStatus (UP|DOWN|DEGRADED|UNKNOWN), lastHttpStatus, lastLatencyMs, lastCheckedAt, sslExpiresAt, sslIssuer, googleConnectionId?, searchConsoleProperty? (`sc-domain:example.com` หรือ URL prefix), gscStatus (UNKNOWN|OK|NO_ACCESS|ERROR), settings Json, disconnectedAt
- `SiteCheck` — siteId, kind (UPTIME|SSL|SEO|LINKS|PAGESPEED), status (OK|WARN|FAIL|SKIPPED), httpStatus?, latencyMs?, details Json (ผลดิบที่ normalize แล้ว), error?, checkedAt — **เก็บทุกครั้ง** ไม่ทับ (ประวัติสำหรับ uptime % และกราฟ)
- `SiteIncident` — siteId, kind (DOWN|DEGRADED|SSL_EXPIRING|SSL_EXPIRED|GSC_ACCESS), startedAt, resolvedAt?, summary, notifiedAt? — เปิด 1 อันต่อ kind จนกว่าจะ resolved (dedupe การแจ้งเตือน)
- `SearchSnapshot` — siteId, date, clicks, impressions, ctr, position, topQueries Json, topPages Json — unique (siteId, date); ค่าที่ API ไม่ให้ = `null`
- `SiteAnalysis` — siteId, result Json (SEO Analyst), provider, model, promptVersion, createdAt
- `GoogleConnection` ใช้ตัวเดิมของ YouTube (scope เพิ่ม `webmasters.readonly`) — token เข้ารหัสด้วย `common/crypto` เท่านั้น

## 4. แพ็กเกจและโมดูล
- `packages/web-core` — `checks.ts` (uptime/ssl/seo/links/pagespeed ล้วน `fetch` + `node:tls` ไม่มี dependency), `search-console.ts` (client Search Console API), `sync.ts` (runSiteChecks, syncSearchConsole — ใช้ prisma ฝั่งเซิร์ฟเวอร์เท่านั้น), `mock-web.ts` (mock เว็บลูกค้า + mock PageSpeed + mock Search Console สำหรับ test)
- `apps/api/src/web` — sites (CRUD, connect Search Console property, run checks, sync search, trends, overview, SEO Analyst), RBAC `web.read` / `web.manage` / `web.analytics.read`
- `workers/scheduler` — คิว `web-monitor` (uptime ตาม checkIntervalMin, กระจายโหลด) และ `web-daily` (SSL/SEO/links/PageSpeed/GSC วันละครั้ง) — quota PageSpeed ~25,000/วัน ไม่ต้องกังวล แต่ GSC จำกัด 1,200 คำขอ/นาที/โปรเจกต์
- `apps/web` — หน้า "เว็บไซต์" (รายการ+เพิ่มเว็บ, สถานะ, KPI, รายละเอียด: ประวัติเช็ก, incident, SEO issues, คำค้น/หน้ายอดนิยม, กราฟ clicks/impressions, ปุ่มตรวจเดี๋ยวนี้/ซิงก์/วิเคราะห์) + KPI บนภาพรวม + กราฟในหน้าวิเคราะห์

## 5. Agents
- **Site Health Monitor** (ไม่ใช้ AI): ตัดสิน UP/DOWN/DEGRADED จาก HTTP status, expectedText, latency > 3 วิ; เปิด incident เมื่อ FAIL 2 ครั้งติด (กัน false alarm), ปิดเมื่อ OK; แจ้งเตือน severity `bad` (ล่ม) / `warn` (ช้า, SSL ≤ 14 วัน) / `info` (ฟื้นตัว)
- **SEO Analyst** (AI ผ่าน `AiGatewayService` role `analysis`): รับ SEO audit + PageSpeed + SearchSnapshot 28 วัน + ข้อมูลแบรนด์ → `summary`, `observations[]`, `inferences[]` (มี confidence), `recommendations[]` (actionType: FIX_META|FIX_PERFORMANCE|CREATE_CONTENT|FIX_BROKEN_LINK|IMPROVE_PAGE|TECHNICAL|OTHER, มี evidence) — ห้ามอ้างอันดับ/ปริมาณค้นหาที่ไม่มีใน data, ห้ามสัญญาผลลัพธ์
- **Web Content Writer** (W-3, AI ผ่าน `AiGatewayService` role `content`): ร่างบทความจากคลิป YouTube / โพสต์ Facebook / ข้อมูลแบรนด์ / คำค้นจาก Search Console → `title`, `slug`, `excerpt`, `metaTitle/metaDescription`, `bodyHtml` (HTML สะอาด ผ่าน `sanitizeArticleHtml`), `tags`, `categories`, `missingInfo[]` — ห้ามแต่งราคา/โปร/ตัวเลข (ใส่ `[ต้องยืนยัน: ...]` แทน), ห้ามคัดลอกสคริปต์คำต่อคำ · Reviewer (role `fast`) ตรวจก่อนเข้าคิวอนุมัติ; มี `[ต้องยืนยัน]` ค้าง = NEEDS_REVISION
- **Newsletter Writer** (W-4, role `content`): ร่างอีเมลจากคอนเทนต์ที่เผยแพร่แล้วของแบรนด์ → `subject` (≤ 60), `preheader`, `bodyHtml` ที่มี `{{name}}`/`{{unsubscribe_url}}` · Reviewer ตรวจก่อนอนุมัติ เช่นเดียวกัน

## 6. กฎเฉพาะโมดูล
1. ตรวจเว็บลูกค้าแบบสุภาพ: User-Agent ระบุตัว (`FBPM-SiteMonitor/1.0`), ไม่เกิน 1 คำขอ/วินาทีต่อเว็บ, crawl ลิงก์ไม่เกิน 50 หน้า/ครั้ง, เคารพ `robots.txt` สำหรับ crawl (uptime หน้าแรกไม่ต้อง)
2. ห้ามเรียก URL ที่ผู้ใช้ป้อนโดยไม่ตรวจ: อนุญาตแค่ http/https, ห้าม IP ส่วนตัว/loopback/link-local (กัน SSRF) ยกเว้นเมื่อ `WEB_ALLOW_PRIVATE_TARGETS=true` (test/mock เท่านั้น)
3. ค่าที่อ่านไม่ได้ (ไม่มี PageSpeed key, ไม่มีสิทธิ์ GSC) = `null`/`SKIPPED` ห้ามเป็น 0 หรือ OK
4. ห้ามแก้เว็บลูกค้าจากโมดูลนี้โดยไม่ผ่านอนุมัติ — W-3 โพสต์ได้เฉพาะบทความที่ APPROVED, กันซ้ำด้วย `ExternalOperation` (`web-publish:<contentId>`) และต้องเปิด `WEB_PUBLISH_ENABLED=true` · เชื่อม WordPress ต้องเป็น https และรหัสผ่านเข้ารหัสด้วย `common/crypto` เท่านั้น · บทความที่เผยแพร่แล้วแก้ผ่าน "อัปเดตบน WordPress" (คนสั่งเท่านั้น ไม่อัตโนมัติ)
7. (W-4) ส่งอีเมลได้เฉพาะผู้รับสถานะ SUBSCRIBED ที่มีบันทึกความยินยอม, ทุกฉบับมีลิงก์ยกเลิกรับ + header `List-Unsubscribe`, กันส่งซ้ำด้วย `EmailSend` (unique campaignId+subscriberId), bounce/spam → ปิดผู้รับอัตโนมัติและห้าม import กลับ · สถิติที่ไม่มี webhook = `null` ห้ามเป็น 0 · ต้องเปิด `EMAIL_SEND_ENABLED=true`
5. token Google ไม่อยู่ใน select/response/audit · ผลดิบ HTML ไม่เก็บทั้งหน้า เก็บเฉพาะที่ normalize แล้ว
6. test/CI ห้ามยิงเว็บจริง/Google จริง ใช้ `startMockWeb()` (+ `startMockYouTube()` สำหรับ token endpoint)

## 7. env
`PAGESPEED_API_KEY` (ไม่บังคับ — ไม่มี = ข้าม Core Web Vitals) · `WEB_MOCK_BASE_URL` (test เท่านั้น: PageSpeed + Search Console + WordPress จำลอง) · `WEB_ALLOW_PRIVATE_TARGETS` (test เท่านั้น) · `WEB_PUBLISH_ENABLED` (W-3 เปิดโพสต์จริง) · `WEB_WP_ALLOW_INSECURE` (test เท่านั้น) · `EMAIL_SEND_ENABLED` (W-4 เปิดส่งจริง) · `EMAIL_MOCK_BASE_URL` (test เท่านั้น) · API key ของ Brevo/Resend ตั้งในหน้าเว็บต่อ workspace (เก็บเข้ารหัสใน DB) · ใช้ `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` เดิม

## 8. Definition of Done (รอบ W-1/W-2)
- เพิ่มเว็บ → ตรวจทันที → เห็น UP/latency/SSL/SEO issues · ทำให้ล่ม (mock) → incident + แจ้งเตือน → ฟื้น → incident ปิด + แจ้งเตือนฟื้นตัว
- เชื่อม Search Console ด้วยบัญชี Google เดิม → เลือก property → snapshot รายวัน 28 วัน → กราฟ + คำค้นยอดนิยม · ไม่มีสิทธิ์ → `gscStatus=NO_ACCESS` และแจ้งตรง ๆ
- SEO Analyst ให้ข้อเสนอที่อ้าง evidence จาก data เท่านั้น
- worker ตรวจตามรอบและไม่ซ้ำ (jobId ต่อเว็บต่อช่วงเวลา) · ทุกอย่างมี test กับ mock · typecheck/lint/test/E2E ผ่าน

## 9. Definition of Done (รอบ W-3/W-4)
- เชื่อม WordPress ด้วย Application Password → ตรวจสิทธิ์จริง (Editor ขึ้นไป) → รหัสผ่านไม่กลับมาในหน้าเว็บ/audit · รหัสผิด = AUTH_FAILED บอกตรง ๆ
- สร้างบทความ → AI ร่างจากคลิป YouTube ของแบรนด์เดียวกัน → ส่งอนุมัติ (Reviewer) → อนุมัติ → โพสต์ขึ้น WordPress ครั้งเดียว (ยิงซ้ำ = กู้โพสต์เดิม ไม่สร้างใหม่) · แก้เนื้อหาหลังอนุมัติ = กลับไปขออนุมัติใหม่ · `publishingPaused` / `WEB_PUBLISH_ENABLED=false` = ไม่ยิง และบอกเหตุผล
- ตั้งค่าผู้ให้บริการอีเมล → รายชื่อ + import ที่ยืนยัน consent → AI ร่าง → อนุมัติ → ส่ง (ข้ามคนที่ยกเลิกรับ, ไม่ส่งซ้ำเมื่อ retry) → webhook อัปเดต delivered/opened/bounced → ลิงก์ยกเลิกรับใช้ได้โดยไม่ต้องล็อกอิน
- ทุกอย่างมี test กับ mock (`startMockWeb()` มี WordPress REST, `startMockEmailProvider()`), E2E ครอบทั้งสองเส้นทาง · typecheck/lint/test/E2E ผ่าน
