# Content Engine — สร้างคอนเทนต์ชุดเดียว ลงทุกแพลตฟอร์ม พร้อมระบบค้นคว้าและกันโพสต์ซ้ำ

> สถานะ: **ออกแบบ รอเริ่มทำ** · ต่อยอดจาก Phase 6 (Content loop), Phase 9 (YouTube Content Lab), Phase 11 (W-3 บทความ), Phase 12 (TikTok)
> กฎทั้งหมดใน [`AGENTS.md`](../AGENTS.md) และ [`CLAUDE.md`](../CLAUDE.md) ยังบังคับใช้เต็มที่ — เอกสารนี้ไม่ยกเว้นข้อใดเลย

---

## 0. เป้าหมายและขอบเขต

### สิ่งที่ต้องการ
1. เขียนโจทย์ครั้งเดียว → ได้คอนเทนต์พร้อมโพสต์ **ทุกแพลตฟอร์มที่เชื่อมไว้** (Facebook, YouTube, TikTok, เว็บ, อีเมล)
2. รองรับทั้ง **คลิปสั้น** (Reels / Shorts / TikTok) และ **โพสต์เรื่องราว + รูป**
3. **ค้นคว้าตาม keyword** ก่อนเขียน — มีโหมดธรรมดา (เร็ว/ฟรี) และโหมดเจาะลึก (ค้นข้างนอก/มีค่าใช้จ่าย)
4. **ฐานข้อมูลกันโพสต์ซ้ำ** — รู้ว่าเคยโพสต์อะไรไปแล้ว ทั้งของที่สร้างจากระบบนี้และของเก่าที่ลูกค้าโพสต์เอง

5. **เสียบผู้ให้บริการ AI ได้หลายเจ้าพร้อมกัน** และเลือกได้ตอนทำงานจริงว่างานไหนใช้ตัวไหน — ทั้งข้อความ (Claude/OpenAI/Gemini/MiniMax/…), สร้างรูป และสร้างคลิป (OpenRouter/KIE AI/WaveSpeed/…) → **ดูข้อ 12**

### สิ่งที่ระบบนี้ "ไม่ทำ" (ต้องเข้าใจตรงกันก่อนเริ่ม)
- **ไม่ตัดต่อวิดีโอให้** — สร้างคลิปสั้นรายช็อตได้ (ข้อ 12) แต่การเรียงช็อต ใส่เสียง ใส่ซับ ยังทำนอกระบบ สิ่งที่ระบบให้เสมอคือ *สเปกการถ่าย*: hook 3 วินาทีแรก, shotlist, ข้อความบนจอ, สคริปต์พากย์
- **ไม่โพสต์ Instagram / X / LINE OA** — ยังไม่มีโมดูลของแพลตฟอร์มเหล่านี้
- **ไม่ข้ามขั้นอนุมัติ** — ทุกแพลตฟอร์มยังใช้ประตูอนุมัติเดิมของตัวเองทุกประตู
- **ไม่เดาราคาของผู้ให้บริการสื่อ** — ค่าใช้จ่ายต่อภาพ/ต่อวินาทีให้ผู้ใช้กรอกเอง ไม่กรอก = `null` ไม่ใช่ 0

---

## 1. ภาพรวมการไหล

```
   keyword / โจทย์ของลูกค้า
            │
            ▼
   ┌──────────────────┐   QUICK: ข้อมูลภายในล้วน (ฟรี, ~5 วิ)
   │  ResearchRun     │   DEEP : + ค้นข้างนอก + อ่านหน้าเว็บ (มีค่าใช้จ่าย/quota)
   │  → Findings      │   ทุกข้อค้นพบมี url + ข้อความต้นทาง + เวลาที่ดึง
   └────────┬─────────┘
            ▼
   ┌──────────────────┐   เสนอ 5–10 มุม พร้อมคะแนนโอกาส
   │  Angle proposals │──► ยิงเข้า "กันซ้ำ" ทันที มุมที่เคยทำแล้วถูกตัดออก/ติดธง
   └────────┬─────────┘
            ▼  ผู้ใช้เลือกมุม + เลือกช่องทางที่จะลง
   ┌──────────────────┐
   │ ContentCampaign  │  โจทย์เดียว = 1 แคมเปญ
   └────────┬─────────┘
            ▼  แตกเป็น ContentItem หลายตัว ผูกกันด้วย ContentRelation('variant_of')
   ┌─────────┬─────────┬─────────┬─────────┬─────────┐
   │ FB post │ FB reel │ Shorts  │ TikTok  │ บทความ  │ + อีเมล
   │ +การ์ด  │  สเปก   │  สเปก   │  สเปก   │  เว็บ   │
   └─────────┴─────────┴─────────┴─────────┴─────────┘
            ▼  Reviewer รายแพลตฟอร์ม (เดิม) → กันซ้ำรอบสอง
   ┌──────────────────┐
   │ ประตูอนุมัติเดิม  │  FB: APPROVED · YT: APPROVED · TikTok: APPROVED+confirmedBy+SOCIAL_PUBLISHING_ENABLED
   │ ของแต่ละช่องทาง   │  เว็บ: APPROVED+WEB_PUBLISH_ENABLED · อีเมล: APPROVED+EMAIL_SEND_ENABLED
   └────────┬─────────┘
            ▼
      ตั้งเวลา/เผยแพร่ (คิวเดิม) → บันทึกลายนิ้วมือลงฐานกันซ้ำ
```

---

## 2. Data model

ของใหม่ 6 ตาราง — ที่เหลือใช้ของเดิมทั้งหมด (`ContentItem`, `ContentRelation`, `MediaAsset`, `Topic`, `BrandInsight`)

