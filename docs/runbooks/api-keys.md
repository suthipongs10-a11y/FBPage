# คู่มือขอ API key ทุกตัว (งานที่ต้องทำเอง)

ทุกอย่างในไฟล์นี้อยู่นอกโค้ด — ต้องใช้บัญชีของคุณเอง ระบบทำแทนไม่ได้
เรียงตามลำดับที่แนะนำ ทำข้อ 1–2 ก่อนก็เริ่มใช้งานจริงได้แล้ว ที่เหลือค่อยเติมทีหลัง

> ใส่ค่าที่ได้ลงในไฟล์ `.env` (คัดลอกจาก `env.example`) แล้วรีสตาร์ท: `docker compose up -d`
> ยกเว้นที่ระบุว่า "กรอกในหน้าเว็บ" — พวกนั้นเก็บเข้ารหัสในฐานข้อมูล ไม่ต้องอยู่ใน `.env`

| # | ระบบ | จำเป็นไหม | ได้อะไร |
| --- | --- | --- | --- |
| 1 | Meta (Facebook) | จำเป็นถ้าจะดูแลเพจ | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` |
| 2 | Google Cloud | จำเป็นถ้าจะดูแล YouTube หรือดู Search Console | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY` |
| 3 | PageSpeed Insights | ไม่บังคับ | `PAGESPEED_API_KEY` |
| 4 | WordPress ของลูกค้า | จำเป็นถ้าจะโพสต์บทความขึ้นเว็บ | Application Password (กรอกในหน้าเว็บ) |
| 5 | Brevo หรือ Resend | จำเป็นถ้าจะส่งอีเมลการตลาด | API key + webhook secret (กรอกในหน้าเว็บ) |
| 6 | SMTP แจ้งเตือนภายใน | ไม่บังคับ | `SMTP_HOST/PORT/USER/PASS/FROM` |
| 7 | AI | มีแล้ว (Gemini) | วาง key ในหน้า "โมเดล AI" |

---

## 1. Meta (Facebook) — ทำครั้งเดียวต่อบริษัท

**ได้:** `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN`

1. เข้า <https://developers.facebook.com> → เมนูขวาบน **My Apps** → **Create App**
   - ถ้ายังไม่เคยสมัคร: กด Get Started แล้วยืนยันเบอร์/อีเมลก่อน
2. เลือกกรณีใช้งาน **Other** → ประเภท **Business** → ตั้งชื่อแอป (เช่น "AI Page Manager") + อีเมลติดต่อ → Create
3. หน้าแอป → **App settings → Basic**
   - คัดลอก **App ID** → `META_APP_ID`
   - กด **Show** ข้าง App Secret → คัดลอก → `META_APP_SECRET` (ห้ามให้ใครเห็น ห้าม commit)
   - เลื่อนลงกรอก Privacy Policy URL และ App Icon (ต้องมีก่อนยื่น review)
4. เพิ่มผลิตภัณฑ์ **Facebook Login for Business** → **Settings**
   - Valid OAuth Redirect URIs = `https://app.yourdomain.com/api/facebook/oauth/callback`
   - ใส่ค่าเดียวกันนี้ใน `.env` ที่ `META_OAUTH_REDIRECT_URI`
5. สิทธิ์ที่ต้องขอ (App Review → Permissions and Features):
   `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts`,
   `pages_read_user_content`, `pages_manage_engagement`, `read_insights`
6. **Webhook** (ให้คอมเมนต์เข้าเรียลไทม์ — ไม่ตั้งก็ยังใช้ได้ แต่คอมเมนต์จะเข้าตามรอบซิงก์)
   - ตั้งข้อความสุ่มของคุณเองเป็น `META_WEBHOOK_VERIFY_TOKEN` เช่นจาก `openssl rand -hex 16`
   - เพิ่มผลิตภัณฑ์ **Webhooks** → เลือก **Page** → Callback URL `https://app.yourdomain.com/api/facebook/webhook`
   - Verify token = ค่าที่ตั้งไว้ → Verify and Save → Subscribe ฟิลด์ `feed` และ `mentions`
7. รีสตาร์ทระบบ แล้วไปหน้า **เพจ** → *เชื่อมต่อ Facebook*

**ระหว่างยังไม่ผ่าน App Review** ใช้ได้เฉพาะเพจที่บัญชีของคุณอยู่ใน Roles ของแอป
(App settings → Roles → เพิ่มตัวเองเป็น Admin/Developer/Tester)
ทางลัดสำหรับเพจลูกค้าที่เชิญคุณเป็นแอดมินแล้ว: Graph API Explorer → เลือกแอป → ขอสิทธิ์ข้างบน →
Generate Access Token → เอา token มาวางในช่อง *วาง token* ในหน้าเพจ (ระบบขยายเป็น long-lived ให้เอง)

---

