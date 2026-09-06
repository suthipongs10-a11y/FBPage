# Facebook AI Page Manager

AI Marketing Manager สำหรับเพจ Facebook — อ่านข้อมูลจริง → วิเคราะห์ → วางแผน → สร้างคอนเทนต์ → ขออนุมัติ → เผยแพร่ → วัดผล → เรียนรู้

**เริ่มใช้งานรับลูกค้า:** [`docs/runbooks/first-client.md`](docs/runbooks/first-client.md) · **อ่านก่อนเขียนโค้ด:** [`AGENTS.md`](AGENTS.md) คือคู่มือหลักของโปรเจกต์ · การตัดสินใจเชิงสถาปัตยกรรมอยู่ใน [`docs/architecture/`](docs/architecture/)

## สถานะ
- **Phase 1 — ฐานระบบ** ✔ monorepo · Docker Compose · PostgreSQL + Redis · NestJS API + health + OpenAPI · Next.js · BullMQ worker · Prisma schema
- **Phase 2 — Identity + Tenant + Client/Brand** ✔ (AGENTS.md §106 ข้อสอง)
  Auth (scrypt + เซสชันฝั่งเซิร์ฟเวอร์ cookie HttpOnly) · Workspace + สมาชิก + RBAC ตาม permission (§58) · tenant isolation ทุก query (§57)
  Client → Brand → Brand Knowledge (สถานะฐานความรู้ EMPTY/PARTIAL/READY) · validation ด้วย zod · audit log ทุกการเปลี่ยนแปลง (§49) · kill switch (§92)
  หน้าเว็บ: login/register · ภาพรวม + "ต้องดูแล" · ลูกค้า · แบรนด์ + ความรู้ · ตั้งค่า/สมาชิก/audit · i18n th/en · responsive

- **Phase 3–4 — Facebook connection + Page/post sync** ✔ (§106 ขั้น 3–4, §11, §13, §60)
  `packages/facebook-core` (GraphClient retry/backoff · FacebookService · metric adapter ที่คืน `null` เมื่ออ่านไม่ได้ · mock Graph สำหรับ test §77)
  เชื่อมบัญชีได้ 2 ทาง: **วาง user token** (ใช้ได้ทันที ไม่ต้องมีแอป Meta) หรือ **OAuth** (เมื่อตั้ง `META_APP_ID/SECRET`) · token ทุกตัวเข้ารหัส AES-256-GCM ด้วย `AUTH_SECRET` และไม่เคยอยู่ใน response/audit
  ผูกเพจกับแบรนด์ → ดึงข้อมูลเพจ + โพสต์ 90 วัน + `PostMetricSnapshot` ทันที · ตรวจ token · ซิงก์ซ้ำ · ระดับอัตโนมัติ/หยุดโพสต์รายเพจ · ตัดการเชื่อมต่อ (ล้าง token เก็บประวัติ)
  หน้าเว็บ "เพจ": เชื่อมบัญชี → เลือกเพจ → เลือกแบรนด์ · รายละเอียดเพจ (ผู้ติดตาม, คะแนนข้อมูลครบ, สิทธิ์ MANAGE/CREATE_CONTENT, โพสต์ + ตัวเลขที่แสดง "อ่านไม่ได้" แทน 0)
  ทดสอบ: unit 11 (facebook-core) + integration 11 (mock Graph, tenant isolation, token ไม่หลุด) + `test/phase3-smoke.mjs` (token จริง อ่านอย่างเดียว)