```prisma
/// โจทย์หนึ่งครั้ง = หนึ่งแคมเปญ ครอบหลายแพลตฟอร์ม (ต่างจาก ContentPlan เดิมที่ผูกกับเพจเดียว)
model ContentCampaign {
  id            String   @id @default(cuid())
  workspaceId   String
  brandId       String
  title         String
  brief         String            // โจทย์ที่ผู้ใช้พิมพ์
  objective     String?           // awareness | engagement | lead | sale
  contentPillar String?
  keywords      String[] @default([])
  /// FACEBOOK_POST | FACEBOOK_REEL | YOUTUBE_SHORT | TIKTOK | WEB_ARTICLE | EMAIL
  targets       String[] @default([])
  status        String   @default("DRAFT")   // DRAFT | GENERATING | READY | PARTIAL | DONE | CANCELLED
  researchRunId String?
  createdById   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  brand    Brand         @relation(fields: [brandId], references: [id], onDelete: Cascade)
  research ResearchRun?  @relation(fields: [researchRunId], references: [id], onDelete: SetNull)
  items    ContentItem[]
  angles   ContentAngle[]

  @@index([workspaceId, createdAt])
  @@index([brandId, status])
}

/// การค้นคว้าหนึ่งครั้ง
model ResearchRun {
  id          String   @id @default(cuid())
  workspaceId String
  brandId     String
  /// QUICK | DEEP
  depth       String   @default("QUICK")
  keywords    String[] @default([])
  question    String?
  status      String   @default("RUNNING")  // RUNNING | DONE | FAILED | PARTIAL
  /// สรุปที่ AI เขียน: { summary, audience, painPoints[], angles[], gaps[], evidenceIds[] }
  brief       Json?
  sourceCount Int      @default(0)
  /// ค่าใช้จ่ายจริงของการค้นข้างนอก (search API) แยกจากค่า AI ที่อยู่ใน AiTaskLog
  searchCalls Int      @default(0)
  costUsd     Decimal? @db.Decimal(10, 4)
  error       String?
  createdById String?
  createdAt   DateTime @default(now())
  finishedAt  DateTime?

  brand     Brand             @relation(fields: [brandId], references: [id], onDelete: Cascade)
  findings  ResearchFinding[]
  campaigns ContentCampaign[]

  @@index([brandId, createdAt])
}

/// หลักฐานหนึ่งชิ้น — ทุกข้อความใน brief ต้องอ้างถึงแถวเหล่านี้ได้
model ResearchFinding {
  id         String   @id @default(cuid())
  runId      String
  /// INTERNAL_POST | INTERNAL_COMMENT | INTERNAL_SEARCH_CONSOLE | INTERNAL_KNOWLEDGE
  /// | EXTERNAL_SEARCH | EXTERNAL_PAGE | PLATFORM_TREND
  kind       String
  title      String
  snippet    String            // ตัดมาไม่เกิน 2000 ตัวอักษร
  url        String?
  sourceName String?
  /// สัญญาณเชิงตัวเลขที่อ่านได้ เช่น { impressions, ctr, position } — อ่านไม่ได้ต้องเป็น null ห้ามเป็น 0
  signals    Json?
  retrievedAt DateTime @default(now())

  run ResearchRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId, kind])
}

/// มุมที่เสนอ — เก็บไว้เพื่อให้ "ไม่เสนอมุมเดิมซ้ำ" และให้ผู้ใช้เลือกทีหลังได้
model ContentAngle {
  id           String   @id @default(cuid())
  campaignId   String
  headline     String
  hook         String?
  rationale    String?
  /// ใช้จัดกลุ่มหัวข้อข้ามคำพูด (normalize แล้ว) — ตัวเดียวกับที่ใช้ตรวจ cooldown
  topicKey     String
  evidenceIds  String[] @default([])
  score        Int?              // 0–100 โอกาสที่ AI ให้ พร้อมเหตุผลใน rationale
  /// OK | SIMILAR | DUPLICATE — ผลตรวจกันซ้ำตอนเสนอ
  dedupeVerdict String  @default("OK")
  dedupeRef     String?           // contentId หรือ fingerprintId ที่ชนกัน
  chosen       Boolean  @default(false)
  createdAt    DateTime @default(now())

  campaign ContentCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@index([campaignId])
  @@index([topicKey])
}

/// ★ ฐานข้อมูลกันโพสต์ซ้ำ — หนึ่งแถวต่อ "ชิ้นงานที่มีตัวตนแล้ว"
/// ครอบคลุมทั้งของที่สร้างจากระบบนี้ และของเก่าที่ลูกค้าเคยโพสต์เอง (backfill)
model ContentFingerprint {
  id          String   @id @default(cuid())
  workspaceId String
  brandId     String
  /// FACEBOOK | YOUTUBE | TIKTOK | WEB | EMAIL
  platform    String
  /// contentItem | facebookPost | youTubeVideo | tikTokVideo | webPost
  sourceType  String
  sourceId    String
  contentId   String?           // ถ้ามาจาก ContentItem
  campaignId  String?
  publishedAt DateTime?

  titleNorm   String?
  /// sha256 ของข้อความที่ normalize แล้ว — ตรงกันคือซ้ำเป๊ะ
  exactHash   String
  /// SimHash 64 บิตของ char 5-gram
  simhash     BigInt
  /// แบ่ง simhash เป็น 4 ท่อน ท่อนละ 16 บิต เพื่อหา candidate ด้วย index ธรรมดา (ไม่ต้องลง extension)
  band0       Int
  band1       Int
  band2       Int
  band3       Int
  topicKey    String?
  keywords    String[] @default([])
  /// sha256 ของไฟล์ภาพ/วิดีโอที่แนบ — กันใช้รูปเดิมซ้ำ
  mediaHashes String[] @default([])
  charCount   Int      @default(0)
  createdAt   DateTime @default(now())

  @@unique([sourceType, sourceId])
  @@index([brandId, platform, publishedAt])
  @@index([brandId, band0])
  @@index([brandId, band1])
  @@index([brandId, band2])
  @@index([brandId, band3])
  @@index([brandId, exactHash])
  @@index([brandId, topicKey])
}

/// ตั้งค่ากันซ้ำต่อแบรนด์ — ธุรกิจต่างกันรับความซ้ำได้ไม่เท่ากัน
model DedupePolicy {
  brandId          String   @id
  /// ระยะ Hamming ที่ถือว่า "คล้ายจนต้องเตือน" (ค่าเริ่มต้น 8 จาก 64 บิต)
  similarDistance  Int      @default(8)
  /// หัวข้อเดิมห้ามทำซ้ำภายในกี่วัน (ค่าเริ่มต้น 60)
  topicCooldownDays Int     @default(60)
  /// เกินกี่วันแล้วให้ถือว่ารีโพสต์ของเก่าได้ (ลดจาก BLOCK เหลือ WARN)
  repostAfterDays  Int      @default(180)
  /// ให้บล็อกจริง หรือแค่เตือนแล้วให้กดผ่านพร้อมเหตุผล
  hardBlock        Boolean  @default(true)
  updatedAt        DateTime @updatedAt

  brand Brand @relation(fields: [brandId], references: [id], onDelete: Cascade)
}
```

เพิ่มใน `ContentItem`: `campaignId String?` + relation · เพิ่มใน `ContentRelation.relationType`: `variant_of`

---

## 3. ระบบกันโพสต์ซ้ำ (หัวใจของงานนี้)

