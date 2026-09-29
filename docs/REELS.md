# Facebook Reels — อัปโหลดคลิปแล้วตั้งเวลาโพสต์เป็น Reels

เพิ่ม 29 ก.ย. 2026 · โค้ด: `packages/facebook-core/src/video.ts` (ตรวจ MP4 ไม่ใช้ ffmpeg), `FacebookService.createReel`, `publisher.ts` (contentType `reel`), `apps/api/src/media` (`POST media/videos`, `POST content/:id/video`), `components/chatgpt-batch.tsx` (โหมด Reels), `content-card.tsx`

## ใช้งาน
**ทางที่ 1 — ChatGPT หลายหัวข้อ** (ห้องข่าว → นำเข้า → 🤖 ChatGPT หลายหัวข้อ)
1. รูปแบบโพสต์ = **🎬 คลิป Reels** → สร้างคำสั่ง: ChatGPT ค้นคว้า (โหมดเจาะลึกได้เหมือนโพสต์รูป) แล้วเขียน **แคปชันสั้น 150–400 ตัวอักษร** + **videoIdea** (สคริปต์คลิปแนวตั้งแบ่งช่วงเวลา: ช็อต · ข้อความบนจอ · บทพูด · CTA)
2. วางผล → แต่ละหัวข้อกด **🎬 อัปโหลดคลิป** (ดูสคริปต์ได้ที่ "ไอเดีย/สคริปต์คลิป") — หัวข้อที่ยังไม่มีคลิปนำเข้าไม่ได้
3. เลือกเวลา / กระจายเวลา → นำเข้า → ร่าง `contentType = reel` → อนุมัติ + ตั้งเวลา (กติกาเดิม: ไม่เติมเวลาเอง, เนื้อหาเสี่ยงเป็นร่าง, ยืนยันก่อน)

**ทางที่ 2 — ร่างเดิม**: หน้าคอนเทนต์ → คลิกโพสต์ → ส่วนสื่อ → **🎬 แนบคลิป Reels** (ได้เฉพาะก่อนอนุมัติ — อนุมัติแล้วกด "กลับไปแก้" ก่อน)

## ข้อกำหนดคลิป (ระบบตรวจตอนอัปโหลด)
| | |
|---|---|
| ไฟล์ | MP4 / MOV (ตรวจจากหัวไฟล์ `ftyp` ไม่เชื่อนามสกุล) |
| ความยาว | 3–90 วินาที (นอกช่วง = ปฏิเสธ 422 และลบไฟล์ทิ้ง) |
| ขนาดภาพ | แนวตั้ง 9:16 แนะนำ 1080×1920 (แนวนอน/ต่ำกว่า 540×960 = เตือน) |
| ขนาดไฟล์ | ≤ `REELS_MAX_MB` (ค่าเริ่มต้น 300) — สตรีมลงดิสก์ ไม่พักในหน่วยความจำ |

## ตอนโพสต์ (worker/โพสต์เลย)
Graph `/{page-id}/video_reels`: `upload_phase=start` → อัปโหลดไฟล์ไป `upload_url` (header `Authorization: OAuth <page token>`, `offset`, `file_size`) → `upload_phase=finish&video_state=PUBLISHED&description=<แคปชัน+แฮชแท็ก>`
- token ส่งไปได้เฉพาะ `https://rupload.facebook.com` (test = mock) — upload_url อื่นถูกปฏิเสธ
- ล้มก่อน finish (start/อัปโหลด) = ยังไม่ขึ้นเพจ → "ล้มแน่นอน" ส่งใหม่ได้ · finish ไม่รู้ผล = ล็อกกันซ้ำ (ปุ่ม "ตรวจแล้ว ไม่มีบนเพจ" เหมือนโพสต์รูป)
- ลิงก์: `https://www.facebook.com/reel/<video_id>` · FacebookPost `mediaType = reel`
- สิทธิ์: `pages_manage_posts` (ชุดเดิมของการโพสต์) · แอป Meta ต้อง Live ไม่งั้นคนทั่วไปมองไม่เห็น

## ความปลอดภัยที่เพิ่ม
publisher อ่านไฟล์ในเครื่องได้เฉพาะใต้ `MEDIA_DIR` (`insideMediaDir`) — path อื่นใน `mediaPaths` (เช่นไฟล์ระบบ) = ล้มพร้อมเหตุผล ไม่ส่งอะไรขึ้น Facebook (เดิมไม่ได้ตรวจ)

## ติดตั้งบน VPS (nginx ของเครื่อง)
nginx จำกัดไฟล์ 10 MB → เพิ่ม location ของเส้นทางอัปโหลดคลิปจาก `deploy/nginx-fbpm.conf` (`client_max_body_size 300m` + `proxy_request_buffering off` + timeout 600s) แล้ว `nginx -t && systemctl reload nginx` · ถ้าใช้ Caddy ไม่ต้องตั้ง (ไม่จำกัดขนาด)

## ทดสอบ
`packages/facebook-core/src/reels.test.ts` (ตรวจ MP4, createReel กับ mock, กัน upload_url แปลกปลอม, insideMediaDir) · `apps/api/src/content/reels.int.test.ts` (อัปโหลด/Range/ข้าม workspace, ChatGPT Reels → โพสต์ผ่าน mock, แนบกับร่างเดิม, อัปโหลดล้ม, reel ไม่มีคลิป) · E2E โหมด Reels ใน `test/e2e/smoke.spec.ts`
