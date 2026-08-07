# PAGE OS — ระบบดูแลเพจ Facebook ครบวงจร (Solo Agency Edition)

> สเปกออกแบบระบบสำหรับ "คนเดียวดูแลหลายเพจ" — ใช้เป็น input ให้ Claude Code สร้างต่อ
> อัปเดตตามสถานะ Meta Platform: สิงหาคม 2026

---

## 0. ข้อจำกัดจริงของ Meta ที่ต้องออกแบบรอบมัน (อ่านก่อนเขียนโค้ดบรรทัดแรก)

ข้อนี้สำคัญที่สุด เพราะ 80% ของทูลที่คนสร้างเองพังตรงนี้ ไม่ใช่ตรง UI

| เรื่อง | สถานะปี 2026 | ผลต่อการออกแบบ |
|---|---|---|
| Graph API version | ปัจจุบัน **v25.0** (ออก 18 ก.พ. 2026), v18/v19 หมดอายุแล้ว | pin version ใน env var ตัวเดียว `GRAPH_VERSION=v25.0` ห้าม hardcode กระจาย |
| App Review | permission เพจเกือบทั้งหมดต้องผ่าน App Review + Business Verification ก่อนใช้กับเพจที่เราไม่ได้เป็นเจ้าของ | วางแผนเผื่อ **4–8 สัปดาห์** และออกแบบให้ระบบทำงานได้ก่อนรีวิวผ่าน (ดูข้อ 7) |
| Permission dependency | `pages_manage_posts` ลาก `pages_read_engagement` + `pages_show_list` มาด้วย | ยื่นรีวิวเป็นชุดเดียว ไม่ใช่ทีละตัว |
| 24-hour window | ตอบ inbox ฟรีได้ภายใน 24 ชม. หลังลูกค้าทัก | ต้องมี timer ต่อ conversation ใน DB |
| HUMAN_AGENT tag | ยังใช้ได้ ขยายเป็น **7 วัน** แต่ต้องเป็นข้อความที่ "คนพิมพ์" เท่านั้น ห้ามบอทส่ง | แยก flag `sent_by: human \| bot` ใน DB และบล็อกบอทไม่ให้ใช้แท็กนี้ |
| Legacy message tags | `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE` **ปลดระวาง 27 เม.ย. 2026** → error 100 | ห้ามใช้ ย้ายไป Utility Templates |
| Recurring Notifications | ปิดทั่วโลก 10 ก.พ. 2026 ยกเว้น AU/EU/JP/KR/UK → **ไทยใช้ไม่ได้** | ตัด feature "broadcast รายสัปดาห์" ออกจากแผน ใช้ Marketing Messages API แทน |
| Webhook mTLS | ต้อง trust Meta internal CA ตั้งแต่ 31 มี.ค. 2026 | อัปเดต trust store บน VPS ไม่งั้น webhook เงียบ |
| Page Reach / Impressions | ปลดระวาง มิ.ย. 2026 → ใช้ Page Viewer Metric / Media Views | รายงานลูกค้าต้องใช้เมตริกใหม่ อย่าอิงของเก่า |
| Rate limit | error 4 (app), 32 (page), 80001 (page/system token) + header `X-App-Usage` | ต้องมี queue + backoff กลาง ห้ามยิงตรง |

**ข้อสรุปเชิงกลยุทธ์:** ทำให้ทุกการเรียก Meta ผ่าน **Gateway Layer ตัวเดียว** ที่จัดการ version, token refresh, rate limit, retry, error mapping ทั้งหมด โมดูลอื่นห้ามเรียก `graph.facebook.com` ตรงๆ เด็ดขาด

---

## 1. โมเดลธุรกิจที่ระบบต้องรองรับ

```
คุณ (Agency Owner)
 └── Workspace (1 workspace = 1 ลูกค้า/แบรนด์)
      └── Pages (FB Page + IG Business ที่ผูกกัน)
           └── Assets: content calendar, bot flows, FAQ knowledge, leads, reports
```

- ผู้ใช้จริงมีคนเดียว = **คุณ** → UI ต้องออกแบบเป็น "control tower" ไม่ใช่ dashboard สวยๆ ต่อเพจ
- ลูกค้าเข้าได้แค่ **Client Portal** แบบอ่านอย่างเดียว + อนุมัติคอนเทนต์
- ทุกอย่างต้องมีมุมมอง **Cross-page** (ดูทุกเพจพร้อมกัน) เป็นค่าเริ่มต้น ไม่ใช่ต้องเลือกเพจก่อน