- **Phase 5 — AI Gateway + AI task log + Analyst + Command Center** ✔ (§4, §5, §19, §37, §41–§43, §50)
  `packages/ai-core`: interface กลาง + adapter anthropic / openai / gemini / openrouter / OpenAI-compatible (LiteLLM, Groq, Ollama …) · tool loop · structured output พร้อม retry · ประเมินค่าใช้จ่าย · mock AI สำหรับ test
  `apps/api/src/ai`: BYOK key ต่อ workspace (เข้ารหัส, ไม่เคยส่งกลับ) · บทบาท→โมเดล (strategy/content/analysis/…) พร้อม fallback · งบต่อเดือน (402 เมื่อเกิน) · `AiTaskLog` ทุกครั้ง (latency, token, cost, success)
  Tool registry (§43) READ tools: list_pages, get_page_overview, get_posts (null-aware), get_brand_knowledge, list_clients_brands, get_latest_page_analysis — บริบท client/brand/page ล็อกฝั่งเซิร์ฟเวอร์
  Analyst Agent: `POST /analytics/pages/:id/analyze` → ผลแบบโครงสร้าง (summary, dataLimitations, patterns, recommendations + confidence, content pillars) เก็บใน `PageAnalysis`
  หน้าเว็บ: "โมเดล AI" (key, ทดสอบ, บทบาท, งบ, งานล่าสุด) · "AI Command" (เลือกบริบท → แชท → เห็นขั้นตอน/ค่าใช้จ่าย) · ปุ่ม "วิเคราะห์ด้วย AI" ในหน้าเพจ
  ทดสอบ: unit 11 (ai-core) + integration 9 (mock AI + mock Graph) + `test/phase5-smoke.mjs`

- **Phase 6 — Content loop: Strategist → Content → Reviewer → Approval → Scheduler → Publisher → Metric collector** ✔ (§18, §20, §25, §28, §29, §31, §46–§48, §55, §92)
  `apps/api/src/content`: ContentItem state machine (§28 ห้ามข้าม) · แก้โดยคนเก็บ revision ทุกครั้ง แก้หลังอนุมัติต้องขออนุมัติใหม่ · ApprovalRequest ทุกการตัดสิน (audit) · ตั้งเวลาเก็บ local + timezone + UTC แล้ว enqueue BullMQ (jobId = content) · "โพสต์ตอนนี้"
  `packages/facebook-core/publisher.ts`: เผยแพร่กันซ้ำด้วย ExternalOperation (§48 — retry หลังเครือข่ายหลุดจะหาโพสต์เดิมก่อน) · ตรวจ kill switch ทุกครั้ง (workspace pause, page pause, token, สิทธิ์ CREATE_CONTENT)
  `workers/scheduler`: processor จริงสำหรับ facebook-publish / facebook-sync (ซิงก์ทุกเพจทุก 6 ชม.) / analytics (เก็บ metric โพสต์หลัง 24/72 ชม.)
  Agents: Strategist → `ContentPlan` + รายการ PLANNED · Content Creator → ร่างพร้อม `missingInfo` (NEEDS_HUMAN_INPUT §54 ไม่เดาราคา/เบอร์) · Reviewer → PASS / NEEDS_REVISION / BLOCKED ก่อนเข้าคิวอนุมัติ (ข้ามอัตโนมัติถ้ายังไม่ตั้งค่า AI)
  หน้าเว็บ: "คอนเทนต์" (กลุ่มตามสถานะ, สร้าง/ให้ AI เขียน/ส่งตรวจ/อนุมัติ/ตั้งเวลา/โพสต์) · "ปฏิทิน" รายสัปดาห์ · "วางแผนคอนเทนต์ด้วย AI" ในหน้าเพจ
  ทดสอบ: integration 10 (API) + 3 (worker) กับ mock Graph/mock AI + `test/phase6-smoke.mjs`

**First Internal Milestone (§100) ครบทั้ง 15 ข้อ** — login → ลูกค้า → แบรนด์ → ข้อมูลแบรนด์ → เชื่อมเพจ → นำเข้าโพสต์ → analytics ที่ null-aware → AI วิเคราะห์ → แผน 7 วัน → ร่าง ≥3 → อนุมัติ → ตั้งเวลา/โพสต์อย่างปลอดภัย → เก็บ metric ภายหลัง → เห็นผลในหน้าเพจ → audit ครบ