## 2. Google Cloud — ใช้ร่วมกันทั้ง YouTube และ Search Console

**ได้:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `YOUTUBE_API_KEY`

> Google Gemini API key ที่คุณมีอยู่แล้วเป็นคนละตัวกับหัวข้อนี้ — อันนั้นใช้กับ AI (ข้อ 7)

1. เข้า <https://console.cloud.google.com> → มุมซ้ายบนเลือกโปรเจกต์ → **New Project** → ตั้งชื่อ → Create
2. **เปิด API ที่ต้องใช้** — ไปที่ APIs & Services → **Library** แล้วค้นหา กด *Enable* ทีละตัว
   - `YouTube Data API v3` — อ่านช่อง/วิดีโอ/คอมเมนต์ และอัปโหลด
   - `YouTube Analytics API` — ตัวเลขการรับชม (เจ้าของช่องเท่านั้น)
   - `Google Search Console API` — คำค้นที่พาคนเข้าเว็บ (โมดูลเว็บไซต์)
   - `PageSpeed Insights API` — ถ้าจะทำข้อ 3 ด้วย เปิดพร้อมกันเลย
3. **API key** (สำหรับอ่านช่อง YouTube สาธารณะ ใช้ได้ทันทีไม่ต้องรออนุมัติ)
   - APIs & Services → **Credentials** → Create credentials → **API key** → คัดลอก → `YOUTUBE_API_KEY`
   - กด **Edit API key** → Application restrictions = None (เรียกจากเซิร์ฟเวอร์)
     → API restrictions = เลือกเฉพาะ YouTube Data API v3 (และ PageSpeed ถ้าจะใช้ key เดียวกัน)
4. **OAuth consent screen** (จำเป็นก่อนสร้าง OAuth client)
   - User type = **External** → กรอกชื่อแอป อีเมลสนับสนุน อีเมลนักพัฒนา
   - Scopes → Add or remove scopes → เพิ่ม:
     `youtube.readonly`, `yt-analytics.readonly`, `youtube.force-ssl`, `youtube.upload`,
     `webmasters.readonly`, `userinfo.email`
   - **Test users** → เพิ่มอีเมล Google ของคุณและของเจ้าของช่อง/เจ้าของเว็บลูกค้า
     (ก่อน verify แอป ใช้ได้เฉพาะอีเมลในลิสต์นี้ สูงสุด 100 คน)
5. **OAuth client**
   - Credentials → Create credentials → **OAuth client ID** → Application type = **Web application**
   - Authorized redirect URIs = `https://app.yourdomain.com/api/youtube/oauth/callback`
   - Create → คัดลอก **Client ID** → `GOOGLE_CLIENT_ID`, **Client secret** → `GOOGLE_CLIENT_SECRET`
   - ใส่ redirect URI เดียวกันที่ `GOOGLE_OAUTH_REDIRECT_URI`
6. **โควตา** เริ่มต้น 10,000 units/วัน (พอสำหรับราว 10 ช่อง) — ดูการใช้จริงได้ในหน้า YouTube ของระบบ
   ถ้าไม่พอ ยื่น Quota extension ใน APIs & Services → YouTube Data API → Quotas
7. **การอัปโหลดวิดีโอผ่านระบบ** ปล่อย `YOUTUBE_UPLOAD_ENABLED=false` ไว้ก่อน
   เปิดได้เมื่อผ่าน **YouTube API compliance audit** (ยื่นฟอร์มเมื่อลูกค้าต้องการจริง)
   ระหว่างนั้นระบบเตรียมชื่อ/คำอธิบาย/แท็ก/ภาพปกให้ครบ แล้วอัปโหลดเองใน YouTube Studio ได้

**เชื่อม Search Console ของเว็บลูกค้า:** เจ้าของเว็บต้องเข้า
<https://search.google.com/search-console> → Settings → **Users and permissions** →
เพิ่มอีเมล Google ที่คุณใช้เชื่อมเป็น user (สิทธิ์ Full หรือ Restricted ก็ได้)
แล้วในระบบกด *เชื่อม Search Console* — ระบบจับคู่ property ให้เอง

---

## 3. PageSpeed Insights API key (ไม่บังคับ)

**ได้:** `PAGESPEED_API_KEY` — ไม่ใส่ = หน้าเว็บไซต์จะแสดงคะแนนความเร็วว่า "ไม่มีข้อมูล" (ไม่ใช่ 0)

1. โปรเจกต์ Google Cloud เดิม → Library → ค้นหา **PageSpeed Insights API** → Enable
2. Credentials → Create credentials → API key → คัดลอกใส่ `PAGESPEED_API_KEY`
   (จะใช้ key เดียวกับข้อ 2 ก็ได้ ถ้าตั้ง API restrictions ให้ครอบคลุมทั้งสองตัว)
