# STATUS

อัปเดตล่าสุด: 2026-08-08

## Milestone ปัจจุบัน

M1 — Capture (TikTok) · ยังไม่เริ่ม

## เสร็จแล้ว

- [x] M0 skeleton (tag `m0`)
  - WXT 0.21 + React 18 + TypeScript strict + Tailwind v4 + Dexie 4 ต่อกันติด
  - side panel เปิดจากไอคอนได้ (`sidePanel.setPanelBehavior` ใน background)
  - MAIN world → ISOLATED → background ส่งข้อความถึงกันได้จริง (พิสูจน์ด้วย E2E)
  - manifest ตรงกับ CLAUDE.md ข้อ 9 เป๊ะ ไม่มี permission เกิน

### ผล gate M0

| เกณฑ์ | ผล |
|---|---|
| `pnpm build` ผ่าน | ✅ chrome-mv3 รวม 443 kB |
| `pnpm compile` (tsc strict, ไม่มี `any`) | ✅ |
| `pnpm test` (Vitest) | ✅ 13 tests |
| โหลด unpacked ใน Chrome ได้ | ✅ `pnpm e2e` โหลด `.output/chrome-mv3` จริง |
| ไม่มี error ใน console | ✅ ตรวจทั้ง sidepanel + options + หน้าที่มี content script |

## กำลังติด

- ยังไม่มี

## ทำต่อจากตรงนี้ (M1)

1. `entrypoints/tiktok-main.content.ts` — patch `window.fetch` + `XMLHttpRequest.prototype.open/send`
   ตอนนี้ยังไม่ patch อะไร แค่ประกาศว่าฉีดติด
2. `lib/adapters/tiktok.ts` — ตัวแปลง payload → `CapturedVideo` (ยังไม่มีไฟล์)
3. ปุ่ม "เก็บเข้าคลัง" ลอยบนคลิป + ฟอร์ม (ฮุกที่ได้ยิน / ประเภทฮุก / แท็ก / โน้ต)
4. เขียนลง Dexie ผ่าน background

## หมายเหตุ

### สิ่งที่ต่างจาก CLAUDE.md ข้อ 3 (เหตุผลเชิงเทคนิค ไม่ใช่การเปลี่ยน scope)

- **ชื่อไฟล์ MAIN world** — CLAUDE.md เขียนว่า `tiktok.main.ts` แต่ WXT บังคับให้ content script
  ลงท้าย `.content.ts` และตัดชื่อ entrypoint ที่จุดแรก (`tiktok.main.content.ts` จะชนกับ
  `tiktok.content.ts`) จึงใช้ **`tiktok-main.content.ts`** / **`instagram-main.content.ts`**
- **`worker/` ยังไม่สร้าง** — เป็นของ M6/M7 ตามกฎ "ทำทีละ milestone ห้ามข้าม"
- **`lib/outlier.ts`, `lib/license.ts`, `lib/adapters/{tiktok,instagram}.ts` ยังไม่มี** —
  เป็นของ M2 / M6 / M1 / M4 ตามลำดับ ไม่สร้าง stub เปล่าทิ้งไว้

### เวอร์ชันที่ต้อง pin ไว้แบบนี้

- **Vite 8** — `@vitejs/plugin-react@6` (ที่ `@wxt-dev/module-react` ดึงมา) ต้องการ `vite ^8`
  ถ้าถอยไป Vite 7 จะพังที่ `vite/internal`
- **Tailwind v4** ผ่าน `@tailwindcss/vite` — token ทั้งหมดอยู่ที่ `assets/tailwind.css` ที่เดียว
- **React 18** ตาม CLAUDE.md ข้อ 2 (ไม่ขึ้น React 19)

### ฟอนต์

bundle ผ่าน `@fontsource/*` เอาเฉพาะ subset ไทย+ละติน ไม่ดึงจาก Google Fonts CDN
เพราะห้ามยิง request ออกนอกเครื่อง (ข้อ 9)

### Permission

ยังเป็น `["storage", "sidePanel", "scripting"]` + 2 โดเมน เท่ากับข้อ 9 เป๊ะ **ยังไม่มีการเพิ่ม**

### E2E บนเครื่องอื่น

`e2e/fixtures.ts` จะหา Chromium จาก `PLAYWRIGHT_BROWSERS_PATH` ก่อน
ถ้าไม่เจอค่อยใช้ `channel: 'chromium'` ของ Playwright เอง (ต้อง `npx playwright install chromium`)
