# YouTube — อัปคลิปด่วน (Private) และคิว "รอตอบ" คอมเมนต์

## อัปคลิปด่วน
หน้า `/youtube` → การ์ด "⬆️ อัปคลิปขึ้น YouTube (Private)"

1. เลือกช่อง (ต้องเชื่อมแบบ OAuth) → เลือกไฟล์ → ชื่อ/คำอธิบาย/แท็ก → เลือก "สร้างมาเพื่อเด็กหรือไม่" เอง (§62 — AI ห้ามตัดสิน)
2. ระบบ: `POST youtube/content` → สตรีมไฟล์ไป `content/:id/assets/video` (จำกัด `YOUTUBE_MAX_MB`, ไม่รับถ้าดิสก์จะเหลือ < 1 GB) → `POST content/:id/quick-upload`
3. `quickUpload` เดิน state machine จนถึง `APPROVED` โดยบันทึก `ApprovalRequest` (APPROVED, ผู้อนุมัติ = คนกด) + audit `YOUTUBE_CONTENT_APPROVED` แล้วเข้าคิว `youtube-upload`
   - privacy ได้แค่ `private` / `unlisted` — เผยแพร่สาธารณะให้เจ้าของไปกดเองใน YouTube Studio
   - สิทธิ์ที่ต้องมี: `youtube.upload` + `youtube.content.approve`
4. worker อัปแบบ resumable อ่านไฟล์ทีละ 8 MB จากดิสก์ (ไม่โหลดทั้งไฟล์เข้าแรม)
5. YouTube ตอบ videoId แล้ว → `releaseLocalVideo` ลบไฟล์ใต้ `MEDIA_DIR` ทิ้ง (แถว `MediaAsset` เก็บไว้ + `meta.deletedAfterUpload`) · ตั้ง `YOUTUBE_KEEP_VIDEO_AFTER_UPLOAD=true` ถ้าอยากเก็บ
   - เปลี่ยนคลิปก่อนอัป → ไฟล์เก่าถูกลบทันที
   - ถ้า YouTube ประมวลผลล้มหลังจากนั้น ต้องแนบไฟล์ใหม่

nginx: location อัปโหลดคลิปใน `deploy/nginx-fbpm.conf` ครอบทั้ง `media/videos` (Reels) และ `youtube/content/:id/assets/video` ที่ `client_max_body_size 2048m` (ต้อง ≥ `YOUTUBE_MAX_MB`)

## คิว "รอตอบ"
หน้า `/youtube/comments` แท็บ "💬 รอตอบ"

- YouTube มี reply ชั้นเดียว: เธรด = ความเห็นบนสุด + replies ทั้งหมด (`parentCommentId` = id ของความเห็นบนสุด)
- `recomputeNeedsReply` (`packages/youtube-core/src/sync.ts`): ความเห็นของผู้ชมที่มา**หลัง**การจัดการครั้งล่าสุดของช่องในเธรด → `needsReply=true`
  - "จัดการแล้ว" = ช่องพูดในเธรด (`authorChannelId` = ช่อง) หรือความเห็นนั้น SENT / SKIPPED / ปิดเรื่อง / SPAM
  - คำนวณใหม่ทุกครั้งที่ซิงก์ (worker ทุก 3 ชม. `yt-sync-all-comments-3h`), ตอบ, หรือปิดเรื่อง — ตอบจาก YouTube Studio เองก็หายจากคิวหลังซิงก์
- `GET youtube/comments/threads` → เป้าหมาย = ความเห็นล่าสุดที่รอตอบของแต่ละเธรด + ข้อความในเธรด (8 ล่าสุด, บอกว่าอันไหนเป็นของช่อง)
- `POST youtube/comments/classify { pendingOnly: true }` → AI ร่างให้เป้าหมายที่ยังไม่มีร่าง พร้อมบริบทเธรด (`[ช่อง]` = ที่เราเคยตอบ) ผ่าน `AiGatewayService` บทบาท community
- ตอบ reply → `comments.insert` ด้วย parentId = ความเห็นบนสุด + ขึ้นต้น `@ผู้เขียน` อัตโนมัติ แล้วบันทึกคำตอบของช่องลงเธรดทันที
- `POST youtube/comments/reply-bulk { ids ≤ 30 }` ส่งร่างที่คนตรวจแล้ว (UI ถามยืนยันก่อน) · หยุดเมื่อ kill switch / โควตาหมด
- ไม่มีการตอบเองอัตโนมัติเพิ่มจากนี้ — การตอบเองยังเป็นไปตาม `policy.allowAutoReply` + automation level เดิม

