# PAGE OS

ระบบดูแลเพจ Facebook สำหรับ "คนเดียวดูแลหลายเพจ"

สเปกเต็ม: [`PAGE-OS-SPEC.md`](./PAGE-OS-SPEC.md) · สถานะงาน: [`STATUS.md`](./STATUS.md) ·
รายงานตรวจงานแต่ละรอบ: [`docs/audit/`](./docs/audit/)

---

## เริ่มใช้งานบนเครื่องตัวเอง

### ต้องมีอะไรก่อน

| ของ | เอามาจากไหน | เช็คว่ามีแล้วยังไง |
|---|---|---|
| **Node 22 ขึ้นไป** | <https://nodejs.org> (เลือก LTS) | `node -v` ต้องขึ้น `v22.x` หรือสูงกว่า |
| **pnpm** | `npm install -g pnpm` | `pnpm -v` |
| **Docker Desktop** | <https://www.docker.com/products/docker-desktop/> | `docker -v` — และต้อง**เปิดโปรแกรมค้างไว้** ไม่ใช่แค่ติดตั้ง |

Docker มีไว้ยก Postgres + Redis เท่านั้น ถ้ามีสองตัวนี้อยู่แล้วก็ข้ามได้ —
ตอน `pnpm configure` ให้ใส่ที่อยู่ของตัวที่มีอยู่แทน

### ห้าคำสั่ง

```bash
pnpm install             # ลง dependency + สร้าง Prisma Client ให้เอง
docker compose up -d     # ยก Postgres + Redis (image มี pgvector มาให้แล้ว)
pnpm configure           # ถามทีละค่า แล้วเขียน .env ให้
pnpm db:push             # สร้างตารางในฐานข้อมูล
pnpm preflight           # ตรวจว่าพร้อมจริงไหม — บอกด้วยว่าต้องพิมพ์อะไรต่อ
pnpm dev                 # เปิดทั้งสามตัวพร้อมกัน
```

เปิด <http://localhost:3000/settings> แล้วเชื่อมเพจแรก

> ⚠️ **ชื่อคำสั่งคือ `configure` กับ `preflight` ไม่ใช่ `setup` กับ `doctor`**
> เพราะสองชื่อหลังเป็นคำสั่งในตัวของ pnpm อยู่แล้ว — พิมพ์ `pnpm setup` จะได้
> ตัวตั้งค่าของ pnpm เอง (ขึ้นว่า "Setup complete") ทั้งที่ `.env` ไม่ถูกสร้าง
> แล้วไปพังต่อที่ `pnpm db:push` แบบเดาสาเหตุไม่ออก

### แต่ละคำสั่งทำอะไร

| คำสั่ง | ทำอะไร |
|---|---|
| `pnpm configure` | ถามค่าทีละตัวเป็นภาษาไทย พร้อมบอกว่าไปเอามาจากไหน สร้างกุญแจเข้ารหัสให้เอง แล้วเขียน `.env` (สิทธิ์ 600) |
| `pnpm preflight` | ตรวจ Node, Prisma Client, `.env`, ต่อ Postgres/Redis ได้ไหม, ตารางมีหรือยัง — ทุกข้อที่ไม่ผ่านมีคำสั่งแก้ติดมาด้วย |
| `pnpm dev` | build แล้วเปิด web + webhook + worker พร้อมกัน รวม log มาไว้ที่เดียว กด Ctrl+C ปิดทั้งหมดแบบเรียบร้อย |
| `pnpm check` | typecheck + เทสต์ทั้งหมด — รันก่อน commit ทุกครั้ง |
| `pnpm db:push` | สร้าง/อัปเดตตารางในฐานข้อมูลตาม `schema.prisma` |
| `pnpm db:generate` | สร้าง Prisma Client ใหม่ (ปกติ `pnpm install` / `pnpm dev` ทำให้เองแล้ว) |
| `pnpm clean` | ลบของที่ build ไว้ทั้งหมด |

`pnpm dev` เปิดสามโปรเซส:

| โปรเซส | ที่อยู่ | ถ้าไม่รันจะเป็นยังไง |
|---|---|---|
| web | <http://localhost:3000> | ไม่มีหน้าจอให้ดู |
| webhook | <http://localhost:3001/healthz> | Meta ส่ง event มาไม่ได้ |
| worker | — | **โพสต์ที่ตั้งเวลาไว้ไม่ขึ้น** โดยไม่มี error ที่ไหนเลย |