---

## 2. โมดูลฟีเจอร์ทั้งหมด

### M0 — Connection & Token Management (รากฐาน ห้ามข้าม)

- Facebook Login (OAuth) → แลก short-lived → **long-lived user token** → ดึง page tokens
- รองรับ **System User Token** ผ่าน Meta Business Manager (ลูกค้าเชิญคุณเป็น Partner) → token ไม่หมดอายุ = ทางที่ควรใช้กับลูกค้าจริง
- เก็บ token **เข้ารหัส** (AES-256-GCM, key ใน env) ห้ามเก็บ plaintext
- Health check ทุก 6 ชม.: `GET /debug_token` → ถ้าใกล้หมดอายุ/โดนเพิกถอน → แจ้งเตือน LINE ทันที
- หน้า "Connection Status" แสดงสถานะทุกเพจ: token OK / permission ขาดตัวไหน / webhook subscribed หรือยัง
- **Onboarding Wizard สำหรับลูกค้า** — หน้าเว็บที่ส่งลิงก์ให้ลูกค้ากดเชื่อมเพจเองใน 3 คลิก (นี่คือสิ่งที่ทำให้รับลูกค้าใหม่ใช้เวลา 5 นาทีแทน 1 ชม.)

**Permissions ที่ต้องขอ:** `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`, `pages_manage_metadata`, `pages_messaging`, `read_insights`, `business_management`, `instagram_basic`, `instagram_manage_messages`, `instagram_content_publish`

---

### M1 — Unified Inbox (หัวใจของงานดูแลเพจ)

รวม Messenger DM + IG DM + Comment + Rating/Review ไว้ที่เดียว **ข้ามทุกเพจ**

- **Realtime ผ่าน Webhook** (ไม่ polling): subscribe `messages`, `messaging_postbacks`, `message_reactions`, `feed`, `ratings`
- Conversation list พร้อม badge: `⏰ เหลือ 3 ชม.` (นับถอยหลัง 24h window) — สีแดงเมื่อ < 2 ชม.
- Filter: ยังไม่ตอบ / บอทตอบแล้วแต่ต้องรีวิว / escalate / เกิน SLA
- **Escalation**: บอทตอบไม่ได้ → ปักธง + ส่ง LINE Notify หาคุณพร้อมลิงก์ deep link เข้า thread
- Canned replies (บันทึกคำตอบซ้ำ) แยกตามเพจ + ตัวแปร `{ชื่อลูกค้า}` `{ชื่อร้าน}`
- Tag ผู้ติดต่อ: สนใจ / ปิดการขายแล้ว / เคลม / สแปม
- **Note ภายใน** ต่อ conversation (ลูกค้าไม่เห็น)
- Mobile-first — คุณจะตอบจากมือถือ 70% ของเวลา ทำเป็น PWA

---

### M2 — Chatbot Engine (จุดขายหลักของบริการ)

**สถาปัตยกรรม 3 ชั้น** — อย่าใช้ LLM ตอบทุกข้อความ เปลืองและคุมไม่ได้

```
ข้อความเข้า
  ↓
[ชั้น 1] Keyword / Regex Rules   ← เร็ว ฟรี แม่นยำ 100%
  ↓ ไม่แมตช์
[ชั้น 2] RAG + LLM (Thai)        ← ค้น FAQ/สินค้าของเพจนั้น แล้วให้ LLM เรียบเรียง
  ↓ confidence ต่ำ
[ชั้น 3] Escalate to Human       ← ส่ง LINE หาคุณ + ตอบ "รอสักครู่นะคะ กำลังตรวจสอบให้ค่ะ"
```

