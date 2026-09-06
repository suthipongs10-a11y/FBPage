# fb-page-ops — จัดการข้อมูลเพจ Facebook ของลูกค้า

> **คู่มือหลักของโปรเจกต์คือ [`AGENTS.md`](AGENTS.md)** — อ่านทั้งไฟล์ก่อนแก้โค้ด production
> การเปลี่ยนผ่านจากเครื่องมือชุดเดิม (ด้านล่าง) ไปสู่สถาปัตยกรรม SaaS อยู่ใน [`docs/architecture/ADR-001`](docs/architecture/ADR-001-migration-to-agents-md-stack.md)
>
> **ระบบใหม่ (monorepo — Phase 1 เสร็จแล้ว)**
> ```
> pnpm install && pnpm db:migrate && pnpm build
> pnpm typecheck && pnpm lint && pnpm test          # Definition of Done §76
> pnpm dev:api (:4000 /health /docs) · pnpm dev:web (:3000) · pnpm dev:worker
> node test/phase1-smoke.mjs && node test/phase2-smoke.mjs   # ต้องเปิด api/web/postgres/redis ก่อน
> node test/phase3-smoke.mjs                        # เชื่อมเพจจริงแบบอ่านอย่างเดียว (ใช้ USER_TOKEN จาก env ไม่พิมพ์ออกจอ)
> ```
> ไฟล์ตัวอย่างค่าตั้งชื่อ `env.example` (ไม่มีจุดนำหน้า เพราะเครื่องมือในทีมห้ามแตะ `.env*`) — `cp env.example .env`
> ทำแล้ว: Phase 1 ฐานระบบ · Phase 2 Auth + Workspace/tenant + RBAC + Client/Brand/Knowledge + audit · Phase 3–4 เชื่อมเพจ (วาง token หรือ OAuth) + ซิงก์โพสต์/metric (`packages/facebook-core`, `apps/api/src/facebook`)
> Phase 5 AI Gateway (`packages/ai-core`, `apps/api/src/ai`): BYOK key, บทบาท→โมเดล, งบ, AiTaskLog, tool registry, Analyst, Command Center
> Phase 6 Content loop (`apps/api/src/content`, `packages/facebook-core/publisher.ts`, `workers/scheduler`): state machine, approval, schedule (BullMQ), publish กันซ้ำ, Strategist/Content/Reviewer agents — §100 ครบ
> Phase 7 Reports (`apps/api/src/reports`) + Media service (`apps/api/src/media` — การ์ดภาพ Chromium, MEDIA_DIR) + Overview §36
> Phase 8 Comments/Leads (`apps/api/src/comments`) + Notifications (`notifications`, helper ใน `@fbpm/database/notify`) + Webhook (`facebook/webhook.controller.ts`) + Invite/Reset links (`auth/invites.service.ts`)
> คอมเมนต์ต้องมีสิทธิ์ pages_read_user_content/pages_manage_engagement — ไม่มีจะขึ้น NO_PERMISSION (ทดสอบผ่าน mock เท่านั้น)
> Phase 9 YouTube module (`packages/youtube-core`, `apps/api/src/youtube`, worker คิว `youtube-*`, หน้า `/youtube/*`) ตาม `AGENTS_YOUTUBE.md` — Google OAuth/API key, progressive sync (quota-aware), Analyst/Topic/Script/Title/Thumb/SEO/Reviewer/Comment agents, Content Lab บน ContentItem เดียวกัน (platform=YOUTUBE), อนุมัติ → resumable upload idempotent, comments→leads→clusters→ideas, repurpose→Facebook, YouTubeReport
> YOUTUBE_MOCK_BASE_URL=http://127.0.0.1:4997 GOOGLE_CLIENT_ID=gclient GOOGLE_CLIENT_SECRET=gsecret GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:4000/youtube/oauth/callback YOUTUBE_API_KEY=APIKEY_OK YOUTUBE_UPLOAD_ENABLED=true pnpm dev:api  แล้ว  node test/phase9-smoke.mjs   # YouTube กับ mock (ไม่แตะช่องจริง)
> กฎ YouTube เพิ่มเติม: ห้าม import googleapis SDK ในโค้ดธุรกิจ (ผ่าน `@fbpm/youtube-core` เท่านั้น) · ทุกคำขอต้องบันทึก quota · ใช้ uploads playlist ไม่ใช้ search.list · ฟิลด์นโยบาย (madeForKids/syntheticMedia/paidPlacement) AI ห้ามตัดสิน · ห้ามอัปโหลด/แก้ metadata จริงโดยไม่ผ่านอนุมัติ · CI/test ห้ามยิงช่องจริง ใช้ `startMockYouTube()`
> Phase 10 Website Care W-1/W-2 (`packages/web-core`, `apps/api/src/web`, worker คิว `web-*`, หน้า `/web`) ตาม `AGENTS_WEB.md` — uptime/SSL/SEO/ลิงก์/PageSpeed + Search Console + SEO Analyst · กฎ: ตรวจสุภาพ (UA ระบุตัว, ≤ 1 คำขอ/วิ, เคารพ robots), กัน SSRF (ห้าม IP ภายในเว้น `WEB_ALLOW_PRIVATE_TARGETS` ใน test), ห้ามแก้เว็บลูกค้า, ค่าที่อ่านไม่ได้ = null/SKIPPED, test ใช้ `startMockWeb()`
> node test/phase5-smoke.mjs                        # AI gateway ผ่าน proxy กับ mock AI (ไม่ใช้ key จริง)
> META_GRAPH_BASE_URL=http://127.0.0.1:4998 pnpm dev:api  แล้ว  node test/phase6-smoke.mjs   # content loop กับ mock Graph (ไม่แตะเพจจริง)
> worker ต้องมี AUTH_SECRET เดียวกับ API (ถอดรหัส page token) — `pnpm dev:worker` · worker มีงาน maintenance (cleanup รายวัน / ตรวจ token / upload ค้าง) ใน `workers/scheduler/src/maintenance.ts` — ห้ามเพิ่มการลบ AuditLog/metric snapshot/report
> CI: `.github/workflows/ci.yml` รัน DoD ทั้งหมดกับ mock — ห้ามใส่ key จริงเป็น secret ของ CI · E2E: `pnpm test:e2e` (Playwright ใช้ Chromium ที่มีอยู่ `/opt/pw-browsers/chromium`)
> ธีม UI สว่าง กำหนดที่ `apps/web/app/globals.css` (`@theme` กลับสเกล slate) — โค้ดหน้าใช้คลาส slate/sky เดิม ห้ามฮาร์ดโค้ดสี hex ในหน้า ยกเว้นกราฟ (`components/charts.tsx` สีตรวจผ่าน validator แล้ว) · เจ้าของระบบดู `docs/runbooks/go-live-checklist.md`
> อีเมล: `SMTP_*` ใน env — โค้ดส่งเมลผ่าน `@fbpm/database/mail` เท่านั้น test ใช้ `startMockSmtp()` ห้ามส่งอีเมลจริง · ลิงก์แชร์รายงาน `/share/r/<token>` เป็นสาธารณะ ต้องไม่ใส่ข้อมูลภายใน/token ใน payload
> กฎที่ต้องรักษาในระบบใหม่: token/API key เข้ารหัสด้วย `common/crypto.ts` เท่านั้น ห้ามอยู่ใน select/response/audit · metric ที่อ่านไม่ได้ = `null` ห้ามแปลงเป็น 0 · test ห้ามยิงเพจจริง/AI จริง ใช้ `startMockGraph()` / `startMockAi()` · โค้ดเรียก AI ต้องผ่าน `AiGatewayService` เท่านั้น (ห้าม import SDK ผู้ให้บริการ)
>
> ---
> **เครื่องมือชุดเดิม (ยังใช้ทำงานลูกค้าได้ระหว่างเปลี่ยนผ่าน):**

