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

ยังไม่ทำ: Messenger inbox (§14 MESSAGE_RECEIVED normalize แล้วแต่ยังไม่มีหน้า — ต้องสิทธิ์ pages_messaging) · อีเมลจริง (SMTP) · export PDF รายงาน · client share link · Ads agent (§26)
ทำภายหลัง: เชิญสมาชิกทางอีเมล (§65), ลืมรหัสผ่าน, rate limit บน Redis เมื่อมีหลาย instance

## โครงสร้าง
```
apps/api            NestJS REST API        →  :4000  /health  /docs
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