### 3.1 ทำไมต้องออกแบบพิเศษ
- **ภาษาไทยไม่มีช่องว่าง** — วิธีมาตรฐานที่ตัดเป็นคำ (word shingle) ใช้ไม่ได้ ต้องใช้ **char n-gram**
- **เราตั้งใจให้คอนเทนต์เดียวลงหลายที่** — ถ้ากันซ้ำแบบซื่อ ๆ ระบบจะบล็อกฟีเจอร์ตัวเอง ต้องแยกให้ออกระหว่าง "ซ้ำโดยตั้งใจ (variant)" กับ "ซ้ำโดยไม่รู้ตัว"

### 3.2 การทำลายนิ้วมือ
```
normalize(text):
  NFC → ตัด URL, emoji, เครื่องหมายวรรคตอน, ช่องว่างทั้งหมด → lowercase
  (ข้อความไทยยุบเป็นสายอักขระเดียว ซึ่งเป็นสิ่งที่ต้องการ)

exactHash = sha256(normalized)
shingles  = ทุกหน้าต่าง 5 อักขระ ของ normalized
simhash   = SimHash 64 บิตจาก shingles (ถ่วงน้ำหนักเท่ากัน)
band0..3  = simhash แบ่งเป็น 4 ท่อน ท่อนละ 16 บิต
```
ข้อความสั้นกว่า 40 อักขระหลัง normalize → ไม่เชื่อถือ simhash ใช้ `exactHash` อย่างเดียว (`charCount` เก็บไว้ตัดสิน)

### 3.3 การค้นหาตัวที่ชน
```sql
-- candidate: ท่อนใดท่อนหนึ่งตรงกัน (ใช้ index ปกติ ไม่ต้องลง pg_trgm/pgvector)
SELECT * FROM "ContentFingerprint"
WHERE "brandId" = $1
  AND ("band0" = $2 OR "band1" = $3 OR "band2" = $4 OR "band3" = $5)
LIMIT 500;
```
แล้วคำนวณ Hamming distance ในโค้ด (popcount ของ XOR) — เร็วมากเพราะ candidate เหลือหลักสิบ

### 3.4 กติกาตัดสิน
| กรณี | ผล | ทำอะไร |
|---|---|---|
| `exactHash` ตรง **และ** แพลตฟอร์มเดียวกัน **และ** ยังไม่เกิน `repostAfterDays` | **DUPLICATE** | บล็อก (ถ้า `hardBlock`) |
| Hamming ≤ `similarDistance` แพลตฟอร์มเดียวกัน | **SIMILAR** | เตือน ต้องกดยืนยันพร้อมเหตุผล บันทึก AuditLog |
| ชนแต่เป็น `variant_of` ของแคมเปญเดียวกัน | **OK** | ผ่านเงียบ ๆ — นี่คือสิ่งที่ตั้งใจ |
| ชนข้ามแพลตฟอร์ม แต่คนละแคมเปญ | **INFO** | แสดงให้เห็น ไม่บล็อก |
| `topicKey` เดิมภายใน `topicCooldownDays` | **SIMILAR** | เตือน "เคยทำหัวข้อนี้ไปเมื่อ N วันก่อน" แม้คำพูดต่างกันสิ้นเชิง |
| `mediaHashes` ชน | **SIMILAR** | เตือน "เคยใช้รูปนี้ไปแล้วในโพสต์ …" |
| เกิน `repostAfterDays` | ลดระดับเป็น **INFO** เสมอ | รีโพสต์ของเก่าเป็นเรื่องปกติ |

### 3.5 ตรวจที่ไหนบ้าง (สามด่าน)
1. **ตอนเสนอมุม** — ตัดมุมที่ `DUPLICATE` ออกก่อนแสดงผล ไม่ให้เปลืองค่า AI เขียนของที่เขียนไปแล้ว
2. **ตอนสร้างร่าง** — ติดธงไว้ที่ร่าง ให้คนเห็นก่อนแก้
3. **ตอนกดอนุมัติ** — ด่านสุดท้าย ตรวจกับข้อความ ณ เวลานั้นจริง ๆ (คนอาจแก้จนไปชนของเก่าพอดี) การกดผ่านต้องมีเหตุผลและเข้า AuditLog

### 3.6 ของเก่าที่ลูกค้าเคยโพสต์เอง
งาน worker `content-fingerprint-backfill` ทำลายนิ้วมือย้อนหลังจากสิ่งที่ซิงก์มาแล้ว:
`FacebookPost.message` · `YouTubeVideo.title + description` · `TikTokVideo` · โพสต์ WordPress ที่อ่านผ่าน `wordpress.ts`
รันครั้งแรกตอนเชื่อมช่องทางใหม่ และรันต่อเนื่องเมื่อ sync ได้ของใหม่ — ทำให้ระบบ "รู้จัก" ประวัติเพจตั้งแต่วันแรกที่ลูกค้าเข้ามา ไม่ต้องรอสะสม

---

## 4. ระบบค้นคว้าตาม keyword

### 4.1 โหมดธรรมดา (QUICK) — ฟรี ไม่ออกเน็ต
ใช้ข้อมูลที่ระบบมีอยู่แล้วล้วน ๆ:

| แหล่ง | ได้อะไร |
|---|---|
| `BrandKnowledgeItem` | สินค้า ราคา นโยบาย ข้อห้ามกล่าวอ้าง น้ำเสียง |
| `FacebookPost` + `PostMetricSnapshot` | โพสต์เก่าอันไหนไปได้ดี (ค่าที่อ่านไม่ได้ = null ไม่ใช่ 0) |
| `YouTubeVideo` / `TikTokVideo` + metric | คลิปไหนยอดดีกว่าค่ากลาง |
| `PageComment` / `Lead` / `CommentCluster` | ลูกค้าถามอะไรซ้ำ ๆ — แหล่งหัวข้อที่ดีที่สุดและฟรี |
| `SearchSnapshot.topQueries` | **คำค้นจริงจาก Google Search Console** ของเว็บลูกค้า พร้อม impressions/CTR/position |
| `BrandInsight` | ข้อสรุปที่ Analyst เคยทำไว้ |
| `ContentFingerprint` | เคยทำหัวข้อไหนไปแล้ว |

บทบาท AI: `analysis` · ใช้เวลาไม่กี่วินาที · ไม่มีค่าใช้จ่ายนอกจากค่า token

### 4.2 โหมดเจาะลึก (DEEP) — ออกเน็ต มีค่าใช้จ่าย
ทุกอย่างของ QUICK **บวก**:
1. **ค้นเว็บ** ผ่าน `SearchProvider` ที่เสียบได้ (HTTP ล้วน เหมือนทุก integration ในโปรเจกต์นี้) — รองรับ Google Programmable Search / Serper / Brave / Tavily เลือกตัวเดียวก็พอ ตั้งคีย์ในหน้าตั้งค่า เข้ารหัสด้วย `common/crypto`
2. **อ่านหน้าเว็บที่ค้นเจอ** ด้วยตัวดึงสุภาพตัวเดียวกับ W-1 — `USER_AGENT` ระบุตัว, เคารพ `robots.txt`, ≤ 1 คำขอ/วินาที, กัน SSRF ด้วย `isPrivateHost()`, timeout, สกัดเฉพาะข้อความ
3. **สัญญาณจากแพลตฟอร์ม** — คลิปยอดดีของช่องคู่แข่งที่ลูกค้าระบุไว้ (ผ่าน API ทางการเท่านั้น ห้าม scrape TikTok/Facebook)

