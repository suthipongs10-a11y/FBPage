# เปิดระบบบนเครื่องพัฒนา

ต้องการตั้งค่าและตรวจรับทุกโมดูล ให้ใช้ [คู่มือรวมทุกโมดูล](ALL_MODULES_CHECKLIST.md) คู่กับหน้านี้ ซึ่งเน้นการเปิดระบบบนเครื่องและรายละเอียด TikTok/Gemini

อัปเดต 8 กันยายน 2026 จาก `fbpagesource.zip` โดยทำงานใน `C:\Work\SocialManage\fbpage` และเก็บ ZIP ต้นฉบับไว้

## เครื่องนี้

ติดตั้ง dependencies และเตรียม PostgreSQL / Redis แบบแยกสำหรับโปรเจ็กต์แล้ว ไม่ใช้ฐานข้อมูล production:

| ส่วน | ที่อยู่ |
|---|---|
| เว็บ | http://localhost:3000 |
| API / health | http://localhost:4000/health |
| PostgreSQL 16 | 127.0.0.1:55432, ฐาน `fbpm_local` |
| Redis 7 | 127.0.0.1:56379, logical DB 2 สำหรับแอป local |
| ฐานทดสอบ | `fbpm_test`; ห้ามใช้ฐานข้อมูลที่มีงานจริงรันทดสอบ |

ไฟล์ `.env` อยู่ที่ root และถูก Git ignore ค่า `AUTH_SECRET` ของเครื่องนี้สร้างแบบสุ่มแล้ว ห้ามเปลี่ยนเมื่อมีโทเค็นเข้ารหัสอยู่ มิฉะนั้นต้องเชื่อมบัญชีใหม่

เปิดระบบที่ build แล้วด้วย PowerShell:

```powershell
cd C:\Work\SocialManage\fbpage
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local.ps1 start
```

คำสั่งนี้ใช้ PostgreSQL / Redis แบบ portable ที่เตรียมไว้ใน `.local-tools` และเปิด API, เว็บ, worker แบบไม่มีหน้าต่างแทรก Log อยู่ใน `.local-data` ใช้ `scripts/local.ps1 status` ตรวจสถานะ และ `scripts/local.ps1 stop` หยุดเฉพาะ process ของแอปที่คำสั่งนี้เปิด ไม่ลบฐานข้อมูลและไม่หยุดบริการอื่น

สมัครผู้ใช้ใหม่ที่หน้าเว็บ แล้วสร้างลูกค้า → แบรนด์ → ข้อมูลแบรนด์ ไม่มีบัญชี admin หรือรหัสผ่านตายตัวแถมมากับ source

## เตรียมงานได้ก่อนมีคีย์

1. สร้างลูกค้าและแบรนด์ในหน้า **ลูกค้า**
2. ไป **TikTok → Content Studio** เลือกแบรนด์ และเลือก **ยังไม่เลือกบัญชี — เตรียมร่างไว้ก่อน**
3. เขียนชื่อร่าง, Hook, สคริปต์, คำบรรยายและแฮชแท็ก แล้วบันทึกได้โดยไม่ต้องใช้ TikTok หรือ AI key
4. ตรวจเนื้อหา ทำเครื่องหมายว่าตรวจแล้ว → ส่งขออนุมัติ → ผู้มีสิทธิ์อนุมัติงาน
5. กด **ดาวน์โหลดร่าง** เพื่อรับไฟล์ TXT ภาษาไทยสำหรับทีมผลิตหรือเตรียมโพสต์ด้วยตนเอง
6. เมื่อเชื่อมบัญชี TikTok ภายหลัง เลือกบัญชีในแบรนด์เดิม แล้วกด **ใช้บัญชีที่เลือกกับร่างนี้** ร่างจะกลับไปให้ตรวจและอนุมัติใหม่ก่อนส่ง

