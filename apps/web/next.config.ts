import type { NextConfig } from 'next';

// เบราว์เซอร์คุยกับ /api/* บน origin เดียวกัน → Next ส่งต่อไป API (ใน prod Caddy ทำหน้าที่เดียวกัน)
// ทำให้ cookie เซสชันเป็น same-origin ไม่ต้องเปิด CORS ข้ามพอร์ต
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@fbpm/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default config;