- **Phase 7 — Reports + Media service + Overview** ✔ (§34, §36, §63, §64, §21)
  รายงานรายเดือนต่อเพจจากข้อมูลที่บันทึกไว้ (โพสต์/metric/คอนเทนต์/ผลวิเคราะห์ล่าสุด) + สรุปผู้บริหารโดย AI (เลือกได้, เก็บผลไว้ไม่รันซ้ำ) + ข้อความพร้อมส่งลูกค้า + ข้อจำกัดข้อมูลระบุชัด
  Media service: การ์ดภาพ 1080×1080 จากเทมเพลต quote/stat/tips/hero (พอร์ตจาก `make-card.mjs`) เรนเดอร์ด้วย Chromium เก็บใน `MEDIA_DIR` + Creative Director ให้ AI ออกแบบการ์ดจากโพสต์ → แนบเข้าคอนเทนต์ → publisher อัปโหลดให้ Facebook
  Overview (§36): โพสต์เดือนนี้ · ตั้งเวลา · รออนุมัติ · โพสต์ไม่สำเร็จ · token มีปัญหา · ค่า AI + "ต้องดูแล" (รออนุมัติ, พรุ่งนี้ไม่มีโพสต์, งบ AI ≥85%, ยังไม่ตั้งค่า AI)
  Docker: API image มี Chromium + ฟอนต์ไทย, volume `media-data` ใช้ร่วมกัน API/worker

- **Phase 8 — Comments/Leads + Notifications + Webhooks + Invite/Reset links + Redis rate limit** ✔ (§14, §23, §24, §33, §56, §65)
  คอมเมนต์: ซิงก์จากโพสต์ → Community agent จำแนก 9 ประเภท + sentiment + risk + ร่างตอบ → Lead Detector (ไม่แต่งข้อมูลติดต่อ) → คนตรวจแล้วส่ง/ซ่อน/จัดการ · FULL_AUTO ตอบเองเฉพาะกลุ่มปลอดภัย · insights §33 → ข้อเสนอคอนเทนต์
  **ต้องมีสิทธิ์ `pages_read_user_content` (อ่าน) และ `pages_manage_engagement` (ตอบ/ซ่อน)** — token ปัจจุบันยังไม่มี ระบบจะขึ้นสถานะ NO_PERMISSION และแจ้งเตือน ไม่ล้ม
  การแจ้งเตือน (§65): in-app (กระดิ่ง) + webhook ภายนอก (Discord/Slack/LINE ผ่านตัวกลาง) — รออนุมัติ, โพสต์ไม่สำเร็จ, token เพจเสีย, ลีดร้อน, รายงานพร้อม, งบ AI ≥85%, ไม่มีสิทธิ์อ่านคอมเมนต์ (dedupe)
  Webhook Meta (§14): `GET/POST /facebook/webhook` ตรวจ verify token + ลายเซ็น sha256 → normalize เป็น SocialEvent → คิว → worker ซิงก์เฉพาะส่วนที่เปลี่ยน
  ลิงก์เชิญสมาชิก (ครั้งเดียว 7 วัน) + ลิงก์ตั้งรหัสใหม่ที่ owner สร้างให้ + เปลี่ยนรหัสผ่าน — ไม่ต้องมีระบบอีเมล · rate limit auth ผ่าน Redis (ถอยเป็นในหน่วยความจำเมื่อ Redis ล่ม)
  ทดสอบ: integration 11 (comments 5, invites 3, webhook 3) กับ mock Graph/AI/webhook receiver

