import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Hook Insight — MV3 extension
// permission ทั้งหมดต้องตรงกับ CLAUDE.md ข้อ 9 เป๊ะ ๆ
// จะเพิ่ม permission ใหม่ต้องเขียนเหตุผลลง STATUS.md ก่อนเสมอ
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'Hook Insight',
    // ประโยคนี้ต้องตรงกับ single purpose statement ใน CLAUDE.md ข้อ 1
    description:
      'เก็บและวิเคราะห์คลิปสั้นที่ใช้อ้างอิง โดยคำนวณว่าคลิปหนึ่ง ๆ ทำผลงานได้ดีกว่าค่าเฉลี่ยของบัญชีนั้นเองมากแค่ไหน',
    default_locale: undefined,
    permissions:
      browser === 'firefox'
        ? ['storage', 'scripting']
        : ['storage', 'sidePanel', 'scripting'],
    host_permissions: [
      'https://www.tiktok.com/*',
      'https://www.instagram.com/*',
    ],
    action: {
      default_title: 'Hook Insight — เปิดคลัง',
    },
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
