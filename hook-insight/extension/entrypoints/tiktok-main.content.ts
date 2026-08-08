import { defineContentScript } from 'wxt/utils/define-content-script';
import { announceBridgeReady } from '@/lib/bridge';

/**
 * MAIN world — อยู่ใน context เดียวกับหน้าเว็บ (Chrome 111+)
 * ที่นี่คือที่เดียวที่จะ patch window.fetch / XMLHttpRequest ได้ (CLAUDE.md ข้อ 4)
 *
 * M0: ยังไม่ patch อะไร แค่ประกาศว่าฉีดติดแล้ว
 * M1: จะ patch fetch + XHR แล้ว postMessage payload ที่ตรง pattern ออกไป
 *
 * ห้ามยิง request เองเพื่อดึงข้อมูลเพิ่มเด็ดขาด — ใช้เฉพาะที่หน้าเว็บโหลดมาแล้ว
 *
 * ชื่อไฟล์: WXT บังคับให้ content script ลงท้าย .content.ts และห้ามชื่อชนกัน
 * (ตัดที่จุดแรก) จึงเป็น tiktok-main.content.ts แทน tiktok.main.ts ใน CLAUDE.md ข้อ 3
 */
export default defineContentScript({
  matches: ['https://www.tiktok.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    announceBridgeReady('tiktok');
  },
});
