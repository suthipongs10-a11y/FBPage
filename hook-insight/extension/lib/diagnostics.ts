import { browser } from 'wxt/browser';
import { attempt, type Result } from './result';
import { PROBE_STORAGE_KEY, type ProbeRecord } from './messages';

/**
 * สถานะการเชื่อมต่อล่าสุดระหว่าง content script กับ background
 * เก็บใน chrome.storage.local เพราะ service worker ตายได้ตลอดเวลา (CLAUDE.md ข้อ 10)
 */

function isProbeRecord(value: unknown): value is ProbeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.platform === 'tiktok' || candidate.platform === 'instagram') &&
    typeof candidate.bridgeReady === 'boolean' &&
    typeof candidate.url === 'string' &&
    typeof candidate.at === 'number'
  );
}

export async function readLastProbe(): Promise<Result<ProbeRecord | null>> {
  return attempt(
    'diagnostics/read',
    'อ่านสถานะการเชื่อมต่อไม่ได้ — ลองเปิดแผงข้างใหม่อีกครั้ง',
    async () => {
      const stored = await browser.storage.local.get(PROBE_STORAGE_KEY);
      const value = stored[PROBE_STORAGE_KEY];
      return isProbeRecord(value) ? value : null;
    },
  );
}

/** ติดตามการเปลี่ยนแปลงแบบสด — คืนฟังก์ชันสำหรับเลิกติดตาม */
export function watchLastProbe(
  onChange: (probe: ProbeRecord | null) => void,
): () => void {
  const handle = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[PROBE_STORAGE_KEY];
    if (!change) return;
    onChange(isProbeRecord(change.newValue) ? change.newValue : null);
  };

  browser.storage.onChanged.addListener(handle);
  return () => browser.storage.onChanged.removeListener(handle);
}
