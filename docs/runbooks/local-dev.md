# Runbook — รันในเครื่องพัฒนา

## ต้องมี
- Node.js 22+ · pnpm 10 (`corepack enable`)
- PostgreSQL 16 และ Redis 7 — ผ่าน Docker (`docker compose up postgres redis`) หรือติดตั้งในเครื่อง
- Chromium (สำหรับสร้างภาพ — ไม่บังคับใน Phase 1)

## ครั้งแรก
```bash
cp env.example .env            # แล้วแก้ DATABASE_URL / REDIS_URL / AUTH_SECRET
pnpm install
pnpm db:migrate                # สร้างตารางจาก packages/database/prisma
pnpm build
```

## รันแยกส่วน
```bash
pnpm dev:api                   # http://localhost:4000  · OpenAPI: /docs · health: /health
pnpm dev:web                   # http://localhost:3000
pnpm dev:worker                # BullMQ worker (ต้องมี Redis)
```

## ตรวจก่อน commit (Definition of Done §76)
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## ถ้าไม่มี Docker daemon (เช่นในคอนเทนเนอร์พัฒนา)
```bash
# PostgreSQL ต้องรันเป็น user postgres
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/16/fbpm-dev -U postgres --auth=trust
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/fbpm-dev -o "-p 5432 -c listen_addresses=127.0.0.1" -l /var/lib/postgresql/16/fbpm-dev/log -w start
sudo -u postgres psql -h 127.0.0.1 -c "CREATE DATABASE fbpm;"
redis-server --daemonize yes
```

## เรื่องที่รู้แล้วจากการใช้งานจริง (ดู ADR-001)
- ค่า metric ที่ Graph ปฏิเสธต้องเก็บเป็น `null` ไม่ใช่ `0`
- `description` ของเพจห้ามมี emoji
- โค้ดชุดเดิม (`fb-pages.mjs`, `server.mjs`) ยังใช้ทำงานลูกค้าได้ระหว่างระบบใหม่ยังไม่ครบ
