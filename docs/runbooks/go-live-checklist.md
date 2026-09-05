# เช็กลิสต์เปิดใช้งานจริง (สิ่งที่ต้องทำเอง — ระบบทำแทนไม่ได้)

ทุกข้ออยู่นอกโค้ด: ต้องมีบัญชี/สิทธิ์/เครื่องของคุณเอง ทำตามลำดับได้เลย ใช้เวลารวมประมาณครึ่งวัน (ไม่นับรอ Meta/Google อนุมัติ)

## 0. เตรียมเครื่อง (VPS หรือเครื่องในออฟฟิศ)
1. Ubuntu 22.04+ มี Docker + Docker Compose (ดู `docs/runbooks/ubuntu-vps.md`)
2. โดเมน 1 ชื่อชี้มาที่เครื่อง เช่น `app.yourdomain.com` (Caddy ใน `docker-compose.yml` ออก HTTPS ให้เอง)
3. `git clone` โปรเจกต์ → `cp env.example .env` → เปิด `.env` แล้วกรอกตามข้อถัดไป
4. ตั้ง `AUTH_SECRET` เป็นข้อความสุ่มยาว ≥ 32 ตัว (`openssl rand -base64 48`) — **ห้ามเปลี่ยนภายหลัง** เพราะใช้ถอดรหัส token ทั้งหมด (เปลี่ยน = ต้องเชื่อมเพจ/ช่องใหม่ทุกอัน)
5. ตั้ง `POSTGRES_PASSWORD`, `APP_URL=https://app.yourdomain.com`, `DOMAIN=app.yourdomain.com`
6. `docker compose up -d --build` → เปิด `https://app.yourdomain.com` → **สมัครบัญชีแรก** (จะเป็น owner ของ workspace)
7. ตั้ง cron สำรองฐานข้อมูล: `docker compose exec postgres pg_dump -U postgres fbpm | gzip > backup-$(date +%F).sql.gz` ทุกคืน (เก็บนอกเครื่องด้วย)