**ฟีเจอร์ที่ต้องมี:**
- **Flow Builder** แบบ visual (React Flow) — node: ส่งข้อความ / ถามคำถาม / ปุ่ม Quick Reply / เงื่อนไข / เก็บตัวแปร / ส่งต่อคน / เรียก webhook
- **Welcome Message + Ice Breakers** (คำถามยอดฮิต 4 ข้อที่โชว์ก่อนลูกค้าพิมพ์) ตั้งผ่าน Messenger Profile API
- **Persistent Menu** ต่อเพจ
- **Knowledge Base ต่อเพจ**: อัปโหลด PDF/ข้อความ/ราคาสินค้า → chunk → embed → pgvector → บอทตอบจากข้อมูลจริงเท่านั้น (ลด hallucination)
- **Tone Profile ต่อเพจ**: กำหนดสรรพนาม (ค่ะ/ครับ/จ้า), ระดับความสุภาพ, emoji มาก/น้อย → ใส่ใน system prompt
- **Human Handover Protocol**: บอทหยุดอัตโนมัติ 30 นาทีเมื่อคุณพิมพ์ตอบเอง (สำคัญมาก ไม่งั้นบอทจะแทรกกลางบทสนทนา)
- **Bot Kill Switch** ต่อเพจ — ปุ่มปิดบอทฉุกเฉิน 1 คลิก
- **Test Console** — ทดสอบ flow โดยไม่ต้องส่งจริง
- **ประกาศว่าเป็นบอท** ในข้อความแรก (Meta policy บังคับในหลายเขต ทำไว้เลยปลอดภัยกว่า)

---

### M3 — Comment Automation (โมดูลที่ทำเงินที่สุดในตลาดไทย)

- **Auto-hide**: คำหยาบ / เบอร์โทรคู่แข่ง / ลิงก์สแปม / คีย์เวิร์ดกำหนดเอง → `POST /{comment-id}` `is_hidden=true`
- **Auto-reply comment**: ตอบใต้คอมเมนต์อัตโนมัติตามคีย์เวิร์ด
- **Comment → Inbox (Private Reply)**: ลูกค้าพิมพ์ "สนใจ" / "ราคา" / "CF" ใต้โพสต์ → ระบบทักเข้า inbox อัตโนมัติ → เข้า flow ปิดการขาย
  - ⚠️ Private Reply ทำได้ **ครั้งเดียวต่อคอมเมนต์** และภายใน **7 วัน** — ต้องมีตาราง `comment_replies` กัน duplicate
- **Auto-like** คอมเมนต์เชิงบวก (เพิ่ม engagement ฟรี)
- **Blocklist ต่อเพจ** — user ที่กวนซ้ำๆ
- **Negative Sentiment Alert**: คอมเมนต์ด่า/ร้องเรียน → LINE แจ้งคุณภายใน 1 นาที (นี่คือสิ่งที่ลูกค้ายอมจ่ายแพง)

---

### M4 — Content Calendar & Publishing

- ปฏิทินรวม **ทุกเพจในจอเดียว** สีแยกตามลูกค้า (drag & drop เลื่อนเวลา)
- ประเภทที่รองรับ: ข้อความ / รูปเดี่ยว / อัลบั้ม / ลิงก์ / **Reels** / Story / วิดีโอ
- **ตั้งเวลาโพสต์**: ใช้ scheduler ของเราเอง (BullMQ delayed job) **ไม่ใช้** `scheduled_publish_time` ของ Meta → เพราะเราต้องแก้/ยกเลิก/ดู log ได้เอง
- **Cross-posting**: 1 คอนเทนต์ → เลือกหลายเพจ + ปรับข้อความรายเพจได้
- **Approval Queue**: ลูกค้ากดอนุมัติผ่าน Client Portal หรือ **ผ่าน LINE** (ปุ่ม อนุมัติ/แก้ไข) ← ต่อยอดจากระบบ LINE approval ที่คุณมีอยู่แล้ว
- **Retry + Dead-letter**: โพสต์ล้มเหลว → retry 3 ครั้ง (1m, 5m, 30m) → แจ้งเตือน
- **Duplicate Guard**: hash เนื้อหา + เช็คว่าเคยโพสต์ในเพจนี้ใน 90 วันหรือยัง (ต่อยอดจาก log ที่คุณทำไว้ในระบบ news)
- **Best Time to Post** — คำนวณจาก Insights ย้อนหลัง 90 วันของเพจนั้นเอง

---

### M5 — AI Content Studio (ตัวคูณความเร็วของงานคุณ)

