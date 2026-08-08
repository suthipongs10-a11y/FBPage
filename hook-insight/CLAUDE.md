# CLAUDE.md — Hook Insight

> Single source of truth ของโปรเจกต์นี้
> ทุก session ต้องอ่านไฟล์นี้ + `STATUS.md` ก่อนเริ่มงานเสมอ
> ห้ามแก้ scope ใน CLAUDE.md เอง ถ้าจะเปลี่ยนต้องถามเจ้าของโปรเจกต์ก่อน

---

## 1. Product

**ชื่อ:** Hook Insight
**ประเภท:** Chrome Extension (Manifest V3) + backend เล็ก ๆ บน Cloudflare Workers
**กลุ่มเป้าหมาย:** ครีเอเตอร์คลิปสั้นไทย (TikTok / Instagram Reels) ที่ทำงานวิจัยคอนเทนต์บนเดสก์ท็อป

### Single purpose statement (ใช้คำนี้ตอนส่งขึ้น Chrome Web Store — ห้ามเปลี่ยน)

> เครื่องมือช่วยครีเอเตอร์เก็บและวิเคราะห์คลิปสั้นที่ใช้อ้างอิง โดยคำนวณว่าคลิปหนึ่ง ๆ ทำผลงานได้ดีกว่าค่าเฉลี่ยของบัญชีนั้นเองมากแค่ไหน

ทุกฟีเจอร์ที่เพิ่มเข้ามาต้องตอบได้ว่าเข้ากับประโยคนี้ยังไง ถ้าตอบไม่ได้ = ไม่ทำ

### ปัญหาที่แก้

1. ครีเอเตอร์เจอคลิปที่ปัง → แคปหน้าจอโยนลง Notion/Line Keep → หาไม่เจอ ใช้งานต่อไม่ได้
2. ดูยอดวิวดิบแล้วเข้าใจผิด — คลิปวิวล้านของช่อง 5 ล้านฟอลคือคลิป *ต่ำกว่า* ค่าเฉลี่ย ส่วนคลิปวิวแสนของช่อง 3 พันฟอลคือของจริง คนตาเปล่าแยกไม่ออก

### สิ่งที่ **ไม่ทำ** (non-goals — ห้ามเสนอ ห้าม implement)

- ❌ ดาวน์โหลดวิดีโอ / ลบลายน้ำ — ผิด ToS + โดนถอดจาก store
- ❌ auto-post, auto-follow, auto-comment, bot ทุกชนิด
- ❌ ตัดต่อวิดีโอ / render — งานนั้นอยู่ที่ Takra Studio ไม่ใช่ที่นี่
- ❌ เก็บข้อมูลผู้ใช้ที่ไม่จำเป็นต่อ single purpose (ดูข้อ 9)
- ❌ scrape แบบ background loop ตอนผู้ใช้ไม่ได้เปิดหน้านั้น

---

## 2. Tech stack (ตัดสินใจแล้ว — ห้ามเปลี่ยนโดยไม่ถาม)

| ส่วน | เลือกใช้ | เหตุผล |
|---|---|---|
| Extension framework | **WXT** (`wxt.dev`) | MV3 + HMR + build ให้ทั้ง Chrome/Edge/Firefox จากโค้ดชุดเดียว |
| UI | React 18 + TypeScript + Tailwind | เร็ว คุ้นมือ |
| UI surface หลัก | `chrome.sidePanel` | แผงข้างเปิดค้างคู่กับ TikTok ได้ ไม่หายเหมือน popup |
| Local DB | **IndexedDB ผ่าน Dexie** | `chrome.storage.local` จำกัด ~10MB ไม่พอกับคลังเป็นพันชิ้น |
| Settings เล็ก ๆ | `chrome.storage.local` | license token, preferences |
| Backend | **Cloudflare Workers + D1** | ฟรีจนกว่าจะมีลูกค้าจริง ไม่ต้องดูแลเซิร์ฟเวอร์ |
| Payment | Stripe Payment Link → webhook → D1 | ตามสถาปัตยกรรม license key ที่ตกลงไว้ |
| Test | Vitest (unit) + Playwright (E2E บนหน้าจริง) | |

