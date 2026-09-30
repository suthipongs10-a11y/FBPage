#!/usr/bin/env bash
# กู้คืน SocialManage จากไฟล์ที่ deploy/backup.sh สร้าง — ใช้ทั้งกู้เครื่องเดิมและย้ายไป VPS ใหม่
#
#   sudo deploy/restore.sh /opt/fbpm-backups/fbpm-20261001-031500.tar.enc
#   ตัวเลือก:
#     --yes               ไม่ถามยืนยัน (ใช้ในสคริปต์)
#     --no-media          ไม่กู้ไฟล์สื่อ
#     --use-backup-env    ใช้ .env จาก backup แทน .env ปัจจุบัน (จำเป็นเมื่อ AUTH_SECRET ไม่ตรงกัน เช่น ย้ายเครื่องแล้วรัน make-env.sh ไปก่อน)
#     --no-safety-backup  ไม่สำรองฐานข้อมูลปัจจุบันก่อนเขียนทับ
#     --check             ตรวจอย่างเดียว (ถอดรหัส + checksum + อ่านโครงสร้างฐานข้อมูลได้) — ไม่แตะระบบ ใช้ซ้อมทุกเดือน
#
# ขั้นตอน: ถอดรหัส → ตรวจ checksum → ตรวจ AUTH_SECRET → สำรองของเดิม → หยุด api/web/worker → กู้ฐานข้อมูล+ไฟล์สื่อ
#          → migrate ให้ตรงโค้ดปัจจุบัน → เปิดระบบ (worker ตั้งคิวโพสต์ตั้งเวลาใหม่จากฐานข้อมูลเอง)
# Redis ไม่ถูกกู้ (ตั้งใจ) · ไม่พิมพ์ค่าลับออกจอ
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/opt/fbpm-backups}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.fbpm-backup-pass}"
DB_NAME="${DB_NAME:-fbpm}"
MEDIA_PATH=/app/data/media
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"; SKIP_START="${SKIP_START:-0}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "❌ $*"; exit 1; }
dc() { (cd "$APP_DIR" && docker compose "$@"); }
secret_of() { grep -E '^AUTH_SECRET=' "$1" 2>/dev/null | tail -1 | cut -d= -f2- | sha256sum | cut -c1-16; }

FILE=""; YES=0; WITH_MEDIA=1; USE_BACKUP_ENV=0; SAFETY=1; CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;; --no-media) WITH_MEDIA=0 ;; --use-backup-env) USE_BACKUP_ENV=1 ;; --no-safety-backup) SAFETY=0 ;; --check) CHECK=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) echo "ไม่รู้จักตัวเลือก: $1" >&2; exit 2 ;;
    *) FILE="$1" ;;
  esac; shift
done
[ -n "$FILE" ] || { sed -n '2,16p' "$0"; exit 2; }
[ -f "$FILE" ] || die "ไม่พบไฟล์ $FILE"
command -v docker >/dev/null || die "ไม่พบคำสั่ง docker"
umask 077
mkdir -p "$BACKUP_DIR"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# 1) ถอดรหัส + แตกไฟล์ + ตรวจความครบถ้วน
case "$FILE" in
  *.enc)
    if [ -f "$PASS_FILE" ]; then PASS_ARG="file:$PASS_FILE"
    else read -r -s -p "รหัสผ่านของไฟล์สำรอง: " PW; echo; PASS_ARG="pass:$PW"; fi
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "$PASS_ARG" -in "$FILE" -out "$WORK/backup.tar" 2>/dev/null || die "ถอดรหัสไม่สำเร็จ — รหัสผ่านไม่ถูกหรือไฟล์เสีย"
    unset PW PASS_ARG ;;
  *) cp "$FILE" "$WORK/backup.tar" ;;
