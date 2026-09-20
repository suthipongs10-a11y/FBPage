/** Chromium helper ใช้ร่วมกันระหว่าง media (การ์ดภาพ) และ reports (PDF) — หา binary/ฟอนต์ไทย + รันแบบ headless */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
export const CHROME_CANDIDATES = ['/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
export const FONT_DIR_CANDIDATES = ['/usr/share/fonts/opentype/tlwg', '/usr/share/fonts/truetype/tlwg'];

export function findChrome(preferred?: string): string | null {
  const windows = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((p): p is string => !!p).flatMap(p => [join(p, 'Google/Chrome/Application/chrome.exe'), join(p, 'Microsoft/Edge/Application/msedge.exe')]);
  return [preferred, ...CHROME_CANDIDATES, ...windows].find(p => p && existsSync(p)) ?? null;
}
export function findThaiFonts(): { regular: string; bold: string } {
  const dir = FONT_DIR_CANDIDATES.find(d => existsSync(join(d, 'Loma.otf')) || existsSync(join(d, 'Loma.ttf')));
  if (!dir) return { regular: '', bold: '' };   // ใช้ฟอนต์ระบบ
  const ext = existsSync(join(dir, 'Loma.otf')) ? 'otf' : 'ttf';
  return { regular: `file://${join(dir, `Loma.${ext}`)}`, bold: `file://${join(dir, `Loma-Bold.${ext}`)}` };
}
/** @font-face สำหรับฝังในหน้า HTML ที่จะเรนเดอร์ */
export function fontFaceCss(f = findThaiFonts()): string {
  if (!f.regular) return '';
  return `@font-face{font-family:'Loma';src:url('${f.regular}');font-weight:400}@font-face{font-family:'Loma';src:url('${f.bold}');font-weight:700}`;
}
export async function chromeScreenshot(chrome: string, html: string, out: string, size: number): Promise<void> {
  await render(chrome, html, ['--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size},${size}`, `--screenshot=${out}`], 60_000);
}
export async function chromePdf(chrome: string, html: string, out: string): Promise<void> {
  await render(chrome, html, ['--no-pdf-header-footer', `--print-to-pdf=${out}`], 90_000);
}
async function render(chrome: string, html: string, args: string[], timeout: number) {
  const profile = await mkdtemp(join(tmpdir(), 'fbpm-chrome-'));
  try {
    await execFileP(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${profile}`, ...args, pathToFileURL(resolve(html)).href], { timeout, windowsHide: true });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); }
}