- **Brand Brief ต่อเพจ**: กลุ่มเป้าหมาย, โทน, คำต้องห้าม, CTA ประจำ, สินค้า/บริการ
- **สร้างคอนเทนต์เป็นชุด**: ป้อนหัวข้อ 1 บรรทัด → ได้ 10 โพสต์พร้อมแคปชั่น + hashtag ไทย
- **Content Pillars**: ตั้งสัดส่วน เช่น ให้ความรู้ 40% / ขาย 30% / มีส่วนร่วม 20% / เบื้องหลัง 10% → ระบบสุ่มตามสัดส่วนเวลาสร้างปฏิทินทั้งเดือน
- **Recycle Engine**: โพสต์ที่ engagement สูงสุด → เขียนใหม่แล้วโพสต์ซ้ำหลัง 60 วัน
- **สร้างภาพประกอบ**: ต่อกับ pipeline ภาพที่คุณมี (Gemini/GPT Image) + เทมเพลตแบรนด์
- **Reels/วิดีโอสั้น**: ต่อกับ Remotion pipeline เดิม → render → อัปโหลดผ่าน Reels API
- **One-click เดือนเต็ม**: กดปุ่มเดียวได้ปฏิทิน 30 วันของเพจนั้น → คุณแค่รีวิว/แก้ (นี่คือฟีเจอร์ที่ทำให้คนเดียวดูแล 20 เพจได้)

---

### M6 — Lead & Simple CRM

- ทุกคนที่ทักเข้ามา = contact record (PSID, ชื่อ, รูป, เพจต้นทาง, tag, ประวัติ)
- **Lead Capture ใน flow**: ถามชื่อ-เบอร์-ที่อยู่ในบอท → เก็บลง DB → ส่งเข้า Google Sheet ของลูกค้าอัตโนมัติ
- **Order Capture (CF/สั่งซื้อ)**: บอทเก็บรายการ → สร้างสรุปยอด → แนบ QR PromptPay → ลูกค้าส่งสลิป → แจ้งเตือนแอดมิน (ใช้โค้ด PromptPay จาก ShopDash ซ้ำได้)
- Export CSV ให้ลูกค้าได้ทุกเมื่อ
- **ห้ามเก็บ**: เลขบัตรประชาชน, ข้อมูลสุขภาพ — และต้องมี **Data Deletion Callback endpoint** (Meta บังคับตอน App Review)

---

### M7 — Analytics & Client Reporting (ตัวรักษาลูกค้าไม่ให้เลิกจ้าง)

- Sync Insights รายวัน (cron 03:00) เก็บลง DB เอง → ทำให้ดูย้อนหลังได้ไม่จำกัด และไม่โดน rate limit ตอนเปิดหน้า
- เมตริกที่ใช้: **Page Viewer Metric / Media Views** (ของใหม่), followers, engagement, link clicks, ยอด inbox, เวลาตอบเฉลี่ย, อัตราบอทตอบเอง
- **Report อัตโนมัติรายเดือน**: สร้าง PDF แบรนด์คุณ → ส่งอีเมล/LINE ให้ลูกค้าทุกวันที่ 1 โดยไม่ต้องทำอะไร
  - หน้าที่ต้องมี: สรุปผู้บริหาร 1 หน้า / กราฟเทียบเดือนก่อน / 5 โพสต์ที่ดีที่สุด / สรุปงาน inbox / สิ่งที่จะทำเดือนหน้า
- **Bot Performance**: อัตราแก้ปัญหาได้เอง (containment rate), คำถามที่บอทตอบไม่ได้บ่อยสุด → ใช้ปรับ Knowledge Base
- **Competitor Watch**: ติดตามเพจคู่แข่ง 3 เพจ (public data) เทียบยอดโพสต์/engagement

---

### M8 — Ops Center (โมดูลที่ทำให้ "คนเดียวไหว")

- **Today View**: หน้าเดียวรวม — ต้องตอบกี่ข้อความ, ต้องอนุมัติกี่โพสต์, มีอะไรพัง, SLA ใกล้เกินที่ไหน
- **SLA Timer ต่อลูกค้า**: สัญญาไว้ตอบใน 1 ชม. → นับถอยหลัง + เตือนที่ 75%
- **Alert Center → LINE**: token หมดอายุ / webhook เงียบเกิน 30 นาที / โพสต์ล้มเหลว / คอมเมนต์ลบ / rate limit ใกล้เต็ม
- **Audit Log** ทุก action (ใครทำอะไร เมื่อไหร่ กับเพจไหน) — ป้องกันข้อพิพาทกับลูกค้า
- **Bulk Actions**: เปลี่ยนการตั้งค่าทีเดียวหลายเพจ
- **Template Library**: ก๊อป bot flow / calendar / moderation rules จากลูกค้าเก่าไปลูกค้าใหม่ในคลิกเดียว ← **ฟีเจอร์นี้คือตัวลดเวลา onboarding จาก 8 ชม. เหลือ 30 นาที**

