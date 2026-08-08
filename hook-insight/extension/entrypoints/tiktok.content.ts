import { defineContentScript } from 'wxt/utils/define-content-script';
import { listenForBridge, sendProbe } from '@/lib/bridge';

/**
 * ISOLATED world — ฝั่งที่คุยกับ background ได้
 * M0: แค่พิสูจน์ว่า MAIN → ISOLATED → background ต่อกันติด
 * M1: จะรับ payload ที่ MAIN ดักได้ แล้วส่งต่อให้ adapter normalize
 */
export default defineContentScript({
  matches: ['https://www.tiktok.com/*'],
  runAt: 'document_start',
  main() {
    listenForBridge('tiktok', () => {
      void sendProbe('tiktok', true);
    });
    void sendProbe('tiktok', false);
  },
});