**ห้ามใช้:** `unlimitedStorage`, `<all_urls>`, remote code / eval (MV3 ห้ามอยู่แล้ว), analytics ของบุคคลที่สาม

---

## 3. โครงสร้างโปรเจกต์

```
hook-insight/
├── CLAUDE.md                 # ไฟล์นี้
├── STATUS.md                 # สถานะล่าสุด อัปเดตทุกจบ session
├── extension/
│   ├── wxt.config.ts
│   ├── entrypoints/
│   │   ├── background.ts             # service worker
│   │   ├── sidepanel/                # UI คลัง + แดชบอร์ด
│   │   ├── options/                  # ตั้งค่า + กรอก license key
│   │   ├── tiktok.content.ts         # ISOLATED world
│   │   ├── tiktok.main.ts            # MAIN world — ดัก network
│   │   ├── instagram.content.ts
│   │   └── instagram.main.ts
│   ├── lib/
│   │   ├── adapters/                 # ตัวแปลงข้อมูลรายแพลตฟอร์ม
│   │   │   ├── types.ts
│   │   │   ├── tiktok.ts
│   │   │   └── instagram.ts
│   │   ├── outlier.ts                # สูตรคำนวณ (ข้อ 6)
│   │   ├── db.ts                     # Dexie schema
│   │   ├── license.ts                # ตรวจ license + grace period
│   │   └── ui/                       # component ที่ใช้ร่วม (Gauge ฯลฯ)
│   └── assets/
└── worker/
    ├── src/index.ts          # /verify /webhook /ai/*
    └── schema.sql            # D1
```

---

## 4. สถาปัตยกรรมการดึงข้อมูล (สำคัญที่สุด — อ่านให้จบก่อนเขียนโค้ด)

### หลักการ

TikTok และ Instagram โหลดข้อมูลผ่าน internal JSON API แล้วค่อย render **class name ทั้งหมด obfuscate และเปลี่ยนทุกสัปดาห์** ถ้าไป query DOM ตรง ๆ จะพังทุก 2 สัปดาห์

**วิธีที่ใช้: ดักข้อมูลที่หน้าเว็บโหลดมาอยู่แล้ว**

```
MAIN world script (tiktok.main.ts)
  └─ patch window.fetch + XMLHttpRequest.prototype.open/send
     └─ เจอ response ที่ตรง pattern → window.postMessage({source:'hi', payload})
        └─ ISOLATED content script รับ → normalize ด้วย adapter
           └─ ส่งเข้า background → เขียน IndexedDB → แจ้ง side panel
```

- MAIN world ประกาศใน manifest ด้วย `"world": "MAIN"` (Chrome 111+)
- **ห้าม** ยิง request เองเพื่อไปดึงข้อมูลเพิ่ม — ใช้เฉพาะข้อมูลที่หน้าเว็บโหลดมาแล้วตอนผู้ใช้เปิดดูเอง (ทั้งเรื่องกฎและเรื่องโดน rate-limit)

### DOM เป็น fallback ชั้นสอง

เมื่อดัก network ไม่ได้ ให้ fallback ไปอ่าน DOM โดย:
- ยึด `aria-label`, `data-e2e` (TikTok มี `data-e2e` ที่ค่อนข้างนิ่ง), semantic tag, และรูปแบบข้อความ (`1.2M`, `12.5พัน`)
- **ห้ามฮาร์ดโค้ด class name เด็ดขาด**
- selector ทุกตัวรวมไว้ที่ `lib/adapters/<platform>.ts` ที่เดียว พร้อม comment ว่าเช็คครั้งล่าสุดเมื่อไหร่

### Adapter contract

ทุก adapter ต้อง return object นี้เท่านั้น ส่วนอื่นของระบบห้ามรู้ว่าข้อมูลมาจากแพลตฟอร์มไหน

