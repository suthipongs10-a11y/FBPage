import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PAGE OS",
  description: "ระบบดูแลเพจ Facebook สำหรับคนเดียวที่ดูแลหลายเพจ",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#191b22" },
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
  ],
};

/**
 * สคริปต์ที่ต้องรันก่อนหน้าจอวาด
 *
 * ถ้ารอ React hydrate ก่อนค่อยใส่ธีม คนที่เลือกโหมดสว่างไว้จะเห็นจอมืดวาบ
 * หนึ่งเฟรมก่อนเปลี่ยน ("flash of wrong theme") ซึ่งแสบตากว่าที่คิดตอนเปิดตอนเช้า
 */
const THEME_BOOTSTRAP = `
try {
  var t = localStorage.getItem('page-os-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

/**
 * layout รากมีแค่โครง html เท่านั้น
 *
 * เพราะใต้รากมีสองโลกที่หน้าตาต้องไม่เหมือนกันเลย:
 *   (ops)/    หอบังคับการของเรา — มืด แน่น มีเมนูข้าง
 *   portal/   หน้าลูกค้า — สว่าง เรียบ เป็นแบรนด์ของลูกค้า ไม่มีร่องรอยของเรา
 *
 * ถ้าเอาเมนูข้างมาไว้ที่รากเมื่อไหร่ ลูกค้าจะเห็นชื่อลูกค้ารายอื่นในแถบข้าง
 * ซึ่งเป็นสิ่งที่สเปกข้อ M9 ห้ามไว้ตรงๆ
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
