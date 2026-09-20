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

### สิ่งที่ระบบนี้ "ไม่ทำ" (ต้องเข้าใจตรงกันก่อนเริ่ม)
- **ไม่ตัดต่อวิดีโอและไม่สร้างไฟล์คลิปให้** — คลิปสั้นที่ได้คือ *สเปกการถ่าย*: hook 3 วินาทีแรก, ลำดับภาพ (shotlist), ข้อความบนจอ, สคริปต์พากย์, แคปชันรายแพลตฟอร์ม ไฟล์วิดีโอจริงยังต้องถ่าย/ตัดเอง แล้วอัปเข้าระบบ
- **ไม่สร้างภาพด้วย AI** — ภาพที่ระบบทำให้ได้เองคือ *การ์ด* 1080×1080 จากเทมเพลตที่มีอยู่ (`quote` / `stat` / `tips` / `hero` × 6 ธีม) ถ้าต้องการภาพสังเคราะห์ต้องเพิ่มผู้ให้บริการใหม่ (ดูข้อ 11)
- **ไม่โพสต์ Instagram / X / LINE OA** — ยังไม่มีโมดูลของแพลตฟอร์มเหล่านี้
- **ไม่ข้ามขั้นอนุมัติ** — ทุกแพลตฟอร์มยังใช้ประตูอนุมัติเดิมของตัวเองทุกประตู

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
3. **ภาพจาก AI** — เอาไหม ถ้าเอาต้องเพิ่มผู้ให้บริการภาพ (มีค่าใช้จ่ายต่อภาพ และต้องมีกติกาเรื่องการเปิดเผยว่าเป็นภาพสังเคราะห์ ซึ่งกระทบฟิลด์ `syntheticMedia` ของ YouTube/TikTok)
4. **คู่แข่งที่จะเฝ้าดู** — ต้องการให้ระบบดูช่อง YouTube/TikTok ของคู่แข่งด้วยไหม (ทำได้ผ่าน API ทางการเท่านั้น)