```ts
export interface CapturedVideo {
  platform: 'tiktok' | 'instagram';
  videoId: string;
  url: string;
  authorId: string;
  authorHandle: string;
  authorFollowers: number | null;
  caption: string;
  hashtags: string[];
  soundId: string | null;
  soundName: string | null;
  thumbnailUrl: string | null;     // เก็บ URL เท่านั้น ห้ามเก็บ blob
  postedAt: number | null;         // epoch ms
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  firstSubtitleText: string | null; // ถ้าหน้าเว็บมี subtitle data มาให้ (best effort)
  capturedAt: number;
}
```

### ⚠️ ข้อจำกัดที่ต้องยอมรับ (อย่าพยายามหาทางอ้อม)

เราถอดเสียง 3 วินาทีแรกของคลิปเองไม่ได้ เพราะต้องโหลดไฟล์วิดีโอ = ผิด ToS
**ทางออกที่ใช้จริง:**
1. ถ้าหน้าเว็บส่ง subtitle/auto-caption มาใน payload → ใช้ 3 วินาทีแรกจากตรงนั้น
2. ถ้าไม่มี → ให้ผู้ใช้พิมพ์ฮุกเองในช่อง "ฮุกที่ได้ยิน" (มีปุ่มให้ AI ช่วยเดาจาก caption + คอมเมนต์ แล้วผู้ใช้แก้ได้)

ช่องนี้ต้องออกแบบให้พิมพ์เร็ว ๆ ได้ ไม่ใช่ปล่อยว่าง

---

## 5. Data model (Dexie)

```ts
// db.ts
export const db = new Dexie('hook-insight');
db.version(1).stores({
  videos:    '&id, platform, authorId, capturedAt, outlierIndex, *tags',
  authors:   '&id, platform, handle, lastSeenAt',
  snapshots: '++id, videoId, takenAt',        // ไว้คำนวณความเร็วการโต
  collections: '++id, name, createdAt',
  items:     '++id, collectionId, videoId'
});
```

- `videos.id` = `${platform}:${videoId}`
- `snapshots` เก็บ `{videoId, takenAt, views, likes, comments}` — เพิ่มแถวใหม่เมื่อเจอคลิปเดิมซ้ำ ห้ามทับของเดิม
- เก็บ snapshot ต่อคลิป **ไม่เกิน 30 แถว** แล้ว downsample ของเก่า
- ทุก entity ต้องมี `schemaVersion` ไว้ migrate

---

## 6. Outlier Index — หัวใจของผลิตภัณฑ์

### สูตร

```
OI = views ÷ baseline(author)
```

`baseline(author)` = **median** ของยอดวิวคลิป 20 คลิปล่าสุดของบัญชีนั้น (median ไม่ใช่ mean — คลิปไวรัลตัวเดียวจะทำให้ mean เพี้ยนหมด)

**เงื่อนไขที่ต้อง implement ให้ครบ:**

| กรณี | ต้องทำ |
|---|---|
| มีข้อมูล < 5 คลิป | แสดง "ข้อมูลไม่พอ" ห้ามแสดงตัวเลข OI |
| มี 5–9 คลิป | แสดง OI พร้อมป้าย "ประมาณการ" |
| คลิปอายุ < 48 ชม. | ตัดออกจากการคำนวณ baseline (ยอดยังวิ่งอยู่) |
| ไม่มียอดวิว (IG บางหน้า) | ใช้ engagement fallback: `(likes+comments) ÷ followers` แล้วเทียบ median แบบเดียวกัน ต้องติดป้ายว่าใช้สูตรสำรอง |

### ตัวเลขประกอบที่ต้องมี

- **ER** = `(likes + comments + shares) ÷ views`
- **Velocity** = `Δviews ÷ Δhours` จาก `snapshots` (ต้องมีอย่างน้อย 2 snapshot)
- **Age-adjusted OI** — เทียบกับคลิปที่อายุใกล้เคียงกันเท่านั้น เมื่อมีข้อมูลพอ

### แถบสี (heat scale) ใช้ที่เดียวทั้งระบบ

| ช่วง OI | ป้าย | token |
|---|---|---|
| < 0.5 | ต่ำกว่าปกติ | `--gauge-cold` |
| 0.5–1.5 | ปกติ | `--gauge-base` |
| 1.5–3 | ดีกว่าปกติ | `--gauge-warm` |
| 3–10 | ทำได้เกินตัว | `--gauge-hot` |
| > 10 | ระเบิด | `--gauge-peak` |

