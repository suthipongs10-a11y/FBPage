# นำเข้าคอนเทนต์จาก ChatGPT / Claude / Gemini (แพ็กเกจ `fbpm-content-v1`)

เพิ่มเมื่อ 27 กันยายน 2026 · อยู่ในหน้า **ห้องข่าว** (`/news`) กล่อง "นำเข้าจาก ChatGPT / Claude / Gemini"
โค้ด: `apps/api/src/news/import-format.ts` (Template + ตัวตรวจ, ฟังก์ชันล้วน), `import.service.ts`, `inbox.controller.ts`, `packages/web-core/src/google-drive.ts`, `apps/web/components/content-import.tsx`

## แนวคิด
ให้ AI ที่เก่งการค้นเป็นคนค้นและเรียบเรียง แล้วส่งผลเข้าระบบตาม **Template มาตรฐานเดียว** ระบบของเรา:
1. **ตรวจ** ว่าครบและผ่านกฎไหม (ผ่าน / ผ่านแต่มีคำเตือน / ไม่ผ่าน พร้อมเหตุผลรายโพสต์)
2. สร้าง **ร่างรออนุมัติ** พร้อมการ์ดหัวข่าว + รูปจริง (ไม่โพสต์เองเด็ดขาด)
3. คนกด **อนุมัติและตั้งเวลา** — ถ้าแพ็กเกจเสนอเวลาไว้ (`scheduleAt`) ช่องเวลาจะตั้งตามนั้นให้ ไม่งั้นใช้ช่องเวลาว่างถัดไปของเพจ

```
แชต AI ค้น + เขียนตาม Template ──┬─ วาง/อัปโหลดในหน้าเว็บ ─────────────┐
                                  ├─ ส่งตรงเข้า URL รับไฟล์ (Custom GPT) ─┼→ ตรวจ → ร่าง + การ์ด + รูป → อนุมัติ+ตั้งเวลา → โพสต์ตามเวลา
                                  └─ บันทึกลงโฟลเดอร์ Google Drive ───────┘   (ระบบดึงทุก 10 นาที)
```

## Template (`fbpm-content-v1`)
กดปุ่ม **📋 คัดลอกคำสั่งสำหรับแชต AI** ในหน้าห้องข่าว แล้ววางต่อท้ายคำขอค้นข่าว — คำสั่งมีตัวอย่างและกฎครบ พร้อมรายชื่อเพจของแบรนด์

