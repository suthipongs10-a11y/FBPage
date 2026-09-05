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
# integration test (tenant isolation / RBAC / audit) ต้องชี้ DB จริง — ข้ามอัตโนมัติถ้าไม่มี DATABASE_URL
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fbpm REDIS_URL=redis://127.0.0.1:6379 \
  AUTH_SECRET=integration-test-secret-at-least-32-chars APP_ENV=test pnpm --filter @fbpm/api test
# end-to-end ผ่านหน้าเว็บ (เปิด api + web ก่อน)
#   node test/phase3-smoke.mjs  — เชื่อมเพจจริงแบบอ่านอย่างเดียวด้วย USER_TOKEN ใน env (ตอนจบตัดการเชื่อมต่อ+ลบ token ให้เอง)
#   node test/phase5-smoke.mjs  — AI gateway กับ mock AI ที่สคริปต์เปิดเอง (ไม่ใช้ key จริง)
#   node test/phase6-smoke.mjs  — content loop (ร่าง→อนุมัติ→ตั้งเวลา→โพสต์) กับ mock Graph: เปิด API ด้วย META_GRAPH_BASE_URL=http://127.0.0.1:4998 ก่อน
# worker (pnpm dev:worker) ต้องได้ AUTH_SECRET ตัวเดียวกับ API เพื่อถอดรหัส page token; งานตั้งเวลาโพสต์จะไม่ยิงถ้า worker ไม่รัน
node test/phase1-smoke.mjs && node test/phase2-smoke.mjs
```

## บัญชีแรก
เปิด http://localhost:3000/register — ผู้สมัครคนแรกเป็น owner ของ workspace ที่สร้างให้อัตโนมัติ
เพิ่มสมาชิกได้ที่ ตั้งค่า → สมาชิก (ต้องมีบัญชีแล้ว) · หน้าเว็บคุยกับ API ผ่าน `/api/*` (Next rewrite) จึงเป็น same-origin

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

## เริ่มรับงานลูกค้า
ดู [first-client.md](first-client.md) — ขั้นตอนครบลูปตั้งแต่สร้างลูกค้าจนส่งรายงาน

## โมดูล YouTube (Phase 9)
- ไม่ตั้ง `GOOGLE_*`/`YOUTUBE_API_KEY` ก็รันได้ — หน้า YouTube จะขึ้น "ยังไม่ตั้งค่า" (ดู [docs/youtube/runbooks/google-cloud-setup.md](../youtube/runbooks/google-cloud-setup.md))
- ทดสอบครบลูปโดยไม่แตะช่องจริง:
  ```bash
  YOUTUBE_MOCK_BASE_URL=http://127.0.0.1:4997 GOOGLE_CLIENT_ID=gclient GOOGLE_CLIENT_SECRET=gsecret \
  GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:4000/youtube/oauth/callback YOUTUBE_API_KEY=APIKEY_OK YOUTUBE_UPLOAD_ENABLED=true pnpm dev:api
  node test/phase9-smoke.mjs
  ```
- worker ต้องเห็น env เดียวกัน (`GOOGLE_*`, `YOUTUBE_*`, `MEDIA_DIR`, `AUTH_SECRET`) เพื่ออัปโหลด/ซิงก์ตามรอบ