3. ฟรี ~25,000 คำขอ/วัน — ระบบเรียกวันละครั้งต่อเว็บ ไม่มีทางเต็ม

---

## 4. WordPress ของลูกค้า (สำหรับโพสต์บทความ)

**ได้:** username + Application Password — **กรอกในหน้าเว็บ** (เก็บเข้ารหัส ไม่ต้องใส่ `.env`)

ทำในเว็บของลูกค้าแต่ละราย:
1. ขอให้ลูกค้าสร้างบัญชีให้คุณ บทบาท **Editor** ขึ้นไป (หรือใช้บัญชีที่มีอยู่)
2. ล็อกอิน WordPress → **Users → Profile** (ถ้าเป็นแอดมินคนอื่นสร้างให้: Users → เลือกผู้ใช้ → Edit)
3. เลื่อนลงหัวข้อ **Application Passwords** → ใส่ชื่อ เช่น `AI Page Manager` → **Add New Application Password**
4. คัดลอกรหัสที่ขึ้นมา (รูปแบบ `abcd EFGH ijkl MNOP` เว้นวรรค — ระบบตัดช่องว่างให้เอง)
   **รหัสนี้แสดงครั้งเดียว** ปิดหน้าไปแล้วต้องสร้างใหม่
5. ในระบบ: หน้า **เว็บ · บทความ** → *เชื่อม WordPress* → เลือกเว็บ → กรอก username + รหัสที่ได้ → บันทึก
   ระบบจะยิงตรวจกับเว็บจริงแล้วบอกชื่อผู้ใช้ที่เชื่อมได้
6. เปิดสวิตช์ใน `.env`: `WEB_PUBLISH_ENABLED=true` แล้วรีสตาร์ท