---

### M9 — Client Portal (White-label)

- ลิงก์เฉพาะลูกค้า login ด้วย magic link (ไม่ต้องมีรหัสผ่าน)
- เห็น: ปฏิทินคอนเทนต์, กดอนุมัติ/ขอแก้, ดูรายงาน, ดูรายชื่อ lead
- ใส่โลโก้/สีของลูกค้าได้ + subdomain
- **ไม่ให้เห็น**: ต้นทุน, ลูกค้ารายอื่น, ค่า config บอท

---

### M10 — Billing (เปิดใช้ตอนขายเป็น SaaS เท่านั้น — เฟสสุดท้าย)

- Plan + quota (จำนวนเพจ / ข้อความบอท / โพสต์ต่อเดือน)
- PromptPay + สลิป (ตลาดไทย) → ต่อยอดจาก ShopDash
- Usage metering ต่อ workspace

---

## 3. Data Model (แกนหลัก)

```sql
workspaces        (id, name, client_name, brand_config, plan, sla_minutes)
pages             (id, workspace_id, fb_page_id, ig_user_id, name, category, timezone)
page_tokens       (page_id, encrypted_token, token_type, scopes[], expires_at, last_checked_at, status)
contacts          (id, page_id, psid, ig_id, name, avatar, tags[], first_seen, last_seen)
conversations     (id, page_id, contact_id, channel, status, window_expires_at,
                   bot_paused_until, assigned_to, sla_due_at, unread)
messages          (id, conversation_id, direction, sent_by, body, attachments,
                   mid, tag_used, delivery_status, created_at)
posts             (id, page_id, type, body, media[], scheduled_at, published_at,
                   fb_post_id, status, content_hash, approval_status, created_by)
post_targets      (post_id, page_id, override_body, fb_post_id, status)  -- cross-post
comments          (id, post_id, page_id, fb_comment_id, author_id, body,
                   sentiment, action_taken, private_replied_at)
bot_flows         (id, page_id, name, graph_json, is_active, version)
knowledge_docs    (id, page_id, title, source, chunk_text, embedding vector(768))
automation_rules  (id, page_id, trigger_type, pattern, action, priority, is_active)
leads             (id, page_id, contact_id, fields_json, status, exported_at)
insights_daily    (page_id, date, metric_key, value)   -- PK (page_id,date,metric_key)
jobs              (id, type, payload, run_at, attempts, last_error, status)
audit_logs        (id, workspace_id, actor, action, target, meta, created_at)
```

---

## 4. Stack ที่แนะนำ (คุ้มที่สุดกับของที่คุณมีอยู่แล้ว)

| ชั้น | เลือก | เหตุผล |
|---|---|---|
| Frontend | **Next.js 15 App Router + Tailwind + shadcn** | คุณใช้อยู่แล้ว, ทำ PWA ได้เลย |
| DB | **Postgres + pgvector** (Supabase หรือ self-host บน VPS) | ต้องใช้ vector สำหรับ RAG อยู่แล้ว ใช้ตัวเดียวจบ |
| Queue | **BullMQ + Redis** | จำเป็นมากสำหรับ scheduled post, rate limit, retry |
| Webhook Receiver | **Node service แยก (Fastify)** ทำงานตลอดเวลาบน VPS | ห้ามใช้ serverless อย่างเดียว — cold start ทำ webhook หลุด |
| Media | **Cloudflare R2** | คุณใช้อยู่ ค่า egress ฟรี |
| LLM | **Gemini Flash** เป็นหลัก + **Qwen บน VPS** เป็น fallback/งานถูก | คุมต้นทุนต่อข้อความให้ต่ำกว่า 0.05 บาท |
| Embedding | `text-embedding-004` หรือ bge-m3 (local) | รองรับไทยดี |
| Automation glue | **n8n** ที่มีอยู่แล้ว | ต่อ LINE approval / Google Sheet โดยไม่ต้องเขียนโค้ด |
| Deploy | **Hostinger KVM2 VPS + Coolify/Dokploy** | คุณมี VPS อยู่แล้ว ต้นทุนส่วนเพิ่ม ≈ 0 |
| Alert | **LINE Messaging API** | คุณอ่าน LINE อยู่แล้วทั้งวัน |

