#!/usr/bin/env bash
# สำรองข้อมูล SocialManage — ฐานข้อมูล + ไฟล์สื่อ + .env (มี AUTH_SECRET ที่ใช้ถอดรหัส token) รวมเป็นไฟล์เดียว
#
#   sudo deploy/backup.sh                 สำรองทันที
#   sudo deploy/backup.sh --no-media      ไม่รวมไฟล์สื่อ (เร็ว/เล็กกว่า)
#   sudo deploy/backup.sh --status        ดูไฟล์สำรองที่มี + ครั้งล่าสุดที่สำเร็จ
#   sudo deploy/backup.sh --install-cron [--at 03:15]   ตั้งสำรองอัตโนมัติทุกวัน (เวลาของเครื่อง)
#
# ค่าที่ปรับได้ (env):
#   BACKUP_DIR=/opt/fbpm-backups           ที่เก็บในเครื่อง (อยู่นอกโฟลเดอร์โค้ด — git pull ไม่แตะ)
#   KEEP_DAYS=14                           ลบไฟล์เก่ากว่านี้ (เก็บอย่างน้อย 3 ไฟล์ล่าสุดเสมอ)
#   BACKUP_PASSPHRASE_FILE=/root/.fbpm-backup-pass   มีไฟล์นี้ = เข้ารหัส AES-256 (แนะนำ, บังคับถ้าจะส่งออกนอกเครื่อง)
#   RCLONE_REMOTE=gdrive:fbpm-backups      ส่งสำเนาออกนอกเครื่องด้วย rclone (เช่น Google Drive) · RCLONE_KEEP_DAYS=30
#
# ไม่พิมพ์ค่าลับใดๆ ออกจอ · Redis (คิวงาน) ไม่ถูกสำรอง — worker สร้างคิวโพสต์ตั้งเวลาใหม่จากฐานข้อมูลเองตอนเริ่ม
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/opt/fbpm-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.fbpm-backup-pass}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_KEEP_DAYS="${RCLONE_KEEP_DAYS:-30}"
DB_NAME="${DB_NAME:-fbpm}"
MEDIA_PATH=/app/data/media

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "❌ $*"; mkdir -p "$BACKUP_DIR" 2>/dev/null && printf '%s %s\n' "$(date -Iseconds)" "$*" > "$BACKUP_DIR/last-failure" 2>/dev/null || true; exit 1; }
dc() { (cd "$APP_DIR" && docker compose "$@"); }

WITH_MEDIA=1; MODE=backup; CRON_AT=03:15
while [ $# -gt 0 ]; do
  case "$1" in
    --no-media) WITH_MEDIA=0 ;;
    --status) MODE=status ;;
    --install-cron) MODE=cron ;;
    --at) shift; CRON_AT="${1:?--at ต้องตามด้วยเวลา HH:MM}" ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "ไม่รู้จักตัวเลือก: $1 (ดู --help)" >&2; exit 2 ;;
  esac; shift
done

if [ "$MODE" = status ]; then
  echo "ที่เก็บ: $BACKUP_DIR"
  [ -f "$BACKUP_DIR/last-success" ] && echo "สำเร็จล่าสุด: $(cat "$BACKUP_DIR/last-success")" || echo "ยังไม่เคยสำรองสำเร็จ"
  [ -f "$BACKUP_DIR/last-failure" ] && echo "ล้มเหลวล่าสุด: $(cat "$BACKUP_DIR/last-failure")"
  ls -lh "$BACKUP_DIR"/fbpm-*.tar* 2>/dev/null | awk '{print "  " $5 "\t" $6 " " $7 " " $8 "\t" $9}' || echo "  (ไม่มีไฟล์)"
  df -h "$BACKUP_DIR" 2>/dev/null | tail -1 | awk '{print "ดิสก์เหลือ: " $4 " (ใช้ไป " $5 ")"}'
  [ -f "$PASS_FILE" ] && echo "เข้ารหัส: เปิด ($PASS_FILE)" || echo "เข้ารหัส: ปิด — สร้างไฟล์รหัสผ่านก่อนส่งสำเนาออกนอกเครื่อง"
  exit 0
fi

