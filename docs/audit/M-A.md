# Audit M-A — Meta Gateway + Token Management

ตรวจเทียบกับ `PAGE-OS-SPEC.md` ข้อ 0, 5, 6, M0 และกฎ 8 ข้อใน `CLAUDE.md`

**ผลรวม: ผ่าน** — 261 เทสต์ผ่านทั้งหมด, typecheck สะอาด
เจอช่องโหว่ที่สเปกสั่งไว้แต่ยังไม่ได้ทำ 2 จุด (อุดแล้วในรอบ audit นี้)

---

## 1. สเปกข้อ 5 — หน้าที่ของ Gateway ทั้ง 7 ข้อ

| # | หน้าที่ | สถานะ | หลักฐาน |
|---|---|---|---|
| 1 | ดึง token ที่ถูกต้อง + decrypt | ✅ | `EncryptedTokenStore.getPageToken()` — เทสต์: อ่านกลับได้, ปฏิเสธ token หมดอายุ/ถูกเพิกถอน |
| 2 | ใส่ `GRAPH_VERSION` จาก env | ✅ | `resolveGraphVersion()` — เทสต์สถาปัตยกรรมบังคับว่ามีเลขเวอร์ชันในโค้ดจริงแค่ที่เดียว |
| 3 | Token bucket ต่อเพจ เข้าคิวถ้าใกล้เต็ม | ✅ | `TokenBucket` + `PageScheduler` — เทสต์: แต่ละเพจมีถังของตัวเอง, retry ไม่ข้าม rate limit |
| 4 | อ่าน `X-App-Usage` > 80% ชะลอ | ✅ | `UsageGovernor` — เทสต์: 92% แล้ว call ถัดไปถูกหน่วงจริง |
| 5 | Retry backoff เฉพาะ 4/32/80001/5xx | ✅ | เทสต์ยืนยันว่า 100/190/200 ยิงครั้งเดียวไม่ retry |
| 6 | Map error → ข้อความไทย | ✅ | `classifyMetaError()` + ฟิลด์ `action` ให้โค้ดตัดสินใจ |
| 7 | Log ทุก call ลง DB | ✅ | `CallLogSink` + ตาราง `meta_call_logs` |

---

## 2. กฎ 8 ข้อใน CLAUDE.md — บังคับด้วยเทสต์แล้ว

`packages/meta/src/architecture.test.ts` สแกนซอร์สจริงทุกครั้งที่รันเทสต์:

| กฎ | วิธีบังคับ |
|---|---|
| 1. ทุก call ผ่าน gateway | ไม่มีไฟล์ไหนนอก `gateway.ts` ที่รู้จัก `graph.facebook.com` หรือเรียก `fetch()` |
| 2. version จาก env | เลขเวอร์ชันปรากฏในโค้ดจริงได้ครั้งเดียวเท่านั้น |
| 3. ห้าม log token | ไม่มี `console.*`, ไม่มีการส่ง `accessToken` เข้า logger, token อยู่ใน header ไม่ใช่ query |
| 4. เวลาเป็น UTC | ทุกคอลัมน์ `DateTime` ใน schema เป็น `Timestamptz`/`Date`, ห้าม `new Date()` แบบไม่ส่ง argument |
| 7. บอทห้ามใช้ HUMAN_AGENT | คำนี้ห้ามปรากฏในโค้ดเลย |
| 8. ห้าม legacy tag | ปรากฏได้เฉพาะใน `errors.ts` (ตัวตรวจจับ) |

กฎข้อ 5 (queue) และ 6 (idempotency) จะบังคับได้เต็มที่ตอน M-B/M-E ที่มี worker และ webhook จริง
schema เตรียมไว้แล้ว (`mid` unique, `fb_comment_id` unique)

---

## 3. ช่องโหว่ที่เจอ และแก้แล้วในรอบ audit นี้

### 3.1 หน้า Connection Status ขาดสถานะ webhook (สเปกข้อ M0)

สเปกเขียนว่าหน้านี้ต้องแสดง *"token OK / permission ขาดตัวไหน / **webhook subscribed หรือยัง**"*
สองอย่างแรกทำแล้ว อย่างที่สามยังไม่มี

**ทำไมสำคัญ:** ถ้า token ปกติแต่ไม่ได้ subscribe webhook ข้อความลูกค้าจะไม่เข้าระบบเลย
โดยไม่มี error ให้เห็น — เป็นอาการที่หาสาเหตุยากที่สุดอันหนึ่ง

**แก้:** เพิ่ม `SubscriptionService` (`check` / `subscribe` / `unsubscribe`)
ตรวจครบทั้ง 5 field ที่สเปกข้อ M1 กำหนด และรายงานว่าขาดตัวไหน

### 3.2 OAuth callback ไม่มีการป้องกัน CSRF

`buildLoginUrl()` รับ `state` มาใส่ใน URL เฉยๆ แต่ไม่มีกลไกตรวจตอน callback

**ทำไมสำคัญ:** คนอื่นสามารถหลอกให้เบราว์เซอร์เราเรียก callback ด้วย `code` ของบัญชีเขา
ผลคือ **เพจของคนแปลกหน้าถูกผูกเข้า workspace ของลูกค้าเรา**

