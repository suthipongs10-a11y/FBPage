#!/usr/bin/env bash
# สร้าง .env production ครั้งแรก — สุ่มความลับให้ ไม่พิมพ์ค่าลับออกจอ และไม่เขียนทับ .env เดิม (AUTH_SECRET เดิมถอดรหัส token ที่เก็บไว้)
# ใช้: bash deploy/make-env.sh <โดเมน> [--host-nginx]     (--host-nginx = เครื่องมี nginx ถือพอร์ต 80/443 อยู่แล้ว)
set -eu
cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
MODE="${2:-}"
if [ -z "$DOMAIN" ]; then echo "ใช้: bash deploy/make-env.sh <โดเมน> [--host-nginx]"; exit 1; fi
case "$DOMAIN" in
  *[!A-Za-z0-9.-]*|.*|*.|*..*) echo "โดเมนไม่ถูกต้อง: $DOMAIN"; exit 1 ;;
  *.*) ;;
  *) echo "โดเมนไม่ถูกต้อง: $DOMAIN"; exit 1 ;;
esac
if [ -n "$MODE" ] && [ "$MODE" != "--host-nginx" ]; then echo "ไม่รู้จักตัวเลือก: $MODE"; exit 1; fi
if [ -e .env ]; then echo ".env มีอยู่แล้ว — ไม่เขียนทับ (ถ้าเปลี่ยน AUTH_SECRET จะถอดรหัส token เดิมไม่ได้)"; exit 1; fi
command -v openssl >/dev/null || { echo "ต้องมี openssl"; exit 1; }

umask 077
cat > .env <<EOF
# ===== ระบบ =====
APP_ENV=production
APP_URL=https://${DOMAIN}
DOMAIN=${DOMAIN}
APP_PUBLIC_API_URL=/api
API_PORT=4000
WEB_PORT=3000
DEFAULT_TIMEZONE=Asia/Bangkok

# ===== ความลับที่สุ่มให้แล้ว — ห้ามเปลี่ยน AUTH_SECRET หลังเริ่มใช้งาน =====
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
META_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)

# ===== ฐานข้อมูล (docker compose เขียนทับให้เองตอนรัน) =====
DATABASE_URL=postgresql://postgres:changed-by-compose@postgres:5432/fbpm?schema=public
REDIS_URL=redis://redis:6379

# ===== Meta (Facebook) =====
META_APP_ID=
META_APP_SECRET=
META_GRAPH_API_VERSION=v26.0
META_OAUTH_REDIRECT_URI=https://${DOMAIN}/api/facebook/oauth/callback

# ===== Google (YouTube + Search Console) =====
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://${DOMAIN}/api/youtube/oauth/callback
YOUTUBE_API_KEY=
YOUTUBE_UPLOAD_ENABLED=false
YOUTUBE_DEFAULT_SYNC_DAYS=90
YOUTUBE_QUOTA_SOFT_LIMIT=10000

# ===== เว็บไซต์ลูกค้า =====
PAGESPEED_API_KEY=
WEB_ALLOW_PRIVATE_TARGETS=false
WEB_PUBLISH_ENABLED=false
WEB_WP_ALLOW_INSECURE=false

# ===== อีเมลการตลาด (API key ของ Brevo/Resend กรอกในหน้าเว็บ) =====
EMAIL_SEND_ENABLED=false

# ===== TikTok =====
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://${DOMAIN}/api/tiktok/oauth/callback
TIKTOK_VERIFIED_MEDIA_PREFIXES=
SOCIAL_PUBLISHING_ENABLED=false

# ===== แชทอัตโนมัติ (compose บังคับ false ซ้ำอีกชั้น) =====
MESSENGER_AUTO_SEND_ENABLED=false

# ===== อีเมลแจ้งเตือนภายใน (ไม่บังคับ) =====
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="AI Page Manager <no-reply@${DOMAIN}>"
SMTP_SECURE=false
SMTP_ALLOW_INSECURE=false

# ===== key AI ระดับระบบ (ไม่บังคับ — ปกติกรอกในหน้า "โมเดล AI") =====
GOOGLE_AI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
LITELLM_BASE_URL=
LITELLM_API_KEY=

# ===== ต้องว่างเสมอใน production =====
META_GRAPH_BASE_URL=
YOUTUBE_MOCK_BASE_URL=
WEB_MOCK_BASE_URL=
EMAIL_MOCK_BASE_URL=
EOF

if [ "$MODE" = "--host-nginx" ]; then
  printf '\n# ===== ใช้ nginx ของเครื่องแทน Caddy =====\nCOMPOSE_FILE=docker-compose.yml:deploy/docker-compose.host-nginx.yml\n' >> .env
fi
chmod 600 .env

ok=1
grep -q '^AUTH_SECRET=.\{64\}$' .env || ok=0
grep -q '^POSTGRES_PASSWORD=.\{48\}$' .env || ok=0
grep -q '^META_WEBHOOK_VERIFY_TOKEN=.\{32\}$' .env || ok=0
if [ "$ok" != 1 ]; then rm -f .env; echo "สุ่มความลับไม่สำเร็จ — ลบ .env ที่ไม่สมบูรณ์ทิ้งแล้ว"; exit 1; fi

echo "สร้าง .env แล้วสำหรับ https://${DOMAIN} (สิทธิ์ 600, สุ่มความลับครบ, ไม่แสดงค่าลับ)"
[ "$MODE" = "--host-nginx" ] && echo "โหมด nginx ของเครื่อง: Caddy ปิด · API 127.0.0.1:4100 · เว็บ 127.0.0.1:3100"
echo "สำรอง .env ไว้นอกเครื่องด้วย — ถ้าหาย AUTH_SECRET จะถอดรหัส token ที่เก็บไว้ไม่ได้อีก"
