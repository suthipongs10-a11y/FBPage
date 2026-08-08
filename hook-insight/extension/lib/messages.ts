import type { Platform } from './adapters/types';

/**
 * สัญญาการส่งข้อความระหว่าง 3 ชั้น (CLAUDE.md ข้อ 4)
 *
 *   MAIN world  --window.postMessage-->  ISOLATED content script
 *   ISOLATED    --runtime.sendMessage->  background
 *
 * ทุก message ต้องผ่าน type guard ในไฟล์นี้ก่อนใช้ ห้าม cast ตรง ๆ
 */

/** marker ของช่อง MAIN → ISOLATED ตามที่กำหนดไว้ใน CLAUDE.md ข้อ 4 */
export const BRIDGE_SOURCE = 'hi' as const;

/** MAIN world บอกว่าฉีดสำเร็จแล้ว — ใช้ยืนยัน pipeline ตั้งแต่ M0 */
export interface BridgeReadyMessage {
  source: typeof BRIDGE_SOURCE;
  kind: 'bridge-ready';
  platform: Platform;
}

export type BridgeMessage = BridgeReadyMessage;

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  if (candidate.source !== BRIDGE_SOURCE) return false;
  return candidate.kind === 'bridge-ready';
}

/** ISOLATED → background */
export interface ProbeMessage {
  type: 'probe';
  platform: Platform;
  /** MAIN world ฉีดติดหรือไม่ */
  bridgeReady: boolean;
  url: string;
  at: number;
}

export type RuntimeMessage = ProbeMessage;

export function isRuntimeMessage(data: unknown): data is RuntimeMessage {
  if (typeof data !== 'object' || data === null) return false;
  return (data as Record<string, unknown>).type === 'probe';
}

export interface RuntimeAck {
  received: true;
}

/** บันทึกสถานะล่าสุดของ content script ไว้ใน chrome.storage.local */
export const PROBE_STORAGE_KEY = 'diagnostics:lastProbe';

export interface ProbeRecord {
  platform: Platform;
  bridgeReady: boolean;
  url: string;
  at: number;
}
