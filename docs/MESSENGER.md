# Messenger AI — ตอบลูกค้าอัตโนมัติรายเพจ

> **เปลี่ยนแนวทาง 14 กันยายน 2026:** ค่าเริ่มต้นใหม่เก็บคำตอบเป็น `DRAFT` และส่งบทสนทนาให้แอดมินตรวจ (`HUMAN`) โดยไม่เรียก Send API ดูร่างในหน้าแชทแล้วตอบผ่าน Meta Business Suite ปุ่มอนุมัติ/ส่งรายข้อความในแอปยังไม่ได้ทำ หากจะเปิดส่งอัตโนมัติต้องได้รับอนุญาตเฉพาะและตั้ง `MESSENGER_AUTO_SEND_ENABLED=true` ฝั่ง worker; ชุด VPS เตรียมไว้เป็น false ข้อความด้านล่างอธิบายโหมดอัตโนมัติเดิม การสร้างร่างยังเรียก AI จริงและอาจมีค่าใช้จ่าย จึงยังไม่เปิดหรือทดลองกับคีย์จริงในงานนี้

เพิ่มเมื่อ 11 กันยายน 2026 — เปิดเมนู **แชทอัตโนมัติ** ที่ `/messenger`

## สิ่งที่ทำได้

- AI วิเคราะห์คำถามและบทสนทนาต่อเนื่อง แล้วตอบกลับลูกค้าเอง โดยไม่ต้องอนุมัติทุกข้อความ
- เปิด/ปิดเฉพาะเพจที่เลือก และแยกข้อมูลตามแบรนด์/workspace
- ใช้คีย์และโมเดล AI กลางของพื้นที่ทำงานผ่าน `AiGatewayService` (บทบาท `community`) เหมือนโมดูลอื่น — ผู้ให้บริการไหนก็ได้ที่ตั้งไว้ (Gemini/OpenAI/Anthropic/OpenRouter/compatible) และค่าใช้จ่ายถูกตัดจากงบ AI รายเดือนของพื้นที่ทำงาน
- ใช้ข้อมูลแบรนด์ สินค้า ราคา FAQ และนโยบายที่บันทึกไว้ประกอบคำตอบ เมื่อข้อมูลไม่พอให้ถามเพิ่มเติม ไม่สร้างราคา/สถานะออเดอร์ขึ้นเอง
- ทดลองถามในหน้าเว็บโดยไม่ส่งข้อความออกไปยังลูกค้า การทดลองใช้ API จริงและนับจำนวนการใช้งาน
- ดูบทสนทนา คำตอบ สถานะส่ง และเหตุขัดข้อง; แอดมินกดรับช่วงแล้วตอบต่อใน Facebook Inbox ได้
- เมื่อพบแอดมินตอบจาก Facebook ผ่าน message echo บอตหยุดในบทสนทนานั้น; กดเปิดต่อเพื่อรอข้อความใหม่ได้
- กรณี AI ล้มเหลวหรือครบเพดานรายวัน ใช้ข้อความรับเรื่องที่กำหนดไว้ แล้วแจ้งเตือนในแอปให้ทีมดูแลต่อ

## ตั้งค่าบนเครื่องนี้

1. เปิดระบบตาม [LOCAL_SETUP](LOCAL_SETUP.md) แล้วสร้างลูกค้า → แบรนด์ → ข้อมูลความรู้แบรนด์ และเชื่อมเพจ Facebook
2. ตั้งคีย์และโมเดล AI ที่หน้า **โมเดล AI** ครั้งเดียวสำหรับทั้งระบบ (บทบาท "ตอบคอมเมนต์/แชท" คือตัวที่แชทใช้) แล้วไป **แชทอัตโนมัติ** เพื่อตั้งจำนวนเรียกสูงสุดต่อวัน หน้านี้แสดงโมเดลที่จะถูกใช้จริงแต่ไม่เก็บคีย์ของตัวเอง
3. เลือกเพจเป้าหมาย ใส่แนวทางการตอบและข้อความรับเรื่องเมื่อ AI ใช้งานไม่ได้ แล้วบันทึก
4. ทดลองคำถามจากข้อมูลแบรนด์ ตรวจทั้งคำถามราคา รายละเอียดบริการ คำถามที่ยังไม่มีข้อมูล และการขอคุยกับแอดมิน เมื่อสำเร็จจะแสดง **ทดลอง AI ผ่านแล้ว**
5. ตั้ง `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` และค่าการเชื่อม OAuth ใน `.env` ถ้ายังไม่ได้ตั้ง แล้วรีสตาร์ท API/เว็บ/worker
6. Meta ต้องเรียก webhook ได้จากภายนอกผ่าน HTTPS โดยใช้ `https://<โดเมนเว็บ>/api/facebook/webhook` เมื่อผ่าน Next proxy หรือ `/facebook/webhook` เมื่อเข้าถึง API โดยตรง การเปิดเพียง `localhost` ไม่ทำให้ Meta เข้าถึงเครื่องได้
7. ตั้ง callback และ verify token ในแอป Meta ให้ตรงกัน เปิด events `messages` และ `message_echoes`; คง `feed` ของงานโพสต์/คอมเมนต์เดิมไว้
8. กด **เชื่อม Facebook พร้อมสิทธิ์แชท** เพื่อขอ `pages_messaging` เพิ่มจากสิทธิ์เดิม การเชื่อม Facebook สำหรับงานคอนเทนต์ตามปกติจะไม่ขอสิทธิ์นี้เพิ่มเอง เพจที่ใช้ต้องให้ผู้เชื่อมมีสิทธิ์ตอบข้อความ; แอปต้องได้รับสิทธิ์/การตรวจสอบจาก Meta ตามการใช้งานจริง
9. กลับเมนูแชท เลือกเพจ → **เชื่อมรับข้อความจากเพจ** → **เปิดตอบอัตโนมัติ** การเปิดตรงนี้เป็นการอนุญาตให้ตอบข้อความใหม่ของเพจนั้นทันที
10. ให้บัญชีทดสอบทักเพจ แล้วตรวจทั้งคำตอบใน Messenger และสถานะในหน้าเว็บ ไม่ใช่ตรวจเพียงปุ่มทดลอง AI

