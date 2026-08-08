import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // แพ็กเกจในโมโนรีโปคอมไพล์เป็น ESM อยู่แล้ว ไม่ต้องให้ Next แปลงซ้ำ
  typedRoutes: true,
};

export default config;