---

## 7. ฟีเจอร์ — แยกตาม milestone

### M0 · Skeleton
- WXT + React + Tailwind + Dexie ต่อกันติด
- side panel เปิดได้จากไอคอน
- content script ยิง log เข้า background ได้
- **Gate:** `pnpm build` ผ่าน โหลด unpacked ใน Chrome ได้ ไม่มี error ใน console

### M1 · Capture (TikTok)
- ดัก network บนหน้า For You / โปรไฟล์ / หน้าคลิปเดี่ยว
- normalize ผ่าน adapter → เขียน IndexedDB
- ปุ่ม **"เก็บเข้าคลัง"** ลอยบนคลิป (ต้องไม่บังปุ่มของ TikTok และหายไปเมื่อ hover ออก)
- ฟอร์มเก็บ: ฮุกที่ได้ยิน, ประเภทฮุก (คำถาม / ตัวเลข / ขัดความคาดหมาย / ก่อน-หลัง / เตือน / เล่าเรื่อง), แท็ก, โน้ต
- **Gate:** เก็บคลิปจริง 20 คลิปจาก 3 บัญชี ข้อมูลครบทุก field ที่ไม่ใช่ optional

### M2 · Outlier Index
- คำนวณ baseline ต่อ author + OI ตามข้อ 6 ครบทุกเงื่อนไข
- **Gauge chip** แปะบนตารางคลิปในหน้าโปรไฟล์ TikTok (signature element — ดูข้อ 8)
- side panel: เรียงตาม OI, กรองตามช่วง OI / แพลตฟอร์ม / แท็ก
- **Gate:** unit test สูตร ≥ 90% coverage + ทดสอบมือกับ 3 บัญชี (เล็ก/กลาง/ใหญ่) ผลไม่ขัดสามัญสำนึก

### M3 · คลัง (Swipe file)
- side panel เต็มรูปแบบ: grid + รายละเอียด + แก้ไข + ลบ
- ค้นหาข้อความในฮุก/caption/โน้ต
- คอลเลกชัน (จัดกลุ่มเอง)
- **Export/Import JSON + CSV** — ต้องมีตั้งแต่เวอร์ชันแรก เป็นข้อพิสูจน์ว่าข้อมูลเป็นของผู้ใช้
- **Gate:** export → ลบข้อมูลทั้งหมด → import กลับ ได้ครบเป๊ะ

### M4 · Instagram Reels
- adapter ตัวที่สอง ผ่าน interface เดิม ห้ามแก้โค้ดส่วนกลาง
- รองรับกรณีไม่มียอดวิว (สูตรสำรอง)
- **Gate:** โค้ดใน `lib/` นอกโฟลเดอร์ `adapters/` ไม่มีคำว่า `tiktok` หรือ `instagram` เลย

### M5 · Snapshot + Velocity
- เจอคลิปเดิมซ้ำ → เพิ่ม snapshot อัตโนมัติ
- กราฟการโตในหน้ารายละเอียด
- **Gate:** เก็บคลิปเดิม 3 ครั้งห่างกัน → กราฟถูกต้อง ไม่มีแถวซ้ำ

### M6 · License + Free/Pro
- ฟรี: เก็บได้ **30 คลิป**, ดู OI ได้, export ได้
- Pro: ไม่จำกัดจำนวน + velocity + AI + คอลเลกชันไม่จำกัด
- endpoint `/verify` + cache ผล 7 วัน + grace period ตอนออฟไลน์
- ผูก license กับ device id (สุ่มตอนติดตั้ง) จำกัด 3 เครื่อง
- **Gate:** ถอด token ออกจาก storage แล้วฟีเจอร์ Pro ต้องหยุดทำงาน + ตัดเน็ต 3 วันแล้วยังใช้ได้

