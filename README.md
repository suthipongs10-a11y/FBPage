# Facebook AI Page Manager

AI Marketing Manager สำหรับเพจ Facebook — อ่านข้อมูลจริง → วิเคราะห์ → วางแผน → สร้างคอนเทนต์ → ขออนุมัติ → เผยแพร่ → วัดผล → เรียนรู้

**อ่านก่อนเขียนโค้ด:** [`AGENTS.md`](AGENTS.md) คือคู่มือหลักของโปรเจกต์ · การตัดสินใจเชิงสถาปัตยกรรมอยู่ใน [`docs/architecture/`](docs/architecture/)

## สถานะ
**Phase 1 — ฐานระบบ** (AGENTS.md §106 ข้อแรก): monorepo · Docker Compose · PostgreSQL + Redis · NestJS API พร้อม health check + OpenAPI · Next.js shell · BullMQ worker · Prisma schema ของโดเมนหลัก

ยังไม่ทำ: Auth, Facebook OAuth, AI Gateway (ตามลำดับ §73)

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
pnpm typecheck && pnpm lint && pnpm test
```