- **Phase 9 — YouTube AI Channel Manager (โมดูลใน monorepo เดียว ตาม [`AGENTS_YOUTUBE.md`](AGENTS_YOUTUBE.md) YT-1…YT-7 / MVP §165)** ✔
  `packages/youtube-core`: Google OAuth (scopes ขั้นต่ำตามฟีเจอร์ §8, refresh อัตโนมัติ, `invalid_grant` → RECONNECT) · `YouTubeClient` (Data v3 / Analytics v2 / resumable upload, error normalization §139, retry, quota ledger ทุกคำขอ §21) · progressive sync §17 (ช่อง → วิดีโอผ่าน uploads playlist 1 unit ไม่ใช้ search 100 → Analytics → คอมเมนต์ → playlists) · Shorts classifier ≤180s · metric normalization (ค่าที่อ่านไม่ได้ = `null`) · หน้าต่างอายุเท่ากัน (§42) · packaging diagnosis/revival score เป็น *สมมติฐาน* (§43, §130) · `mock-youtube.ts` สำหรับทดสอบ
  `apps/api/src/youtube`: connections (OAuth callback + วาง refresh token) · channels (OAUTH / PUBLIC_API_KEY โดย @handle, policy §64, automation level, kill switches) · videos (คลัง + stats + baseline ต่อรูปแบบ + แก้ metadata ทีละรายการผ่าน API มี audit §67) · Analyst / Topic Opportunity / Script / Title / Thumbnail brief / SEO / Reviewer / Comment intelligence / Repurposing agents ผ่าน `AiGatewayService` เท่านั้น · Content Lab บน `ContentItem` เดียวกัน (`platform=YOUTUBE`, `ytStatus` state machine §55–61, ฟิลด์นโยบาย madeForKids/synthetic/paid ต้องเป็นคนกรอก §62–63) · อนุมัติ → อัปโหลด resumable + idempotent ผ่าน `YouTubeUploadOperation` (§56–61) · คอมเมนต์ → ลีด/คลัสเตอร์ → ไอเดีย (§47–50) · cross-platform: repurpose → ร่าง Facebook + `ContentRelation`, `BrandInsight` (§71–76) · รายงานรายเดือน `YouTubeReport` (§78) · quota/health
  worker: คิว `youtube-upload` (concurrency 1, ตรวจ processing ทุก 5 นาที) · `youtube-sync` (quick ทุก 6 ชม., videos+analytics รายวัน) · `youtube-analytics` (+1h/+24h/+72h/+7d/+28d) · `youtube-comments` — quota-aware, `quotaExceeded` ไม่ retry
  หน้าเว็บ: "YouTube" (สถานะ/โควตา/บัญชี Google/เชื่อมช่อง/kill switch/ข้อเสนอ) · "YT · วิดีโอ" · "YT · Content Lab" · "YT · คอมเมนต์" · "YT · รายงาน" · ปฏิทิน/คิวอนุมัติรวมสองแพลตฟอร์ม (§65, §117)
  RBAC `youtube.*` (§89–91) · env `GOOGLE_*`, `YOUTUBE_*` (§144) · เอกสาร `docs/youtube/` (API changelog §167, Google Cloud setup, first-channel runbook)
  ทดสอบ: unit 11 (youtube-core) + integration 17 (API กับ mock YouTube/mock AI/mock Graph — OAuth, connect, sync, quota 429, analyst, metadata audit, comments→lead→cluster→idea, ideas→script→metadata→policy gate→approve→asset→upload idempotent, repurpose, report, tenant isolation, disconnect/revoke) + `test/phase9-smoke.mjs`
  Playlist Architect (§45): `POST channels/:id/playlists/plan` → AI เสนอกลุ่มจากข้อมูลที่ซิงก์ไว้เป็น recommendation (ADD_TO_PLAYLIST / CREATE_PLAYLIST) → คนกด "ทำเลย" (`POST recommendations/:id/apply`) ระบบจึงสร้าง/เพิ่มผ่าน OAuth แบบ idempotent แล้วซิงก์กลับ · `GET channels/:id/playlists` แสดง playlist + วิดีโอที่ยังไม่อยู่ใน playlist
  ภาพรวมรวมสองแพลตฟอร์ม (§36): `GET youtube/overview` → KPI YouTube + รายการ "ต้องดู" บนหน้าแรก (ต้องเชื่อมใหม่ / อัปโหลดล้มเหลว / รออนุมัติ / โควตา ≥ 80% / คอมเมนต์ค้าง / ข้อเสนอรอตัดสิน)
  Maintenance (worker `maintenance` + `youtube-maintenance`): cleanup รายวัน (session/invite/reset หมดอายุ, notification ที่อ่านแล้ว > 90 วัน, AiTaskLog > 180 วัน, ApiUsage/SyncRun > 90 วัน — **ไม่ลบ** audit/metric snapshot/report) · ตรวจ token ทุก 12 ชม. (Facebook ใกล้หมดอายุ 7 วัน, เพจ INVALID, Google ERROR → แจ้งเตือน dedupe) · upload ค้าง > 6 ชม. → UPLOAD_FAILED + แจ้งเตือน, PROCESSING > 24 ชม. → ตรวจใหม่
  CI: `.github/workflows/ci.yml` — Postgres/Redis service → migrate → build → typecheck → lint → test ทุก package → smoke phase6 + phase9 ผ่าน Next proxy กับ mock (ไม่มี key จริงใน CI)
  ทดสอบเพิ่ม: worker integration 5 (sync/upload/processing/metrics/kill switch/missing file/comments/maintenance) · API 19 (playlist plan→apply idempotent + kill switch, overview)
  อีเมล (§65): SMTP client ไม่มี dependency ใน `@fbpm/database/mail` (STARTTLS/SMTPS, AUTH PLAIN/LOGIN, ไม่ส่งรหัสผ่านผ่านช่องไม่เข้ารหัส) — คำเชิญสมาชิก, ลิงก์ตั้งรหัสใหม่, **ลืมรหัสผ่าน** (`POST /auth/forgot` ตอบ 200 เสมอ), แจ้งเตือนสำคัญถึง owner/admin (โพสต์/อัปโหลดล้มเหลว, ต้องเชื่อมใหม่, รออนุมัติ, ลีดร้อน) · ไม่ตั้ง `SMTP_HOST` = ปิด ทุกอย่างยังทำงานด้วยลิงก์คัดลอก · ทดสอบกับ `startMockSmtp()`
  รายงานส่งลูกค้า: **PDF** (`GET reports/:id/pdf`, Chromium เดียวกับ media) + **ลิงก์แชร์** อ่านอย่างเดียว มีวันหมดอายุ ไม่ต้องล็อกอิน (`POST reports/:id/share` → `/share/r/<token>` เซ็นด้วย AUTH_SECRET) ทั้ง Facebook และ YouTube
  วิเคราะห์แนวโน้ม (หน้า "วิเคราะห์"): กราฟ SVG ล้วนตามหลัก dataviz (series เดียวต่อกราฟ, ไม่มี dual axis, hover/ตาราง, ค่า null เว้นว่าง) — โพสต์/แชร์ต่อสัปดาห์ (FB), วิดีโอ/วิวต่อสัปดาห์ + ผู้ติดตามจาก snapshot (YT) ผ่าน `GET pages/:id/trends`, `GET youtube/channels/:id/trends`
  E2E (Playwright, `pnpm test:e2e`): สมัคร → ล็อกอิน → เพจ → อนุมัติคอนเทนต์ในเบราว์เซอร์ → เชื่อมช่อง YouTube ผ่าน UI (mock Google) → คลังวิดีโอ → กราฟ → ลิงก์แชร์รายงานแบบไม่มี session — ใช้ Chromium ที่ติดตั้งไว้ CI ติดตั้งเอง
  UI: ธีมสว่างทั้งแอป (กำหนดที่ `apps/web/app/globals.css` ไฟล์เดียวผ่าน Tailwind v4 `@theme`), หน้าภาพรวมแบบแดชบอร์ด (hero, KPI มีสีประจำหัวข้อ, กราฟ 8 สัปดาห์, รายการต้องดู) · เช็กลิสต์เปิดใช้งานจริงสำหรับเจ้าของระบบ: [`docs/runbooks/go-live-checklist.md`](docs/runbooks/go-live-checklist.md)
  ยังไม่ทำ (นอก MVP §165): Live (§68), YouTube Reporting API bulk (§93), thumbnail generation ด้วยภาพ AI (§39 มีแค่บรีฟ), Messenger inbox, Ads agent