### M7 · AI (ฝั่งเซิร์ฟเวอร์เท่านั้น)
- `POST /ai/hook` — เดาฮุกจาก caption + top comments
- `POST /ai/patterns` — วิเคราะห์คลังของผู้ใช้ แล้วสรุปว่าฮุกแบบไหนได้ OI สูงสุด
- **ประมวลผลบน Worker ทั้งหมด** extension แค่ส่ง text ไปแล้วรับผลกลับ — crack ไม่ได้
- นับ quota ต่อ license ที่ฝั่งเซิร์ฟเวอร์
- **Gate:** เรียก endpoint โดยไม่มี token ต้องได้ 401 ทุกกรณี

---

## 8. Design direction

**คอนเซปต์: หน้าปัดเครื่องวัด** — สินค้านี้คือเครื่องมือวัด ไม่ใช่แกลเลอรี ตัวเลขต้องอ่านง่ายและเทียบกันได้ ห้ามทำเป็นการ์ดสวย ๆ ที่ดูไม่ออกว่าอันไหนดีกว่าอันไหน

### Tokens

```css
--ink:        #0E1116;  /* พื้นแผงข้าง */
--surface:    #181D25;
--line:       #2A313A;
--text:       #E6E9EE;
--muted:      #8A94A3;

--gauge-cold: #4C7FA8;
--gauge-base: #6B7484;
--gauge-warm: #D9A441;
--gauge-hot:  #E4572E;
--gauge-peak: #F2F0EC;  /* ขาวสว่าง = ทะลุสเกล */
```

### Type

- Thai UI: **IBM Plex Sans Thai** — น้ำหนัก 400/600
- ตัวเลขทั้งหมด: **IBM Plex Mono** + `font-variant-numeric: tabular-nums` (ตัวเลขต้องเรียงคอลัมน์ให้ตรงกัน ไม่งั้นเทียบด้วยตาไม่ได้)
- ห้ามใช้ฟอนต์ display หวือหวา — เครื่องมือวัดไม่ต้องมีบุคลิก ตัวเลขคือพระเอก

### Signature element: Gauge chip

ชิปเล็กแนวนอนคล้าย VU meter ติดมุมล่างซ้ายของทุก thumbnail:

```
┌──────────────┐
│ ▓▓▓▓▓▓▓░░░░  │   4.2×
└──────────────┘
```

- แถบเต็มตาม log scale ของ OI (ไม่ใช่ linear — ไม่งั้นคลิป 50× จะทำให้ที่เหลือแบนหมด)
- สีตามตารางข้อ 6
- **ต้องมีพื้นหลังทึบของตัวเอง** เพราะต้องอ่านออกทั้งบนพื้นดำของ TikTok และพื้นขาวของ IG
- ตัวเลข `4.2×` ต้องอยู่นอกแถบ ไม่ทับ

### กฎ UI ที่ต้องผ่านทุกหน้า

- แตะได้จริงบนจอเล็ก keyboard focus มองเห็นชัด `prefers-reduced-motion` เคารพ
- animation มีได้เฉพาะตอน gauge เติมแถบครั้งแรก (150ms) — ที่เหลือห้ามมี
- overlay บนหน้าเว็บของเขา ต้อง `z-index` ต่ำกว่า modal ของแพลตฟอร์ม และมีปุ่มปิดถาวรในหน้าตั้งค่า

### Copy

- ภาษาไทยธรรมดา สั้น ไม่ต้องสุภาพเกิน ไม่ใช้ศัพท์ระบบ
- หน้าว่าง = คำชวนลงมือ ไม่ใช่คำขอโทษ เช่น "ยังไม่มีคลิปในคลัง — เปิด TikTok แล้วกดปุ่มเก็บที่มุมคลิป"
- error บอกว่าเกิดอะไรและทำยังไงต่อ ห้ามเขียนว่า "เกิดข้อผิดพลาด"

---

## 9. Privacy & Chrome Web Store compliance

**นโยบายใหม่บังคับใช้ 1 ส.ค. 2026 — ข้อมูลที่เก็บต้องจำเป็นต่อ single purpose เท่านั้น และต้องเปิดเผยชัดเจน**

### Permissions ที่ขอได้ (เกินกว่านี้ต้องถามก่อน)

```json
"permissions": ["storage", "sidePanel", "scripting"],
"host_permissions": [
  "https://www.tiktok.com/*",
  "https://www.instagram.com/*"
]
```