กฎเหล็กของ DEEP:
- **ทุกประโยคในบทสรุปต้องมี `evidenceIds`** ชี้ไป `ResearchFinding` — ไม่มีหลักฐานห้ามพูดเป็นข้อเท็จจริง (แบบเดียวกับที่ Messenger บังคับอยู่)
- **ห้ามลอกข้อความมาโพสต์** — `snippet` ใช้เป็นหลักฐานและบริบทเท่านั้น prompt สั่งให้เขียนใหม่ทั้งหมด และ Reviewer ตรวจซ้ำว่าไม่มีช่วงข้อความยาวตรงกับ snippet
- **บันทึกทุกคำขอ** ลง `ResearchRun.searchCalls` + `costUsd` เหมือนที่ YouTube บันทึก quota
- **มีเพดาน** — จำนวนคำค้น/หน้าที่อ่านต่อครั้ง และต่อเดือนต่อ workspace
- ใช้ได้เฉพาะเมื่อมี `SEARCH_PROVIDER_*` ตั้งไว้ ไม่มี → ปุ่มเจาะลึกเป็นสีเทาพร้อมบอกว่าต้องตั้งอะไร

---

## 5. การสร้างคอนเทนต์

### 5.1 สเปกคลิปสั้น (ใช้ร่วมกัน FB Reel / YT Short / TikTok)
AI ตัวเดียว (`short-video-spec-v1`, บทบาท `content`) ผลิตโครงกลางหนึ่งชุด:
```json
{
  "hook": "3 วินาทีแรกพูดว่าอะไร ทำไมถึงหยุดนิ้ว",
  "durationSec": 35,
  "beats": [
    { "atSec": 0,  "shot": "มือถือถ่ายมุมสูงให้เห็นคราบบนพื้น", "onScreen": "คราบนี้ 3 ปี", "vo": "..." },
    { "atSec": 4,  "shot": "...", "onScreen": "...", "vo": "..." }
  ],
  "bRoll": ["ภาพเสริมที่ควรมี"],
  "cta": "ทักแชทจองคิว",
  "musicMood": "อัปบีต ไม่มีเนื้อร้อง",
  "accessibility": { "captionsRequired": true }
}
```
แล้ว **ตัวแปลงรายแพลตฟอร์ม** (ไม่ใช้ AI ซ้ำ — ประหยัดและได้ผลคงที่) แปลงเป็น:
- **TikTok** → `TikTokContentMetadata.hook` / `.script`, caption ≤ 2,200, hashtag แบบ TikTok
- **YouTube Short** → `YouTubeContentMetadata` format `SHORT`, `title` ≤ 100, `description`, `tags`, `targetDurationSec` · ฟิลด์นโยบาย (`madeForKids` / `syntheticMedia` / `paidPlacement`) **AI ห้ามเติม** ปล่อย null ให้คนตอบ
- **Facebook Reel** → `ContentItem` contentType `reel` + `mediaBrief` = shotlist

ถ้าผู้ใช้อัปไฟล์คลิปเข้ามาแล้ว ระบบผูกไฟล์เข้ากับทุก variant ให้อัตโนมัติ (`MediaAsset` เดียว หลาย `ContentItem`)

### 5.2 โพสต์เรื่องราว + รูป
- AI เขียน `title` / `caption` / `cta` / `hashtags` / `contentPillar` (เอเจนต์เดิมใน `agents.service.ts`) พร้อม `mediaBrief`
- ต่อด้วย **ข้อเสนอการ์ดภาพ**: AI เลือกเทมเพลต (`quote` / `stat` / `tips` / `hero`) + ธีมของแบรนด์ + เนื้อหาในการ์ด → เรนเดอร์ด้วย Chromium ที่มีอยู่ → เก็บเป็น `MediaAsset` แล้วแนบกับโพสต์
- **ห้ามใส่ emoji ใน `description` ของเพจ** (Facebook แปลงเป็น `�`) — ในแคปชันโพสต์ใส่ได้ปกติ
- บทความเว็บ / อีเมล ใช้ทางเดิมของ W-3 / W-4 ไม่สร้างของใหม่

### 5.3 สิ่งที่ยังขาด → ต้องถามคน
ยึดแบบเดิมของโปรเจกต์: AI เติม `aiNotes.missingInfo[]` และแทรก `[ต้องยืนยัน ...]` ในเนื้อหา ร่างที่มีข้อความนี้ค้าง **อนุมัติไม่ผ่าน** (W-3 ทำแบบนี้อยู่แล้ว ใช้กติกาเดียวกัน)

---

## 6. อนุมัติ ตั้งเวลา เผยแพร่

- แคมเปญมีปุ่ม "ส่งอนุมัติทั้งชุด" แต่**ไม่ได้ข้ามประตูใด** — มันแค่ยิง `ApprovalRequest` ของแต่ละ `ContentItem` ตามกติกาเดิมของแพลตฟอร์มนั้น
- ตั้งเวลาแบบ **staggered**: ลงทุกที่พร้อมกันเป๊ะไม่ดีต่อ reach ให้เว้นช่วงตามช่องทางได้ (เช่น FB 09:00, TikTok 12:00, Shorts 18:00) เก็บใน `scheduledLocal` + `scheduledTz` เดิม
- ถ้าช่องทางใดล้ม แคมเปญเป็น `PARTIAL` — ช่องอื่นที่สำเร็จแล้วไม่ถูกย้อน แสดงชัดว่าอันไหนค้าง
- หลังเผยแพร่สำเร็จ → เขียน `ContentFingerprint` ทันทีในทรานแซกชันเดียวกับที่บันทึกผลเผยแพร่

---

## 7. หน้าจอ

**`/studio`** (ใหม่ — ศูนย์รวม)
1. *โจทย์* — เลือกแบรนด์, พิมพ์โจทย์/keyword, เลือกช่องทาง, เลือกโหมดค้นคว้า (ธรรมดา / เจาะลึก พร้อมบอกว่าเจาะลึกมีค่าใช้จ่าย)
2. *ผลค้นคว้า* — บทสรุป + รายการหลักฐานที่กดดูต้นทางได้ + คำค้นจาก Search Console
3. *เลือกมุม* — การ์ดมุมละใบ พร้อมคะแนนและ **ป้ายกันซ้ำ** (`เคยทำแล้ว` / `คล้ายของเดิม` / `ใหม่`)
4. *ตรวจร่าง* — แท็บรายช่องทาง แก้ได้ทุกช่อง เห็นการ์ดภาพ/สเปกคลิป
5. *ตั้งเวลาและส่งอนุมัติ*

