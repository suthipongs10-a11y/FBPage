import { browser } from 'wxt/browser';
import type { Platform } from './adapters/types';
import { log } from './log';
import {
  BRIDGE_SOURCE,
  isBridgeMessage,
  type BridgeReadyMessage,
  type ProbeMessage,
} from './messages';

/**
 * สะพาน MAIN world → ISOLATED → background
 * ไฟล์นี้ต้องไม่รู้จักชื่อแพลตฟอร์มใด ๆ — รับ platform เป็นพารามิเตอร์เท่านั้น
 * (CLAUDE.md ข้อ 7 · M4 gate)
 */

/** เรียกจาก MAIN world เท่านั้น */
export function announceBridgeReady(platform: Platform): void {
  const message: BridgeReadyMessage = {
    source: BRIDGE_SOURCE,
    kind: 'bridge-ready',
    platform,
  };
  const send = (): void => {
    window.postMessage(message, window.location.origin);
  };

  send();
  // ISOLATED กับ MAIN ถูกฉีดที่ document_start เหมือนกัน แต่ Chrome ไม่รับประกันลำดับ
  // ถ้า MAIN มาก่อน ข้อความแรกจะตกหาย จึงประกาศซ้ำอีกครั้งตอน DOM พร้อม
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', send, { once: true });
  }
}

/** เรียกจาก ISOLATED content script เท่านั้น */
export function listenForBridge(
  platform: Platform,
  onReady: () => void,
): () => void {
  const handle = (event: MessageEvent<unknown>): void => {
    // รับเฉพาะข้อความที่หน้าต่างนี้ส่งหาตัวเอง ไม่รับจาก iframe หรือโดเมนอื่น
    if (event.source !== window) return;
    if (!isBridgeMessage(event.data)) return;
    if (event.data.platform !== platform) return;
    onReady();
  };

  window.addEventListener('message', handle);
  return () => window.removeEventListener('message', handle);
}

/** ISOLATED → background */
export async function sendProbe(
  platform: Platform,
  bridgeReady: boolean,
): Promise<void> {
  const message: ProbeMessage = {
    type: 'probe',
    platform,
    bridgeReady,
    url: window.location.href,
    at: Date.now(),
  };
  try {
    await browser.runtime.sendMessage(message);
  } catch (cause) {
    // background หลับอยู่หรือส่วนขยายเพิ่งรีโหลด — ไม่ใช่เรื่องคอขาดบาดตาย
    log.warn('ส่ง probe ไป background ไม่สำเร็จ', cause);
  }
}
