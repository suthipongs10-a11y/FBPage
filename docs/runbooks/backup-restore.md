# สำรองข้อมูล กู้คืน และย้าย VPS

สคริปต์: `deploy/backup.sh` · `deploy/restore.sh` (รันบน VPS ในโฟลเดอร์ `/opt/fbpm` ด้วย root)

## ไฟล์สำรองมีอะไร
| ส่วน | เก็บอะไร | ทำไม |
|---|---|---|
| `db.dump` | ฐานข้อมูลทั้งหมด (pg_dump custom format) | ลูกค้า เพจ คอนเทนต์ คอมเมนต์ ลีด ประวัติ |
| `media.tar.gz` | ไฟล์ใน `/app/data/media` (รูป การ์ด คลิป Reels) | โพสต์ที่ตั้งเวลาไว้ต้องใช้ไฟล์เหล่านี้ |
| `env` | ไฟล์ `.env` | **มี `AUTH_SECRET`** — token เพจ/ช่อง/คีย์ AI ทั้งหมดเข้ารหัสด้วยค่านี้ ถ้าหาย ต้องให้ทุกลูกค้าเชื่อมใหม่ |
| `manifest.txt`, `SHA256SUMS` | วันที่ รุ่นโค้ด รุ่นฐานข้อมูล จำนวนเพจ/โพสต์ตั้งเวลา · checksum | ตรวจว่าไฟล์ครบและไม่เสีย |

Redis (คิวงาน) **ไม่สำรอง** โดยตั้งใจ — worker มีงาน `schedule-reconcile` (ตอนเริ่ม + ทุก 15 นาที) ที่ตั้งคิวโพสต์ Facebook สถานะ SCHEDULED ใหม่จากฐานข้อมูลเอง

## ตั้งค่าครั้งแรก (ทำครั้งเดียว)
```bash
cd /opt/fbpm && git pull
# 1) รหัสผ่านเข้ารหัสไฟล์สำรอง — เก็บสำเนาไว้ในที่ปลอดภัยนอกเครื่อง (เช่น password manager) ไม่งั้นไฟล์สำรองเปิดไม่ได้
openssl rand -base64 32 > /root/.fbpm-backup-pass && chmod 600 /root/.fbpm-backup-pass
cat /root/.fbpm-backup-pass        # คัดลอกไปเก็บ แล้ว clear หน้าจอ
# 2) ลองสำรองครั้งแรก
sudo deploy/backup.sh
sudo deploy/backup.sh --status
# 3) ตั้งให้สำรองทุกวัน (เวลาของเครื่อง — ดูด้วย `date`)
sudo deploy/backup.sh --install-cron --at 03:15
```

### ส่งสำเนาออกนอกเครื่อง (แนะนำ — เครื่องพังทั้งเครื่องก็ยังกู้ได้)
ใช้ rclone ส่งไป Google Drive (ฟรี 15 GB):
```bash
sudo apt install -y rclone
rclone config          # n → ชื่อ gdrive → เลือก drive → ใช้ค่าเริ่มต้น → "Use auto config?" ตอบ n
                       # แล้วทำตามที่ขึ้นจอ: รัน `rclone authorize "drive"` บนคอมที่มีเบราว์เซอร์ แล้ววางผลกลับมา
rclone mkdir gdrive:fbpm-backups
sudo RCLONE_REMOTE=gdrive:fbpm-backups deploy/backup.sh          # ลองส่งครั้งแรก
sudo RCLONE_REMOTE=gdrive:fbpm-backups deploy/backup.sh --install-cron --at 03:15   # ติดตั้งใหม่ให้ cron ส่งทุกวัน
```
สคริปต์**ไม่ยอมส่งออกนอกเครื่องถ้าไฟล์ไม่ได้เข้ารหัส** · เก็บบนไดรฟ์ 30 วัน (`RCLONE_KEEP_DAYS`) ในเครื่อง 14 วัน (`KEEP_DAYS`, เหลืออย่างน้อย 3 ไฟล์เสมอ)

