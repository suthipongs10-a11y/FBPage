# Facebook AI Page Manager

AI Marketing Manager สำหรับเพจ Facebook — อ่านข้อมูลจริง → วิเคราะห์ → วางแผน → สร้างคอนเทนต์ → ขออนุมัติ → เผยแพร่ → วัดผล → เรียนรู้

**อ่านก่อนเขียนโค้ด:** [`AGENTS.md`](AGENTS.md) คือคู่มือหลักของโปรเจกต์ · การตัดสินใจเชิงสถาปัตยกรรมอยู่ใน [`docs/architecture/`](docs/architecture/)

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

ยังไม่ทำ (ตามลำดับ §73): Strategist/Content agents + content domain + approval + scheduler + publisher (ขั้น 6+) · comments/leads · reports · webhooks
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