- ทุกข้อความแสดงอายุแบบ YouTube ("4 สัปดาห์ที่ผ่านมา", ชี้ดูวันเวลาจริง) — `timeAgo` ใน `apps/web/lib/yt-comment.ts`
- ปุ่ม "📋 คัดลอกถาม AI" คัดลอกข้อความพร้อมวางใน ChatGPT: ชื่อคลิป + ลิงก์ + บทสนทนาก่อนหน้า + คอมเมนต์ที่ต้องตอบ + คำสั่งขอคำตอบ 3 แบบ (`replyPrompt`) — ทำในเบราว์เซอร์ล้วน ไม่เรียก AI ของระบบ

## ⭐ คอมเมนต์น่าสนใจ
หน้า `/youtube/comments` แท็บ "⭐ คอมเมนต์น่าสนใจ"

- `POST youtube/channels/:id/comments/highlights { days }` (บทบาท AI `analysis`) — ส่งเฉพาะคอมเมนต์ของผู้ชม (ไม่รวมของช่อง/สแปม) สูงสุด 300 รายการ แบบย่อ (ข้อความ ≤ 300, likes, จำนวนคนตอบต่อ, อายุวัน, ยังไม่ได้ตอบ)
- AI คืน: ภาพรวม, คอมเมนต์น่าสนใจ ≤ 15 (คะแนน/ชนิด/เหตุผล/ไอเดียหัวข้อ), ไอเดียหัวข้อคลิป ≤ 6 — id ที่ไม่มีจริงถูกตัด, ข้อความ/คลิป/วันที่ที่แสดงประกอบจาก DB ไม่ใช้ข้อความจาก AI
- เก็บใน `YouTubeCommentHighlightRun` (แยกจาก `YouTubeChannelAnalysis`) · `GET .../comments/highlights` = ผลล่าสุด
- "➕ ส่งไป Content Lab" = `POST youtube/content` (IDEA) พร้อม notes อ้างคอมเมนต์ต้นทาง → ทำสคริปต์/ชื่อ/SEO ต่อใน YT · Content Lab

## ร่างโพสต์ชุมชน (แท็บ "โพสต์" ของช่อง)
หน้า `/youtube/community` (เมนู YT · โพสต์ชุมชน)

- **YouTube Data API ไม่มีคำสั่งโพสต์ชุมชน** — `activities.insert` / channel bulletin ถูกปิดตั้งแต่ 18 พ.ค. 2020 และไม่มีคำสั่งอ่านโพสต์ชุมชนด้วย → ระบบ**ไม่โพสต์เอง** และห้ามใช้บอทล็อกอินแทน (ผิดข้อกำหนด YouTube)
- `POST youtube/channels/:id/community/draft { source: VIDEO|HIGHLIGHTS|TEXT, videoId?, text?, kind: AUTO|TEXT|POLL|IMAGE, count 1–5, note? }` — AI บทบาท `content` ร่างจากคลิป (ล่าสุดหรือที่เลือก + ลิงก์), ผลคอมเมนต์น่าสนใจล่าสุด, หรือข้อความที่วางมา (เช่น โพสต์ Facebook)
- โพลถูกจัดให้ตรงข้อจำกัด YouTube: 2–5 ตัวเลือก, ตัวละ ≤ 65 ตัวอักษร, ตัดซ้ำ (`cleanPollOptions`) — โพลที่ตัวเลือกไม่พอกลายเป็นข้อความ · IMAGE มีแค่ `imageIdea` (คนทำรูปเอง)
- เก็บใน `YouTubeCommunityDraft` (DRAFT → POSTED / ARCHIVED) · `POST youtube/community` เขียนเอง · `PATCH youtube/community/:id` แก้/ตั้งเวลา/ทำเครื่องหมายโพสต์แล้ว
- ตั้ง `scheduledAt` → worker `yt-community-reminders-10m` แจ้งเตือนครั้งเดียวเมื่อถึงเวลา (`remindedAt`) · เปลี่ยนเวลาแล้วเตือนใหม่
- หน้าเว็บ: คัดลอกข้อความ / คำถาม / ตัวเลือกโพลทีละข้อ / ไอเดียรูป + ลิงก์ `youtube.com/channel/<id>/posts`

ทดสอบ: `apps/api/src/youtube/youtube.int.test.ts` (quick upload, threads) และ E2E `YouTube: quick upload …` ใน `test/e2e/smoke.spec.ts`
