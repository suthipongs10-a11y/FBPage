# ติดตั้งใช้งานจริงบน VPS — ตัวอย่างโดเมน `fbm.ragalpha.com`

คู่มือนี้พาตั้งแต่ VPS เปล่าจนระบบรับลูกค้าได้ พร้อมไฟล์ `.env` เต็มและ URL ทุกตัวที่ต้องเอาไปวางในคอนโซลของแต่ละเจ้า
ขั้นตอนขอ key แบบทีละคลิกอยู่ใน [`api-keys.md`](api-keys.md) — ไฟล์นี้เน้น "ค่าไหนไปอยู่ตรงไหน" สำหรับโดเมนจริง

> แทนที่ `fbm.ragalpha.com` ด้วยโดเมนของคุณถ้าใช้ชื่ออื่น — ที่เหลือเหมือนกันหมด

---

## URL ทั้งหมดที่ต้องวางในคอนโซลภายนอก

Caddy ตัด `/api` ออกก่อนส่งต่อให้ API ดังนั้น path ข้างล่างนี้คือค่าที่ถูกต้องแล้ว ห้ามตัด `/api` ออก

| เอาไปวางที่ไหน | ค่า |
| --- | --- |
| Meta → Facebook Login → **Valid OAuth Redirect URIs** | `https://fbm.ragalpha.com/api/facebook/oauth/callback` |
| Meta → Webhooks → **Callback URL** | `https://fbm.ragalpha.com/api/facebook/webhook` |
| Google Cloud → OAuth client → **Authorized redirect URIs** | `https://fbm.ragalpha.com/api/youtube/oauth/callback` |
| Google Cloud → OAuth client → **Authorized JavaScript origins** | `https://fbm.ragalpha.com` |
| Brevo → Transactional → Webhooks → **URL** | `https://fbm.ragalpha.com/api/email/webhooks/brevo/<workspaceId>?token=<secret>` |
| Resend → Webhooks → **Endpoint URL** | `https://fbm.ragalpha.com/api/email/webhooks/resend/<workspaceId>` |

`<workspaceId>` ไม่ต้องเดา — หน้า **อีเมล** ในระบบจะแสดง URL เต็มให้คัดลอกหลังบันทึก API key แล้ว

URL ที่ระบบสร้างเองและส่งออกไปหาคนนอก (ไม่ต้องตั้งค่าอะไร แค่รู้ไว้):

| อะไร | รูปแบบ |
| --- | --- |
| ลิงก์ยกเลิกรับอีเมลในทุกฉบับ | `https://fbm.ragalpha.com/api/email/u/<token>` |
| ลิงก์รายงานที่แชร์ให้ลูกค้า | `https://fbm.ragalpha.com/share/r/<token>` |
| ลิงก์เชิญทีม / รีเซ็ตรหัสผ่าน | `https://fbm.ragalpha.com/invite/<token>` · `/reset/<token>` |

---

## 0. เตรียม DNS และเครื่อง

1. **DNS** — ที่ผู้ดูแลโดเมน `ragalpha.com` เพิ่ม A record
   ```
   Type: A    Name: fbm    Value: <IP ของ VPS>    TTL: Auto
   ```
   ถ้าใช้ Cloudflare ให้ตั้งเป็น **DNS only (เมฆสีเทา)** ตอนแรก เพื่อให้ Caddy ขอใบรับรองได้
   เปิด proxy ทีหลังได้เมื่อได้ HTTPS แล้ว

2. **ตรวจว่า DNS ชี้ถูก** (รอ 1–10 นาทีหลังเพิ่ม record)
   ```bash
   dig +short fbm.ragalpha.com
   ```

3. **เปิดพอร์ต 80 และ 443**
   ```bash
   sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
   ```
   ถ้าผู้ให้บริการ VPS มี firewall ของตัวเอง (DigitalOcean, AWS, Vultr) ต้องเปิดในหน้าเว็บของเขาด้วย

