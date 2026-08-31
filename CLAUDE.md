# fb-page-ops — จัดการข้อมูลเพจ Facebook ของลูกค้า

โปรเจกต์นี้ใช้ `fb-pages.mjs` (Node 18+, ไม่มี dependency) คุยกับ Meta Pages API
เพจทั้งหมดเป็นของลูกค้าที่เชิญเราเป็นแอดมิน — token ที่ใช้คือของบัญชีเรา

## ไฟล์
- `fb-pages.mjs` — สคริปต์หลัก (ห้ามแก้ logic การส่ง token)
- `pages.json` — รายชื่อเพจ + Page token (สร้างโดย `sync` หรือสร้างอัตโนมัติเมื่อไม่มีไฟล์ เช่นใน cloud session ใหม่) **ห้ามเปิดอ่าน/แสดงเนื้อหา**
- `setup/<page-id>.json` — ไฟล์ข้อมูลที่จะอัปเดตต่อเพจ (ดูรูปแบบใน `setup-example.json`)
- `.env` (ถ้ามี) — เก็บ USER_TOKEN **ห้ามเปิดอ่าน**

## คำสั่ง
```
node fb-pages.mjs sync                              ดึงเพจทั้งหมด → pages.json (รันเมื่อมีลูกค้าใหม่)
node fb-pages.mjs audit                             ตรวจทุกเพจว่าขาดข้อมูลอะไร (% ครบ)
node fb-pages.mjs show <page-id>                    ดูข้อมูลปัจจุบันของเพจ
node fb-pages.mjs apply <page-id> setup/<page-id>.json --dry   ดู payload ก่อน
node fb-pages.mjs apply <page-id> setup/<page-id>.json         อัปเดตจริง
```
อ้างเพจด้วย page-id (เลข) หรือชื่อเพจตรงตัวก็ได้

## Workflow เมื่อได้รับคำสั่ง "ตั้งค่าเพจ X"
1. รัน `audit` (ถ้าไม่เจอเพจ → รัน `sync` ก่อน แล้ว audit ซ้ำ)
2. รัน `show <page-id>` เพื่อดูค่าปัจจุบัน อย่าเขียนทับข้อมูลที่ดีอยู่แล้ว
3. ถ้าขาดข้อมูลธุรกิจที่จำเป็น (เบอร์, ที่อยู่, เวลาทำการ, เว็บ) ให้**ถามผู้ใช้ก่อน** ห้ามเดา
4. เขียน `setup/<page-id>.json` — ข้อความเป็นภาษาไทย น้ำเสียงมืออาชีพ ตรงกับประเภทธุรกิจ
5. รัน `apply ... --dry` แสดงผลให้ผู้ใช้ดู รอยืนยัน
6. รัน `apply` จริง แล้วรัน `audit` ซ้ำเพื่อสรุปผล
7. รายการที่สคริปต์ทำไม่ได้ (หมวดหมู่, @username, รูปปก, รูปโปรไฟล์) → สรุปเป็น checklist ให้ผู้ใช้ไปทำในหน้าเพจ

## กฎความปลอดภัย (สำคัญมาก)
- **ห้าม** print, echo, log หรือแสดง token ในทุกรูปแบบ — ทั้ง USER_TOKEN และ access_token ในผลลัพธ์ใดๆ
- **ห้าม** `cat`/อ่าน `.env` หรือ `pages.json` โดยตรง ใช้เฉพาะคำสั่งของสคริปต์
- **ห้าม** ยิง Graph API เองด้วย curl/fetch พร้อม token ใน command line — ใช้สคริปต์เท่านั้น
- **ห้าม** `apply` จริงโดยไม่ผ่าน `--dry` และการยืนยันจากผู้ใช้ก่อน
- **ห้าม** commit `.env`, `pages.json`, `.claude/settings.local.json`
- ถ้าเจอ error เกี่ยวกับ token หมดอายุ/ไม่มีสิทธิ์ → บอกผู้ใช้ให้ generate + extend token ใหม่แล้วอัปเดต USER_TOKEN ห้ามพยายามแก้เอง

## รูปแบบข้อมูลใน setup json
- `about` ≤ 255 ตัวอักษร — ข้อความสั้นใต้ชื่อเพจ ใส่จุดขายหลัก + ช่องทางติดต่อ
- `description` — รายละเอียดยาว: ขายอะไร จุดเด่น การจัดส่ง/บริการ การรับประกัน
- `phone` รูปแบบ `+66812345678`
- `emails` เป็น array เช่น `["a@b.com"]`
- `price_range` ใช้ได้เฉพาะ `"$"`, `"$$"`, `"$$$"`, `"$$$$"`
- `hours` ใช้คีย์ `<day>_<n>_open` / `<day>_<n>_close` (day = mon..sun, n = 1 หรือ 2) เวลา `HH:MM` 24 ชม. วันที่ปิดไม่ต้องใส่
- ฟิลด์เสริม: `general_info`, `company_overview`, `mission`, `products`, `founded`