หากพื้นที่ทำงานเปิด **หยุดระบบอัตโนมัติ** ไว้ ต้องปลดในตั้งค่าก่อน บอตทุกเพจเริ่มต้นปิด ไม่มีการเปิดเพจจริงจากการติดตั้งหรือ migration นี้

ต้องทดลองคำตอบให้สำเร็จอย่างน้อยหนึ่งครั้งก่อนเปิดตอบอัตโนมัติของเพจใด ถ้าถอดคีย์ AI ของพื้นที่ทำงานออก แชทจะตอบไม่ได้และเปิดเพจใหม่ไม่ได้จนกว่าจะตั้งคีย์และทดลองใหม่

## ทดสอบก่อนใช้งานกับลูกค้า

| ทดสอบ | ผลที่ต้องได้ |
|---|---|
| ถามข้อมูลที่มีในแบรนด์ | ตอบเนื้อหาตรงคำถามและข้อเท็จจริง โดยไม่รออนุมัติ |
| ถามต่อจากคำถามก่อน | ใช้บริบทก่อนหน้า ไม่เริ่มสนทนาใหม่ทุกครั้ง |
| ถามสิ่งที่ไม่มีข้อมูล | ถามรายละเอียดเพิ่มหรือรับเรื่องส่งต่อ ไม่เดาราคา/สต็อก |
| ทักเพจที่ปิด AI | ไม่มีคำตอบอัตโนมัติจากโมดูลนี้ |
| ลูกค้าขอแอดมิน | ได้รับข้อความตอบรับและบอตพักในบทสนทนานั้น |
| แอดมินรับช่วง | บอตหยุด; เปิดต่อแล้วไม่ตอบข้อความเก่าย้อนหลัง |
| เหตุการณ์เดิมส่งมาซ้ำ | ไม่มีคำตอบซ้ำ |
| AI ใช้งานไม่ได้ | ส่งข้อความรับเรื่องที่กำหนดเมื่อ Meta ยังส่งได้ และแจ้งเตือนในแอป |
| Meta ส่งไม่สำเร็จหรือไม่ทราบผล | แสดงสถานะให้ตรวจ ไม่ส่งซ้ำแบบเสี่ยงข้อความซ้ำ |

## ขอบเขตและข้อจำกัด

