/**
 * ไอคอนเมนู — วาดเป็น SVG ในไฟล์นี้เอง ไม่ดึงไลบรารีไอคอนมา
 *
 * ─── ทำไมไม่ใช้ lucide/heroicons ───
 *
 * เมนูมีเจ็ดอัน การลงไลบรารีไอคอนพันกว่าตัวเพื่อใช้เจ็ดตัว แลกมาด้วย
 * dependency ที่ต้องคอยอัปเดตและ bundle ที่โตขึ้นโดยไม่ได้อะไรกลับมา
 * — เหตุผลเดียวกับที่ `ui.tsx` ไม่ดึง shadcn มาทั้งชุด
 *
 * ทุกตัวใช้ `currentColor` เพื่อให้เปลี่ยนสีตามสถานะเมนู (active/ปกติ)
 * ได้โดยไม่ต้องส่ง prop สี และ `stroke-width` 1.75 เพราะ 2 หนาเกินไปที่ 18px
 */
import type { ReactElement } from "react";

/**
 * ชื่อไอคอน — **ส่งข้ามฝั่ง server → client ได้**
 *
 * ⚠️ ห้ามส่งตัว component ข้ามไป React ปฏิเสธฟังก์ชันที่ข้ามเส้น
 * server/client ("Functions cannot be passed directly to Client Components")
 * เพราะมันต้อง serialize props เป็น JSON — ฟังก์ชันแปลงเป็น JSON ไม่ได้
 *
 * ส่งเป็นสตริงแล้วให้ฝั่ง client เปิดตารางหาเอง จึงเป็นทางเดียวที่ใช้ได้
 */
export type NavIconKey =
  | "today"
  | "inbox"
  | "calendar"
  | "listening"
  | "ops"
  | "pages"
  | "settings";

function Svg({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** วันนี้ — เป้า สื่อว่า "จุดที่ต้องเล็ง" ไม่ใช่ปฏิทิน (ปฏิทินมีเมนูของตัวเอง) */
export const IconToday = (): ReactElement => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Svg>
);

export const IconInbox = (): ReactElement => (
  <Svg>
    <path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6" />
    <path d="M3 12h4l1.5 2.5h7L17 12h4" />
    <path d="m3 12 2.5-6.2A2 2 0 0 1 7.4 4.5h9.2a2 2 0 0 1 1.9 1.3L21 12" />
  </Svg>
);

export const IconCalendar = (): ReactElement => (
  <Svg>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

/** ฟังเสียง — คลื่นเสียง */
export const IconListening = (): ReactElement => (
  <Svg>
    <path d="M4 11v2M8 8v8M12 5v14M16 8v8M20 11v2" />
  </Svg>
);

/** ศูนย์ปฏิบัติการ — สไลเดอร์ปรับค่า */
export const IconOps = (): ReactElement => (
  <Svg>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);

export const IconPages = (): ReactElement => (
  <Svg>
    <rect x="3" y="4" width="8" height="7" rx="1.5" />
    <rect x="13" y="4" width="8" height="7" rx="1.5" />
    <rect x="3" y="13" width="8" height="7" rx="1.5" />
    <rect x="13" y="13" width="8" height="7" rx="1.5" />
  </Svg>
);

export const IconSettings = (): ReactElement => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
  </Svg>
);

/** ตารางชื่อ → ตัวไอคอน — ใช้ฝั่ง client เท่านั้น (ดูเหตุผลที่ `NavIconKey`) */
export const NAV_ICONS: Record<NavIconKey, () => ReactElement> = {
  today: IconToday,
  inbox: IconInbox,
  calendar: IconCalendar,
  listening: IconListening,
  ops: IconOps,
  pages: IconPages,
  settings: IconSettings,
};
