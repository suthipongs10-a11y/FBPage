# PAGE OS

ระบบดูแลเพจ Facebook ครบวงจร สำหรับ "คนเดียวดูแลหลายเพจ"
สเปกเต็มอยู่ที่ `PAGE-OS-SPEC.md` — สถานะงานอยู่ที่ `STATUS.md`

## หลักการที่ห้ามละเมิด

1. ทุก call ไป Meta ต้องผ่าน `packages/meta` (`MetaGateway.call()`) เท่านั้น
   ห้ามเรียก `graph.facebook.com` ตรงจากที่อื่นเด็ดขาด
2. Graph version อ่านจาก env `GRAPH_VERSION` ห้าม hardcode
   — มีที่เดียวที่รู้จักเลขเวอร์ชันคือ `resolveGraphVersion()`
3. Token เก็บเข้ารหัสเสมอ (AES-256-GCM) ห้าม log token แม้บางส่วน
   — `createLogger()` scrub ให้อัตโนมัติ แต่อย่าพึ่งอย่างเดียว อย่าใส่ token ลง log ตั้งแต่แรก
4. เวลาใน DB เป็น UTC เสมอ แสดงผลค่อยแปลงตาม timezone ของเพจ
5. ทุกงานที่เรียก external API ต้องผ่าน queue ห้ามทำใน request handler
6. ทุก webhook ต้อง idempotent ด้วย `mid` / `comment_id`
7. บอทห้ามใช้ HUMAN_AGENT tag เด็ดขาด (Meta อนุญาตเฉพาะข้อความที่คนพิมพ์)
8. ห้ามใช้ legacy message tags — `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`,
   `ACCOUNT_UPDATE` ปลดระวางแล้ว 27 เม.ย. 2026 → ใช้ Utility Template แทน

## ข้อจำกัด Meta ที่ต้องจำ (ส.ค. 2026)

| เรื่อง | สถานะ |
|---|---|
| Graph API | v25.0 — v18/v19 หมดอายุแล้ว |
| Recurring Notifications | ปิดในไทย → ห้ามวางแผนฟีเจอร์ broadcast รายสัปดาห์ |
| Page Reach / Impressions | ปลดระวาง มิ.ย. 2026 → ใช้ Page Viewer Metric / Media Views |
| HUMAN_AGENT tag | ขยายเป็น 7 วัน แต่ต้องเป็นข้อความที่คนพิมพ์ |
| Webhook mTLS | ต้อง trust Meta internal CA ตั้งแต่ 31 มี.ค. 2026 |
| Rate limit | error 4 (app), 32 (page), 80001 (page/system) + header `X-App-Usage` |

## โครงสร้าง

```
packages/core     crypto (AES-256-GCM), logger ที่ redact token, Clock ที่ inject ได้
packages/meta     Meta Gateway + error mapping + rate limit + OAuth/token lifecycle
packages/db       Prisma schema + TokenStore ที่เข้ารหัส + health check
packages/store    ที่เดียวในระบบที่รู้จัก Prisma — implement interface ของทุกโดเมน
packages/queue    ที่เดียวในระบบที่รู้จัก BullMQ — คิว, ตารางงาน, การปิดระบบ
apps/web          Next.js 15 (หอบังคับการ + ศูนย์ปฏิบัติการ + portal ลูกค้า)
apps/webhook      Fastify service รับ webhook จาก Meta แล้วส่งเข้าคิว
apps/worker       BullMQ workers + cron
```

โดเมนที่เหลืออยู่ใน `packages/{publish,moderation,analytics,inbox,bot,studio,portal,ops,listening}`
— ดูตารางเต็มใน `README.md`

## คำสั่ง

```bash
pnpm install      # ลง dependency + สร้าง Prisma Client ให้เอง (postinstall)
pnpm check        # typecheck + test ทั้งหมด (รันก่อน commit ทุกครั้ง)
pnpm test         # เฉพาะเทสต์
pnpm typecheck    # เฉพาะ typecheck (รวมไฟล์เทสต์)
pnpm build        # build dist ของทุก package
pnpm configure    # ตัวถาม-ตอบ เขียนไฟล์ .env
pnpm preflight    # ตรวจความพร้อมก่อนเปิดระบบ
pnpm dev          # เปิด web + webhook + worker พร้อมกัน
```

> ชื่อคำสั่งห้ามชนกับคำสั่งในตัวของ pnpm (`setup`, `doctor`, `init`, `pack`, …)
> — pnpm จะรันของตัวเองเงียบๆ โดยไม่บอกว่ามีสคริปต์ชื่อเดียวกันอยู่
> `scripts/package-scripts.test.ts` บังคับกฎนี้ไว้แล้ว

## แนวทางเขียนโค้ดในโปรเจ็คนี้

- **Inject dependency เสมอ** — `Clock`, `fetch`, `Logger`, `TokenStore` ส่งเข้ามาทาง constructor
  ทำให้เทสต์ได้โดยไม่ต้องต่อเน็ตและไม่ต้องรอเวลาจริง (ดู `FakeClock`)
- **ข้อความ error เป็นภาษาไทยและบอกว่าต้องทำอะไรต่อ** ไม่ใช่แค่บอกว่าพัง
  ทุก error จาก gateway มีฟิลด์ `action` ให้โค้ดตัดสินใจ และ `th` ให้คนอ่าน
- **คอมเมนต์อธิบาย "ทำไม" ไม่ใช่ "ทำอะไร"** โดยเฉพาะจุดที่ทำสวนสามัญสำนึก
- เทสต์ต้องอธิบายพฤติกรรมที่ต้องการ ไม่ใช่สะท้อนโค้ดที่เขียนไป
