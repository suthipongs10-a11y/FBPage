import { defineContentScript } from 'wxt/utils/define-content-script';
import { listenForBridge, sendProbe } from '@/lib/bridge';

/**
 * ISOLATED world — ดูคำอธิบายที่ tiktok.content.ts
 * ตัวจริงเริ่มที่ M4 ตอนนี้มีไว้พิสูจน์ว่า pipeline ต่อกันติดทั้งสองแพลตฟอร์ม
 */
export default defineContentScript({
  matches: ['https://www.instagram.com/*'],
  runAt: 'document_start',
  main() {
    listenForBridge('instagram', () => {
      void sendProbe('instagram', true);
    });
    void sendProbe('instagram', false);
  },
});
