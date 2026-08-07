# สถานะงาน PAGE OS

อัปเดตล่าสุด: หลังจบ M-A

## ความคืบหน้าตาม Roadmap (สเปกข้อ 7)

| Milestone | ขอบเขต | สถานะ |
|---|---|---|
| **M-A** | Meta Gateway + Auth + Token management + Connection status | ✅ เสร็จ |
| — | ยื่น App Review + Business Verification | ⬜ งานนอกโค้ด (ดูข้อ 10 ในสเปก) |
| **M-B** | Content Calendar + Publishing + Retry + Duplicate guard | 🔜 ถัดไป |
| **M-C** | Comment Automation | ⬜ |
| **M-D** | Analytics sync + Monthly PDF report | ⬜ |
| **M-E** | Unified Inbox + Webhook realtime + SLA | ⬜ |
| **M-F** | Chatbot 3 ชั้น + Flow Builder + RAG | ⬜ |
| **M-G** | AI Content Studio + Template Library | ⬜ |
| **M-H** | Client Portal + Onboarding wizard | ⬜ |
| **M-I** | Ops Center + Audit + Bulk actions | ⬜ |
| **M-J** | Billing | ⬜ |

---

## M-A — เสร็จแล้ว

### สิ่งที่ทำได้ตอนนี้

**Meta Gateway (`packages/meta`)** — ครบทั้ง 7 หน้าที่ตามสเปกข้อ 5

| # | หน้าที่ตามสเปก | อยู่ที่ |
|---|---|---|
| 1 | ดึง token ที่ถูกต้อง + decrypt | `TokenStore` → `EncryptedTokenStore` |
| 2 | ใส่ `GRAPH_VERSION` จาก env | `resolveGraphVersion()` |
| 3 | Token bucket ต่อเพจ เข้าคิวถ้าใกล้เต็ม | `TokenBucket` + `PageScheduler` |
| 4 | อ่าน `X-App-Usage` > 80% ชะลอ | `UsageGovernor` |
| 5 | Retry backoff เฉพาะ 4/32/80001/5xx | `MetaGateway.call()` |
| 6 | Map error → ข้อความไทย | `classifyMetaError()` |
| 7 | Log ทุก call ลง DB | `CallLogSink` |

**Token lifecycle (M0)**
- OAuth: code → short-lived → long-lived → page tokens
- รองรับ System User Token (ไม่หมดอายุ)
- เก็บเข้ารหัส AES-256-GCM + AAD ผูกกับ pageId + รองรับ key rotation
- `debug_token` health check ทุก 6 ชม. พร้อมส่ง alert
- ตรวจ permission ครบ 11 ตัว + บอกว่าฟีเจอร์ไหนใช้ไม่ได้เพราะขาดสิทธิ์อะไร

**Data model (`packages/db/prisma/schema.prisma`)** — ครบตามสเปกข้อ 3
รวม `meta_call_logs` สำหรับตอบคำถาม "ทำไมโพสต์ไม่ขึ้น"

### เทสต์

```
218 tests ผ่านทั้งหมด (10 ไฟล์)
```

รันด้วย `pnpm check` (typecheck + test)

### บั๊กที่เจอตอนทำ M-A และแก้ไปแล้ว

1. **Priority inversion ใน scheduler** — งาน `bulk` ที่เข้าคิวก่อนจะจอง token ทันที
   ทำให้งาน `realtime` ที่มาทีหลังแซงไม่ได้จริง (คือเคสที่ทำให้ตอบ inbox ไม่ทัน 24h window)
   แก้เป็น "รอให้ยิงได้ก่อน แล้วค่อยเลือกคน"
2. **Call log ที่พังทำให้ยิงซ้ำ** — `record()` ที่ throw ถูกจับโดย catch ของ retry loop
   แล้ว retry ทั้ง call → DB สะดุดหลังโพสต์สำเร็จ = โพสต์ขึ้นเพจซ้ำ
   แก้เป็น `safeLog()` ที่กลืน error
3. **ข้อความไทยหายตอนห่อ error ใหม่** — "ต่อ Facebook ไม่ได้" กลายเป็น "HTTP 599"
4. **Health check วนทีละเพจ** — เน็ตมีปัญหา = 30 เพจใช้เวลาเป็นนาทีจนทับรอบ cron ถัดไป
   แก้เป็นขนานจำกัด 5 เพจ
5. **`FakeClock.advance` เช็ค timer ก่อน microtask ได้ลงทะเบียน** — ทำให้เทสต์ค้าง

### ยังไม่ได้ทำใน M-A

- `apps/web` หน้า Connection Status — ตรรกะและป้ายสถานะพร้อมแล้ว
  (`STATE_LABEL_TH`, `STATE_TONE`, `TokenHealthChecker`) เหลือแค่ชั้น UI
- Onboarding Wizard สำหรับลูกค้า — `buildLoginUrl()` พร้อมแล้ว เหลือหน้าเว็บ
- Prisma migration จริง — schema เขียนครบแล้ว แต่ยังไม่ได้รัน `prisma migrate`
  (ต้องมี Postgres + pgvector ก่อน)
- Repository ที่ต่อ Prisma จริง — ตอนนี้มี `InMemoryPageTokenRepository`
  ส่วน interface `PageTokenRepository` พร้อมให้ implement แล้ว

---

## งานนอกโค้ดที่ต้องทำขนานไป (สเปกข้อ 10)

- [ ] Meta Business Manager + Business Verification (ภ.พ.20)
- [ ] สร้าง App ประเภท Business + Privacy Policy URL, Terms URL, Data Deletion Callback URL
- [ ] อัดวิดีโอ screencast สาธิตแต่ละ permission
- [ ] อัปเดต trust store บน VPS ให้ trust Meta CA (webhook mTLS)
- [ ] เตรียมสัญญาบริการ + หนังสือมอบอำนาจ
- [ ] LINE Official Account + Messaging API สำหรับ alert
