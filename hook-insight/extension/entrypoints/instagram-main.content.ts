import { defineContentScript } from 'wxt/utils/define-content-script';
import { announceBridgeReady } from '@/lib/bridge';

/**
 * MAIN world — ดูคำอธิบายที่ tiktok-main.content.ts
 * ตัวจริงเริ่มที่ M4
 */
export default defineContentScript({
  matches: ['https://www.instagram.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    announceBridgeReady('instagram');
  },
});