- **Phase 10 — Website Care W-1/W-2 (โมดูลใน monorepo ตาม [`AGENTS_WEB.md`](AGENTS_WEB.md))** ✔
  `packages/web-core`: uptime (HTTP + คำที่ต้องพบ + latency > 3 วิ = DEGRADED), SSL (node:tls, ≤ 14 วัน = WARN), SEO audit หน้าแรก (title/description/h1/canonical/robots/og/lang/viewport/alt/word count), ลิงก์เสียภายใน (≤ 50, เคารพ robots.txt, ≤ 1 คำขอ/วิ), Core Web Vitals ผ่าน PageSpeed Insights (ไม่มี key = SKIPPED), Search Console client (ใช้บัญชี Google เดิม scope `webmasters.readonly`), กัน SSRF (ปฏิเสธ IP ภายใน), `mock-web.ts` — ไม่มี dependency
  `apps/api/src/web`: เว็บผูกแบรนด์ (เพิ่มแล้วตรวจทันที), ตรวจตามชนิด, incident (DOWN ต้องล้ม 2 ครั้งติด → แจ้งเตือน; ฟื้นตัว → แจ้งเตือน info), เชื่อม Search Console (จับคู่ property อัตโนมัติ, ไม่มีสิทธิ์ = NO_ACCESS ตรงไปตรงมา), snapshot รายวัน 28 วัน + คำค้น/หน้ายอดนิยม, trends รายสัปดาห์, overview, **SEO Analyst** (observed/inference/recommendation/content ideas อิง evidence เท่านั้น) · RBAC `web.read/manage/analytics.read`
  worker: คิว `web-monitor` (ทุก 5 นาที หาเว็บที่ถึงรอบตาม `checkIntervalMin`) และ `web-daily` (SSL/SEO/ลิงก์/PageSpeed/Search Console วันละครั้ง กระจายเวลา)
  หน้าเว็บ "เว็บไซต์": รายการ+เพิ่มเว็บ, KPI (uptime %, latency, SSL, คะแนนความเร็ว), กราฟ 12 สัปดาห์, ปัญหา SEO, ลิงก์เสีย, Search Console (เชื่อม/ซิงก์/คำค้น/หน้า), ผลวิเคราะห์ AI, incident/ประวัติ · KPI + รายการต้องดูบนภาพรวม
  ทดสอบ: unit 7 (web-core) + integration API 6 + worker 3 กับ mock ทั้งหมด
  ถัดไป (W-3/W-4 ตามสเปก): ContentItem `platform=WEB` → WordPress publisher ผ่านอนุมัติ · Email marketing (consent/unsubscribe/ผู้ให้บริการส่งจำนวนมาก)

