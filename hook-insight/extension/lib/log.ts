/**
 * Logger กลาง — ห้ามใช้ console.log ตรง ๆ ในโค้ด production (CLAUDE.md ข้อ 10)
 *
 * ค่าเริ่มต้น: เปิดตอน dev, ปิดตอน production build
 * เปิดชั่วคราวตอน debug ของจริงได้ด้วย setLogEnabled(true) จากหน้า options
 */

const PREFIX = '[hook-insight]';

let enabled: boolean = import.meta.env.DEV;

export function setLogEnabled(next: boolean): void {
  enabled = next;
}

export function isLogEnabled(): boolean {
  return enabled;
}

export const log = {
  debug(...args: unknown[]): void {
    if (enabled) console.debug(PREFIX, ...args);
  },
  info(...args: unknown[]): void {
    if (enabled) console.info(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    if (enabled) console.warn(PREFIX, ...args);
  },
  /** error โผล่เสมอ — ถ้าเงียบไว้จะ debug ของจริงไม่ได้ */
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};
