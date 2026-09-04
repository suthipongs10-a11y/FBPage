# ADR-001 — ย้ายจาก CLI + local dashboard ไปสู่สถาปัตยกรรมตาม AGENTS.md

สถานะ: **ยอมรับแล้ว** · วันที่: 2026-09-04 · อ้างอิง: AGENTS.md §3, §6, §7, §73, §75, §106

## บริบท

ก่อนหน้านี้โปรเจกต์เป็นเครื่องมือภายในแบบ zero-dependency:

| ของเดิม | ทำอะไร | สถานะ |
|---|---|---|
| `fb-pages.mjs` | CLI: check / sync / audit / show / apply / post / report | ทดสอบกับเพจจริงแล้ว |
| `lib/graph.mjs` | ตัวเชื่อม Graph API + ตรรกะ audit/report | ทดสอบแล้ว |
| `lib/ai.mjs` | เรียก AI 4 ค่ายผ่าน HTTP + ลูปเครื่องมือ | ทดสอบผ่าน mock |
| `lib/ads.mjs` | อ่าน Marketing API | ยังไม่ได้ทดสอบกับ token จริง |
| `make-card.mjs` | สร้างภาพ 1080×1080 จากเทมเพลต | ทดสอบแล้ว |
| `server.mjs` + `web/` | แดชบอร์ด PWA ผูก 127.0.0.1 | ทดสอบแล้ว |

AGENTS.md กำหนดผลิตภัณฑ์เป้าหมายเป็น **multi-tenant SaaS** (Next.js + NestJS + PostgreSQL + Redis/BullMQ + Docker)
ซึ่งเป็นการเปลี่ยนสถาปัตยกรรมขนาดใหญ่ — §75 กำหนดให้อธิบายเหตุผลเป็นเอกสารก่อน จึงมี ADR นี้

## การตัดสินใจ

1. **สร้าง monorepo ใหม่ตาม §7 ควบคู่กับของเดิม** ไม่ลบของเดิมทันที — CLI ยังใช้ทำงานลูกค้าจริงอยู่ระหว่างที่ระบบใหม่ยังไม่ครบ
2. **ย้ายตรรกะที่พิสูจน์แล้วเข้า packages ไม่ใช่เขียนใหม่จากศูนย์**

   | ของเดิม | ปลายทางใน monorepo | หมายเหตุ |
   |---|---|---|
   | `lib/graph.mjs` | `packages/facebook-core` | กลายเป็น `FacebookService` (§11) + metric adapter (§60) |
   | `lib/ai.mjs` | `packages/ai-providers` (adapter) + `packages/ai-core` (interface, router, logging) | โค้ดเฉพาะค่ายอยู่ใน adapter เท่านั้น (§4) |
   | `lib/ads.mjs` | `packages/facebook-core/marketing` | Phase 4 (§71) — พอร์ตทีหลัง |
   | `make-card.mjs` | `MediaService` ใน `apps/api/src/media` | §63 — เป็นหนึ่งใน provider ของ MediaService |
   | `server.mjs` เครื่องมือ AI 7 ตัว | `packages/tool-registry` | เพิ่ม `riskLevel` และ `ToolContext` (§43–44) |
   | `web/` | `apps/web` (Next.js) | เขียนใหม่ — ของเดิมเป็น vanilla JS ไม่มี i18n/RBAC |

3. **ลำดับการสร้างตาม §73/§106 อย่างเคร่งครัด** — Phase 1 นี้คือฐานระบบเท่านั้น (monorepo, Docker, DB, health, .env.example, docs) ยังไม่แตะ Facebook OAuth หรือ AI
4. **บทเรียนจากของเดิมที่ต้องฝังเข้าไปในระบบใหม่** (ได้มาจากการใช้งานจริง ไม่ใช่จากเอกสาร):
   - Graph ปฏิเสธ `likes.summary` / `comments.summary` ด้วยสิทธิ์ที่ยังไม่ผ่าน App Review → metric adapter ต้องเก็บค่าเป็น `null` ไม่ใช่ `0` และ UI ต้องแสดง "อ่านไม่ได้" (§40, §88)
   - `description` ของเพจรับ emoji ไม่ได้ (Facebook แปลงเป็น U+FFFD) → validation ใน content domain
   - ฟิลด์ `products` / `general_info` ตายแล้ว (code 100 / code 1) → ไม่ใส่ใน schema
   - เพจที่ token มีเฉพาะ `CREATE_CONTENT` ไม่มี `MANAGE` → แก้หมวดหมู่/@username ไม่ได้ ต้องเก็บ `tasks` ต่อเพจและแสดงในหน้าเชื่อมต่อ (§13)
   - โพสต์รูปหลายใบ = อัปโหลด `published=false` แล้วแนบด้วย `attached_media` → เป็น `createPhotoPost` ใน FacebookService
   - Chromium headless + ฟอนต์ Loma สร้างภาพต้นฉบับได้ใน ~570 ms → MediaService provider ตัวแรก ไม่ต้องพึ่ง vendor ภายนอก

## ผลที่ตามมา

- ระยะสั้นมีโค้ด 2 ชุด (เก่า/ใหม่) — ยอมรับได้ เพราะของเก่าเป็น zero-dependency ไม่มีค่าบำรุงรักษา และจะถูกถอดออกเมื่อ Milestone 1 (§100) ผ่าน
- ต้องมี Postgres + Redis จึงจะรัน API ได้ — เพิ่มความซับซ้อนของการติดตั้ง แต่จำเป็นต่อ multi-tenant, queue, audit log (§46, §49)
- Docker daemon ไม่มีในสภาพแวดล้อมพัฒนาปัจจุบัน → ทดสอบด้วย PostgreSQL 16 / Redis 7 ที่ติดตั้งในเครื่องแทน; `docker-compose.yml` เขียนไว้สำหรับ VPS แต่ยังไม่ได้รันจริงจนกว่าจะ deploy

## เวอร์ชันที่ตรึงไว้ (ตรวจจาก registry วันที่ตัดสินใจ)

TypeScript 5.x (ไม่ใช้ 7.x เพราะ NestJS พึ่ง decorator metadata emit ของ tsc เดิม) · NestJS 12 · Next.js 16 · React 19 · Prisma 7 · BullMQ 6 · Zod 4 · Vitest 5