**ต้นทุนต่อเดือนโดยประมาณ:** VPS ที่มีอยู่ + LLM 300–1,000 บาท + โดเมน = **ต่ำกว่า 1,500 บาท/เดือน** รองรับได้ ~20–30 เพจ

---

## 5. Meta Gateway Layer (สเปกบังคับ)

โมดูลเดียวที่คุยกับ Meta ได้ ต้องมี:

```
metaGateway.call({ pageId, method, path, params, priority })
```

หน้าที่:
1. ดึง token ที่ถูกต้องจาก `page_tokens` + decrypt
2. ใส่ `GRAPH_VERSION` จาก env
3. **Token bucket ต่อเพจ** — เข้าคิวถ้าใกล้เต็ม
4. อ่าน `X-App-Usage` ทุก response → ถ้า > 80% ชะลออัตโนมัติ
5. Retry แบบ exponential backoff เฉพาะ error 4 / 32 / 80001 / 5xx
6. Map error → ข้อความไทยที่คุณเข้าใจ (`error 190` = token หมดอายุ → trigger reconnect flow)
7. Log ทุก call ลง DB (debug ตอนลูกค้าถามว่าทำไมโพสต์ไม่ขึ้น)

---

## 6. ปัญหาที่ต้องแก้ตั้งแต่ต้น (คนทำระบบแบบนี้พลาดกันหมด)

1. **Webhook ซ้ำ** — Meta ส่งซ้ำได้ → ใช้ `mid` เป็น unique key, ทำ idempotency
2. **Echo loop** — ข้อความที่เราส่งเองจะเด้งกลับมาเป็น webhook → เช็ค `message.is_echo` แล้วข้าม
3. **บอทแทรกตอนคนกำลังคุย** → `bot_paused_until` ต้องเซ็ตทุกครั้งที่คุณพิมพ์เอง
4. **โพสต์ผิดเพจ** → ต้องมี confirm dialog แสดงชื่อเพจตัวใหญ่ + สี ก่อน publish
5. **Token ของลูกค้าหลุดเงียบๆ** (ลูกค้าเปลี่ยนรหัส/ถอดสิทธิ์) → health check ทุก 6 ชม. เท่านั้นถึงจะจับได้ทัน
6. **เวลา** — เก็บ UTC ใน DB เสมอ แสดงผลตาม timezone ของเพจ
7. **ลูกค้าแอบเข้าไปตอบเองในแอป FB** → sync สองทาง อย่าถือว่า DB เราคือความจริงเสมอ

---

## 7. Roadmap (Milestone-gated — เผื่อ App Review ไปด้วย)

> กลยุทธ์สำคัญ: **เริ่มจากโมดูลที่ไม่ต้องรอ App Review** ระหว่างนั้นยื่นรีวิวขนานไป
> ตอน app อยู่ใน Development Mode คุณจัดการเพจที่ "คุณเป็นแอดมินเอง" ได้ (ให้ลูกค้าตั้งคุณเป็นแอดมินเพจ) แต่ **แชทบอทจะยังคุยกับลูกค้าจริงไม่ได้** จนกว่า app จะ Live + ผ่านรีวิว `pages_messaging` → นี่คือเหตุผลที่ต้องยื่นรีวิววันแรก

| Milestone | ขอบเขต | เกณฑ์ผ่าน | ประมาณเวลา |
|---|---|---|---|
| **M-A** | Meta Gateway + Auth + Token management + Connection page | เชื่อมเพจตัวเองได้ 3 เพจ token refresh อัตโนมัติ | 1 สัปดาห์ |
| — | **ยื่น App Review + Business Verification วันนี้** | ส่งเอกสาร + screencast ครบ | ขนานไป 4–8 สัปดาห์ |
| **M-B** | Content Calendar + Publishing + Retry + Duplicate guard | ตั้งเวลาโพสต์ 3 เพจพร้อมกัน สำเร็จ 100% ติดกัน 7 วัน | 1.5 สัปดาห์ |
| **M-C** | Comment Automation (hide/reply/private reply/alert) | รันบนเพจจริง 7 วัน ไม่มี false positive | 1 สัปดาห์ |
| **M-D** | Analytics sync + Monthly PDF report | ออกรายงานเดือนแรกอัตโนมัติได้ | 1 สัปดาห์ |
| **M-E** | Unified Inbox + Webhook realtime + SLA + LINE alert | ตอบข้ามเพจได้จากมือถือ, 24h timer แม่น | 2 สัปดาห์ |
| **M-F** | Chatbot 3 ชั้น + Flow Builder + RAG + Handover | containment rate > 50% บนเพจทดสอบ | 2.5 สัปดาห์ |
| **M-G** | AI Content Studio + Template Library | สร้างปฏิทิน 30 วันของเพจใหม่ได้ใน 10 นาที | 1.5 สัปดาห์ |
| **M-H** | Client Portal + Onboarding wizard | รับลูกค้าใหม่ end-to-end ใน 30 นาที | 1 สัปดาห์ |
| **M-I** | Ops Center + Audit + Bulk actions | ดูแล 10 เพจโดยใช้เวลา < 2 ชม./วัน | 1 สัปดาห์ |
| **M-J** | Billing + multi-user (เฉพาะถ้าจะขายเป็น SaaS) | — | ทีหลัง |