log แบบเต็ม (JSON) อยู่ใน `.logs/` ส่วนบนจอย่อให้อ่านง่ายแล้ว

### เปิด localhost ไม่ได้ ทำยังไง

**1. ดูบรรทัด "เปิดครบแล้ว" บนจอ ว่าบอกพอร์ตอะไร**

```
เปิดครบแล้ว
  หน้าเว็บ   http://localhost:3000
  ตั้งค่า    http://localhost:3000/settings
  webhook   http://localhost:3001/healthz
```

URL ที่แสดงคือของจริงเสมอ — ถ้าพอร์ต 3000 ไม่ว่าง Next จะย้ายไปพอร์ตอื่น
แล้วบรรทัดนี้จะบอกพอร์ตใหม่พร้อมเหตุผล **ให้กดตามที่ขึ้นบนจอ อย่าเดาว่า 3000**

**2. ถ้าไม่มีบรรทัดนั้นเลย** แปลว่ามีตัวใดตัวหนึ่งสตาร์ทไม่ขึ้น มันจะบอกว่าให้ไปดู
`.logs/<ชื่อ>.log` — สาเหตุที่พบบ่อยที่สุดคือ Postgres/Redis ยังไม่ขึ้น
(`docker compose ps` เช็ค แล้ว `docker compose up -d`)

**3. `pnpm preflight`** ไล่ให้ทีละข้อว่าติดตรงไหน พร้อมคำสั่งแก้

### ตารางอาการ → สาเหตุ

| อาการ | มักเป็นเพราะ |
|---|---|
| หน้าเว็บขาว / ต่อไม่ติด | พอร์ตไม่ใช่ 3000 — ดูบนจอ |
| `ECONNREFUSED ...:6379` | Redis ยังไม่ขึ้น → `docker compose up -d` |
| `ECONNREFUSED ...:5432` | Postgres ยังไม่ขึ้น → `docker compose up -d` |
| `ยังไม่มีไฟล์ .env` | ยังไม่ได้รัน `pnpm configure` |
| `table ... does not exist` | ยังไม่ได้รัน `pnpm db:push` |
| `docker : The term 'docker' is not recognized` | ยังไม่ได้ติดตั้ง Docker Desktop (ลิงก์อยู่ตารางบนสุด) |
| `error during connect: ... docker_engine` | ติดตั้ง Docker แล้วแต่ยังไม่ได้เปิดโปรแกรม |
| `Setup complete. Open a new terminal...` | พิมพ์ `pnpm setup` ไป — ตัวที่ต้องการคือ `pnpm configure` |
| `Environment variable not found: DATABASE_URL` (P1012) | ยังไม่มี `.env` → `pnpm configure` |
| `TS7006: Parameter 'r' implicitly has an 'any' type` ในไฟล์ที่ไม่ได้แก้ | Prisma Client ยังไม่ถูกสร้าง → `pnpm db:generate` |
| `ELIFECYCLE Command failed.` ตอนกด Ctrl+C | ไม่ใช่ error — เป็นเสียงบ่นของ pnpm เวลาโดนสัญญาณหยุด ปิดครบทุกตัวแล้ว (ดูบรรทัด "ปิดระบบครบทุกขั้นแล้ว" เหนือขึ้นไป) |
| ทุกหน้าที่แตะฐานข้อมูลขึ้น 500 + `could not locate the Query Engine` | Prisma ถูกลากเข้า bundle ของ Next — ล็อกไว้แล้วใน `apps/web/next.config.ts` ถ้าเจออีกแปลว่าค่านั้นหายไป (`apps/web/src/next-config.test.ts` จะจับได้) |

> `pnpm install`, `pnpm dev`, `pnpm build` และ `pnpm typecheck` เรียก
> `scripts/ensure-prisma.mjs` ให้อัตโนมัติแล้ว จึงไม่ควรเจอ TS7006 อีก —
> ถ้ายังเจอแปลว่า `prisma generate` พัง ให้สั่ง `pnpm db:generate` ดู error เต็ม

---

## ป้อนคีย์ต่างๆ ตรงไหน

แบ่งเป็นสองที่ ตามว่าค่านั้นถูกอ่านตอนไหน — **ไม่ใช่เพราะทำไม่เสร็จ**

### 1. ค่าที่อ่านตอนโปรเซสสตาร์ท → `pnpm configure`

