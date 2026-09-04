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

ยังไม่ทำ (ตามลำดับ §73): AI Gateway + BYOK (ขั้น 5) · Agents + content/approval/scheduler/publisher (ขั้น 6+)
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