**รวมประมาณ 13–14 สัปดาห์** แต่ใช้งานหาเงินได้จริงตั้งแต่ M-D (สัปดาห์ที่ 5)

---

## 8. แพ็กเกจขายลูกค้า (ให้ระบบรองรับตั้งแต่ออกแบบ)

| | STARTER | GROWTH ⭐ | FULL |
|---|---|---|---|
| โพสต์/เดือน | 12 | 20 | 30 + Reels 4 |
| ตอบ inbox | บอทอย่างเดียว | บอท + คนตอบ 9–18 น. | บอท + คนตอบ 8–22 น. |
| SLA ตอบ | 4 ชม. | 1 ชม. | 30 นาที |
| ดูแลคอมเมนต์ | ✓ | ✓ | ✓ + alert เชิงลบทันที |
| แชทบอท | flow พื้นฐาน | flow + FAQ | flow + RAG + ปิดการขาย |
| รายงาน | รายเดือน | รายเดือน + คอลรีวิว | รายสัปดาห์ |
| ค่าโฆษณา | — | ดูแลได้ (คิดแยก) | ดูแลได้ |

**เซ็ตอัพครั้งแรก** คิดแยกเสมอ (ตั้งค่าเพจ + บอท + knowledge base) — งานหนักอยู่ตรงนี้

---

## 9. CLAUDE.md เริ่มต้น

```markdown
# PAGE OS

## หลักการที่ห้ามละเมิด
1. ทุก call ไป Meta ต้องผ่าน `lib/meta/gateway.ts` เท่านั้น
2. Graph version อ่านจาก env `GRAPH_VERSION` ห้าม hardcode
3. Token เก็บเข้ารหัสเสมอ ห้าม log token แม้บางส่วน
4. เวลาใน DB เป็น UTC เสมอ
5. ทุกงานที่เรียก external API ต้องผ่าน BullMQ ห้ามทำใน request handler
6. ทุก webhook ต้อง idempotent ด้วย mid/comment_id
7. บอทห้ามใช้ HUMAN_AGENT tag เด็ดขาด
8. ห้ามใช้ legacy message tags (ปลดระวางแล้ว เม.ย. 2026)

## โครงสร้าง
apps/web        Next.js 15 (dashboard + client portal)
apps/webhook    Fastify service รับ webhook
apps/worker     BullMQ workers
packages/meta   Gateway + types
packages/db     Prisma schema + migrations

## Milestone ปัจจุบัน
ดู STATUS.md
```

---

## 10. สิ่งที่ต้องเตรียมนอกโค้ด (ทำขนานกันวันนี้)

- [ ] Meta Business Manager + **Business Verification** (ใช้เอกสารจดทะเบียน/ภ.พ.20)
- [ ] สร้าง App ประเภท Business + ตั้ง Privacy Policy URL, Terms URL, **Data Deletion Callback URL**
- [ ] อัดวิดีโอ screencast สาธิตแต่ละ permission (เหตุผลอันดับ 1 ที่รีวิวไม่ผ่าน = วิดีโอไม่ชัด)
- [ ] อัปเดต trust store บน VPS ให้ trust Meta CA (webhook mTLS)
- [ ] เตรียมสัญญาบริการ + หนังสือมอบอำนาจให้เข้าถึงเพจ
- [ ] LINE Official Account + Messaging API สำหรับ alert