if [ "$MODE" = cron ]; then
  [ "$(id -u)" = 0 ] || die "ต้องรันด้วย root (sudo) เพื่อเขียน /etc/cron.d"
  [[ "$CRON_AT" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || die "เวลาไม่ถูกต้อง: $CRON_AT (ใช้ HH:MM)"
  H=$((10#${BASH_REMATCH[1]})); M=$((10#${BASH_REMATCH[2]}))
  {
    echo "# สำรองข้อมูล SocialManage ทุกวัน — สร้างโดย deploy/backup.sh --install-cron"
    echo "SHELL=/bin/bash"
    echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    echo "$M $H * * * root APP_DIR=$APP_DIR BACKUP_DIR=$BACKUP_DIR KEEP_DAYS=$KEEP_DAYS RCLONE_REMOTE=$RCLONE_REMOTE $APP_DIR/deploy/backup.sh >> /var/log/fbpm-backup.log 2>&1"
  } > /etc/cron.d/fbpm-backup
  chmod 644 /etc/cron.d/fbpm-backup
  log "✅ ตั้งสำรองอัตโนมัติทุกวันเวลา $CRON_AT (เวลาเครื่อง: $(date +%Z)) → /etc/cron.d/fbpm-backup · log: /var/log/fbpm-backup.log"
  exit 0
fi

# ---------- สำรอง ----------
[ -f "$APP_DIR/.env" ] || die "ไม่พบ $APP_DIR/.env"
command -v docker >/dev/null || die "ไม่พบคำสั่ง docker"
umask 077
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.lock"; flock -n 9 || die "มีการสำรองอีกงานกำลังทำอยู่"
TS="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d "$BACKUP_DIR/.tmp-$TS-XXXXXX")"; trap 'rm -rf "$WORK"' EXIT
free_kb=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
[ "${free_kb:-0}" -gt 1048576 ] || log "⚠️ ดิสก์ที่ $BACKUP_DIR เหลือไม่ถึง 1 GB — อาจสำรองไม่สำเร็จ"

log "เริ่มสำรอง → $BACKUP_DIR"
log "1/4 ฐานข้อมูล (pg_dump)"
dc exec -T postgres pg_dump -U postgres -d "$DB_NAME" -Fc > "$WORK/db.dump" || die "pg_dump ล้มเหลว — postgres ทำงานอยู่ไหม? (docker compose ps)"
[ -s "$WORK/db.dump" ] || die "ไฟล์ฐานข้อมูลว่าง"

if [ "$WITH_MEDIA" = 1 ]; then
  log "2/4 ไฟล์สื่อ ($MEDIA_PATH)"
  if dc ps --status running --services 2>/dev/null | grep -qx api; then
    dc exec -T api sh -c "cd $MEDIA_PATH && tar -czf - ." > "$WORK/media.tar.gz" || die "สำรองไฟล์สื่อล้มเหลว"
  else
    dc run --rm --no-deps -T --entrypoint sh api -c "cd $MEDIA_PATH && tar -czf - ." > "$WORK/media.tar.gz" || die "สำรองไฟล์สื่อล้มเหลว"
  fi
else log "2/4 ข้ามไฟล์สื่อ (--no-media)"; fi

log "3/4 .env (มี AUTH_SECRET — ไม่พิมพ์ค่า)"
cp "$APP_DIR/.env" "$WORK/env"

q() { dc exec -T postgres psql -U postgres -d "$DB_NAME" -tAc "$1" 2>/dev/null | tr -d '\r' || echo "?"; }
{
  echo "created=$TS"
  echo "host=$(hostname)"
  echo "git=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "migration=$(q "select migration_name from _prisma_migrations where finished_at is not null order by finished_at desc limit 1")"
  echo "workspaces=$(q 'select count(*) from "Workspace"')"
  echo "facebook_pages=$(q 'select count(*) from "FacebookPage" where "disconnectedAt" is null')"
  echo "content_items=$(q 'select count(*) from "ContentItem"')"
  echo "scheduled_posts=$(q "select count(*) from \"ContentItem\" where status = 'SCHEDULED'")"
  echo "media=$([ "$WITH_MEDIA" = 1 ] && echo yes || echo no)"
} > "$WORK/manifest.txt"
(cd "$WORK" && sha256sum db.dump env $([ "$WITH_MEDIA" = 1 ] && echo media.tar.gz) > SHA256SUMS)

log "4/4 รวมไฟล์"
OUT="$BACKUP_DIR/fbpm-$TS.tar"; n=1
while [ -e "$OUT" ] || [ -e "$OUT.enc" ]; do n=$((n + 1)); OUT="$BACKUP_DIR/fbpm-$TS-$n.tar"; done   # รันซ้ำในวินาทีเดียวกัน → ไม่เขียนทับ
tar -cf "$OUT" -C "$WORK" .
if [ -f "$PASS_FILE" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS_FILE" -in "$OUT" -out "$OUT.enc" || die "เข้ารหัสล้มเหลว"
  rm -f "$OUT"; OUT="$OUT.enc"
else
  log "⚠️ ไม่ได้เข้ารหัส (ไม่มี $PASS_FILE) — ไฟล์นี้มี .env อยู่ข้างใน เก็บในเครื่องแบบ root อ่านได้คนเดียว"
fi
chmod 600 "$OUT"

# เก็บย้อนหลัง: ลบไฟล์เก่ากว่า KEEP_DAYS แต่เหลือ 3 ไฟล์ล่าสุดเสมอ
while read -r f; do
  if [ -n "$f" ] && [ -n "$(find "$f" -maxdepth 0 -mtime +"$KEEP_DAYS" 2>/dev/null)" ]; then rm -f "$f"; log "ลบไฟล์เก่า: $(basename "$f")"; fi
done < <(ls -1t "$BACKUP_DIR"/fbpm-*.tar* 2>/dev/null | tail -n +4 || true)

if [ -n "$RCLONE_REMOTE" ]; then
  case "$OUT" in *.enc) ;; *) die "ไม่ส่งออกนอกเครื่องเพราะไฟล์ไม่ได้เข้ารหัส — สร้าง $PASS_FILE ก่อน (ดู docs/runbooks/backup-restore.md)";; esac
  command -v rclone >/dev/null || die "ตั้ง RCLONE_REMOTE ไว้แต่ไม่พบคำสั่ง rclone"
  log "ส่งสำเนาไป $RCLONE_REMOTE"
  rclone copy "$OUT" "$RCLONE_REMOTE" || die "rclone copy ล้มเหลว (ไฟล์ในเครื่องยังอยู่: $OUT)"
  rclone delete "$RCLONE_REMOTE" --min-age "${RCLONE_KEEP_DAYS}d" --include 'fbpm-*' || log "⚠️ ลบไฟล์เก่าบน $RCLONE_REMOTE ไม่สำเร็จ"
fi

SIZE=$(du -h "$OUT" | cut -f1)
printf '%s %s %s\n' "$(date -Iseconds)" "$(basename "$OUT")" "$SIZE" > "$BACKUP_DIR/last-success"
rm -f "$BACKUP_DIR/last-failure"
log "✅ สำรองเสร็จ: $OUT ($SIZE)"