โปรเจกต์นี้ใช้ `fb-pages.mjs` (Node 18+, ไม่มี dependency) คุยกับ Meta Pages API
เพจทั้งหมดเป็นของลูกค้าที่เชิญเราเป็นแอดมิน — token ที่ใช้คือของบัญชีเรา

## ไฟล์
- `fb-pages.mjs` — สคริปต์หลัก (ห้ามแก้ logic การส่ง token)
- `pages.json` — รายชื่อเพจ + Page token (สร้างโดย `sync` หรือสร้างอัตโนมัติเมื่อไม่มีไฟล์ เช่นใน cloud session ใหม่) **ห้ามเปิดอ่าน/แสดงเนื้อหา**
- `setup/<page-id>.json` — ไฟล์ข้อมูลที่จะอัปเดตต่อเพจ (ดูรูปแบบใน `setup-example.json`)
- `.env` (ถ้ามี) — เก็บ USER_TOKEN **ห้ามเปิดอ่าน**

## ข้อกำหนดของ environment
- token อ่านจาก env `USER_TOKEN` หรือ `FB_USER_TOKEN` (ชื่อไหนก็ได้) หรือไฟล์ `.env`
- Graph version ตั้งผ่าน `API_VERSION` หรือ `GRAPH_VERSION` (ไม่ใส่ = v26.0)
- **ต้องเพิ่ม `graph.facebook.com` ใน network egress allowlist ของ environment** ไม่งั้นทุกคำสั่งจะได้ HTTP 403 จาก proxy
- env var ถูก inject ตอน container เริ่ม → เพิ่มตัวแปรใหม่แล้วต้องเปิด session ใหม่ถึงจะเห็น
- สิทธิ์ที่ token ต้องมี: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`

## คำสั่ง
```
node fb-pages.mjs check                             ตรวจว่าเจอ token ไหม + ใช้งานได้ไหม + เห็นกี่เพจ
node fb-pages.mjs sync                              ดึงเพจทั้งหมด → pages.json (รันเมื่อมีลูกค้าใหม่)
node fb-pages.mjs audit                             ตรวจทุกเพจว่าขาดข้อมูลอะไร (% ครบ)
node fb-pages.mjs show <page-id>                    ดูข้อมูลปัจจุบันของเพจ
node fb-pages.mjs apply <page-id> setup/<page-id>.json --dry   ดู payload ก่อน
node fb-pages.mjs apply <page-id> setup/<page-id>.json         อัปเดตจริง
node fb-pages.mjs post <page-id> post/<file>.json --dry        ดูข้อความ+รูปก่อนโพสต์
node fb-pages.mjs post <page-id> post/<file>.json              โพสต์จริง
node fb-pages.mjs report <page-id> [--days 30] [--json]        สรุปผลรายเพจ
node make-card.mjs <template> card/<file>.json out.png         สร้างภาพจากเทมเพลต
node server.mjs                                               เปิดแดชบอร์ด (PWA) ที่ http://127.0.0.1:8787
```

## แดชบอร์ด (server.mjs + web/)
- `server.mjs` ผูกกับ 127.0.0.1 เท่านั้น · ทุก `/api` ต้องมี header `x-app-token` ที่สุ่มใหม่ทุกครั้งที่เปิด
- token เพจ / API key ของ AI / token โฆษณา อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น **ไม่เคยส่งไปหน้าเว็บ** (มี test ตรวจว่าไม่หลุด)
- `config.json` เก็บ AI key + token โฆษณา (อยู่ใน .gitignore, chmod 600) — **ห้ามเปิดอ่าน/commit**
- `lib/graph.mjs` แยกจาก `fb-pages.mjs` เพื่อไม่แตะ CLI ที่ทดสอบแล้ว (logic ซ้ำกันเล็กน้อยโดยตั้งใจ)
- `lib/ai.mjs` เรียก AI ผ่าน HTTP ล้วน รองรับ anthropic / openai / gemini / compatible (Groq, OpenRouter, Ollama ฯลฯ)
- AI มีเครื่องมืออ่านข้อมูลเต็มที่ แต่ **โพสต์จริงไม่ได้** — ใช้ `prepare_post` แล้วผู้ใช้ต้องกดยืนยันในหน้าเว็บ
- ข้อมูลโฆษณาใช้ Marketing API ต้องมี token ที่มี `ads_read` (token เพจปกติไม่มี) ตั้งในหน้าตั้งค่า
- ทดสอบ: `node test/smoke.mjs` และ `node test/mock-ai.mjs` + `node test/smoke-ai.mjs` (ต้องเปิด server ก่อน) — เช็ค auth, token ไม่หลุด, traversal, dry run, card, ลูป AI
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
- **ห้าม** `apply` หรือ `post` จริงโดยไม่ผ่าน `--dry` และการยืนยันจากผู้ใช้ก่อน
- **ห้าม** โพสต์เนื้อหา/รูปที่คัดลอกมาจากเพจอื่นโดยไม่ได้รับอนุญาต
- **ห้าม** commit `.env`, `pages.json`, `config.json`, `.claude/settings.local.json`
- ถ้าเจอ error เกี่ยวกับ token หมดอายุ/ไม่มีสิทธิ์ → บอกผู้ใช้ให้ generate + extend token ใหม่แล้วอัปเดต USER_TOKEN ห้ามพยายามแก้เอง

## รูปแบบข้อมูลใน setup json
- `about` ≤ 255 ตัวอักษร — ข้อความสั้นใต้ชื่อเพจ ใส่จุดขายหลัก + ช่องทางติดต่อ
- `description` — รายละเอียดยาว: ขายอะไร จุดเด่น การจัดส่ง/บริการ การรับประกัน
- `phone` รูปแบบ `+66812345678`
- `emails` เป็น array เช่น `["a@b.com"]`
- `price_range` ใช้ได้เฉพาะ `"$"`, `"$$"`, `"$$$"`, `"$$$$"`
- `hours` ใช้คีย์ `<day>_<n>_open` / `<day>_<n>_close` (day = mon..sun, n = 1 หรือ 2) เวลา `HH:MM` 24 ชม. วันที่ปิดไม่ต้องใส่
- ฟิลด์เสริม: `founded`
- **`products`, `general_info` ใช้ไม่ได้แล้ว** — Graph API ตอบ error (code 100 / code 1) ให้ยัดเนื้อหาไว้ใน `description` แทน
- **ห้ามใส่ emoji ใน `description`** — Facebook แปลงเป็น `\uFFFD` ใช้ `[ หัวข้อ ]` กับ `•` แทน (emoji ในโพสต์ใช้ได้ปกติ)

## รูปแบบข้อมูลใน post json
- `message` — ข้อความโพสต์ ใส่ emoji ได้
- `link` — ลิงก์แนบ (ถ้ามี photos ด้วย Facebook จะไม่แสดงการ์ดลิงก์)
- `photos` — array ของ path ไฟล์ในเครื่อง หรือ URL รูป สูงสุด 10 ใบ
- `scheduled_publish_time` — เช่น `"2026-09-05T10:00:00+07:00"` ต้องล่วงหน้า 10 นาที–75 วัน
- ต้องมีอย่างน้อย 1 อย่างใน `message` / `link` / `photos`
- ต้องมีสิทธิ์ `CREATE_CONTENT` บนเพจนั้น (ดูจาก `check`)

## รูปแบบข้อมูลใน card json (ภาพประกอบ)
เทมเพลต: `quote` (ข้อความเด่น) · `stat` (เปรียบเทียบก่อน→หลัง) · `tips` (รายการมีเลข) · `hero` (หัวเรื่อง+ภาพ SVG)
ธีม: `fadaeng` · `phuketmaids` · `rabiangboon` · `dark` · `default` (ใส่ใน json ที่คีย์ `theme` หรือ `--theme`)
- ทุกเทมเพลตรับ `kicker`, `footer`, `brand`
- ในข้อความใช้ `\n` ขึ้นบรรทัดใหม่ และ `*ข้อความ*` เพื่อเน้นเป็นสีหลักของธีม
- ภาพออกมาขนาด 1080x1080 · `tips` ย่อขนาดอัตโนมัติตามจำนวนข้อ
- ดูตัวอย่างที่ `card/demo-*.json`

## ข้อจำกัดของ report
- อ่านได้: คะแนนความสมบูรณ์ของข้อมูลเพจ, ผู้ติดตาม, จำนวนโพสต์, ยอดแชร์
- **อ่านไม่ได้**: ยอดถูกใจ/ความคิดเห็นรายโพสต์ (Graph ปฏิเสธ `likes.summary`/`comments.summary`
  ด้วยสิทธิ์ปัจจุบัน) และตัวเลขการเข้าถึง (ต้องมี `read_insights`)
- รายงานจะขึ้นว่า "อ่านไม่ได้" ไม่ใช่เลข 0 — **ห้ามแก้ให้แสดง 0** เพราะทำให้รายงานหลอกตา
- ค่าโฆษณาไม่ได้อยู่ในคำสั่งนี้ ดูแยกจาก Ads Manager