```json
{
  "format": "fbpm-content-v1",
  "posts": [{
    "type": "news",                       // news = ต้องมีที่มา · original = โพสต์ของเพจเอง
    "page": "ชื่อเพจตรงตัว",               // ไม่ใส่ = เพจที่เลือกตอนนำเข้า / เพจเดียวของแบรนด์
    "title": "ชื่อเรื่องภายใน",
    "caption": "ข้อความโพสต์ (ไม่ต้องใส่ที่มา ระบบต่อท้ายให้)",
    "hashtags": ["ข่าวรอบโลก"],             // ≤ 5 ไม่ต้องมี #
    "sources": [{ "name": "BBC News", "url": "https://..." }],
    "card": { "kicker": "ข่าวแปลก", "headline": "พาดหัว ≤ 90 ตัวอักษร *เน้น* ได้", "sub": "สรุปหนึ่งประโยค" },
    "images": [{ "url": "https://images.pexels.com/...", "credit": "ช่างภาพ / Pexels" }, "cover.jpg"],
    "photoQuery": "baby elephant rescue",  // ไม่มีรูป → ให้ระบบหาในคลังภาพฟรี
    "imagePrompt": "...",                  // ไม่มีรูป + เลือกภาพ AI
    "category": "สัตว์",
    "scheduleAt": "2026-09-28T19:00:00+07:00",
    "risk": "LOW", "riskReasons": [], "needsCheck": []
  }]
}
```
รับได้ทั้งไฟล์ `.json`, ข้อความจากแชตที่มี <code>```json</code> ปนคำอธิบาย, array ของโพสต์ หรือโพสต์เดี่ยว · สูงสุด 20 โพสต์/แพ็กเกจ · รูป ≤ 6 ใบ/โพสต์

## ระบบตรวจอะไรบ้าง
| ระดับ | ตรวจ |
|---|---|
| ❌ ไม่ผ่าน | JSON ผิดรูปแบบ/ขาดฟิลด์ · ข้อความสั้นเกิน · โพสต์ข่าวไม่มีที่มา · ลิงก์ที่มาไม่ใช่ http(s) · **รูปมาจากโดเมนเดียวกับสำนักข่าวต้นทาง** · รูปไม่ใช่ https / ชื่อไฟล์ผิด · อ้างไฟล์รูปที่ไม่ได้แนบ · ไม่พบเพจ · **ซ้ำ** (ลิงก์ที่มาเดียวกัน หรือหัวข้อเดียวกันภายใน 14 วัน รวมถึงซ้ำกันเองในแพ็กเกจ) |
| ⚠️ เตือน | มี `[ต้องยืนยัน: …]` (ปุ่มอนุมัติจะถูกปิดจนแก้) · risk HIGH · เวลาที่เสนอผ่านไปแล้ว/รูปแบบผิด · แฮชแท็กเกิน 5 · รูปจากลิงก์ไม่มีเครดิต · พาดหัวยาวเกิน |

ตอนสร้างร่าง: ต่อท้าย `ที่มา: … + ลิงก์` (ถ้ายังไม่มีในข้อความ) และ `ภาพประกอบ: <เครดิต>` · รูปจากลิงก์ดาวน์โหลดแบบกัน SSRF + ตรวจไบต์ว่าเป็น JPEG/PNG/WebP จริง ≤ 12 MB · การ์ดหัวข่าวใช้รูปแรกครึ่งบน แล้วแนบรูปเต็มตามหลัง (โพสต์หลายรูป) · ตรวจซ้ำกับ DB อีกรอบก่อนสร้างร่างทุกครั้ง

## ช่องทางที่ 1 — วาง / อัปโหลด (ง่ายสุด ใช้ได้กับทุกแชต)
1. ในแชต AI: "ค้นข่าว … 5 เรื่อง" + วางคำสั่งที่คัดลอกมา
2. คัดลอกผลลัพธ์ (หรือดาวน์โหลดไฟล์ .json) → วางในกล่อง → ถ้าแพ็กเกจอ้างรูปด้วยชื่อไฟล์ ให้เลือกไฟล์รูปพวกนั้นด้วย
3. **ตรวจก่อน** (ไม่สร้างอะไร) → **นำเข้าเป็นร่าง** → เลื่อนลงไปแท็บ "เขียนแล้ว" → อนุมัติและตั้งเวลา

## ช่องทางที่ 2 — URL รับไฟล์ (ChatGPT ส่งเข้ามาเองผ่าน Custom GPT)
1. ห้องข่าว → นำเข้า → แท็บ **URL รับไฟล์** → **สร้างคีย์ใหม่** (แสดงครั้งเดียว เก็บเป็น hash — สร้างใหม่ = คีย์เก่าใช้ไม่ได้)
2. ChatGPT → Explore GPTs → Create → Configure → **Actions → Create new action**
   - Import from URL: `https://<โดเมน>/api/inbox/openapi.json`
   - Authentication: **API Key**, Auth Type **Bearer**, วางคีย์ `fbin_…`
   - Instructions ของ GPT: วางคำสั่งที่คัดลอกจากปุ่ม 📋 แล้วเพิ่ม "เมื่อผู้ใช้ยืนยัน ให้เรียก sendPosts"
