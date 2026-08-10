import "server-only";

/**
 * ของจริงที่หน้าเว็บฝั่งเซิร์ฟเวอร์ใช้ — ฐานข้อมูล + ทางไป Meta
 *
 * `import "server-only"` บรรทัดแรกไม่ใช่พิธีกรรม: ถ้าวันหนึ่งมีคนเผลอ import
 * ไฟล์นี้จาก component ที่รันบนเบราว์เซอร์ Next จะ **ล้มตอน build** แทนที่จะ
 * ส่ง `TOKEN_ENC_KEYS` กับ `META_APP_SECRET` ไปให้เบราว์เซอร์เงียบๆ (กฎข้อ 3)
 */
import { createLogger, Keyring } from "@page-os/core";
import { EncryptedTokenStore } from "@page-os/db";
import { MetaGateway, TokenService } from "@page-os/meta";
import {
  getPrisma,
  PrismaCallLog,
  PrismaPageTokenRepository,
  type PrismaClient,
} from "@page-os/store";

export class WebConfigError extends Error {
  override readonly name = "WebConfigError";
  readonly th: string;
  constructor(th: string) {
    super(th);
    this.th = th;
  }
}

function required(key: string, hintTh: string): string {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") {
    throw new WebConfigError(`ยังไม่ได้ตั้งค่า ${key} — ${hintTh}`);
  }
  return v.trim();
}

const logger = createLogger({ bindings: { service: "web" } });

export function prisma(): PrismaClient {
  return getPrisma();
}

/**
 * ทางไป Meta สำหรับหน้าเว็บ
 *
 * สร้างใหม่ทุกครั้งที่เรียกโดยตั้งใจ — หน้าเว็บยิงไป Meta แค่ตอนคนกดเชื่อมเพจ
 * ซึ่งนานๆ ครั้ง การเก็บ instance ไว้ข้ามคำขอมีแต่จะทำให้สถานะ rate limit
 * ค้างอยู่ในโปรเซสที่ Next รีโหลดทิ้งเมื่อไหร่ก็ได้ตอน dev
 */
export function metaGateway(): { gateway: MetaGateway; tokens: EncryptedTokenStore } {
  const db = prisma();
  const tokens = new EncryptedTokenStore({
    repo: new PrismaPageTokenRepository(db),
    keyring: Keyring.fromEnv(process.env["TOKEN_ENC_KEYS"]),
    logger,
  });

  const gateway = new MetaGateway(
    {
      appId: required("META_APP_ID", "รัน `pnpm setup` แล้วใส่ App ID จาก Meta"),
      appSecret: required("META_APP_SECRET", "รัน `pnpm setup` แล้วใส่ App Secret"),
      // กฎข้อ 2: เวอร์ชันมาจาก env ที่เดียว — ห้ามส่ง graphVersion เข้ามาที่นี่
    },
    { tokenStore: tokens, logger, callLog: new PrismaCallLog({ prisma: db, logger }) },
  );

  return { gateway, tokens };
}

export function tokenService(gateway: MetaGateway): TokenService {
  return new TokenService(
    gateway,
    {
      appId: required("META_APP_ID", "รัน `pnpm setup`"),
      redirectUri: process.env["META_OAUTH_REDIRECT_URI"] ?? "",
    },
    logger,
  );
}

export { logger as webLogger };
