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
| TikTok for Developers → Login Kit → **Redirect URI** | `https://fbm.ragalpha.com/api/tiktok/oauth/callback` |
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

## 0.5 เครื่องที่มี nginx ถือพอร์ต 80/443 อยู่แล้ว (VPS 43.228.86.7 เป็นแบบนี้)

ตรวจด้วย `ss -ltn | grep -E ':(80|443) '` — ถ้ามีคนฟังอยู่แล้ว **ห้ามใช้ Caddy** (จะแย่งพอร์ตกับเว็บอื่นบนเครื่อง) ให้ทำแบบนี้แทน:

- **ข้ามข้อ 0.3 (ufw)** — พอร์ต 80/443 เปิดอยู่แล้วเพราะ nginx ใช้ และการเปิด ufw บนเครื่องที่มีบริการอื่นอาจตัดบริการนั้น
- ข้อ 1 สร้าง `.env` ตามปกติ แล้ว**เพิ่มบรรทัดนี้** ทุกคำสั่ง `docker compose` จะปิด Caddy และเปิด api/web ที่ `127.0.0.1:4100` / `127.0.0.1:3100` ให้ nginx เรียก พร้อมเพดาน RAM ต่อคอนเทนเนอร์
  ```bash
  echo 'COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.host-nginx.yml' >> .env
  docker compose --profile automation config --services   # ต้องไม่มี caddy ในรายการ
  ```
- **ถ้าไม่มี swap** (`free -m` แถว Swap เป็น 0) เพิ่มก่อน build — build ครั้งแรกกิน RAM หลาย GB ถ้าไม่มี swap เครื่องอาจฆ่าบริการอื่นทิ้ง
  ```bash
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```
- ข้อ 2 ให้ build **ทีละตัว** แทน `docker compose build` เพื่อไม่ให้ RAM พุ่งพร้อมกัน
  ```bash
  docker compose build api && docker compose build worker && docker compose build web && docker compose --profile maintenance build migrate
  ```
- หลังข้อ 2 เปิดบริการแล้ว ต่อ nginx เข้ามา (แทน `fbm.example.com` ด้วยโดเมนจริง)
  ```bash
  sed 's/fbm.example.com/<โดเมน>/' deploy/nginx-fbpm.conf > /etc/nginx/sites-available/fbpm
  ln -s /etc/nginx/sites-available/fbpm /etc/nginx/sites-enabled/fbpm
  nginx -t && systemctl reload nginx
  apt install -y certbot python3-certbot-nginx   # ข้ามถ้ามีแล้ว (certbot --version)
  certbot --nginx -d <โดเมน>
  ```
  ตรวจ: `curl -s http://127.0.0.1:4100/health` (ตรงเข้า API) และ `curl -s https://<โดเมน>/api/health` (ผ่าน nginx)

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

# ===== TikTok (ข้อ 8 ของ api-keys.md — เว้นว่างไว้ได้ถ้ายังไม่ใช้) =====
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://fbm.ragalpha.com/api/tiktok/oauth/callback
TIKTOK_VERIFIED_MEDIA_PREFIXES=
SOCIAL_PUBLISHING_ENABLED=false

# ===== แชทอัตโนมัติ (Messenger) — คีย์/โมเดล AI ใช้ของกลางจากหน้า "โมเดล AI" =====
# หมายเหตุ: docker-compose.yml บังคับค่านี้เป็น false ให้อีกชั้นหนึ่ง ตั้งใน .env อย่างเดียวไม่พอ
# จะเปิดส่งอัตโนมัติจริงต้องแก้ทั้ง .env และ docker-compose.yml (ตั้งใจให้ยากเพราะมันคุยกับลูกค้าจริง)
MESSENGER_AUTO_SEND_ENABLED=false

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
| `SOCIAL_PUBLISHING_ENABLED` | สวิตช์ใหญ่ของการอัปโหลดคลิปขึ้น TikTok จริง | ได้ (ค่าเริ่มต้นปิด) |
| `MESSENGER_AUTO_SEND_ENABLED` | ให้แชทส่งคำตอบเองโดยไม่รอคนตรวจ | ได้ (ค่าเริ่มต้นปิด = เก็บเป็นร่างให้แอดมินตรวจ) — compose บังคับ false ซ้ำอีกชั้น ต้องแก้ทั้งสองที่ |
| `*_MOCK_BASE_URL` | ชี้ไปเซิร์ฟเวอร์จำลองตอนทดสอบ | **ต้องว่างใน production** ไม่งั้นระบบจะคุยกับของปลอม |

---

## 2. เปิดระบบครั้งแรก

