/** ตัวเลขจำนวนเต็มพร้อมคั่นหลักพัน */
export function formatInt(value: number): string {
  return new Intl.NumberFormat('th-TH').format(Math.round(value));
}

/** เวลาแบบ "เมื่อ X ที่แล้ว" — สั้น อ่านผ่านตาได้ */
export function formatAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'เมื่อครู่';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;
  const days = Math.round(hours / 24);
  return `${days} วันที่แล้ว`;
}