**`/studio/history`** — ประวัติแคมเปญ + **หน้าค้นฐานกันซ้ำ**: พิมพ์ข้อความ/keyword แล้วดูว่าเคยโพสต์อะไรใกล้เคียงไปบ้าง เมื่อไหร่ ช่องไหน (ใช้ก่อนเขียนเองด้วยมือก็ได้)

ธีมสว่างเดิม ใช้คลาส slate/sky ห้ามฮาร์ดโค้ดสี hex

---

## 8. API (ร่าง)

```
POST   /workspaces/:ws/research                 { brandId, keywords[], question?, depth }
GET    /workspaces/:ws/research/:id             บทสรุป + findings
POST   /workspaces/:ws/campaigns                { brandId, brief, targets[], researchRunId? }
POST   /workspaces/:ws/campaigns/:id/angles     ให้ AI เสนอมุม (ตรวจกันซ้ำให้เลย)
POST   /workspaces/:ws/campaigns/:id/generate   { angleId, targets[] } → สร้าง ContentItem ทุกช่องทาง
GET    /workspaces/:ws/campaigns/:id            แคมเปญ + items + สถานะรายช่องทาง
POST   /workspaces/:ws/campaigns/:id/schedule   { schedule: { target: localTime } }
POST   /workspaces/:ws/campaigns/:id/submit     ส่งอนุมัติทุกชิ้นตามกติกาเดิม
POST   /workspaces/:ws/dedupe/check             { brandId, platform, text, mediaHashes[] } → verdict + ตัวที่ชน
GET    /workspaces/:ws/dedupe/search?q=         ค้นฐานกันซ้ำด้วยมือ
PUT    /workspaces/:ws/brands/:id/dedupe-policy ตั้งค่ากันซ้ำของแบรนด์
```

สิทธิ์ใหม่: `research.run` · `research.deep` (แยกเพราะมีค่าใช้จ่าย) · `campaign.create` · `campaign.manage` · `dedupe.override`
บทบาท: `viewer`/`analyst` อ่านได้ · `editor` สร้างแคมเปญ+ค้นธรรมดา · `manager` ค้นเจาะลึก + กดผ่านกันซ้ำ

---

## 9. กฎที่ต้องรักษา

- คีย์ search provider เข้ารหัสด้วย `common/crypto` ห้ามอยู่ใน select/response/audit
- เรียก AI ผ่าน `AiGatewayService` / `runStructuredTask` เท่านั้น ห้าม import SDK
- ตัวเลขที่อ่านไม่ได้ = `null` ห้ามแปลงเป็น 0 ทั้งใน `ResearchFinding.signals` และในบทสรุป
- ค้นเว็บต้องสุภาพ: UA ระบุตัว, เคารพ robots, ≤ 1 คำขอ/วินาที, กัน SSRF
- ห้ามลอกเนื้อหา/ภาพจากเว็บหรือเพจอื่นมาโพสต์
- test ห้ามยิง search API จริง/เว็บจริง — เพิ่ม `startMockSearch()` ในชุด mock
- การกดผ่านคำเตือนกันซ้ำต้องมีเหตุผลและเข้า `AuditLog` ทุกครั้ง
- AI ห้ามตัดสินฟิลด์นโยบายของ YouTube/TikTok

---

## 10. แผนทำเป็นเฟส

| เฟส | ได้อะไร | DoD |
|---|---|---|
| **C-1** ฐานกันซ้ำ | `ContentFingerprint` + `DedupePolicy` + normalize/simhash/banding + backfill worker + `POST /dedupe/check` + หน้าค้นด้วยมือ | unit ครอบ normalize/simhash/Hamming ภาษาไทย · int test: สร้างโพสต์ซ้ำแล้วโดนบล็อก, variant เดียวกันผ่าน, เกิน repostAfterDays ลดเป็น INFO |
| **C-2** ค้นคว้าโหมดธรรมดา | `ResearchRun`/`ResearchFinding` + ตัวรวบรวมข้อมูลภายใน + บทสรุปมี evidence | int test: run ได้ brief พร้อม findings ทุกข้อมี url/ที่มา · ไม่มีคำขอออกเน็ตเลย |
| **C-3** แคมเปญ + เสนอมุม | `ContentCampaign`/`ContentAngle` + เสนอมุมพร้อมป้ายกันซ้ำ + หน้า `/studio` ขั้น 1–3 | E2E: พิมพ์โจทย์ → ได้มุม → มุมที่เคยทำติดป้าย |
| **C-4** สร้างครบทุกช่องทาง | สเปกคลิปสั้น + ตัวแปลงรายแพลตฟอร์ม + การ์ดภาพ + ตั้งเวลาเหลื่อม + ส่งอนุมัติทั้งชุด | E2E: โจทย์เดียว → FB post + Reel + Short + TikTok + บทความ ครบ ผูกด้วย ContentRelation · ทุกชิ้นยังต้องผ่านประตูอนุมัติเดิม |
| **C-5** ค้นคว้าเจาะลึก | `SearchProvider` + ตัวอ่านหน้าเว็บสุภาพ + เพดาน/ค่าใช้จ่าย + `startMockSearch()` | int test กับ mock ล้วน · ทดสอบ robots/SSRF/rate limit · บังคับ evidence ครบ |

ทำ C-1 ก่อนเสมอ — มันคือของที่เอาไปใช้ได้ทันทีแม้ยังไม่มีอะไรอย่างอื่น และเป็นด่านที่เฟสหลังต้องพึ่ง

---

## 11. เรื่องที่ต้องตัดสินใจก่อนเริ่ม C-5

1. **ผู้ให้บริการค้นเว็บ** — Serper (ถูก ง่าย) · Google Programmable Search (ทางการ โควตาฟรี 100/วัน) · Brave · Tavily (ออกแบบมาเพื่อ AI โดยเฉพาะ) เลือกหนึ่ง แล้วต้องเพิ่มโดเมนใน egress allowlist ของ VPS
2. **งบค้นเจาะลึกต่อเดือน** — ตั้งเพดานเท่าไหร่ และให้ใครกดได้บ้าง
3. ~~ภาพจาก AI เอาไหม~~ → **เอา** ออกแบบไว้ในข้อ 12 แล้ว เหลือเลือกว่าจะเริ่มด้วยเจ้าไหน และกรอกราคาต่อหน่วยเท่าไหร่
4. **คู่แข่งที่จะเฝ้าดู** — ต้องการให้ระบบดูช่อง YouTube/TikTok ของคู่แข่งด้วยไหม (ทำได้ผ่าน API ทางการเท่านั้น)