```bash
cd /opt/fbpm

# 1) สร้าง image (ครั้งแรกใช้เวลา 5–10 นาที)
docker compose build

# 2) สร้างตารางในฐานข้อมูล — ต้องสั่งเอง ไม่ได้รันอัตโนมัติตอน API เริ่ม
docker compose --profile maintenance run --rm migrate

# 3) เปิดทุกบริการ รวม worker (worker อยู่หลัง profile "automation" ถ้าไม่ใส่ จะไม่ถูกเปิด)
docker compose --profile automation up -d

docker compose ps                     # ทุกตัวต้องขึ้น running/healthy
docker compose logs -f api | head -40
```

> **สองจุดที่พลาดกันบ่อย**
> - **migration ไม่ได้รันเอง** — คอนเทนเนอร์ API สั่งแค่ `node dist/main.js` (ตั้งใจให้เจ้าของระบบกดเอง จะได้ไม่มีการแก้ฐานข้อมูลโดยไม่ตั้งใจ) ถ้าข้ามข้อ 2 API จะเปิดได้แต่ทุกหน้าจะพังด้วย error ว่าไม่มีตาราง
> - **`docker compose up -d` เฉย ๆ ไม่เปิด worker** — แล้วจะไม่มีการโพสต์ตามเวลา ไม่มีการเฝ้าเว็บ ไม่มีการตอบแชท ต้องใส่ `--profile automation` ทุกครั้ง
>
> จำง่าย ๆ: ใช้ `docker compose --profile automation up -d` เสมอ และสั่ง migrate ทุกครั้งที่อัปเดตโค้ด

**ตรวจว่าใช้ได้**
```bash
curl -s https://fbm.ragalpha.com/api/health   # ต้องได้ JSON สถานะ ok
```
ถ้ายังไม่ขึ้น HTTPS ให้ดู `docker compose logs caddy` — สาเหตุที่พบบ่อยคือ DNS ยังไม่ชี้มา หรือพอร์ต 80 ถูกปิด

เปิด `https://fbm.ragalpha.com` ในเบราว์เซอร์ → **สมัครบัญชีแรก** บัญชีนี้จะเป็น owner ของ workspace โดยอัตโนมัติ

---

## 2.5 ทดสอบว่าใช้ได้จริง (10 นาที ยังไม่ต้องมี key ของ Meta/Google)

ทำตามลำดับนี้ ถ้าติดข้อไหนให้หยุดแล้วแก้ก่อน

| # | ทำอะไร | ต้องได้อะไร |
|---|---|---|
| 1 | `curl -s https://fbm.ragalpha.com/api/health` | JSON ที่มี `"status":"ok"` และ postgres/redis เป็น ok |
| 2 | `docker compose ps` | เห็น postgres, redis, api, web, caddy **และ worker** ทั้งหมด running/healthy |
| 3 | เปิด `https://fbm.ragalpha.com` → สมัครบัญชีแรก | เข้าหน้าภาพรวมได้ บัญชีนี้เป็น owner |
| 4 | เมนูซ้ายครบ | ภาพรวม · ลูกค้า · เพจ · คอนเทนต์ · ปฏิทิน · แชทอัตโนมัติ · TikTok · YouTube · เว็บไซต์ · อีเมล · รายงาน · โมเดล AI · ตั้งค่า |
| 5 | **ลูกค้า** → เพิ่มลูกค้า → เพิ่มแบรนด์ | บันทึกได้ ไม่มี error |
| 6 | **โมเดล AI** → เพิ่มคีย์ Gemini → *ทดสอบ* | ขึ้น ✔ พร้อมชื่อโมเดลและเวลาตอบ (ข้อนี้ต้องมี key จริง) |
| 7 | ตั้งบทบาท `content` ให้ชี้คีย์นั้น → *บันทึกบทบาท* | บันทึกแล้ว |
| 8 | **คอนเทนต์** → สร้างร่างด้วย AI | ได้ข้อความร่างกลับมา และหน้า **โมเดล AI** → ตารางงานล่าสุด มีแถวใหม่พร้อมชื่อคีย์ที่ใช้ |
| 9 | **เว็บไซต์** → เพิ่มเว็บของคุณเอง (เช่น `https://ragalpha.com`) | ภายใน ~1 นาที worker ตรวจแล้วขึ้นสถานะ/คะแนน SEO — ถ้าไม่ขึ้นเลยแปลว่า worker ไม่ทำงาน |
| 10 | **ตั้งค่า** → ตรวจว่าไม่มี API key โผล่ในหน้าเว็บที่ไหนเลย | เห็นได้แค่ 4 ตัวท้าย |

ข้อ 9 คือข้อที่พิสูจน์ว่า worker ทำงานจริง — อย่าข้าม

**ยังไม่ต้องทำตอนทดสอบ:** เชื่อมเพจจริง, อัปโหลด TikTok จริง, ส่งอีเมลจริง, โพสต์ขึ้นเว็บลูกค้าจริง
สวิตช์พวกนี้ (`SOCIAL_PUBLISHING_ENABLED`, `EMAIL_SEND_ENABLED`, `WEB_PUBLISH_ENABLED`, `MESSENGER_AUTO_SEND_ENABLED`) ปิดไว้หมดตั้งแต่ต้น ตั้งใจให้ทดสอบได้โดยไม่มีอะไรหลุดออกไปหาลูกค้า