**แก้:** เพิ่ม `createOAuthState()` / `verifyOAuthState()` — เซ็นด้วย HMAC-SHA256
แบบ stateless มี nonce กัน replay และหมดอายุใน 30 นาที

---

## 4. บั๊กที่เจอตอนพัฒนา (แก้ไปแล้วก่อน commit M-A)

| บั๊ก | ผลถ้าไม่แก้ |
|---|---|
| Priority inversion ใน scheduler | งาน bulk 500 ตัวดองคิวจนตอบ inbox ไม่ทัน 24h window |
| `record()` ที่ throw ถูก retry loop จับ | DB สะดุดหลังโพสต์สำเร็จ → **โพสต์ขึ้นเพจซ้ำ** |
| ข้อความไทยหายตอนห่อ error ใหม่ | "ต่อ Facebook ไม่ได้" กลายเป็น "HTTP 599" ที่ไม่บอกอะไร |
| Health check วนทีละเพจ | เน็ตมีปัญหา = 30 เพจกินเวลาเป็นนาที ทับรอบ cron ถัดไป |
| `FakeClock.advance` เช็ค timer ก่อน microtask ลงทะเบียน | เทสต์ค้าง (บั๊กของ test infra) |

---

## 5. ข้อจำกัด Meta ตามสเปกข้อ 0 — ตรวจแล้ว

| เรื่อง | สถานะ |
|---|---|
| Graph v25.0 pin ที่ env ตัวเดียว | ✅ บังคับด้วยเทสต์ |
| Permission dependency ยื่นเป็นชุด | ✅ `expandWithDependencies()` ลาก dependency มาให้ครบ |
| Legacy message tags ปลดระวาง | ✅ ตรวจจับแล้วคืน `action: "deprecated"` พร้อมบอกให้ใช้ Utility Template |
| Rate limit 4 / 32 / 80001 + `X-App-Usage` | ✅ ครบ รวม `X-Business-Use-Case-Usage` และ `estimated_time_to_regain_access` |
| HUMAN_AGENT เฉพาะคนพิมพ์ | ✅ schema แยก `sent_by: human \| bot \| system` + เทสต์ห้ามใช้ tag นี้ |
| Recurring Notifications ปิดในไทย | ✅ ไม่มีฟีเจอร์ broadcast ในแผน |
| Page Reach ปลดระวาง มิ.ย. 2026 | ⬜ เกี่ยวกับ M-D บันทึกไว้ใน CLAUDE.md แล้ว |
| Webhook mTLS | ⬜ งานระดับ VPS ไม่ใช่โค้ด อยู่ในเช็คลิสต์ข้อ 10 |

---

## 6. สเปกข้อ 6 — ปัญหาที่ต้องแก้ตั้งแต่ต้น (เฉพาะที่เกี่ยวกับ M-A)

| ข้อ | สถานะ |
|---|---|
| 6.4 โพสต์ผิดเพจ | ⬜ เป็นงาน UI ของ M-B (confirm dialog) |
| 6.5 Token หลุดเงียบ | ✅ health check ทุก 6 ชม. + mark revoked ทันทีที่เจอ error 190 ระหว่างใช้งาน |
| 6.6 เวลาเป็น UTC | ✅ บังคับด้วยเทสต์ |

ข้อ 6.1 (webhook ซ้ำ), 6.2 (echo loop), 6.3 (บอทแทรก), 6.7 (sync สองทาง)
เป็นเรื่องของ M-E/M-F — schema รองรับไว้แล้ว (`mid` unique, `bot_paused_until`)

---

## 7. สิ่งที่ยังเหลือของ M-A (ตั้งใจเลื่อน ไม่ใช่ลืม)

- **หน้าเว็บ** Connection Status และ Onboarding Wizard — ตรรกะ ป้ายสถานะ และสีพร้อมหมดแล้ว
  (`STATE_LABEL_TH`, `STATE_TONE`, `TokenHealthChecker`, `SubscriptionService`)
  เหลือแค่ชั้น UI ซึ่งจะทำพร้อม `apps/web` ตอน M-B
- **Prisma migration จริง** — schema เขียนครบแล้ว ต้องมี Postgres + pgvector ก่อนถึงจะรันได้
- **`PageTokenRepository` ที่ต่อ Prisma** — interface พร้อม, ตอนนี้ใช้ `InMemory` ในเทสต์

---

## 8. สรุป

รากฐานแน่นพอที่จะสร้าง M-B ต่อได้ จุดที่ต้องระวังต่อไป:

1. **M-B ต้องไม่เรียก Meta ตรง** — เทสต์สถาปัตยกรรมจะจับได้ทันทีถ้าเผลอ
2. **`assertNoManualToken` กันโมดูลอื่นแอบส่ง token เอง** — ถ้ามีคนพยายามส่ง `access_token`
   มาใน params จะโยน error ทันทีพร้อมบอกเหตุผล
3. **`priority` ต้องใส่ให้ถูก** — งานโพสต์ตามเวลาใช้ `high`, งาน sync ใช้ `low`
   ไม่งั้นงานหนักจะไปเบียดงานที่ลูกค้ารออยู่