4. **ติดตั้ง Docker** (ข้ามถ้ามีแล้ว — ตรวจด้วย `docker compose version`)
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```

5. **ดึงโค้ดลงเครื่อง**
   ```bash
   sudo mkdir -p /opt/fbpm && sudo chown $USER /opt/fbpm
   git clone <repo-url> /opt/fbpm && cd /opt/fbpm
   ```

---

## 1. สร้างไฟล์ config `.env`

รันคำสั่งนี้ **ครั้งเดียว** ที่ `/opt/fbpm` — มันจะสุ่มความลับให้เองทั้งหมด ไม่ต้องคิดเอง

```bash
cat > .env <<EOF
# ===== ระบบ =====
APP_ENV=production
APP_URL=https://fbm.ragalpha.com
DOMAIN=fbm.ragalpha.com
APP_PUBLIC_API_URL=/api
API_PORT=4000
WEB_PORT=3000
DEFAULT_TIMEZONE=Asia/Bangkok

# ===== ความลับที่สุ่มให้แล้ว — ห้ามเปลี่ยน AUTH_SECRET หลังเริ่มใช้งาน =====
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
META_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)

# ===== ฐานข้อมูล (docker compose เขียนทับให้เองตอนรัน ปล่อยไว้แบบนี้ได้) =====
DATABASE_URL=postgresql://postgres:changed-by-compose@postgres:5432/fbpm?schema=public
REDIS_URL=redis://redis:6379

# ===== Meta (Facebook) — กรอกหลังสร้างแอปในข้อ 4 =====
META_APP_ID=
META_APP_SECRET=
META_GRAPH_API_VERSION=v26.0
META_OAUTH_REDIRECT_URI=https://fbm.ragalpha.com/api/facebook/oauth/callback

# ===== Google (YouTube + Search Console) — กรอกหลังตั้ง Google Cloud ในข้อ 5 =====
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://fbm.ragalpha.com/api/youtube/oauth/callback
YOUTUBE_API_KEY=
YOUTUBE_UPLOAD_ENABLED=false
YOUTUBE_DEFAULT_SYNC_DAYS=90
YOUTUBE_QUOTA_SOFT_LIMIT=10000

# ===== เว็บไซต์ลูกค้า =====
PAGESPEED_API_KEY=
WEB_ALLOW_PRIVATE_TARGETS=false
WEB_PUBLISH_ENABLED=false
WEB_WP_ALLOW_INSECURE=false

# ===== อีเมลการตลาด (API key ของ Brevo/Resend กรอกในหน้าเว็บ ไม่ใช่ที่นี่) =====
EMAIL_SEND_ENABLED=false

# ===== อีเมลแจ้งเตือนภายใน — กรอกในข้อ 9 (ไม่บังคับ) =====
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="AI Page Manager <no-reply@ragalpha.com>"
SMTP_SECURE=false
SMTP_ALLOW_INSECURE=false

# ===== key ระดับระบบ (ไม่บังคับ — ปกติกรอก key ในหน้าเว็บต่อ workspace แทน) =====
GOOGLE_AI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
LITELLM_BASE_URL=
LITELLM_API_KEY=

# ===== ต้องว่างเสมอใน production (ใช้เฉพาะตอนทดสอบ) =====
META_GRAPH_BASE_URL=
YOUTUBE_MOCK_BASE_URL=
WEB_MOCK_BASE_URL=
EMAIL_MOCK_BASE_URL=
EOF