3. คุยกับ GPT นั้น: "ค้นข่าวสัตว์น่ารัก 3 เรื่องแล้วส่งเข้าระบบ" → GPT ได้ผลตรวจรายโพสต์กลับไปบอกคุณทันที
- ใช้กับ n8n / Make / สคริปต์ก็ได้: `curl -X POST https://<โดเมน>/api/inbox/content -H "Authorization: Bearer fbin_…" -H "content-type: application/json" --data @posts.json` (รับ `text/plain` ที่มี <code>```json</code> ได้ด้วย)
- จำกัด 20 แพ็กเกจ/นาทีต่อแบรนด์ · 30 คำขอ/นาทีต่อ IP · ติ๊ก "ตรวจผ่านแล้วสร้างร่างทันที" ไม่ติ๊ก = เก็บผลตรวจไว้ในประวัติให้กดสร้างร่างเอง · workspace ที่กดหยุดอัตโนมัติฉุกเฉินจะเก็บผลตรวจแต่ไม่สร้างร่าง

## ช่องทางที่ 3 — โฟลเดอร์ Google Drive (Claude บันทึกลง Drive ได้)
ตั้งครั้งเดียว:
1. Google Cloud Console → โปรเจกต์ (ใช้ของ YouTube ก็ได้) → **APIs & Services → Enable APIs → Google Drive API**
2. **IAM & Admin → Service Accounts → Create** (ไม่ต้องให้ role) → Keys → Add key → **JSON** → ได้ไฟล์คีย์
3. ใน Google Drive สร้างโฟลเดอร์ เช่น `fbpm-inbox/ข่าวรอบโลก` → **แชร์ให้อีเมล service account** (`…@….iam.gserviceaccount.com`) สิทธิ์ **ผู้มีสิทธิ์อ่าน**
4. ห้องข่าว → นำเข้า → แท็บ **Google Drive** → วางลิงก์โฟลเดอร์ + เนื้อไฟล์คีย์ JSON → บันทึก (ระบบทดสอบอ่านโฟลเดอร์ทันที ถ้าผิดจะขึ้นเหตุผลสีแดง)

ใช้งาน:
- Claude (เปิด Google Drive connector) — "ค้นข่าว … แล้วบันทึกเป็นไฟล์ `ข่าว-2026-09-28.json` ในโฟลเดอร์ fbpm-inbox/ข่าวรอบโลก ตามรูปแบบนี้ …"
- ChatGPT / Gemini — ดาวน์โหลดไฟล์ .json จากแชตแล้วลากใส่โฟลเดอร์ (หรือใช้ช่องทางที่ 1/2 แทน)
- ระบบดึงทุก 10 นาที (หรือกด **ดึงตอนนี้**) อ่านไฟล์ `.json` `.txt` `.md` และ Google Docs (ส่งออกเป็นข้อความ) · รูปอ้างด้วยชื่อไฟล์ที่อยู่ในโฟลเดอร์เดียวกัน
- ไฟล์เดิมไม่นำเข้าซ้ำ (จำ fileId + checksum — แก้ไฟล์แล้วบันทึกใหม่ = นำเข้าใหม่ แต่โพสต์ที่ซ้ำจะไม่ผ่าน) · ไฟล์เก่ากว่า 7 วันข้าม · ≤ 10 ไฟล์/รอบ
- ระบบ **อ่านอย่างเดียว** (scope `drive.readonly` และเห็นเฉพาะโฟลเดอร์ที่แชร์) ไม่ลบ/ย้ายไฟล์ในโฟลเดอร์
- คีย์ service account เข้ารหัสด้วย `common/crypto` ไม่แสดงกลับ ไม่อยู่ใน audit · เรียก Google ผ่าน HTTP ล้วน (ไม่ใช้ googleapis SDK) · ไม่เชื่อ `token_uri` ในไฟล์คีย์ (กัน SSRF)

## API
| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `workspaces/:ws/brands/:brandId/news/import/template` | content.read |
| POST | `workspaces/:ws/brands/:brandId/news/import/check` `{ text, pageId?, files? }` | content.create |
| POST | `workspaces/:ws/brands/:brandId/news/import` `{ text, pageId?, files?, theme?, imageFallback?, draft? }` | content.create |
| POST | `workspaces/:ws/news/import/files?name=` (body = ไบต์รูป) | content.create |
| GET | `workspaces/:ws/brands/:brandId/news/imports` · POST `news/imports/:id/draft` · DELETE `news/imports/:id` | content.read / content.create |
| GET/PUT | `workspaces/:ws/brands/:brandId/news/inbox` | content.read / ai.configure |
| POST/DELETE | `workspaces/:ws/brands/:brandId/news/inbox/key` | ai.configure |
| POST | `workspaces/:ws/brands/:brandId/news/inbox/drive/poll` | content.create |
| POST | `inbox/content` (สาธารณะ, Bearer `fbin_…`) · GET `inbox/openapi.json` | คีย์ของแบรนด์ |

ตาราง: `ContentInbox` (ตั้งค่าต่อแบรนด์), `ContentImport` (แพ็กเกจที่รับ + ผลตรวจ + ร่างที่สร้าง) · โพสต์ที่นำเข้าผูกกับ `NewsItem` (ป้าย "นำเข้า") จึงใช้กันซ้ำและขึ้นแท็บ "เขียนแล้ว" เหมือนข่าวที่ AI ในระบบเขียน
ทดสอบ: `import-format.test.ts`, `import.int.test.ts`, `packages/web-core/src/google-drive.test.ts` — ใช้ `startMockWeb()` (มี Google token/Drive จำลอง) ไม่แตะ Drive จริง