ร่างก่อนเชื่อมบัญชีเป็นข้อมูลของแบรนด์จริง ไม่มีการสร้างบัญชีหรือสถิติ TikTok ปลอม คีย์ Gemini ยังจำเป็นสำหรับปุ่มสร้างด้วย AI แต่หากมีเฉพาะ Gemini key ก็สร้างร่างตามแบรนด์ได้ก่อนมี TikTok key เช่นกัน รายการคอนเทนต์ต้นทางสำหรับแปลงร่างจำกัดเฉพาะแบรนด์เดียวกัน

หากเพิ่งเปิดเครื่องและต้องการเปิดเฉพาะฐานข้อมูล/คิวก่อน migrate หรือรันทดสอบ ใช้ `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local.ps1 services` จากนั้นใช้ `scripts/local.ps1 status` ตรวจบริการ ก่อนเปิดแอปด้วย `start`

## ติดตั้งจาก source บนเครื่องใหม่

ต้องมี Node.js 22+, pnpm 10.33, PostgreSQL 16 และ Redis 7 ใช้ Docker Compose สำหรับฐาน local ได้:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose -f docker-compose.local.yml up -d
```

แก้ `.env` ให้ `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fbpm_local` และ `REDIS_URL=redis://127.0.0.1:6379/2` พร้อมตั้ง `AUTH_SECRET` เป็นค่าสุ่มอย่างน้อย 32 ตัวอักษร ใช้ตัวอย่างนี้เฉพาะบริการ local ที่ bind loopback เท่านั้น ไฟล์ portable tools ไม่รวมใน source ZIP

```powershell
pnpm db:local
pnpm build
pnpm dev:api
```

เปิดอีกสอง terminal ที่ root และใช้ `pnpm dev:web` กับ `pnpm dev:worker` ตามลำดับ Launcher โหลด root `.env` และใช้ path สื่อร่วมกัน เว็บเปิดที่ 3000, API 4000 หากเพิ่งแก้ schema ให้หยุด API/worker ก่อน `pnpm db:generate` หรือ build บน Windows เพื่อไม่ให้ Prisma engine ถูกล็อก

## Gemini / Google AI Studio

ใช้ `GOOGLE_AI_API_KEY` ใน `.env` หรือเพิ่ม Gemini API key แยกต่อ workspace ในหน้า **โมเดล AI** เลือก Gemini ให้บทบาท content และ analysis แล้วใช้ปุ่มทดสอบเดิมของระบบ อ่าน [AI_PROVIDER.md](AI_PROVIDER.md) สำหรับการเลือกโมเดลและข้อจำกัด ไม่ต้องใส่ OpenAI key เพื่อใช้ TikTok

## TikTok OAuth จริง — BLOCKED_BY_CREDENTIALS

1. สร้างแอปใน TikTok for Developers และตั้งค่า Login Kit / Display API; ขอ `user.info.basic` และ `video.list` ใช้ `user.info.profile` / `user.info.stats` เมื่อแอปได้รับสิทธิ์และผู้ใช้อนุญาต
2. ตั้ง `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` ใน `.env` แล้วเริ่ม API และ worker ใหม่
3. Redirect จริงต้องเป็น HTTPS ที่ลงทะเบียนตรงกัน เช่น `https://your-dev-host/api/tiktok/oauth/callback` ใช้ web origin เดียวกับที่เปิดแอปและล็อกอิน เพื่อให้ session cookie กลับมาด้วย หากใช้ HTTPS development tunnel ต้องตั้ง `APP_URL` เป็น origin นั้นและล็อกอินจาก origin นั้น ไม่สลับกับ localhost ระหว่าง flow
4. ไปหน้า TikTok เลือกแบรนด์และสิทธิ์เพิ่มเติม → เชื่อมด้วย TikTok → ยินยอมบนเว็บไซต์ TikTok → กลับแอป → ซิงก์ข้อมูล
5. OAuth state หมดอายุใน 10 นาที ใช้ครั้งเดียวและผูกกับ session + ผู้ใช้ + workspace หากหมดอายุให้เริ่มเชื่อมใหม่ โทเค็นหมดอายุจะแสดงให้เชื่อมใหม่

ยังไม่ได้ทดสอบ OAuth หรือ Gemini กับบริการจริง เพราะไม่ได้รับ credentials และสิทธิ์แอป ผลจาก mock ไม่ได้ยืนยันว่าผ่าน TikTok review