`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `TOKEN_ENC_KEYS`,
`DATABASE_URL`, `REDIS_URL` และค่าตั้งค่าอื่นๆ

หน้าเว็บแก้ค่าพวกนี้ไม่ได้โดยตั้งใจ: มันถูกอ่านตอนสตาร์ท แก้แล้วก็ต้องรีสตาร์ทอยู่ดี
และตัวที่สำคัญที่สุดคือ `TOKEN_ENC_KEYS` ซึ่งเป็นกุญแจถอดรหัส token ทุกเพจ —
ถ้าหน้าเว็บเขียนทับได้ ใครที่เข้าหน้านั้นได้ก็ทำให้ token ทุกเพจใช้ไม่ได้ถาวรในคลิกเดียว

> ⚠️ **`TOKEN_ENC_KEYS` สร้างครั้งเดียว** `pnpm configure` จะไม่สร้างทับของเดิมเด็ดขาด
> ถ้าไฟล์ `.env` หายหลังเชื่อมเพจไปแล้ว token เดิมถอดรหัสไม่ได้อีกเลย ต้องเชื่อมใหม่ทุกเพจ

### 2. token ของแต่ละเพจ → หน้า `/settings`

วาง **Page Access Token** จาก [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
ระบบจะตรวจกับ Meta ให้ก่อน (ใช้ได้จริงไหม · ออกโดยแอปเราหรือเปล่า · เป็น token
ของเพจหรือของผู้ใช้) แล้วเก็บแบบเข้ารหัส AES-256-GCM ลงฐานข้อมูล

หน้านี้ยังแสดงสถานะค่าใน `.env` ทั้งหมดให้ดูด้วย (ปิดบังค่าลับไว้) จะได้เห็นในที่เดียว
ว่าตั้งครบหรือยัง

> ทางนี้มีไว้สำหรับช่วงทดสอบ เพราะ OAuth เต็มรูปแบบใช้ได้หลังผ่าน App Review เท่านั้น
> token จาก Explorer อายุสั้น (1–2 ชม.) — ถ้าจะใช้ยาวให้ใช้ System User Token
> จาก Business Manager ที่ไม่หมดอายุ

---

---

## โครงสร้าง

| แพ็กเกจ | หน้าที่ |
|---|---|
| `packages/core` | crypto (AES-256-GCM), logger ที่ redact token, Clock ที่ inject ได้ |
| `packages/meta` | Meta Gateway + error mapping + rate limit + OAuth/token lifecycle |
| `packages/db` | Prisma schema + TokenStore ที่เข้ารหัส + health check |
| `packages/store` | **ที่เดียวในระบบที่รู้จัก Prisma** — implement interface ของทุกโดเมน |
| `packages/publish` | ตั้งเวลาโพสต์ + retry + duplicate guard + best time |
| `packages/moderation` | จัดการคอมเมนต์ — ตรวจเบอร์/ลิงก์/คำหยาบ + กฎอัตโนมัติ |
| `packages/analytics` | sync Insights + รายงานรายเดือน |
| `packages/inbox` | webhook parsing + 24h window + SLA + handover |
| `packages/bot` | บอท 3 ชั้น + flow engine + RAG + tone |
| `packages/studio` | AI Content Studio + Template Library |
| `packages/portal` | Client Portal (magic link, ขอบเขตข้อมูล, white-label) |
| `packages/ops` | Ops Center (ตรวจปัญหา, alert, audit log, bulk actions) |
| `packages/queue` | **ที่เดียวในระบบที่รู้จัก BullMQ** — คิว, ตารางงาน, การปิดระบบ |
| `apps/web` | Next.js 15 — หอบังคับการ + ศูนย์ปฏิบัติการ + portal ลูกค้า |
| `apps/webhook` | Fastify — รับ event จาก Meta แล้วส่งต่อเข้าคิว |
| `apps/worker` | รัน cron + ยิงโพสต์ที่ถึงเวลา + ตรวจปัญหาแล้วแจ้งเตือน |

### ทำไมมี `packages/store` แยกออกมา

โดเมนแต่ละตัวประกาศแค่ **interface** ของที่เก็บข้อมูล (`PageTokenRepository`,
`AuditStore`, `AlertStore`, `MagicLinkStore`, …) แล้ว `packages/store` เป็นคน
ทำให้เป็นจริงด้วย Prisma

ข้อดีสามข้อ:

1. **ไม่เกิดวงแหวนพึ่งพา** — `ops` พึ่ง `db` อยู่แล้ว ถ้าให้ `db` implement
   `AuditStore` ของ `ops` ก็จะพึ่งกันวน
2. **โดเมนยังเทสต์ได้โดยไม่ต้องมี Postgres** — ใช้ `InMemory*` ที่มาคู่กับทุก interface
3. **มีที่เดียวให้เปิดดูว่าข้อมูลลงตารางไหน**

---

## หลักการที่ห้ามละเมิด

อยู่ใน [`CLAUDE.md`](./CLAUDE.md) — และมี **เทสต์ที่บังคับกฎเหล่านี้จริง**
(`packages/meta/src/architecture.test.ts` สแกนซอร์สทุกไฟล์ใน `packages/*/src`)

1. ทุก call ไป Meta ต้องผ่าน `MetaGateway.call()` เท่านั้น
2. Graph version อ่านจาก env ห้าม hardcode
3. Token เก็บเข้ารหัสเสมอ ห้าม log token แม้บางส่วน
4. เวลาใน DB เป็น UTC เสมอ
5. ทุกงานที่เรียก external API ต้องผ่าน queue
6. ทุก webhook ต้อง idempotent ด้วย `mid` / `comment_id`
7. บอทห้ามใช้ HUMAN_AGENT tag
8. ห้ามใช้ legacy message tags ที่ปลดระวางแล้ว

---

## สถานะตอนนี้

โดเมนทั้งหมด (M-A ถึง M-I) เขียนและตรวจงานครบแล้ว — **1,532 เทสต์**
หน้าเว็บใช้งานได้จริงสี่หน้า ที่เก็บข้อมูลทดสอบกับ Postgres จริง
และคิวงานทดสอบกับ Redis จริง

**ทำงานได้จริงแล้ว** (ทดลองรันจริง ไม่ใช่แค่เทสต์ผ่าน):

- ตั้งเวลาโพสต์ → cron หาโพสต์ที่ถึงเวลา → เข้าคิว → ยิงขึ้นเพจ → บันทึกผล
- ลูกค้าทักเข้ามา → ตรวจลายเซ็น → เข้าคิว → worker บันทึกลง inbox
  พร้อมนับถอยหลังหน้าต่าง 24 ชม. และตั้งกำหนดเวลา SLA ตามแพ็กเกจของลูกค้า
- ตรวจปัญหาทุก 5 นาที (token ใกล้หมด / webhook เงียบ / โพสต์ล้มเหลว)

> ℹ️ **หน้าเว็บส่วนอื่นยังเป็นข้อมูลตัวอย่าง** — ตอนนี้มีแต่หน้า `/settings`
> ที่ต่อฐานข้อมูลจริง ส่วนหน้า "วันนี้ / กล่องข้อความ / ปฏิทิน / ศูนย์ปฏิบัติการ"
> ยังโชว์ข้อมูลสมมติไว้ดูหน้าตา ตัวเลขในแถบข้างจึงยังไม่ตรงกับของจริง
> (เบื้องหลังทำงานกับของจริงหมดแล้ว — เหลือแค่ต่อสายหน้าจอ)

**ยังไม่มี** และเป็นสิ่งที่เหลืออยู่ก่อนใช้ดูแลเพจจริงได้:

- ต่อหน้าเว็บที่เหลือเข้ากับฐานข้อมูลจริง (ตอนนี้มีแต่ `/settings`)
- OAuth เต็มรูปแบบ — ตอนนี้ใส่ token ผ่านหน้า `/settings` ได้แล้ว
  แต่ยังต้องไปหยิบมาจาก Graph API Explorer เอง
- ปลายทางแจ้งเตือนจริง (LINE) — ตอนนี้ตรวจเจอปัญหาแล้วแต่ยังไม่ได้ส่งไปไหน
- รอบ cron ที่ยังไม่ได้ต่อ: `token-health`, `analytics-sync`,
  `morning-digest`, `monthly-report`, `purge-expired`
  (ลงทะเบียนไว้แล้วและจะขึ้นในรายการที่ล้มเหลวพร้อมบอกว่าขาดอะไร ไม่ใช่หายเงียบ)

ดูรายละเอียดใน [`STATUS.md`](./STATUS.md) และ [`docs/audit/M-J.md`](./docs/audit/M-J.md)

---

## งานนอกโค้ดที่ต้องทำขนานไป

Meta บังคับก่อนใช้ permission จริง — ดูข้อ 10 ในสเปก และรายการติดตามใน `STATUS.md`