esac
mkdir "$WORK/x"; tar -xf "$WORK/backup.tar" -C "$WORK/x" || die "แตกไฟล์ไม่สำเร็จ"
(cd "$WORK/x" && sha256sum -c --quiet SHA256SUMS) || die "checksum ไม่ตรง — ไฟล์สำรองเสียหาย"
[ -s "$WORK/x/db.dump" ] || die "ไม่มีไฟล์ฐานข้อมูลใน backup"
log "ไฟล์สำรองสมบูรณ์:"; sed 's/^/    /' "$WORK/x/manifest.txt"
[ "$WITH_MEDIA" = 1 ] && [ ! -f "$WORK/x/media.tar.gz" ] && { log "backup นี้ไม่มีไฟล์สื่อ — กู้เฉพาะฐานข้อมูล"; WITH_MEDIA=0; }
if [ "$CHECK" = 1 ]; then
  n=$(dc exec -T postgres pg_restore --list < "$WORK/x/db.dump" 2>/dev/null | grep -c ' TABLE public ' || true)
  [ "${n:-0}" -gt 0 ] || die "อ่านโครงสร้างฐานข้อมูลใน backup ไม่ได้"
  [ -f "$WORK/x/media.tar.gz" ] && { tar -tzf "$WORK/x/media.tar.gz" >/dev/null || die "ไฟล์สื่อใน backup เสีย"; log "ไฟล์สื่อ: $(tar -tzf "$WORK/x/media.tar.gz" | grep -vc '/$') ไฟล์"; }
  grep -qE '^AUTH_SECRET=.+' "$WORK/x/env" || die "backup ไม่มี AUTH_SECRET"
  log "✅ ตรวจผ่าน: ถอดรหัสได้ · checksum ตรง · ฐานข้อมูล $n ตาราง · มี AUTH_SECRET — ไม่ได้แตะระบบ"
  exit 0
fi

# 2) AUTH_SECRET ต้องตรงกับที่ใช้เข้ารหัส token ใน backup ไม่งั้นทุกเพจ/ช่องต้องเชื่อมใหม่
ENV_ACTION=keep
if [ ! -f "$APP_DIR/.env" ]; then ENV_ACTION=copy
elif [ "$(secret_of "$APP_DIR/.env")" != "$(secret_of "$WORK/x/env")" ]; then
  [ "$USE_BACKUP_ENV" = 1 ] || die "AUTH_SECRET ใน .env ปัจจุบันไม่ตรงกับ backup — ถ้ากู้ไป token ทั้งหมดจะถอดรหัสไม่ได้
    ถ้านี่คือเครื่องใหม่/ย้ายเครื่อง ให้รันใหม่พร้อม --use-backup-env (ระบบเก็บ .env ปัจจุบันไว้เป็น .env.before-restore-*)"
  ENV_ACTION=replace
elif [ "$USE_BACKUP_ENV" = 1 ]; then ENV_ACTION=replace; fi

echo
log "จะทำต่อไปนี้ใน $APP_DIR:"
echo "    • หยุด api / web / worker ระหว่างกู้ (ระบบใช้งานไม่ได้ชั่วคราว)"
[ "$SAFETY" = 1 ] && echo "    • สำรองฐานข้อมูลปัจจุบันไว้ที่ $BACKUP_DIR/pre-restore-*.dump"
echo "    • ลบข้อมูลในฐานข้อมูล '$DB_NAME' แล้วกู้จาก backup"
[ "$WITH_MEDIA" = 1 ] && echo "    • แทนที่ไฟล์สื่อทั้งหมดด้วยของใน backup"
case "$ENV_ACTION" in copy) echo "    • ใช้ .env จาก backup (ยังไม่มี .env)";; replace) echo "    • แทน .env ด้วยของใน backup (เก็บของเดิมไว้)";; esac
echo "    • migrate ฐานข้อมูลให้ตรงโค้ดปัจจุบัน แล้วเปิดระบบ"
if [ "$YES" != 1 ]; then read -r -p "พิมพ์ RESTORE เพื่อยืนยัน: " ok; [ "$ok" = RESTORE ] || die "ยกเลิก"; fi