### กฎเหล็ก

- ข้อมูลคลังทั้งหมดอยู่ **เครื่องผู้ใช้เท่านั้น** ไม่ sync ขึ้น server
- สิ่งเดียวที่ออกจากเครื่อง: (ก) license key + device id ตอน verify (ข) ข้อความ caption/comment ที่ผู้ใช้ **กดปุ่มเอง** เพื่อส่งให้ AI
- ไม่เก็บประวัติการท่องเว็บ ไม่ track หน้าอื่นนอกจาก 2 โดเมนข้างบน
- ไม่มี third-party analytics
- privacy policy ต้องเขียนตรงกับ 4 ข้อบนเป๊ะ ๆ และ deploy ก่อนส่งรีวิว
- ทุกครั้งที่จะเพิ่ม permission ใหม่ ต้องเขียนเหตุผลลง STATUS.md ก่อน

---

## 10. Coding conventions

- TypeScript strict ห้าม `any` (ใช้ `unknown` + type guard)
- ห้าม `console.log` ใน production build — ใช้ `lib/log.ts` ที่ปิดได้
- ทุกฟังก์ชันที่แตะข้อมูลภายนอกต้อง return `Result<T, E>` ไม่ throw ข้ามชั้น
- Service worker ของ MV3 **ตายได้ตลอดเวลา** ห้ามเก็บ state ในตัวแปร module-level ให้อ่าน/เขียน storage ทุกครั้ง
- ทุก selector และทุก network pattern ต้องมี comment `// verified: YYYY-MM-DD`
- commit message: `M<n>: <สิ่งที่ทำ>` เช่น `M2: add log-scale gauge`

---

## 11. Workflow

1. เริ่ม session → อ่าน `CLAUDE.md` + `STATUS.md`
2. ทำทีละ milestone **ห้ามข้าม ห้ามทำสองอันพร้อมกัน**
3. จบ milestone → รัน gate criteria → ถ้าผ่าน:
   ```bash
   git add -A && git commit -m "M<n>: <สรุป>" && git tag m<n>
   ```
4. อัปเดต `STATUS.md` ทุกครั้งก่อนจบ session
5. เจอปัญหาที่ต้องเปลี่ยน scope → **หยุด ถามก่อน** อย่าตัดสินใจเอง

### STATUS.md template

```markdown
# STATUS
อัปเดตล่าสุด: YYYY-MM-DD

## Milestone ปัจจุบัน
M2 — Outlier Index (กำลังทำ)

## เสร็จแล้ว
- [x] M0 skeleton (tag m0)
- [x] M1 capture TikTok (tag m1)

## กำลังติด
- baseline เพี้ยนกับบัญชีที่โพสต์ห่างกันเกิน 6 เดือน

## ทำต่อจากตรงนี้
- เพิ่ม age-adjusted OI ใน lib/outlier.ts

## หมายเหตุ
- selector โปรไฟล์ TikTok เช็คล่าสุด 2026-08-08
```

---

## 12. เกณฑ์ปล่อยเวอร์ชันแรก

ส่งขึ้น store ได้เมื่อครบทั้งหมดนี้:

- [ ] M0–M4 ผ่าน gate ครบ
- [ ] ใช้เองจริงต่อเนื่อง 7 วัน เก็บคลิปได้ ≥ 100 คลิป โดยไม่พังกลางทาง
- [ ] ทดสอบกับครีเอเตอร์จริง 3 คน — ทุกคนเข้าใจว่า `4.2×` แปลว่าอะไรโดยไม่ต้องอธิบาย
- [ ] privacy policy ขึ้นเว็บแล้ว
- [ ] export/import ทำงานถูกต้อง
- [ ] ไม่มี permission เกินจากข้อ 9
- [ ] ไม่มี error ใน console ตลอด 30 นาทีของการใช้งานปกติ

M5–M7 ปล่อยตามหลังได้ **อย่าให้ M6/M7 มาถ่วงการปล่อยเวอร์ชันแรก** — เอาของถึงมือคนใช้ก่อน แล้วค่อยเก็บเงิน
