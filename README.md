# PAGE OS

ระบบดูแลเพจ Facebook สำหรับ "คนเดียวดูแลหลายเพจ"

สเปกเต็ม: [`PAGE-OS-SPEC.md`](./PAGE-OS-SPEC.md) · สถานะงาน: [`STATUS.md`](./STATUS.md) ·
รายงานตรวจงานแต่ละรอบ: [`docs/audit/`](./docs/audit/)

---

## เริ่มใช้งานบนเครื่องตัวเอง

```bash
# 1. ติดตั้ง
pnpm install

# 2. ยก Postgres + Redis ขึ้น (ใช้ image ที่มี pgvector มาให้แล้ว)
docker compose up -d

# 3. ตั้งค่า
cp .env.example .env
node -e "console.log('TOKEN_ENC_KEYS=k1:'+require('crypto').randomBytes(32).toString('base64'))" >> .env
#    แล้วเปิด .env ใส่ META_APP_ID / META_APP_SECRET ที่ได้จาก Meta for Developers

# 4. สร้างตารางในฐานข้อมูล
pnpm --filter @page-os/db db:push

# 5. เปิดหน้าเว็บ
pnpm --filter @page-os/web dev     # http://localhost:3000
```

### คำสั่งที่ใช้บ่อย

```bash
pnpm check        # typecheck + test ทั้งหมด — รันก่อน commit ทุกครั้ง
pnpm test         # เฉพาะเทสต์
pnpm typecheck    # เฉพาะ typecheck (รวมไฟล์เทสต์)
pnpm build        # build dist ของทุก package
```

### รันเทสต์ที่ต่อฐานข้อมูลจริง

เทสต์ของ `packages/store` จะ **ข้ามทั้งไฟล์** ถ้าไม่ได้ตั้ง `DATABASE_URL`
เครื่องที่ไม่มีฐานข้อมูลจึงยังรัน `pnpm check` ผ่าน ส่วนเครื่องที่มีจะได้ตรวจของจริง

```bash
createdb pageos_test
DATABASE_URL=postgresql://pageos:pageos@localhost:5432/pageos_test \
  pnpm --filter @page-os/db db:push
DATABASE_URL=postgresql://pageos:pageos@localhost:5432/pageos_test pnpm test
```

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
| `apps/web` | Next.js 15 — หอบังคับการ + ศูนย์ปฏิบัติการ + portal ลูกค้า |

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

โดเมนทั้งหมด (M-A ถึง M-I) เขียนและตรวจงานครบแล้ว — **1,357 เทสต์**
หน้าเว็บใช้งานได้จริงสี่หน้า และมีที่เก็บข้อมูลจริงที่ทดสอบกับ Postgres แล้ว

**ยังไม่มี** และเป็นสิ่งที่กั้นระหว่าง "รันบนเครื่องได้" กับ "ใช้ดูแลเพจจริงได้":

- `apps/webhook` — ตัวรับ event จาก Meta (ถ้าไม่มี inbox/บอท/คอมเมนต์ไม่ทำงาน)
- `apps/worker` — ตัวรัน cron และคิวงาน (ถ้าไม่มี โพสต์ที่ตั้งเวลาไว้ไม่ขึ้น)
- หน้าเชื่อมเพจ (OAuth callback) ใน `apps/web`

ดูรายละเอียดใน [`STATUS.md`](./STATUS.md)

---

## งานนอกโค้ดที่ต้องทำขนานไป

Meta บังคับก่อนใช้ permission จริง — ดูข้อ 10 ในสเปก และรายการติดตามใน `STATUS.md`
