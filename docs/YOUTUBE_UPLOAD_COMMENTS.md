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

ทดสอบ: `apps/api/src/youtube/youtube.int.test.ts` (quick upload, threads) และ E2E `YouTube: quick upload …` ใน `test/e2e/smoke.spec.ts`
