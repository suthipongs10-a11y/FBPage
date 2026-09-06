# ดูแลเว็บไซต์ลูกค้า (Website Care W-1/W-2)

## เพิ่มเว็บ
หน้า **เว็บไซต์ → เพิ่มเว็บไซต์**: เลือกแบรนด์ → ใส่ URL → (แนะนำ) ใส่ "คำที่ต้องพบในหน้าแรก" เช่น ชื่อร้าน เพื่อจับกรณีเว็บขึ้นแต่เนื้อหาหาย → บันทึก ระบบตรวจ uptime/SSL/SEO ทันทีและตรวจซ้ำตามรอบ (ค่าเริ่มต้น 15 นาที) ส่วน SSL/SEO/ลิงก์/PageSpeed/Search Console ตรวจวันละครั้งตี 2 UTC
- เว็บล่ม: ต้องล้ม 2 รอบติดกันจึงแจ้งเตือน (กัน false alarm) และแจ้งอีกครั้งเมื่อฟื้น · SSL ≤ 14 วันแจ้งเตือน · ช้าเกิน 3 วิ = "ช้า/ไม่แน่ใจ"
- ระบบ **ไม่แก้เว็บลูกค้า** และตรวจแบบสุภาพ (UA `FBPM-SiteMonitor/1.0`, ≤ 1 คำขอ/วินาที, เคารพ robots.txt)

## Core Web Vitals
ต้องมี `PAGESPEED_API_KEY` (Google Cloud → PageSpeed Insights API → API key ฟรี) ไม่มี = แสดง "ไม่มีข้อมูล" ไม่ใช่ 0

## Search Console
1. หน้า YouTube → *เชื่อมบัญชี Google* (ระบบขอ scope Search Console ด้วยแล้ว) หรือให้เจ้าของเว็บกด
2. เจ้าของเว็บเพิ่มอีเมลบัญชี Google นั้นเป็น **user** ของ property ใน Search Console (Settings → Users and permissions)
3. หน้าเว็บไซต์ → เลือกเว็บ → *เชื่อม Search Console* → ระบบจับคู่ property ให้เอง (`sc-domain:` ก่อน แล้ว URL prefix) → ซิงก์ 28 วัน
- ข้อมูล Google ล่าช้า 2–3 วัน · ไม่มีสิทธิ์ = สถานะ "ไม่มีสิทธิ์" + แจ้งเตือน ไม่ใช่เลข 0

## SEO Analyst
ปุ่ม *ให้ AI วิเคราะห์ SEO* ใช้เฉพาะข้อมูลที่ระบบตรวจได้ (audit, PageSpeed, Search Console, ข้อมูลแบรนด์) แยก OBSERVED / INFERENCE / RECOMMENDATION พร้อม effort — ห้ามอ้างอันดับหรือคู่แข่งที่ไม่มีในข้อมูล

## ปัญหาที่พบบ่อย
| อาการ | ทำอย่างไร |
| --- | --- |
| "ไม่อนุญาตเป้าหมายในเครือข่ายภายใน" | URL เป็น IP ภายใน/localhost — ใช้โดเมนจริง (test ตั้ง `WEB_ALLOW_PRIVATE_TARGETS=true`) |
| SSL = "ไม่ใช่ https" | เว็บลูกค้ายังไม่มี HTTPS — แนะนำลูกค้าเปิด (Let's Encrypt ฟรี) |
| Search Console "ไม่มีสิทธิ์" | เจ้าของเว็บยังไม่เพิ่มบัญชี Google เป็น user ของ property หรือบัญชีเชื่อมโดยไม่มี scope ค้นหา → เชื่อมบัญชี Google ใหม่ |
| PageSpeed FAIL | หน้าแรกโหลดไม่สำเร็จจากฝั่ง Google หรือ key ผิด — ดูข้อความ error ในการ์ด |