---

## 12. ชั้นผู้ให้บริการ AI — หลายเจ้าพร้อมกัน เลือกได้ตอนทำงาน

### 12.1 ของเดิมทำไปแล้วครึ่งทาง

ระบบมี `AiProviderKey` (คีย์ต่อ workspace, เข้ารหัสแล้ว), `AiRoleConfig` (บทบาท → provider + model) และอะแดปเตอร์ 5 ตัว
(`anthropic` / `openai` / `gemini` / `openrouter` / `compatible`) ทำงานผ่าน HTTP ล้วนอยู่แล้ว — **เรื่องข้อความจึงเหลือแก้แค่สองจุด**

| ช่องโหว่ | อาการจริง | ทางแก้ |
|---|---|---|
| `@@unique([workspaceId, provider])` | มี `compatible` ได้แค่ **ตัวเดียว** → ใส่ MiniMax แล้วใส่ Groq เพิ่มไม่ได้ | เปลี่ยนไปคีย์ด้วย **ชื่อที่ตั้งเอง** แทนชนิด |
| `AiRoleConfig.provider` เป็นสตริงชนิด | ชี้ไปที่ "ชนิด" ไม่ใช่ "คีย์ใบไหน" เลยแยกสองตัวที่ชนิดเดียวกันไม่ออก | ชี้ไปที่ `connectionId` |

ส่วน **สร้างรูป / สร้างคลิป เป็นคนละเรื่องกันโดยสิ้นเชิง** ยัดลงทางเดิมไม่ได้ เพราะ:
- เป็นงาน **asynchronous** — ส่งงาน → ได้ job id → poll เป็นนาที (คลิปบางเจ้า 2–5 นาที) ไม่ใช่ request/response
- ผลลัพธ์เป็น **ไฟล์ไบนารี** ต้องโหลดมาเก็บเอง ไม่ใช่ข้อความ
- คิดเงิน **ต่อภาพ / ต่อวินาที** ไม่ใช่ต่อ token → `estimateCostUsd()` และ `AiTaskLog.inputTokens` ใช้ไม่ได้เลย

จึงต้องมีชั้นพี่น้องอีกชั้นหนึ่ง ไม่ใช่การต่อท่อเดิม

---

### 12.2 ข้อความ — `AiConnection` แทน `AiProviderKey`

```prisma
/// หนึ่งแถว = หนึ่งคีย์ที่ผู้ใช้ใส่ ตั้งชื่อเองได้ ใส่ชนิดเดียวกันกี่ใบก็ได้
model AiConnection {
  id              String    @id @default(cuid())
  workspaceId     String
  /// ชื่อที่ผู้ใช้ตั้ง เช่น "Claude หลัก", "MiniMax", "Groq ราคาถูก"
  label           String
  /// ชนิดอะแดปเตอร์: anthropic | openai | gemini | openrouter | compatible
  kind            String
  /// preset ที่เลือกตอนสร้าง (minimax | deepseek | groq | ...) — ใช้เติมค่าเริ่มต้นและแสดงโลโก้เท่านั้น
  preset          String?
  encryptedApiKey String
  keyHint         String?
  baseUrl         String?
  /// โมเดลที่แนะนำของคีย์ใบนี้ ให้ dropdown เลือกได้เร็วโดยไม่ต้องพิมพ์
  models          String[]  @default([])
  status          String    @default("ACTIVE")
  lastValidatedAt DateTime?
  lastError       String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  workspace Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  roles     AiRoleConfig[]

  @@unique([workspaceId, label])
  @@index([workspaceId, kind])
}
```

`AiRoleConfig` เปลี่ยน `provider String` → `connectionId String` + relation (migration แปลงของเดิมให้อัตโนมัติ
โดยตั้ง `label` = ชื่อ provider เดิม จึงไม่เสียค่าที่ตั้งไว้แล้ว)

**ไม่เขียนอะแดปเตอร์เพิ่มรายเจ้า** — เจ้าที่พูด OpenAI protocol (MiniMax, DeepSeek, Groq, Together, LiteLLM, Ollama ฯลฯ)
ใช้ `kind: 'compatible'` ได้หมด สิ่งที่เพิ่มคือ **แคตตาล็อก preset ในโค้ด** เพื่อให้ตั้งค่าคลิกเดียว:

```ts
// packages/ai-core/src/presets.ts — ข้อมูลล้วน ไม่มี logic
export const PROVIDER_PRESETS = [
  { id: 'anthropic',  label: 'Anthropic (Claude)', kind: 'anthropic',  baseUrl: null, models: [...] },
  { id: 'openai',     label: 'OpenAI',             kind: 'openai',     baseUrl: null, models: [...] },
  { id: 'gemini',     label: 'Google Gemini',      kind: 'gemini',     baseUrl: null, models: [...] },
  { id: 'openrouter', label: 'OpenRouter',         kind: 'openrouter', baseUrl: null, models: [...] },
  { id: 'minimax',    label: 'MiniMax',            kind: 'compatible', baseUrl: '<ยืนยันจากเอกสารตอนลงมือ>', models: [...] },
  { id: 'deepseek',   label: 'DeepSeek',           kind: 'compatible', baseUrl: 'https://api.deepseek.com/v1', models: [...] },
  { id: 'groq',       label: 'Groq',               kind: 'compatible', baseUrl: 'https://api.groq.com/openai/v1', models: [...] },
  { id: 'custom',     label: 'อื่น ๆ (OpenAI-compatible)', kind: 'compatible', baseUrl: null, models: [] },
];
```

> `baseUrl` และรายชื่อโมเดลของแต่ละเจ้า **ยืนยันจากเอกสารจริงตอนลงมือทำ** ไม่ใส่ค่าที่เดาเอาไว้ในสเปก

---

### 12.3 สื่อ — แพ็กเกจใหม่ `@fbpm/media-core`

