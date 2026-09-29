/**
 * ตรวจไฟล์คลิปสำหรับ Facebook Reels โดยอ่านหัวไฟล์ MP4/MOV (ISO BMFF) เอง — ไม่ต้องมี ffmpeg ในเครื่อง
 * อ่านเฉพาะ box ที่จำเป็น (ftyp, moov → mvhd, trak → tkhd) จึงเร็วแม้ไฟล์ใหญ่
 */
import { open } from 'node:fs/promises';

export interface VideoInfo { container: 'mp4' | 'mov'; durationSec: number | null; width: number | null; height: number | null }
/** ข้อกำหนดของ Facebook Reels (Graph API video_reels) */
export const REEL_MIN_SEC = 3;
export const REEL_MAX_SEC = 90;

/** ไฟล์ขึ้นต้นด้วย box ftyp = MP4/MOV — null = ไม่ใช่คลิปที่รองรับ */
export function sniffVideo(head: Buffer): VideoInfo['container'] | null {
  if (head.length < 12 || head.toString('latin1', 4, 8) !== 'ftyp') return null;
  return head.toString('latin1', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
}

export async function inspectVideo(path: string): Promise<VideoInfo> {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    const head = Buffer.alloc(12); await fh.read(head, 0, 12, 0);
    const container = sniffVideo(head);
    if (!container) throw new Error('ไฟล์นี้ไม่ใช่คลิป MP4/MOV');
    const info: VideoInfo = { container, durationSec: null, width: null, height: null };
    // หา moov ในระดับบนสุด (อยู่ต้นหรือท้ายไฟล์ก็ได้)
    let off = 0;
    while (off + 8 <= size) {
      const h = Buffer.alloc(16); await fh.read(h, 0, 16, off);
      let len = h.readUInt32BE(0); const type = h.toString('latin1', 4, 8); let hdr = 8;
      if (len === 1) { len = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (len === 0) len = size - off;
      if (len < hdr) break;
      if (type === 'moov') {
        if (len > 64 * 1024 * 1024) break;   // moov ใหญ่ผิดปกติ — ไม่อ่านทั้งก้อน
        const moov = Buffer.alloc(len - hdr); await fh.read(moov, 0, moov.length, off + hdr);
        parseMoov(moov, info);
        break;
      }
      off += len;
    }
    return info;
  } finally { await fh.close(); }
}

function* boxes(buf: Buffer, start = 0, end = buf.length): Generator<{ type: string; body: Buffer }> {
  let off = start;
  while (off + 8 <= end) {
    let len = buf.readUInt32BE(off); const type = buf.toString('latin1', off + 4, off + 8); let hdr = 8;
    if (len === 1 && off + 16 <= end) { len = Number(buf.readBigUInt64BE(off + 8)); hdr = 16; } else if (len === 0) len = end - off;
    if (len < hdr || off + len > end) return;
    yield { type, body: buf.subarray(off + hdr, off + len) };
    off += len;
  }
}

function parseMoov(moov: Buffer, info: VideoInfo) {
  for (const b of boxes(moov)) {
    if (b.type === 'mvhd' && b.body.length >= 20) {
      const v = b.body[0];
      const timescale = v === 1 ? b.body.readUInt32BE(20) : b.body.readUInt32BE(12);
      const duration = v === 1 ? Number(b.body.readBigUInt64BE(24)) : b.body.readUInt32BE(16);
      if (timescale > 0) info.durationSec = Math.round((duration / timescale) * 10) / 10;
    }
    if (b.type === 'trak' && info.width === null) {
      for (const t of boxes(b.body)) {
        if (t.type !== 'tkhd') continue;
        const v = t.body[0]; const base = v === 1 ? 88 : 76;   // ตำแหน่ง width/height (16.16 fixed) ท้าย tkhd
        if (t.body.length < base + 8) continue;
        const w = t.body.readUInt32BE(base) / 65536; const hgt = t.body.readUInt32BE(base + 4) / 65536;
        if (w > 0 && hgt > 0) { info.width = Math.round(w); info.height = Math.round(hgt); }   // แทร็กเสียงมี 0×0 — ข้าม
      }
    }
  }
}

/** ปัญหาที่ต้องแก้ (errors) และคำแนะนำ (warnings) ก่อนโพสต์เป็น Reels */
export function reelProblems(i: VideoInfo): { errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  if (i.durationSec === null) warnings.push('อ่านความยาวคลิปไม่ได้ — ตรวจว่ายาว 3–90 วินาที');
  else if (i.durationSec < REEL_MIN_SEC || i.durationSec > REEL_MAX_SEC) errors.push(`คลิปยาว ${i.durationSec} วินาที — Reels ต้องยาว ${REEL_MIN_SEC}–${REEL_MAX_SEC} วินาที`);
  if (i.width && i.height) {
    if (i.width >= i.height) warnings.push(`คลิปเป็นแนวนอน/สี่เหลี่ยม (${i.width}×${i.height}) — Reels ควรเป็นแนวตั้ง 9:16 ไม่งั้นจะมีขอบดำ`);
    if (Math.min(i.width, i.height) < 540) warnings.push(`ความละเอียดต่ำ (${i.width}×${i.height}) — แนะนำอย่างน้อย 540×960 (ดีที่สุด 1080×1920)`);
  }
  return { errors, warnings };
}

/** MP4 เล็กที่สุดที่มี ftyp + moov(mvhd + trak/tkhd) — ใช้ใน test และ mock เท่านั้น */
export function fakeMp4(o: { durationSec?: number; width?: number; height?: number; padBytes?: number } = {}): Buffer {
  const box = (type: string, ...parts: Buffer[]) => { const body = Buffer.concat(parts); const h = Buffer.alloc(8); h.writeUInt32BE(body.length + 8, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(Math.round((o.durationSec ?? 15) * 1000), 16);
  const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE((o.width ?? 1080) * 65536, 76); tkhd.writeUInt32BE((o.height ?? 1920) * 65536, 80);
  const ftyp = Buffer.concat([Buffer.from('isom', 'latin1'), Buffer.alloc(4), Buffer.from('isommp42', 'latin1')]);
  return Buffer.concat([box('ftyp', ftyp), box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd))), box('mdat', Buffer.alloc(o.padBytes ?? 64))]);
}
