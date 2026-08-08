/**
 * ที่เก็บ token ที่ต่อ Postgres จริง
 *
 * ⚠️ จุดที่ต้องระวังที่สุดของไฟล์นี้: **`pageId` สองความหมาย**
 *
 * โดเมนทั้งระบบใช้ `pageId` = **รหัสเพจของ Facebook** (ตัวที่อยู่ใน path ของ
 * Graph API และเป็น AAD ตอนเข้ารหัส token) แต่ในฐานข้อมูล `page_tokens.page_id`
 * ชี้ไปที่ `pages.id` ซึ่งเป็น UUID ภายในของเรา
 *
 * ถ้าเผลอเอาสองอันนี้มาปนกัน จะได้ token ของเพจอื่นมาถอดรหัสด้วย AAD ที่ไม่ตรง
 * แล้วพังแบบเงียบๆ ตอนถอดรหัสไม่ได้ — หรือแย่กว่านั้นคือหาไม่เจอแล้วคิดว่า
 * "เพจนี้ยังไม่ได้เชื่อม" ทั้งที่เชื่อมแล้ว
 *
 * ที่นี่จึงแปลงให้ชัดเจนทุกครั้ง: รับ fb page id → หา `Page` → ใช้ UUID
 */
import type {
  PageTokenRepository,
  PageTokenRow,
  TokenStatus,
} from "@page-os/db";
import type { PrismaClient } from "./client.js";
import { toDate, toMs } from "./client.js";

/** ชนิด token ในฐานข้อมูล — ตรงกับ enum `TokenKind` ใน schema */
type DbTokenKind = "page" | "user" | "system_user";

function toDbKind(t: PageTokenRow["tokenType"]): DbTokenKind {
  return t as DbTokenKind;
}

export class PrismaPageTokenRepository implements PageTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * หา UUID ภายในจากรหัสเพจของ Facebook
   *
   * คืน null ถ้ายังไม่มีแถวเพจ — แปลว่ายังไม่ได้ onboard เพจนี้
   * ไม่ใช่ error เพราะเป็นสถานะปกติตอนเริ่มต้น
   */
  private async internalId(fbPageId: string): Promise<string | null> {
    const page = await this.prisma.page.findUnique({
      where: { fbPageId },
      select: { id: true },
    });
    return page?.id ?? null;
  }

  async findByPageId(fbPageId: string): Promise<PageTokenRow | null> {
    const row = await this.prisma.pageToken.findFirst({
      where: { page: { fbPageId } },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) return null;

    return {
      // คืนรหัสของ Facebook กลับไป ไม่ใช่ UUID ภายใน —
      // เพราะ AAD ตอนถอดรหัสผูกกับรหัสของ Facebook
      pageId: fbPageId,
      encryptedToken: row.encryptedToken,
      tokenType: row.tokenType as PageTokenRow["tokenType"],
      scopes: row.scopes,
      expiresAtMs: toMs(row.expiresAt),
      status: row.status as TokenStatus,
      statusReason: row.statusReason,
      lastCheckedAtMs: toMs(row.lastCheckedAt),
    };
  }

  async upsert(row: PageTokenRow): Promise<void> {
    const pageId = await this.internalId(row.pageId);
    if (pageId === null) {
      throw new Error(
        `ยังไม่มีเพจ ${row.pageId} ในระบบ — ต้องสร้างแถว Page ก่อนเก็บ token`,
      );
    }

    const data = {
      encryptedToken: row.encryptedToken,
      tokenType: toDbKind(row.tokenType),
      scopes: row.scopes,
      expiresAt: toDate(row.expiresAtMs),
      status: row.status,
      statusReason: row.statusReason ?? null,
      lastCheckedAt: toDate(row.lastCheckedAtMs),
    };

    await this.prisma.pageToken.upsert({
      where: { pageId_tokenType: { pageId, tokenType: toDbKind(row.tokenType) } },
      create: { pageId, ...data },
      update: data,
    });
  }

  async updateStatus(
    fbPageId: string,
    status: TokenStatus,
    reason: string,
    checkedAtMs: number,
  ): Promise<void> {
    // updateMany เพราะเราไม่รู้ tokenType ตอนอัปเดตสถานะ —
    // และเพจหนึ่งอาจมีทั้ง page token และ system user token
    await this.prisma.pageToken.updateMany({
      where: { page: { fbPageId } },
      data: {
        status,
        statusReason: reason,
        lastCheckedAt: new Date(checkedAtMs),
      },
    });
  }

  async listAll(): Promise<PageTokenRow[]> {
    const rows = await this.prisma.pageToken.findMany({
      include: { page: { select: { fbPageId: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row) => ({
      pageId: row.page.fbPageId,
      encryptedToken: row.encryptedToken,
      tokenType: row.tokenType as PageTokenRow["tokenType"],
      scopes: row.scopes,
      expiresAtMs: toMs(row.expiresAt),
      status: row.status as TokenStatus,
      statusReason: row.statusReason,
      lastCheckedAtMs: toMs(row.lastCheckedAt),
    }));
  }
}