chmod 600 .env
```

**ตรวจว่าสุ่มความลับได้จริง** (ต้องขึ้นเลขมากกว่า 0 ทั้งสามบรรทัด ห้าม print ค่าจริงออกจอ)
```bash
grep -c '^AUTH_SECRET=.\{60,\}' .env
grep -c '^POSTGRES_PASSWORD=.\{20,\}' .env
grep -c '^META_WEBHOOK_VERIFY_TOKEN=.\{20,\}' .env
```

### คีย์สำคัญที่ต้องเข้าใจ

| คีย์ | ทำอะไร | เปลี่ยนภายหลังได้ไหม |
| --- | --- | --- |
| `AUTH_SECRET` | ใช้ถอดรหัส token เพจ/ช่อง/WordPress/อีเมล และเซ็น session | **ห้ามเปลี่ยน** เปลี่ยนแล้วต้องเชื่อมทุกอย่างใหม่หมด |
| `APP_ENV=production` | เปิด secure cookie และปิด log ระดับ debug | ได้ |
| `APP_URL` | ใช้เป็น CORS origin และเป็นฐานของลิงก์ยกเลิกรับ/แชร์รายงาน | ได้ แต่ต้องตรงกับโดเมนจริงเสมอ |
| `DOMAIN` | Caddy ใช้ขอใบรับรอง HTTPS | ได้ |
| `WEB_PUBLISH_ENABLED` | สวิตช์ใหญ่ของการโพสต์บทความขึ้นเว็บลูกค้า | ได้ (ค่าเริ่มต้นปิด) |
| `EMAIL_SEND_ENABLED` | สวิตช์ใหญ่ของการส่งอีเมลการตลาด | ได้ (ค่าเริ่มต้นปิด) |
| `*_MOCK_BASE_URL` | ชี้ไปเซิร์ฟเวอร์จำลองตอนทดสอบ | **ต้องว่างใน production** ไม่งั้นระบบจะคุยกับของปลอม |

---

## 2. เปิดระบบครั้งแรก

```bash
cd /opt/fbpm
docker compose up -d --build          # ครั้งแรกใช้เวลา 5–10 นาที
docker compose ps                     # ทุกตัวต้องขึ้น running/healthy
docker compose logs -f api | head -40  # ต้องเห็น migration รันผ่านแล้ว API เริ่ม
```

migration ฐานข้อมูลรันอัตโนมัติทุกครั้งที่ API เริ่ม ไม่ต้องสั่งเอง

**ตรวจว่าใช้ได้**
```bash
curl -s https://fbm.ragalpha.com/api/health   # ต้องได้ JSON สถานะ ok
```
ถ้ายังไม่ขึ้น HTTPS ให้ดู `docker compose logs caddy` — สาเหตุที่พบบ่อยคือ DNS ยังไม่ชี้มา หรือพอร์ต 80 ถูกปิด

เปิด `https://fbm.ragalpha.com` ในเบราว์เซอร์ → **สมัครบัญชีแรก** บัญชีนี้จะเป็น owner ของ workspace โดยอัตโนมัติ

---

## 3. AI (ใช้ Gemini ที่มีอยู่แล้ว)

ไม่ต้องแก้ `.env`
1. เอา key จาก <https://aistudio.google.com/apikey>
2. ในระบบ → หน้า **โมเดล AI** → ช่อง Google AI (Gemini) → วาง key → กด *ทดสอบ*
3. ตั้งบทบาทให้โมเดล: `strategy`, `content`, `analysis`, `community`, `fast`
4. หน้า **ตั้งค่า** → ใส่งบ AI ต่อเดือนและเพดานต่องาน — ถึงงบระบบหยุดเรียกเอง

> อยากให้ทุก workspace ใช้ key เดียวกันโดยไม่ต้องกรอก ให้ใส่ที่ `GOOGLE_AI_API_KEY` ใน `.env` แทน

---

## 4. Meta (Facebook)

รายละเอียดทีละคลิกอยู่ใน `api-keys.md` ข้อ 1 · สรุปค่าที่ต้องตรงกัน:

1. <https://developers.facebook.com> → Create App → **Business**
2. App settings → Basic → คัดลอก App ID และ App Secret
3. เพิ่ม **Facebook Login for Business** → Settings → Valid OAuth Redirect URIs
   ```
   https://fbm.ragalpha.com/api/facebook/oauth/callback
   ```
4. เพิ่ม **Webhooks** → Page → Callback URL
   ```
   https://fbm.ragalpha.com/api/facebook/webhook
   ```
   Verify token = ค่าที่อยู่ใน `.env` ของคุณ ดูด้วย (ค่านี้ไม่ใช่ความลับระดับ token เพจ แต่ก็อย่าแชร์)
   ```bash
   grep '^META_WEBHOOK_VERIFY_TOKEN=' .env | cut -d= -f2
   ```
   กด Verify and Save แล้ว Subscribe ฟิลด์ `feed` และ `mentions`
5. เติมค่าลง `.env` แล้วรีสตาร์ท
   ```bash
   nano .env      # ใส่ META_APP_ID และ META_APP_SECRET
   docker compose up -d
   ```
6. หน้า **เพจ** → *เชื่อมต่อ Facebook*