```prisma
/// คีย์ของผู้ให้บริการสร้างรูป/คลิป
model MediaConnection {
  id              String   @id @default(cuid())
  workspaceId     String
  label           String            // "KIE AI", "WaveSpeed", "OpenRouter รูป"
  /// ชนิดอะแดปเตอร์: openrouter | kie | wavespeed | openai_image | gemini_image | generic_async
  kind            String
  encryptedApiKey String
  keyHint         String?
  baseUrl         String?
  status          String   @default("ACTIVE")
  lastValidatedAt DateTime?
  lastError       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  workspace Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  models    MediaModelConfig[]
  jobs      MediaJob[]

  @@unique([workspaceId, label])
}

/// "งานประเภทนี้ ให้ใช้เจ้านี้ โมเดลนี้" — เทียบเท่า AiRoleConfig ของฝั่งข้อความ
model MediaModelConfig {
  id           String   @id @default(cuid())
  workspaceId  String
  /// IMAGE_POST | IMAGE_THUMBNAIL | IMAGE_BROLL | VIDEO_SHOT | VIDEO_BROLL | TTS_VOICE
  purpose      String
  connectionId String
  model        String
  /// ค่าตั้งเฉพาะเจ้า เช่น { aspectRatio: "9:16", steps: 30, durationSec: 5 }
  params       Json?
  /// ★ ราคาต่อหน่วย — ผู้ใช้กรอกเอง เพราะ API ของเจ้าพวกนี้ไม่ได้ส่งราคากลับมา และราคาเปลี่ยนบ่อย
  unitCostUsd  Decimal? @db.Decimal(10, 4)
  /// image | second | job
  unit         String   @default("job")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  connection MediaConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, purpose])
}

/// งานสร้างสื่อหนึ่งชิ้น — asynchronous, กันซ้ำ, ตามผลได้
model MediaJob {
  id             String    @id @default(cuid())
  workspaceId    String
  brandId        String?
  contentId      String?
  campaignId     String?
  purpose        String
  connectionId   String
  model          String
  prompt         String
  params         Json?
  /// QUEUED | SUBMITTED | RUNNING | SUCCEEDED | FAILED | CANCELLED | TIMED_OUT
  status         String    @default("QUEUED")
  externalJobId  String?
  /// กันยิงซ้ำแบบเดียวกับ ExternalOperation: media:<contentId>:<purpose>:<hash(prompt+params)>
  idempotencyKey String    @unique
  attempts       Int       @default(0)
  pollCount      Int       @default(0)
  nextPollAt     DateTime?
  submittedAt    DateTime?
  finishedAt     DateTime?
  /// คำนวณจาก unitCostUsd × หน่วยที่ใช้ — ไม่รู้ราคา = null ห้ามเป็น 0
  costUsd        Decimal?  @db.Decimal(10, 4)
  durationSec    Int?
  outputAssetIds String[]  @default([])
  error          String?
  requestedById  String?
  createdAt      DateTime  @default(now())

  connection MediaConnection @relation(fields: [connectionId], references: [id], onDelete: Restrict)

  @@index([workspaceId, status, nextPollAt])
  @@index([contentId])
}
```

`MediaAsset` เพิ่ม: `aiGenerated Boolean @default(false)` · `mediaJobId String?` · `sha256 String?` · `kind` รับค่า `generated` เพิ่ม

**อะแดปเตอร์กลาง** (HTTP ล้วน ห้าม import SDK เจ้าไหนทั้งสิ้น):

```ts
export type MediaPurpose = 'IMAGE_POST' | 'IMAGE_THUMBNAIL' | 'IMAGE_BROLL' | 'VIDEO_SHOT' | 'VIDEO_BROLL' | 'TTS_VOICE';
export interface MediaOutput { url: string; mimeType: string; width?: number; height?: number; durationSec?: number }

export interface MediaAdapter {
  kind: string;
  supports: MediaPurpose[];
  /** เจ้าที่ตอบทันทีคืน outputs เลย เจ้าที่เป็นคิวคืน externalJobId */
  submit(cfg: MediaConfig, req: MediaRequest): Promise<{ externalJobId: string } | { outputs: MediaOutput[] }>;
  /** เฉพาะเจ้าที่เป็นคิว */
  poll?(cfg: MediaConfig, externalJobId: string): Promise<{ status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; outputs?: MediaOutput[]; error?: string }>;
}
```

เขียนอะแดปเตอร์ทีละเจ้าตามเอกสารจริง (`openrouter`, `kie`, `wavespeed`) — โครงข้างบนครอบทั้งแบบซิงก์และแบบคิว
เจ้าใหม่ที่เข้ามาทีหลังเขียนไฟล์เดียวจบ ไม่ต้องแตะที่อื่น

**คิวและการตามผล** — `workers/scheduler` เพิ่มคิว `media-generate`:
1. `submit` → บันทึก `externalJobId`, ตั้ง `nextPollAt`
2. งาน `media-poll` วนถามสถานะด้วย backoff (10 วิ → 30 วิ → 60 วิ), เพดาน 10 นาทีแล้ว `TIMED_OUT`
3. สำเร็จ → โหลดไฟล์ (ตรวจ content-type, เพดานขนาด, กัน SSRF ด้วย `isPrivateHost()` ตัวเดียวกับ W-1) → เก็บลง `MEDIA_DIR` → `sha256` → สร้าง `MediaAsset(aiGenerated: true)`
4. `sha256` เข้าไปอยู่ใน `ContentFingerprint.mediaHashes` ด้วย → **รูปที่ AI สร้างก็โดนกันซ้ำเหมือนกัน**

---

### 12.4 เลือกตอนทำงานจริง

สองระดับ:

**ระดับค่าเริ่มต้น** (หน้า *โมเดล AI* ตั้งครั้งเดียว)

| งาน | ตั้งที่ไหน |
|---|---|
| ค้นคว้า | `AiRoleConfig` บทบาท **`research`** ← บทบาทนี้มีในระบบอยู่แล้วแต่ยังไม่เคยถูกใช้ งานนี้คือที่ที่มันได้ใช้จริง |
| เขียนคอนเทนต์ | บทบาท `content` |
| ตอบแชท/คอมเมนต์ | บทบาท `community` |
| สร้างรูป | `MediaModelConfig` purpose `IMAGE_POST` |
| สร้างคลิป | `MediaModelConfig` purpose `VIDEO_SHOT` |

**ระดับต่อครั้ง** (ในหน้า `/studio` ทุกขั้นมี dropdown "ใช้ตัวไหน")
ส่ง `connectionId` + `model` มากับคำขอ → ใช้ทันทีโดยข้ามการเลือกตามบทบาท **แต่ยังตรวจงบและบันทึก log เหมือนเดิมทุกประการ**

```ts
// runAiTask รับ override เพิ่ม — ไม่กระทบผู้เรียกเดิม
runAiTask(ctx, { ...meta, override: { connectionId, model } }, fn)
```
`AiTaskLog` / `MediaJob` บันทึกว่าใช้ตัวไหนเสมอ → ย้อนดูได้ว่า "คลิปที่ยอดดีเดือนนี้ใช้เจ้าไหนทำ"

