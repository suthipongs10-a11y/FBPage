// Liveness ของตัว web เอง (ไม่พึ่ง API) — ให้ reverse proxy / compose healthcheck ใช้
export function GET(): Response {
  return Response.json({ status: 'ok', service: 'web' });
}