ยังไม่ทำ: Messenger inbox (§14 MESSAGE_RECEIVED normalize แล้วแต่ยังไม่มีหน้า — ต้องสิทธิ์ pages_messaging) · อีเมลจริง (SMTP) · export PDF รายงาน · client share link · Ads agent (§26)
ทำภายหลัง: เชิญสมาชิกทางอีเมล (§65), ลืมรหัสผ่าน, rate limit บน Redis เมื่อมีหลาย instance

## โครงสร้าง
```
apps/api            NestJS REST API        →  :4000  /health  /docs  (+ /workspaces/:id/youtube/*, /web/*)
apps/web            Next.js dashboard      →  :3000
workers/scheduler   BullMQ worker (คิวตาม §46)
packages/shared     enum + กฎโดเมนล้วน (state machine, RBAC, risk level)
packages/database   Prisma schema + migrations + tenant-scoping helpers
docs/               ADR · runbooks
deploy/             Caddyfile
```
โค้ดชุดเดิม (`fb-pages.mjs`, `server.mjs`, `lib/`, `web/`) ยังอยู่และใช้งานได้ระหว่างเปลี่ยนผ่าน — ดู [ADR-001](docs/architecture/ADR-001-migration-to-agents-md-stack.md)

## เริ่มใช้งาน
- ในเครื่อง: [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md)
- บน VPS: [`docs/runbooks/ubuntu-vps.md`](docs/runbooks/ubuntu-vps.md)

```bash
cp env.example .env && pnpm install && pnpm db:migrate && pnpm build
pnpm typecheck && pnpm lint && pnpm test                       # unit tests
DATABASE_URL=... REDIS_URL=... AUTH_SECRET=<32+> pnpm --filter @fbpm/api test   # + integration (tenant isolation)
node test/phase1-smoke.mjs && node test/phase2-smoke.mjs       # end-to-end (ต้องเปิด api/web ก่อน)
```