> ก่อนผ่าน App Review ใช้ได้เฉพาะเพจของบัญชีที่อยู่ใน Roles ของแอป
> ทางลัด: ลูกค้าเชิญคุณเป็นแอดมินเพจ → Graph API Explorer → Generate token → วางในช่อง *วาง token* ในหน้าเพจ

---

## 5. Google Cloud (YouTube + Search Console)

1. <https://console.cloud.google.com> → New Project
2. APIs & Services → Library → Enable ทีละตัว
   - YouTube Data API v3
   - YouTube Analytics API
   - Google Search Console API
   - PageSpeed Insights API (ถ้าจะทำข้อ 6 ด้วย)
3. Credentials → Create credentials → **API key** → ใส่ที่ `YOUTUBE_API_KEY`
4. OAuth consent screen (External) → เพิ่ม scope:
   `youtube.readonly`, `yt-analytics.readonly`, `youtube.force-ssl`, `youtube.upload`, `webmasters.readonly`, `userinfo.email`
   → เพิ่มอีเมลตัวเองและของเจ้าของช่อง/เจ้าของเว็บเป็น **Test users**
5. Credentials → Create credentials → **OAuth client ID** → Web application
   - Authorized JavaScript origins: `https://fbm.ragalpha.com`
   - Authorized redirect URIs: `https://fbm.ragalpha.com/api/youtube/oauth/callback`
6. เติม `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY` ลง `.env` → `docker compose up -d`
7. หน้า **YouTube** → *เชื่อมบัญชี Google*

`YOUTUBE_UPLOAD_ENABLED` ปล่อย `false` ไว้ก่อน เปิดเมื่อผ่าน YouTube API compliance audit แล้ว

---

## 6. PageSpeed (ไม่บังคับ)

โปรเจกต์ Google Cloud เดิม → Enable **PageSpeed Insights API** → สร้าง API key → ใส่ `PAGESPEED_API_KEY` → `docker compose up -d`
ไม่ใส่ = หน้าเว็บไซต์แสดงคะแนนความเร็วว่า "ไม่มีข้อมูล" (ไม่ใช่ 0)

---

## 7. WordPress ของลูกค้า

ไม่มีค่าลง `.env` ยกเว้นสวิตช์ — รหัสผ่านกรอกในหน้าเว็บและเก็บแบบเข้ารหัส

1. ในเว็บลูกค้า: Users → Profile → **Application Passwords** → ตั้งชื่อ `AI Page Manager` → คัดลอกรหัส (แสดงครั้งเดียว)
   บัญชีต้องเป็น Editor ขึ้นไป และเว็บต้องเป็น `https://`
2. ในระบบ: หน้า **เว็บ · บทความ** → *เชื่อม WordPress* → เลือกเว็บ → กรอก username + รหัส
3. เปิดสวิตช์เมื่อพร้อมโพสต์จริง
   ```bash
   sed -i 's/^WEB_PUBLISH_ENABLED=false/WEB_PUBLISH_ENABLED=true/' .env && docker compose up -d
   ```

---

## 8. อีเมลการตลาด (Brevo หรือ Resend)

1. **ยืนยันโดเมนผู้ส่งก่อนเสมอ** — เพิ่ม DNS record (SPF, DKIM) ที่ `ragalpha.com` ตามที่ผู้ให้บริการบอก
   ไม่ยืนยัน = อีเมลเข้าสแปมหรือถูกปฏิเสธ
2. เอา API key มาวางในระบบ: หน้า **อีเมล** → *ผู้ให้บริการส่งอีเมล* → เลือก brevo/resend → วาง key
   - ช่อง **Webhook secret** ต้องใส่ด้วย ไม่งั้นระบบจะปฏิเสธ webhook ทั้งหมด (กันคนยิงสถิติปลอม)
     สุ่มค่าได้ด้วย `openssl rand -hex 16`
3. ระบบจะแสดง URL ของ webhook ให้คัดลอก — เอาไปตั้งที่ผู้ให้บริการ
   - **Brevo**: Transactional → Settings → Webhooks → URL ต่อท้ายด้วย `?token=<secret ที่ตั้งไว้>`
     เลือกเหตุการณ์ Delivered, Opened, Clicked, Hard bounce, Soft bounce, Spam, Unsubscribed
   - **Resend**: Webhooks → Add → เลือก `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`
     → คัดลอก Signing Secret (`whsec_…`) กลับมาใส่ในช่อง Webhook secret ของระบบ
