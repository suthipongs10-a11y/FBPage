# Hook Insight

Chrome Extension (MV3) ช่วยครีเอเตอร์คลิปสั้นเก็บและวิเคราะห์คลิปที่ใช้อ้างอิง
โดยคำนวณว่าคลิปหนึ่ง ๆ ทำผลงานได้ดีกว่าค่าเฉลี่ยของบัญชีนั้นเองมากแค่ไหน

> อ่าน [`CLAUDE.md`](./CLAUDE.md) + [`STATUS.md`](./STATUS.md) ก่อนเริ่มงานทุกครั้ง
> `CLAUDE.md` คือ single source of truth — ห้ามแก้ scope เอง

## เริ่มงาน

```bash
cd extension
pnpm install
pnpm dev          # โหลด Chrome พร้อม HMR
```

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `pnpm build` | build ไป `.output/chrome-mv3` |
| `pnpm compile` | ตรวจชนิดข้อมูล (tsc strict) |
| `pnpm test` | unit test (Vitest) |
| `pnpm e2e` | โหลดส่วนขยายจริงใน Chrome แล้วตรวจ gate (ต้อง `pnpm build` ก่อน) |
| `pnpm zip` | แพ็กไฟล์ส่งขึ้น store |
| `node scripts/make-icons.mjs` | สร้างไอคอนใหม่จากโค้ด |

## โหลด unpacked เอง

1. `pnpm build`
2. Chrome → `chrome://extensions` → เปิด Developer mode
3. Load unpacked → เลือก `extension/.output/chrome-mv3`

## โครงสร้าง

```
extension/
├── entrypoints/
│   ├── background.ts              service worker
│   ├── sidepanel/                 UI คลัง + แดชบอร์ด
│   ├── options/                   ตั้งค่า
│   ├── tiktok.content.ts          ISOLATED world
│   ├── tiktok-main.content.ts     MAIN world — ที่เดียวที่ patch fetch/XHR ได้
│   ├── instagram.content.ts
│   └── instagram-main.content.ts
├── lib/
│   ├── adapters/types.ts          สัญญา CapturedVideo
│   ├── bridge.ts                  สะพาน MAIN → ISOLATED → background
│   ├── db.ts                      Dexie schema
│   ├── messages.ts                type guard ของทุกข้อความ
│   ├── result.ts                  Result<T, E>
│   ├── log.ts                     logger ที่ปิดได้
│   └── ui/                        component ที่ใช้ร่วม
├── assets/tailwind.css            design tokens ที่เดียวของทั้งระบบ
└── e2e/                           gate test ที่โหลดส่วนขยายจริง
```

`worker/` (Cloudflare Workers + D1) จะมาตอน M6