- รองรับข้อความตัวอักษร ยังไม่วิเคราะห์รูปภาพ เสียง ไฟล์ หรือสถานะออเดอร์จากระบบภายนอก ถ้ามีไฟล์แนบจะขอรายละเอียดเป็นข้อความเพิ่ม
- ใช้หน้าต่างตอบมาตรฐาน 24 ชั่วโมงนับจากข้อความลูกค้า ไม่ใช้ message tags เพื่อส่งอัตโนมัตินอกกรอบนี้
- ความเร็วขึ้นกับโมเดล AI ที่เลือก เครือข่าย Meta และคิว มีการรวมข้อความที่มาถี่และยกเลิกคำตอบเก่าก่อนเริ่มส่ง กำหนดเวลารอ AI 25 วินาทีและรอ Meta 15 วินาที ไม่รับประกันว่าอินเทอร์เน็ตหรือผู้ให้บริการล่มแล้วยังส่งได้
- ข้อความที่เริ่มส่งออกไปแล้วอาจหยุดไม่ทัน การหยุด AI ระงับงานที่ยังไม่เริ่มส่ง
- เพจ Facebook จริงหนึ่งเพจเปิดบอตได้ในแบรนด์/workspace เดียวในระบบนี้ เพื่อป้องกันสองบอตตอบลูกค้าคนเดียวพร้อมกัน บอตภายนอกแอปนี้ต้องตั้งค่าแยกกับ Meta
- หน้าแชทแสดงล่าสุด 100 บทสนทนา และล่าสุด 100 ข้อความต่อบทสนทนา; AI ใช้ประวัติล่าสุดไม่เกิน 20 รายการและข้อมูลแบรนด์ที่คัดเลือกแบบจำกัดขนาด ไม่ได้อ่านประวัติ Messenger ย้อนหลังก่อนเชื่อมระบบ
- เพดานรายวันนับ "จำนวนครั้ง" ที่เริ่มเรียก AI รวมการทดลองและการเรียกที่ล้มเหลว รีเซ็ต 00:00 UTC (07:00 เวลาไทย) — ไม่ใช่วงเงิน USD วงเงินจริงคืองบ AI รายเดือนของพื้นที่ทำงาน ซึ่งตอนนี้ครอบคลุมค่าแชทด้วยแล้ว (เกินงบ → แชทหยุดเรียก AI และตกไปใช้ข้อความรับเรื่อง)
- บันทึก token/เวลา/ผลการเรียกใน AiTaskLog โดยไม่บันทึกคีย์หรือ prompt ลง audit log ราคา estimatedCost ของงานแชทเป็น null เพื่อไม่ใช้ตารางราคาประมาณเดิมกับโมเดลที่ผู้ใช้เลือก
- ยังต้องประเมินคุณภาพภาษาและความถูกต้องด้วยคำถามจริงของธุรกิจ ผลทดสอบ mock ยืนยันการทำงานของระบบ แต่ไม่ยืนยันคุณภาพโมเดลหรือสิทธิ์แอป Meta จริง

## ผลตรวจ

ตรวจเมื่อ 11 กันยายน 2026:

- Build, typecheck และ lint ผ่าน
- Unit/integration ทั้งระบบ **249 เคสผ่าน** รวม Messenger core 7 เคส, Messenger API/integration 21 เคส และการทดสอบ timeout ของ AI อีก 1 เคส
- Browser ทั้งระบบ **11 เคสผ่าน** รวมการตั้งเพดานรายวัน ทดลองคำตอบ เปิดเฉพาะเพจ รับ webhook ผ่านคิวจริง ส่งคำตอบจำลอง รับช่วงโดยแอดมิน และปิดเพจ
- ตรวจภาพหน้าจอมือถือกว้าง 390 px แล้ว ไม่มีแนวนอนล้นจอ (`test-results/messenger-mobile.png`)
- Migration เพิ่ม 5 ตาราง Applied ทั้ง `fbpm_local` และ `fbpm_test` ไม่ลบตารางหรือข้อมูลเดิม
- การส่งจริงกับผู้ให้บริการ AI/Meta ยังเป็น **BLOCKED_BY_CREDENTIALS** และต้องยืนยันสิทธิ์แอป/เพจจริง ไม่มีการส่งข้อความถึงลูกค้าจริงระหว่างพัฒนา

หลักฐานในเครื่อง: `messenger-build.log`, `messenger-typecheck.log`, `messenger-lint.log`, `messenger-final-tests.log`, `messenger-e2e.log` การรันรวมก่อนหน้านี้พบ timeout ของการเรนเดอร์ PDF ในชุด YouTube ขณะรันหลายงานพร้อมกัน; รันแยกผ่าน 20 เคส แล้วรันทั้งระบบซ้ำผ่านครบ 249 เคส โดยไม่แก้โค้ด YouTube

## Implementation notes

The owner requested automatic AI replies without per-message approval, enabled only for selected Facebook Pages. The existing Facebook webhook accepts message events but its worker has no conversation processor. Messenger runs through the same central AI gateway as every other module (role `community`), so one workspace key and model serve content, comments, YouTube, web articles, email and chat alike, and the workspace monthly AI budget covers chat as well.

Flow: signed Meta webhook → durable, deduplicated conversation/message → dedicated queue → brand knowledge and recent conversation → shared AI adapter → validated reply/clarification/handoff → recheck page switch, human takeover and messaging window → Meta Send API. No model tools can publish content, change prices, create orders or issue refunds.

New pages default off. An operator sets the workspace AI key/model once on the AI models page, sets the daily call cap, tests a reply, subscribes the target Page to messages and enables that Page. An enabled Page answers automatically. Missing information should lead to a specific clarifying question; human requests and service failures receive an acknowledgement before handoff when sending is possible. A failed provider cannot guarantee delivery; the inbox must show the failure.

Durable message IDs prevent webhook replay from sending duplicate replies. A conversation lease serializes AI work. New incoming messages invalidate stale responses. Send requests are never blindly retried after an ambiguous network outcome; the conversation is flagged for reconciliation. Echoes of our sends are recognized; external operator echoes pause AI. Workspace pause and Page disconnect are checked before sending. Enabling a page never sends old stored messages.

References checked: [Meta Messenger Send API](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api), [OpenAI API projects](https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/projects). Real credentials and approved Meta permissions are required for live validation. Automated tests use local fixtures.