# 3) .env
TS="$(date +%Y%m%d-%H%M%S)"
if [ "$ENV_ACTION" = replace ]; then cp "$APP_DIR/.env" "$APP_DIR/.env.before-restore-$TS"; chmod 600 "$APP_DIR/.env.before-restore-$TS"; fi
if [ "$ENV_ACTION" != keep ]; then cp "$WORK/x/env" "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"; log ".env ← backup"; fi

# 4) ฐานข้อมูลต้องพร้อม
dc up -d postgres redis >/dev/null
for i in $(seq 1 60); do dc exec -T postgres pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1 && break; [ "$i" = 60 ] && die "postgres ไม่พร้อมใน 60 วินาที"; sleep 1; done
if [ "$ENV_ACTION" != keep ]; then
  # volume postgres ของเครื่องใหม่ถูกสร้างด้วยรหัสผ่านจาก .env เดิม → ตั้งให้ตรง .env ที่เพิ่งกู้ (ต่อผ่าน socket ภายในคอนเทนเนอร์ ไม่ต้องใช้รหัส)
  PGPW="$(grep -E '^POSTGRES_PASSWORD=' "$APP_DIR/.env" | tail -1 | cut -d= -f2-)"
  [ -n "$PGPW" ] && printf "ALTER USER postgres PASSWORD '%s';\n" "${PGPW//\'/\'\'}" | dc exec -T postgres psql -q -U postgres -d postgres >/dev/null && log "ตั้งรหัสผ่านฐานข้อมูลให้ตรง .env แล้ว"
  unset PGPW
fi

if [ "$SAFETY" = 1 ]; then
  dc exec -T postgres pg_dump -U postgres -d "$DB_NAME" -Fc > "$BACKUP_DIR/pre-restore-$TS.dump" || die "สำรองฐานข้อมูลปัจจุบันไม่สำเร็จ — หยุดก่อนเขียนทับ"
  chmod 600 "$BACKUP_DIR/pre-restore-$TS.dump"; log "สำรองของเดิม → $BACKUP_DIR/pre-restore-$TS.dump"
fi

log "หยุด api / web / worker"
dc stop api web worker >/dev/null 2>&1 || true

log "กู้ฐานข้อมูล"
printf 'SET client_min_messages = warning;\nDROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n' | dc exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" >/dev/null || die "ล้างฐานข้อมูลไม่สำเร็จ"
dc exec -T postgres pg_restore -U postgres -d "$DB_NAME" --no-owner --no-privileges --exit-on-error < "$WORK/x/db.dump" || die "pg_restore ล้มเหลว — กู้ของเดิมคืนได้ด้วยไฟล์ pre-restore-$TS.dump"

if [ "$WITH_MEDIA" = 1 ]; then
  log "กู้ไฟล์สื่อ"
  dc run --rm --no-deps -T --entrypoint sh api -c "find $MEDIA_PATH -mindepth 1 -delete && tar -xzf - -C $MEDIA_PATH" < "$WORK/x/media.tar.gz" || die "กู้ไฟล์สื่อไม่สำเร็จ"
fi

if [ "$SKIP_MIGRATE" != 1 ]; then log "migrate ให้ตรงโค้ดปัจจุบัน"; dc --profile maintenance run --rm migrate || die "migrate ล้มเหลว"; fi
if [ "$SKIP_START" != 1 ]; then log "เปิดระบบ"; dc --profile automation up -d >/dev/null || die "เปิดระบบไม่สำเร็จ — ดู docker compose logs"; fi

log "✅ กู้คืนเสร็จ"
echo "    ตรวจต่อ: curl -s http://127.0.0.1:\${FBPM_API_HOST_PORT:-4100}/health  ·  เปิดเว็บแล้วดูหน้าเพจ/คอนเทนต์"
echo "    โพสต์ที่ตั้งเวลาไว้: worker ใส่คิวให้ใหม่เองตอนเริ่ม (ดู docker compose logs worker | grep reconcile)"
echo "    งานที่ค้างสถานะ 'ไม่แน่ใจว่าโพสต์แล้ว' ยังล็อกอยู่ — ตรวจในหน้าเพจจริงก่อนปลดล็อก"