**ลองเทียบกันก่อนเลือก (ไม่บังคับ)** — ปุ่ม *ลองหลายตัว* ยิงโจทย์เดียวกันไป 2–3 ตัวพร้อมกัน แสดงผลข้างกัน
พร้อมราคาจริงของแต่ละตัว กดเลือกตัวที่ชอบ → ระบบตั้งเป็นค่าเริ่มต้นของงานนั้นให้ (คิดเงินตามจริงทุกตัวที่ยิง แจ้งก่อนกด)

---

### 12.5 งบสองก้อน แยกกัน

`Workspace` เพิ่ม `mediaMonthlyBudgetUsd Decimal?` แยกจาก `aiMonthlyBudgetUsd` เดิม

เหตุผล: อัตราต่างกันเป็นร้อยเท่า คลิปเดียวอาจแพงกว่าค่าข้อความทั้งเดือน ถ้าใช้ก้อนเดียวกัน
การทดลองสร้างคลิปไม่กี่ครั้งจะทำให้แชทลูกค้าหยุดทำงานทั้งพื้นที่ทำงาน — ซึ่งเป็นความเสียหายที่ไม่ควรเกิด
หน้าเดียวแสดงทั้งสองก้อน แต่เพดานแยกและเตือนแยก

---

### 12.6 สื่อที่ AI สร้าง กับฟิลด์นโยบายของแพลตฟอร์ม

`MediaAsset.aiGenerated = true` เป็น **ข้อเท็จจริงที่ระบบรู้แน่** (เราเป็นคนสั่งสร้างเอง) ไม่ใช่การคาดเดาของ AI

เมื่อไฟล์นั้นถูกแนบกับ YouTube หรือ TikTok:
- ระบบ **บังคับ** ให้คนตอบฟิลด์นโยบาย (`syntheticMedia` / `paidPlacement` / `madeForKids`) ก่อนอนุมัติ ข้ามไม่ได้
- ช่อง `syntheticMedia` ตั้งค่าเริ่มต้นเป็น *ใช่* พร้อมหมายเหตุว่า "ไฟล์นี้สร้างด้วย AI ในระบบ"
- **AI ยังห้ามตัดสินฟิลด์นี้เอง** ตามกฎเดิม — ระบบแค่บอกสิ่งที่รู้ คนยังเป็นผู้กดยืนยัน

---

### 12.7 กฎเพิ่มเติมของชั้นนี้

- คีย์ทุกใบเข้ารหัสด้วย `common/crypto` · ห้ามอยู่ใน select/response/audit · แสดงได้แค่ 4 ตัวท้าย
- ห้าม import SDK ของผู้ให้บริการรายใด — HTTP ล้วนเหมือนทุก integration ในโปรเจกต์นี้
- **ราคาที่ไม่รู้ = `null` ห้ามเดา ห้ามใส่ 0** ถ้าผู้ใช้ไม่กรอก `unitCostUsd` หน้าสรุปต้องขึ้นว่า "ไม่ทราบค่าใช้จ่าย" ไม่ใช่ $0.00
- ดาวน์โหลดไฟล์ผลลัพธ์ต้องตรวจ content-type, เพดานขนาด, timeout และกัน SSRF
- test ใช้ `startMockMediaProvider()` — **ห้ามยิง API จริงของเจ้าไหนทั้งสิ้นใน CI** และห้ามใส่คีย์จริงเป็น secret ของ CI
- ต้องเพิ่มโดเมนของทุกเจ้าที่ใช้เข้า egress allowlist ของ VPS ก่อนใช้งานจริง
- `MediaJob` ต้องมี `idempotencyKey` เสมอ — กันยิงซ้ำตอน worker restart (บทเรียนเดียวกับ `ExternalOperation`)

---

### 12.8 เฟสของชั้นนี้

| เฟส | ได้อะไร | DoD |
|---|---|---|
| **P-1** ข้อความหลายเจ้า | `AiConnection` + migration จากของเดิม + แคตตาล็อก preset + `AiRoleConfig.connectionId` + override ต่อครั้ง + หน้าตั้งค่าใหม่ | int test: ใส่ `compatible` 2 ใบพร้อมกันได้ · บทบาท `research` ชี้คนละใบกับ `content` ได้ · override ต่อครั้งเข้า `AiTaskLog` ถูกตัว · ของเดิมที่ตั้งไว้ไม่หาย |
| **P-2** สร้างรูป | `@fbpm/media-core` + `MediaConnection`/`MediaModelConfig`/`MediaJob` + คิว + อะแดปเตอร์รูปเจ้าแรก + ปุ่มสร้างรูปในหน้าคอนเทนต์ | int test กับ mock ล้วน: ส่งงาน → poll → ได้ `MediaAsset(aiGenerated)` · ยิงซ้ำ key เดิมไม่สร้างงานใหม่ · ไม่กรอกราคา → `costUsd` เป็น null |
| **P-3** สร้างคลิป | อะแดปเตอร์วิดีโอ (KIE / WaveSpeed) + poll ยาว + timeout + ผูกกับ TikTok/Shorts/Reel + บังคับฟิลด์นโยบาย | E2E: สั่งสร้างคลิป → ได้ไฟล์ → แนบกับ ContentItem → อนุมัติไม่ผ่านถ้ายังไม่ตอบฟิลด์นโยบาย |
| **P-4** เทียบก่อนเลือก | ปุ่มลองหลายตัว + หน้าเทียบผลและราคา + ตั้งเป็นค่าเริ่มต้น | int test: ยิง 2 ตัว ได้ 2 ผล คิดเงินทั้งคู่ |

### ลำดับที่แนะนำรวมทั้งหมด

```
P-1 → C-1 → C-2 → C-3 → P-2 → C-4 → P-3 → C-5 → P-4
 │     │     │     │     │     │     │     │
 │     │     │     │     │     │     │     └─ ค้นเจาะลึก (ต้องเลือก search provider ก่อน)
 │     │     │     │     │     │     └─────── สร้างคลิป
 │     │     │     │     │     └───────────── สร้างครบทุกช่องทาง
 │     │     │     │     └─────────────────── สร้างรูป
 │     │     │     └───────────────────────── แคมเปญ + เสนอมุม
 │     │     └─────────────────────────────── ค้นคว้าโหมดธรรมดา
 │     └───────────────────────────────────── ฐานกันซ้ำ  ← ใช้ได้ทันทีแม้ไม่มีอย่างอื่น
 └─────────────────────────────────────────── หลายเจ้าสำหรับข้อความ ← เล็กที่สุด ได้ผลทั้งระบบทันที
```

**P-1 มาก่อนเสมอ** เพราะเล็กที่สุด และพอเสร็จแล้วทุกโมดูลที่มีอยู่ (คอนเทนต์ YouTube TikTok เว็บ อีเมล แชท)
ได้ประโยชน์ทันทีโดยไม่ต้องรอ Content Engine เลย