---

## 3. AI (ใช้ Gemini ที่มีอยู่แล้ว)

ไม่ต้องแก้ `.env`
1. เอา key จาก <https://aistudio.google.com/apikey>
2. ในระบบ → หน้า **โมเดล AI** → **เพิ่มคีย์** → เลือก *Google Gemini* → ตั้งชื่อ (เช่น "Gemini หลัก") → วาง key → *บันทึก* → *ทดสอบ*
3. ตั้งบทบาทให้โมเดล: `strategy`, `content`, `analysis`, `community`, `research`, `fast`
   (บทบาท `community` คือตัวที่ตอบคอมเมนต์และแชทใช้ · `research` ไว้ใช้กับระบบค้นคว้าในอนาคต)
4. หน้า **ตั้งค่า** → ใส่งบ AI ต่อเดือนและเพดานต่องาน — ถึงงบระบบหยุดเรียกเอง

> ใส่ได้หลายใบและหลายเจ้าพร้อมกัน (Claude, OpenAI, Gemini, DeepSeek, Groq, OpenRouter, MiniMax หรือ endpoint แบบ OpenAI ของตัวเอง)
> แยกกันด้วยชื่อที่ตั้ง แล้วจ่ายงานคนละบทบาทได้ เช่น ให้ Gemini เขียนคอนเทนต์ ให้ Claude ทำงานวิเคราะห์

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
   docker compose --profile automation up -d
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
6. เติม `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY` ลง `.env` → `docker compose --profile automation up -d`
7. หน้า **YouTube** → *เชื่อมบัญชี Google*

`YOUTUBE_UPLOAD_ENABLED` ปล่อย `false` ไว้ก่อน เปิดเมื่อผ่าน YouTube API compliance audit แล้ว

---

## 6. PageSpeed (ไม่บังคับ)

โปรเจกต์ Google Cloud เดิม → Enable **PageSpeed Insights API** → สร้าง API key → ใส่ `PAGESPEED_API_KEY` → `docker compose --profile automation up -d`
ไม่ใส่ = หน้าเว็บไซต์แสดงคะแนนความเร็วว่า "ไม่มีข้อมูล" (ไม่ใช่ 0)

---

## 7. WordPress ของลูกค้า

ไม่มีค่าลง `.env` ยกเว้นสวิตช์ — รหัสผ่านกรอกในหน้าเว็บและเก็บแบบเข้ารหัส

1. ในเว็บลูกค้า: Users → Profile → **Application Passwords** → ตั้งชื่อ `AI Page Manager` → คัดลอกรหัส (แสดงครั้งเดียว)
   บัญชีต้องเป็น Editor ขึ้นไป และเว็บต้องเป็น `https://`
2. ในระบบ: หน้า **เว็บ · บทความ** → *เชื่อม WordPress* → เลือกเว็บ → กรอก username + รหัส
3. เปิดสวิตช์เมื่อพร้อมโพสต์จริง
   ```bash
   sed -i 's/^WEB_PUBLISH_ENABLED=false/WEB_PUBLISH_ENABLED=true/' .env && docker compose --profile automation up -d
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
   sed -i 's/^EMAIL_SEND_ENABLED=false/EMAIL_SEND_ENABLED=true/' .env && docker compose --profile automation up -d
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
`docker compose --profile automation up -d` แล้วทดสอบที่ **ตั้งค่า → อีเมลแจ้งเตือน → ส่งอีเมลทดสอบถึงฉัน**

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
cd /opt/fbpm && git pull && docker compose build \
  && docker compose --profile maintenance run --rm migrate \
  && docker compose --profile automation up -d
```

**สำรอง `.env`** เก็บไว้ที่ปลอดภัยนอกเครื่อง — ถ้าหาย `AUTH_SECRET` ไปด้วย จะถอดรหัส token ที่เก็บไว้ไม่ได้อีกเลย

---

## ตรวจสุขภาพรายสัปดาห์ (5 นาที)

```bash
docker compose ps                                   # ทุกตัว healthy
docker compose logs --since 24h worker | grep -i fail   # ไม่มี log เลย = worker ไม่ได้เปิด (ลืม --profile automation)
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
| หน้าเว็บขึ้นแต่กดอะไรก็ error / log มีคำว่า `relation ... does not exist` | ยังไม่ได้รัน migration → `docker compose --profile maintenance run --rm migrate` |
| โพสต์ตามเวลาไม่ทำงาน · เว็บไม่ถูกตรวจ · แชทไม่ตอบ | worker ไม่ได้เปิด → `docker compose --profile automation up -d` แล้วดู `docker compose ps` ว่ามี worker |
| log มี `Cannot find module '.prisma/client'` | image เก่าที่สร้างก่อนแก้ generator → `docker compose build --no-cache api worker` |