4. เปิดสวิตช์
   ```bash
   sed -i 's/^EMAIL_SEND_ENABLED=false/EMAIL_SEND_ENABLED=true/' .env && docker compose up -d
   ```

---

## 9. อีเมลแจ้งเตือนภายใน (ไม่บังคับ แต่แนะนำ)

คนละระบบกับข้อ 8 — ตัวนี้ส่งแจ้งเตือนถึงทีม ลิงก์เชิญ และลิงก์ลืมรหัสผ่าน

Gmail App Password (ต้องเปิด 2-Step ก่อน) ที่ <https://myaccount.google.com/apppasswords>
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<รหัส 16 ตัว>
SMTP_FROM="AI Page Manager <you@gmail.com>"
```
`docker compose up -d` แล้วทดสอบที่ **ตั้งค่า → อีเมลแจ้งเตือน → ส่งอีเมลทดสอบถึงฉัน**

---

## 10. สำรองข้อมูลและอัปเดต

**สำรองทุกคืน ตี 3** (`crontab -e`)
```
0 3 * * * cd /opt/fbpm && docker compose exec -T postgres pg_dump -U postgres fbpm | gzip > /opt/fbpm/backup/fbpm-$(date +\%F).sql.gz && find /opt/fbpm/backup -name '*.sql.gz' -mtime +14 -delete
```
```bash
mkdir -p /opt/fbpm/backup
```
ควรคัดลอกไฟล์สำรองออกนอกเครื่องด้วย (rclone ไป Google Drive / S3) — เครื่องพังแล้วไฟล์ในเครื่องหายไปด้วย

**อัปเดตโค้ด**
```bash
cd /opt/fbpm && git pull && docker compose up -d --build
```

**สำรอง `.env`** เก็บไว้ที่ปลอดภัยนอกเครื่อง — ถ้าหาย `AUTH_SECRET` ไปด้วย จะถอดรหัส token ที่เก็บไว้ไม่ได้อีกเลย

---

## ตรวจสุขภาพรายสัปดาห์ (5 นาที)

```bash
docker compose ps                                   # ทุกตัว healthy
docker compose logs --since 24h worker | grep -i fail
df -h /                                             # พื้นที่ดิสก์
```
ในระบบ: หน้าภาพรวม → รายการ "ต้องดู" ต้องว่าง · โควตา YouTube ไม่แตะ 80% · ค่า AI เทียบงบ

---

## ปัญหาที่พบบ่อย

| อาการ | สาเหตุและวิธีแก้ |
| --- | --- |
| เปิดเว็บไม่ขึ้น HTTPS | DNS ยังไม่ชี้มาที่ VPS หรือพอร์ต 80 ถูกปิด → `dig +short fbm.ragalpha.com` และดู `docker compose logs caddy` |
| Cloudflare ขึ้น error 5xx | ตอนขอ cert ครั้งแรกต้องตั้ง DNS only (เมฆเทา) ก่อน แล้วค่อยเปิด proxy |
| ล็อกอินแล้วเด้งออกทันที | `APP_URL` ไม่ตรงกับโดเมนที่เปิดจริง หรือ `APP_ENV` ไม่ได้เป็น `production` |
| Meta ตอบ "URL blocked" ตอนเชื่อมเพจ | redirect URI ในแอปไม่ตรงกับ `META_OAUTH_REDIRECT_URI` แม้แต่ตัวเดียว (ระวัง `/` ท้าย) |
| Google ตอบ `redirect_uri_mismatch` | เหมือนข้างบน ตรวจ Authorized redirect URIs ให้ตรงเป๊ะ |
| Google ตอบ `access_denied` | อีเมลนั้นยังไม่ได้อยู่ใน Test users ของ OAuth consent screen |
| webhook อีเมลไม่เข้า สถิติขึ้น "ไม่มีข้อมูล" | ยังไม่ได้ตั้ง Webhook secret ในระบบ หรือ Brevo ยังไม่ได้ต่อ `?token=` ท้าย URL |
| API ขึ้น error ตอนเริ่ม | `docker compose logs api` — มักเป็น `.env` ผิดรูปแบบหรือ `AUTH_SECRET` สั้นกว่า 32 ตัว |