## การส่งวิดีโอ

ค่าเริ่มต้น `SOCIAL_PUBLISHING_ENABLED=false` สร้างร่างและอนุมัติได้ แต่ไม่มีคำขอส่งวิดีโอออกไป เปิดเฉพาะหลังเตรียมแอปและบัญชีจริงพร้อมแล้ว

MVP ใช้ **ส่งวิดีโอเข้า TikTok Inbox** ผ่าน `video.upload` ไม่มี Direct Post และไม่อัปโหลดไฟล์จากเครื่องโดยตรง:

- ตั้ง `TIKTOK_VERIFIED_MEDIA_PREFIXES` เป็น HTTPS domain หรือ path prefix ที่ยืนยันกับ TikTok แล้ว คั่นหลายค่าด้วย comma
- ระบุ public HTTPS MP4 URL ที่อยู่ใต้ prefix นั้น ไม่รับ localhost, URL ที่มี credentials, query หรือ fragment และไม่รับ signed URL ใน MVP นี้
- สคริปต์และคำบรรยายเป็นร่างสำหรับผู้ใช้ตรวจ/นำไปใช้ต่อ Inbox API นี้ส่งเฉพาะไฟล์วิดีโอ ไม่ได้โพสต์คำบรรยายที่บันทึกในแอปให้อัตโนมัติ
- คนตรวจเนื้อหา → ส่งอนุมัติ → ผู้มีสิทธิ์อนุมัติ → ผู้มีสิทธิ์ส่งยืนยันอีกครั้ง → ส่งทันทีหรือตั้งเวลา
- เวลาที่ตั้งคือเวลาส่งเข้า Inbox **ไม่ใช่เวลาเผยแพร่สาธารณะ** เจ้าของบัญชีต้องเปิดแจ้งเตือน TikTok และโพสต์ต่อเอง
- `UPLOADED` = ส่งเข้า Inbox แล้ว; `PUBLISHED` ใช้เฉพาะเมื่อ TikTok ตอบ `PUBLISH_COMPLETE`
- ถ้าไม่ทราบผลคำขอส่ง ระบบแสดงว่าต้องตรวจสอบก่อนและไม่ส่งซ้ำอัตโนมัติ ตรวจใน TikTok ก่อนสร้างร่างใหม่เพื่อส่งอีกครั้ง ไม่แก้ ExternalOperation ในฐานข้อมูลเพื่อบังคับ retry
- หยุดส่งได้ระดับบัญชีและ workspace งานที่เริ่มส่งแล้วอาจยกเลิกไม่ได้

อ่านข้อจำกัด API และแหล่งอ้างอิงใน [TIKTOK_MODULE_PLAN.md](TIKTOK_MODULE_PLAN.md)

## รันทดสอบ

สร้างฐาน `fbpm_test` แยกและ migrate ก่อน ใช้ PowerShell ที่ root:

```powershell
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55432/fbpm_test'
$env:REDIS_URL='redis://127.0.0.1:56379/1'
$env:APP_ENV='test'
$env:AUTH_SECRET='test-only-secret-at-least-32-characters'
pnpm --filter @fbpm/database exec prisma migrate deploy
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

ก่อน E2E หยุดแอป local ที่ 3000/4000 เพราะชุดทดสอบเปิด API/web ของตัวเองโดยกำหนด external endpoints เป็น loopback mock หากไม่มี Chrome/Edge ให้ติดตั้ง Chromium ของ Playwright หรือกำหนด `PLAYWRIGHT_CHROMIUM` ไปยัง executable ที่ติดตั้งไว้ ทดสอบ PDF ใช้ `CHROME_BIN` หรือค้นหา Chrome/Edge อัตโนมัติ

ห้ามตั้ง `*_MOCK_BASE_URL`, `WEB_ALLOW_PRIVATE_TARGETS`, หรือ `WEB_WP_ALLOW_INSECURE` ใน production ตรวจผลที่รันล่าสุดใน [TEST_REPORT.md](TEST_REPORT.md)
