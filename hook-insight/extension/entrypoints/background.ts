import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { log } from '@/lib/log';
import {
  isRuntimeMessage,
  PROBE_STORAGE_KEY,
  type ProbeRecord,
  type RuntimeAck,
} from '@/lib/messages';

/**
 * Service worker ของ MV3 ตายได้ตลอดเวลา
 * ห้ามเก็บ state ในตัวแปร module-level — อ่าน/เขียน storage ทุกครั้ง (CLAUDE.md ข้อ 10)
 */

interface SidePanelApi {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
}

function getSidePanel(value: unknown): SidePanelApi | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = (value as { sidePanel?: unknown }).sidePanel;
  if (typeof candidate !== 'object' || candidate === null) return null;
  if (typeof (candidate as SidePanelApi).setPanelBehavior !== 'function') {
    return null;
  }
  return candidate as SidePanelApi;
}

async function rememberProbe(record: ProbeRecord): Promise<void> {
  try {
    await browser.storage.local.set({ [PROBE_STORAGE_KEY]: record });
  } catch (cause) {
    log.error('เขียน diagnostics ลง storage ไม่สำเร็จ', cause);
  }
}

export default defineBackground(() => {
  // คลิกไอคอนบนทูลบาร์ = เปิดแผงข้าง (Chrome/Edge)
  // Firefox ใช้ sidebar_action ซึ่งเปิดเองอยู่แล้ว จึงข้ามไป
  const sidePanel = getSidePanel(browser);
  if (sidePanel) {
    sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((cause: unknown) => {
        log.error('ตั้งค่าให้ไอคอนเปิดแผงข้างไม่สำเร็จ', cause);
      });
  }

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: RuntimeAck) => void) => {
      if (!isRuntimeMessage(message)) return false;

      log.info('probe จาก content script', message);
      void rememberProbe({
        platform: message.platform,
        bridgeReady: message.bridgeReady,
        url: message.url,
        at: message.at,
      }).then(() => {
        sendResponse({ received: true });
      });

      // บอก Chrome ว่าจะตอบแบบ async
      return true;
    },
  );

  log.info('background พร้อมทำงาน');
});