## 1. Meta (Facebook) — ทำครั้งเดียวต่อบริษัท
1. [developers.facebook.com](https://developers.facebook.com) → My Apps → **Create App** → ประเภท Business → ตั้งชื่อ
2. เพิ่มผลิตภัณฑ์ **Facebook Login for Business** → Settings → Valid OAuth Redirect URIs = `https://app.yourdomain.com/api/facebook/oauth/callback`
3. Settings → Basic → คัดลอก **App ID** และ **App Secret** ใส่ `.env`: `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI=https://app.yourdomain.com/api/facebook/oauth/callback`
4. สิทธิ์ที่แอปต้องมี: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `read_insights`
   - ระหว่างยังไม่ผ่าน App Review: ใช้ได้กับบัญชีที่เป็น **Admin/Developer/Tester ของแอป** เท่านั้น → เพิ่มบัญชีของคุณใน Roles
   - ส่ง App Review เมื่อพร้อมใช้กับหลายบริษัท (ต้องอัดวิดีโอสาธิตการใช้แต่ละสิทธิ์)
5. Webhook (ให้คอมเมนต์เข้าเรียลไทม์): ผลิตภัณฑ์ **Webhooks** → Page → Callback URL `https://app.yourdomain.com/api/facebook/webhook`, Verify token = ค่าที่คุณตั้งใน `META_WEBHOOK_VERIFY_TOKEN` → subscribe `feed`, `mention`
6. รีสตาร์ท: `docker compose up -d`

**เชื่อมเพจลูกค้าแต่ละราย** (หน้า "เพจ"): ลูกค้าต้องเชิญบัญชี Facebook ของคุณเป็น **แอดมิน**ของเพจก่อน → กด *เชื่อมต่อ Facebook* → ล็อกอินและเลือกเพจ → ผูกกับแบรนด์
ทางลัดตอนยังไม่ผ่าน review: Graph API Explorer → เลือกแอป → ขอสิทธิ์ข้างบน → Generate token → กด *ขยายเป็น long-lived* → วางในช่อง *วาง token*

## 2. Google / YouTube — ทำครั้งเดียวต่อบริษัท
ดูขั้นตอนละเอียดใน `docs/youtube/runbooks/google-cloud-setup.md` สรุป:
1. Google Cloud Console → New project → เปิด **YouTube Data API v3** + **YouTube Analytics API**
2. Credentials → **API key** → ใส่ `YOUTUBE_API_KEY` (อ่านช่องสาธารณะ/วิเคราะห์ ใช้ได้ทันทีไม่ต้องรอ)
3. OAuth consent screen (External) → เพิ่ม scopes (readonly, yt-analytics.readonly, force-ssl, upload, userinfo.email) → เพิ่มอีเมลเจ้าของช่องเป็น **Test users** จนกว่าจะ verify แอป
4. Credentials → **OAuth client (Web)** → Redirect URI `https://app.yourdomain.com/api/youtube/oauth/callback` → ใส่ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
5. `YOUTUBE_UPLOAD_ENABLED=false` ไว้ก่อน — อัปโหลดผ่านระบบต้องผ่าน **API compliance audit** ของ YouTube (ยื่นฟอร์มเมื่อลูกค้าต้องการจริง ๆ) ระหว่างนั้นระบบเตรียมแพ็กเกจให้อัปโหลดเองใน Studio
6. โควตาเริ่มต้น 10,000 units/วัน พอสำหรับ ~10 ช่อง ถ้าไม่พอยื่น Quota extension

**เชื่อมช่องลูกค้า** (หน้า "YouTube"): กด *เชื่อมบัญชี Google* ให้เจ้าของช่องล็อกอิน → เลือกแบรนด์ → *เชื่อมช่อง* หรือใส่ `@handle` แบบอ่านสาธารณะ

## 3. AI (อย่างน้อย 1 ผู้ให้บริการ)
1. สมัคร key จากผู้ให้บริการที่ต้องการ: Anthropic / OpenAI / Google AI / OpenRouter / Groq หรือ Ollama ในเครื่อง (ผ่านโหมด compatible)
2. หน้า **โมเดล AI** → วาง key ในช่องผู้ให้บริการ → กด *ทดสอบ* → ตั้งบทบาท `strategy`, `content`, `analysis`, `community`, `fast`, `fallback` ให้โมเดลที่ต้องการ
3. ตั้งงบ: **ตั้งค่า** → งบ AI ต่อเดือน + เพดานต่องาน (ระบบหยุดเมื่อถึงงบ)
4. ทางเลือก: ใส่ key ระดับแพลตฟอร์มใน `.env` (`OPENAI_API_KEY` ฯลฯ) เพื่อให้ทุก workspace ใช้ได้โดยไม่ต้องกรอกเอง

## 4. อีเมล (ไม่บังคับ แต่แนะนำ)
ใส่ `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (Gmail ใช้ App Password; หรือ Brevo/Mailgun/SES) → รีสตาร์ท → **ตั้งค่า → อีเมลแจ้งเตือน → ส่งอีเมลทดสอบถึงฉัน**
ไม่ตั้ง = ระบบยังใช้ลิงก์คัดลอกส่งทาง LINE ได้ครบทุกฟีเจอร์ แต่ "ลืมรหัสผ่าน" ด้วยตัวเองจะไม่ทำงาน

## 5. การแจ้งเตือนเข้า LINE / Discord (ไม่บังคับ)
**ตั้งค่า → การแจ้งเตือน** วาง webhook URL (Discord ใช้ได้ตรง; LINE ใช้ Messaging API ผ่านตัวกลางเช่น Make/n8n) → กด *ทดสอบ*

## 6. เชิญทีม
**ตั้งค่า → เชิญสมาชิก** เลือกบทบาท (admin / editor / viewer) → ส่งลิงก์ (หรือใส่อีเมลให้ระบบส่ง) — ลิงก์ใช้ได้ 7 วัน ครั้งเดียว

## 7. รับลูกค้ารายแรก
ตาม `docs/runbooks/first-client.md` (Facebook) และ `docs/youtube/runbooks/first-channel.md` (YouTube): สร้างลูกค้า → แบรนด์ → **กรอกข้อมูลแบรนด์ให้ครบ** (ราคา เบอร์ ที่อยู่ ข้อห้ามกล่าวอ้าง — AI จะไม่เดา) → เชื่อมเพจ/ช่อง → ให้ AI วิเคราะห์ → วางแผน → ร่าง → อนุมัติ → ตั้งเวลา → รายงานสิ้นเดือน (PDF/ลิงก์แชร์)

## 8. ตรวจสุขภาพระบบทุกสัปดาห์ (5 นาที)
- หน้าภาพรวม: รายการ "ต้องดู" ต้องว่าง (token หมดอายุ / เชื่อมใหม่ / อัปโหลดล้มเหลว)
- `docker compose ps` ทุก service เป็น healthy · `docker compose logs --since 24h worker | grep -i fail`
- โควตา YouTube ในหน้า YouTube ไม่แตะ 80% ทุกวัน
- ค่า AI เดือนนี้เทียบงบในหน้าโมเดล AI
- อัปเดตโค้ด: `git pull && docker compose up -d --build` (migration รันอัตโนมัติตอน API เริ่ม)

## สิ่งที่ยังต้องรอฝั่งแพลตฟอร์ม (ไม่ใช่งานโค้ด)
| เรื่อง | ต้องทำ | ผลถ้ายังไม่ทำ |
| --- | --- | --- |
| Meta App Review | ยื่นพร้อมวิดีโอสาธิต | ใช้ได้เฉพาะเพจของบัญชีที่อยู่ใน Roles ของแอป |
| `read_insights` | ขอใน App Review | รายงานไม่มี reach/impressions (แสดง "อ่านไม่ได้") |
| `pages_read_user_content` + `pages_manage_engagement` | ขอใน App Review | หน้าคอมเมนต์/ลีดของ Facebook ขึ้น NO_PERMISSION |
| Google OAuth verification | ยื่นเมื่อมีผู้ใช้เกิน 100 คน | ก่อนนั้นเพิ่มเจ้าของช่องเป็น Test user ทีละคน |
| YouTube API audit | ยื่นเมื่อจะอัปโหลดผ่านระบบ | อัปโหลดได้แค่ private / ใช้โหมดเตรียมแพ็กเกจ |
| Messenger inbox / Ads | ต้อง `pages_messaging`, `ads_read` | ยังไม่มีในระบบ (นอกขอบเขตปัจจุบัน) |
