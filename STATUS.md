# สถานะงาน PAGE OS

อัปเดตล่าสุด: หลังจบ M-G

## ความคืบหน้าตาม Roadmap (สเปกข้อ 7)

| Milestone | ขอบเขต | สถานะ |
|---|---|---|
| **M-A** | Meta Gateway + Auth + Token management + Connection status | ✅ เสร็จ |
| — | ยื่น App Review + Business Verification | ⬜ งานนอกโค้ด (ดูข้อ 10 ในสเปก) |
| **M-B** | Content Calendar + Publishing + Retry + Duplicate guard | ✅ เสร็จ |
| **M-C** | Comment Automation | ✅ เสร็จ |
| **M-D** | Analytics sync + Monthly PDF report | ✅ เสร็จ — เริ่มเก็บเงินลูกค้าได้ |
| **M-E** | Unified Inbox + Webhook realtime + SLA | ✅ เสร็จ |
| **M-F** | Chatbot 3 ชั้น + RAG + Flow engine + Tone | ✅ เสร็จ (ตัววาด flow เป็นงาน UI) |
| **M-G** | AI Content Studio + Template Library | ✅ เสร็จ (หน้าปฏิทินเป็นงาน UI) |
| **M-H** | Client Portal + Onboarding wizard | 🔜 ถัดไป |
| **M-I** | Ops Center + Audit + Bulk actions | ⬜ |
| **M-J** | Billing | ⬜ |

รายงาน audit ของแต่ละ milestone อยู่ที่ `docs/audit/M-*.md`

---

## M-G — เสร็จแล้ว

`packages/studio` — ตัวคูณความเร็วที่ทำให้คนเดียวดูแล 20 เพจได้

| ไฟล์ | หน้าที่ |
|---|---|
| `brand.ts` | Brand Brief ต่อเพจ + ตรวจว่ากรอกครบพอจะสร้างคอนเทนต์ดีๆ ได้ไหม |
| `pillars.ts` | สัดส่วนคอนเทนต์ → กระจายลงเดือนแบบกำหนดได้ (ไม่สุ่ม) |
| `hashtags.ts` | แฮชแท็กไทยที่ใช้ได้จริง — ไม่มีช่องว่าง ไม่กินวรรณยุกต์ |
| `generator.ts` | สร้างคอนเทนต์เป็นชุด + ด่านตรวจก่อนส่งให้คนรีวิว |
| `recycle.ts` | เขียนโพสต์เก่าใหม่ให้ผ่าน Duplicate Guard (พิสูจน์ว่าต่างจริง) |
| `calendar.ts` | One-click ปฏิทิน 30 วัน + drag & drop เลื่อนเวลา |
| `templates.ts` | Template Library ที่สแกนกันข้อมูลลูกค้าเก่ารั่วแบบ fail-closed |

เรื่องที่ต้องรู้ก่อนแตะโค้ดส่วนนี้:

- **แฮชแท็กไทยต้องเก็บ `\p{M}`** — วรรณยุกต์เป็น Mark ไม่ใช่ Letter
  ตัดทิ้งแล้ว "#ร้านกาแฟ" จะกลายเป็น "#รานกาแฟ" โดยไม่มี error ให้เห็น
- **ตัวแปรเทมเพลตใช้ `[[...]]`** เพราะ `{...}` ถูกจองโดย `renderTemplate()` ของ M3
- **เวลาในปฏิทินคำนวณจากวันที่ท้องถิ่นทีละวัน** ไม่ใช่บวก 86,400,000 ms
  (ปลอดภัยกับ DST) แล้วเก็บเป็น UTC ตามกฎข้อ 4
- ของที่ก๊อปจากเทมเพลต **ปิดไว้ก่อนเสมอ** ต้องมีคนตรวจก่อนเปิด

รายละเอียดบั๊กที่เจอและวิธีแก้: `docs/audit/M-G.md`

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
1,057 tests ผ่านทั้งหมด (51 ไฟล์)
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
