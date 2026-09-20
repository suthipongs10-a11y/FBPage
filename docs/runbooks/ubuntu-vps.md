# Runbook — Deploy บน Ubuntu VPS (Docker Compose + Caddy)

> **SUPERSEDED 2026-09-14 — ห้ามทำตามคำสั่งติดตั้งด้านล่างโดยตรง:** ใช้ [VPS_MIGRATION_PLAN.md](../VPS_MIGRATION_PLAN.md) และตรวจเครื่องด้วย `deploy/preflight.sh` ก่อน ต้องผ่านการซ้อม restore และอนุมัติสุดท้ายจากเจ้าของ Migration ไม่รันตอน API เริ่มแล้ว; worker ต้องเปิด profile แยก ส่วนที่เหลือเก็บเป็นประวัติเท่านั้น

## เตรียมเครื่อง (Ubuntu 22.04/24.04)
```bash
sudo apt update && sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

## ติดตั้งโปรเจกต์
```bash
git clone <repo> fbpm && cd fbpm
cp env.example .env
# แก้ .env: POSTGRES_PASSWORD, AUTH_SECRET (ยาว ≥32), DOMAIN=yourdomain.com, APP_URL=https://yourdomain.com
docker compose --env-file .env up -d --build
```
Caddy ขอใบรับรอง HTTPS ให้อัตโนมัติเมื่อ `DOMAIN` ชี้มาที่เครื่องนี้ (เปิดพอร์ต 80/443)

## ตรวจ
```bash
docker compose ps
curl -s https://$DOMAIN/api/health | jq     # ต้องได้ status: ok
curl -s https://$DOMAIN/health              # web liveness
docker compose logs -f api worker
```

## อัปเดตเวอร์ชัน
```bash
git pull
docker compose --env-file .env up -d --build
# migration รันอัตโนมัติตอน container api เริ่ม (prisma migrate deploy)
```

## สำรองข้อมูล (§80 — backup ที่ไม่เคย restore ถือว่ายังไม่ผ่าน)
```bash
# สำรอง
docker compose exec -T postgres pg_dump -U postgres fbpm | gzip > backup-$(date +%F).sql.gz
# ทดสอบกู้คืนลงฐานข้อมูลชั่วคราว
docker compose exec -T postgres createdb -U postgres fbpm_restore_test
gunzip -c backup-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U postgres fbpm_restore_test
docker compose exec -T postgres dropdb -U postgres fbpm_restore_test
```
แนะนำตั้ง cron รายวัน + เก็บย้อนหลัง 14 วัน + คัดลอกออกนอกเครื่อง

## สวิตช์ฉุกเฉิน (§92)
- หยุดอัตโนมัติทั้งระบบ: `docker compose stop worker` (API และหน้าเว็บยังใช้ดูข้อมูลได้)
- หยุดทั้งหมด: `docker compose down`

## ความลับ (§83)
- `.env` ห้าม commit · สิทธิ์ไฟล์ `chmod 600 .env`
- ถ้าความลับหลุด: ลบ → หมุนเวียนคีย์ใหม่ → บันทึกเหตุการณ์ (ลบจาก git อย่างเดียวไม่พอ)
