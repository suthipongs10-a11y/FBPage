#!/usr/bin/env bash
# อัปเดตระบบบน VPS ด้วยคำสั่งเดียว — ดึงโค้ด → build → migrate ฐานข้อมูล → เปิดระบบ → ตรวจสุขภาพ
#
#   cd /opt/fbpm && sudo deploy/update.sh             อัปเดตเต็มขั้นตอน
#   sudo deploy/update.sh --no-pull                    ไม่ git pull (โค้ดในเครื่องอัปเดตแล้ว)
#   sudo deploy/update.sh --backup                     สำรองฐานข้อมูลก่อน migrate (ใช้ deploy/backup.sh --no-media)
#
# ทำไมต้องใช้สคริปต์นี้: ถ้า build โค้ดใหม่แต่ลืม migrate หน้าเว็บยังเปิดได้ แต่ซิงก์เพจ/บันทึกบางอย่างจะขึ้น error
# เพราะโค้ดเรียกคอลัมน์ที่ฐานข้อมูลยังไม่มี — สคริปต์นี้ migrate ก่อนเปิด api/worker ตัวใหม่เสมอ และไม่พิมพ์ค่าลับใดๆ
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PULL=1; BACKUP=0
for a in "$@"; do
  case "$a" in
    --no-pull) PULL=0 ;;
    --backup) BACKUP=1 ;;
    -h|--help) sed -n 2,9p "$0"; exit 0 ;;
    *) echo "ไม่รู้จักตัวเลือก: $a"; exit 2 ;;
  esac
done

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "❌ $*"; exit 1; }
dc() { (cd "$APP_DIR" && docker compose "$@"); }

if [ "$PULL" = 1 ]; then log "ดึงโค้ดล่าสุด"; (cd "$APP_DIR" && git pull --ff-only) || die "git pull ไม่สำเร็จ (มีไฟล์แก้ในเครื่อง?) — ดู git status"; fi
log "build api / worker / web / migrate"
dc build api && dc build worker && dc build web && dc --profile maintenance build migrate || die "build ล้มเหลว — ระบบเดิมยังทำงานอยู่ ไม่มีอะไรเปลี่ยน"
if [ "$BACKUP" = 1 ]; then log "สำรองฐานข้อมูลก่อน migrate"; "$APP_DIR/deploy/backup.sh" --no-media || die "สำรองไม่สำเร็จ — ยังไม่ได้ migrate"; fi
log "migrate ฐานข้อมูล"
dc --profile maintenance run --rm migrate || die "migrate ล้มเหลว — ระบบเดิมยังทำงานอยู่ ดู log ด้านบน"
log "เปิดระบบตัวใหม่ (รวม worker)"
dc --profile automation up -d

log "ตรวจสุขภาพ API"
for i in $(seq 1 30); do
  out="$(dc exec -T api node -e "fetch('http://127.0.0.1:4000/health').then(r=>r.json()).then(j=>{console.log(j.checks.map(c=>c.name+'='+c.status+(c.error?' ('+c.error+')':'')).join(' · '));process.exit(j.status==='ok'?0:3)}).catch(()=>process.exit(4))" 2>/dev/null)" && { log "✅ $out"; exit 0; }
  rc=$?; [ "$rc" = 3 ] && die "API เปิดแล้วแต่มีบางอย่างไม่พร้อม: $out"
  sleep 2
done
die "API ไม่ตอบภายใน 60 วินาที — docker compose logs api --tail=100"