**ข้อควรรู้**
- เว็บลูกค้าต้องเป็น `https://` (รหัสผ่านส่งไปกับ header) — ถ้ายังเป็น http ให้ลูกค้าเปิด SSL ก่อน (Let's Encrypt ฟรี)
- ไม่พบ REST API = ปลั๊กอินความปลอดภัยบางตัวปิด `/wp-json` ไว้ ต้องให้เปิดเฉพาะ path นี้
- ยกเลิกได้ทุกเมื่อ: ลบ Application Password ใน WordPress หรือกด *ยกเลิกการเชื่อม* ในระบบ

---

## 5. ผู้ให้บริการส่งอีเมล — เลือก Brevo หรือ Resend อย่างใดอย่างหนึ่ง

**ได้:** API key + webhook secret — **กรอกในหน้าเว็บ** (เก็บเข้ารหัส)
เปิดสวิตช์ `EMAIL_SEND_ENABLED=true` ใน `.env` ด้วย

### ก่อนอื่น: ยืนยันโดเมนผู้ส่ง (ข้ามไม่ได้)
ถ้าไม่ยืนยัน อีเมลจะเข้าสแปมหรือถูกปฏิเสธ — ต้องเข้าไปเพิ่ม DNS record ที่ผู้ให้บริการโดเมน
(Cloudflare / GoDaddy / ผู้ให้เช่าโฮสต์) ตามที่ Brevo/Resend บอก โดยทั่วไปคือ TXT (SPF, DKIM)
และ CNAME 2–3 รายการ · รอ propagate ประมาณ 5 นาที – 1 ชั่วโมง

### ทาง A — Brevo (เดิมชื่อ Sendinblue) แนะนำถ้าเพิ่งเริ่ม มีโควตาฟรีรายวัน
1. สมัคร <https://www.brevo.com> → ยืนยันอีเมล (บัญชีใหม่อาจต้องรอทีมงานอนุมัติ 1 วันทำการ)
2. **Senders, Domains & Dedicated IPs → Domains** → Add a domain → ใส่โดเมนของลูกค้าหรือของคุณ
   → ทำตาม DNS record ที่ให้มา → Authenticate
3. เมนูขวาบน (ชื่อบัญชี) → **SMTP & API** → แท็บ **API Keys** → **Generate a new API key**
   → ตั้งชื่อ → คัดลอก (ขึ้นต้น `xkeysib-`) — แสดงครั้งเดียว
4. ในระบบ: หน้า **อีเมล** → *ผู้ให้บริการส่งอีเมล* → เลือก `brevo` → วาง API key
   → ช่อง Webhook secret ใส่ข้อความสุ่มของคุณเอง (เช่นจาก `openssl rand -hex 16`) → บันทึก
   ระบบจะตรวจ key ให้ทันทีและแสดง URL ของ webhook
5. ตั้ง webhook ที่ Brevo: **Transactional → Settings → Webhooks** → Add a new webhook
   - URL = URL ที่ระบบแสดง **ต่อท้ายด้วย** `?token=<secret ที่ตั้งไว้ข้อ 4>`
     ตัวอย่าง `https://app.yourdomain.com/api/email/webhooks/brevo/<workspaceId>?token=abc123`
   - เลือกเหตุการณ์: Delivered, Opened, Clicked, Hard bounce, Soft bounce, Spam, Unsubscribed

### ทาง B — Resend (ตั้งง่ายกว่า เหมาะถ้าคุ้นกับ DNS อยู่แล้ว)
1. สมัคร <https://resend.com> → **Domains** → Add Domain → ทำตาม DNS record → รอ Verified
2. **API Keys** → Create API Key → สิทธิ์ **Sending access** → คัดลอก (ขึ้นต้น `re_`) — แสดงครั้งเดียว
3. ในระบบ: หน้า **อีเมล** → *ผู้ให้บริการส่งอีเมล* → เลือก `resend` → วาง API key → บันทึกไว้ก่อน
4. **Webhooks** → Add Webhook → URL = URL ที่ระบบแสดง (ไม่ต้องต่อ `?token=`)
   → เลือกเหตุการณ์ `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`
   → สร้างเสร็จจะได้ **Signing Secret** ขึ้นต้น `whsec_` → คัดลอก
5. กลับมาที่หน้าอีเมลในระบบ → ใส่ `whsec_...` ในช่อง Webhook secret → บันทึกอีกครั้ง

> ถ้าไม่ตั้ง webhook secret ระบบจะ **ปฏิเสธ webhook ทั้งหมด** (กันคนยิงสถิติปลอม)
> ผลคือสถิติเปิด/คลิกจะขึ้นว่า "ไม่มีข้อมูล" — ส่งอีเมลได้ปกติ แค่ไม่รู้ผล

---

## 6. SMTP แจ้งเตือนภายใน (ไม่บังคับ แต่แนะนำ)

**ได้:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
ใช้ส่ง: แจ้งเตือนงานพัง/รออนุมัติ/ลีดร้อน, ลิงก์เชิญทีม, ลิงก์ลืมรหัสผ่าน
**คนละระบบกับข้อ 5** — ห้ามใช้ตัวนี้ส่งอีเมลการตลาดจำนวนมาก

**ทางที่ง่ายที่สุด — Gmail App Password**
1. บัญชี Google ที่จะใช้ส่งต้องเปิด **2-Step Verification** ก่อน
2. <https://myaccount.google.com/apppasswords> → ตั้งชื่อ เช่น `AI Page Manager` → Create
3. ได้รหัส 16 ตัว → ใส่ใน `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=<รหัส 16 ตัว>
   SMTP_FROM="AI Page Manager <you@gmail.com>"
   ```
4. รีสตาร์ท → หน้า **ตั้งค่า → อีเมลแจ้งเตือน → ส่งอีเมลทดสอบถึงฉัน**

ใช้ Brevo เป็น SMTP ก็ได้ (SMTP & API → แท็บ SMTP): host `smtp-relay.brevo.com`, port 587,
user = อีเมลที่ล็อกอิน, pass = SMTP key (คนละอันกับ API key)

---

## 7. AI — คุณมี Google Gemini อยู่แล้ว

ไม่ต้องแตะ `.env` ก็ได้:
1. หน้า **โมเดล AI** → ช่อง **Google AI (Gemini)** → วาง API key จาก <https://aistudio.google.com/apikey> → *ทดสอบ*
2. ตั้งบทบาทให้โมเดล: `strategy`, `content`, `analysis`, `community`, `fast` (เลือก Gemini รุ่นที่มีสิทธิ์ใช้)
3. หน้า **ตั้งค่า** → ใส่งบ AI ต่อเดือนและเพดานต่องาน — ถึงงบระบบจะหยุดเรียกเอง

ถ้าอยากให้ทุก workspace ใช้ key เดียวกันโดยไม่ต้องกรอก: ใส่ `GOOGLE_AI_API_KEY=` ใน `.env`

---

## ลำดับที่แนะนำถ้าเพิ่งเริ่ม

1. ตั้งเครื่อง + โดเมน + `AUTH_SECRET` (ดู `go-live-checklist.md` ข้อ 0)
2. วาง Gemini key ในหน้าโมเดล AI → ระบบใช้งาน AI ได้แล้ว
3. Meta app (ข้อ 1) → เชื่อมเพจลูกค้ารายแรกด้วยวิธีวาง token
4. Google Cloud (ข้อ 2) → เชื่อมช่อง YouTube และ Search Console
5. เพิ่มเว็บลูกค้าเข้าหน้าเว็บไซต์ (ยังไม่ต้องมี key อะไรเลย) → ค่อยเติม PageSpeed key
6. เมื่อจะเริ่มทำบทความ: Application Password ของ WordPress (ข้อ 4)
7. เมื่อจะเริ่มทำอีเมล: Brevo/Resend + ยืนยันโดเมน (ข้อ 5)