## ตรวจทุกเดือน (ไม่แตะระบบ)
```bash
sudo deploy/backup.sh --status
sudo deploy/restore.sh /opt/fbpm-backups/<ไฟล์ล่าสุด>.tar.enc --check
```
`--check` ถอดรหัส ตรวจ checksum อ่านโครงสร้างฐานข้อมูล และดูว่ามี AUTH_SECRET — ผ่านแปลว่ากู้ได้จริง

## กู้คืนบนเครื่องเดิม
```bash
sudo deploy/restore.sh /opt/fbpm-backups/fbpm-YYYYMMDD-HHMMSS.tar.enc
```
พิมพ์ `RESTORE` เพื่อยืนยัน · สคริปต์สำรองฐานข้อมูลปัจจุบันไว้ที่ `/opt/fbpm-backups/pre-restore-*.dump` ก่อนเขียนทับ · หยุด api/web/worker → กู้ → migrate → เปิดระบบ

## ย้ายไป VPS ใหม่ (โดเมนเดิม)
เวลาหยุดระบบประมาณ 30 นาที · ใช้โดเมนเดิม = ไม่ต้องแก้อะไรที่ Meta / Google / TikTok
1. **เครื่องใหม่:** ติดตั้ง Docker, nginx, certbot (ดู `ubuntu-vps.md`) แล้ว `git clone` โค้ดไปที่ `/opt/fbpm` (branch เดียวกับเครื่องเดิม) — **ยังไม่ต้องรัน make-env.sh**
2. **เครื่องเดิม:** หยุด worker ไม่ให้โพสต์ระหว่างย้าย แล้วสำรอง
   ```bash
   cd /opt/fbpm && docker compose stop worker && sudo deploy/backup.sh
   scp /opt/fbpm-backups/fbpm-*.tar.enc root@<IP-ใหม่>:/root/        # หรือดึงจาก Google Drive
   ```
3. **เครื่องใหม่:** วางไฟล์รหัสผ่าน `/root/.fbpm-backup-pass` (ค่าเดียวกับเครื่องเดิม) แล้ว
   ```bash
   cd /opt/fbpm
   docker compose build api && docker compose build worker && docker compose build web && docker compose --profile maintenance build migrate
   sudo deploy/restore.sh /root/fbpm-*.tar.enc          # ยังไม่มี .env → ใช้ของใน backup ให้เอง
   ```
   ถ้ารัน `make-env.sh` ไปแล้ว สคริปต์จะหยุดเพราะ AUTH_SECRET ไม่ตรง → รันใหม่พร้อม `--use-backup-env` (สคริปต์ตั้งรหัสผ่านฐานข้อมูลให้ตรง .env ให้ด้วย)
4. ตั้ง nginx ของเครื่องใหม่ (`deploy/nginx-fbpm.conf`) → เปลี่ยน DNS ของโดเมนไป IP ใหม่ → `certbot --nginx -d <โดเมน>`
5. ตรวจ: `curl -s http://127.0.0.1:4100/health`, ล็อกอิน, หน้าเพจ/คอนเทนต์, `docker compose logs worker | grep reconcile` (โพสต์ตั้งเวลาถูกตั้งคิวใหม่)
6. เครื่องเดิม: ปิดระบบ (`docker compose --profile automation down` **ห้ามใส่ -v**) เก็บไว้สักสัปดาห์ก่อนลบ

## สิ่งที่ต้องรู้
- **ไฟล์ .env + รหัสผ่านไฟล์สำรอง = กุญแจทุกอย่าง** เก็บสำเนานอกเครื่องเสมอ
- โพสต์ที่สถานะ "ไม่แน่ใจว่าโพสต์แล้ว" (UNKNOWN) ยังล็อกหลังกู้ — ตรวจที่เพจจริงแล้วกดปลดล็อกในหน้าคอนเทนต์
- งานอัปโหลด YouTube/เว็บ/อีเมลที่อยู่ในคิวตอนสำรอง ต้องกดสั่งใหม่หลังกู้ (โพสต์ Facebook ตั้งเวลา worker ตั้งคิวใหม่ให้เอง)
- log การสำรองอัตโนมัติ: `/var/log/fbpm-backup.log` · ล้มเหลวล่าสุด: `/opt/fbpm-backups/last-failure`
