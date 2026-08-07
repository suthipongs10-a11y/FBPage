/**
 * TokenStore ที่เก็บ token แบบเข้ารหัส (กฎข้อ 3)
 *
 * แยกจาก Prisma ผ่าน PageTokenRepository เพื่อให้:
 *   - เทสต์ได้โดยไม่ต้องมี DB จริง
 *   - เปลี่ยนที่เก็บได้โดยไม่แตะตรรกะการเข้ารหัส
 */
import {
  Keyring,
  decryptToken,
  encryptToken,
  nullLogger,
  systemClock,
  type Clock,
  type Logger,
} from "@page-os/core";
import type { PageToken, TokenStore, TokenType } from "@page-os/meta";

export type TokenStatus =
  | "active"
  | "expiring_soon"
  | "expired"
  | "revoked"
  | "missing_permissions"
  | "unknown";

/** แถวใน page_tokens ตามที่เก็บจริง (token ยังเป็น ciphertext) */
export interface PageTokenRow {
  pageId: string;
  encryptedToken: string;
  tokenType: TokenType;
  scopes: string[];
  /** epoch ms; null = ไม่หมดอายุ */
  expiresAtMs: number | null;
  status: TokenStatus;
  statusReason?: string | null;
  lastCheckedAtMs?: number | null;
}

export interface PageTokenRepository {
  findByPageId(pageId: string): Promise<PageTokenRow | null>;
  upsert(row: PageTokenRow): Promise<void>;
  updateStatus(
    pageId: string,
    status: TokenStatus,
    reason: string,
    checkedAtMs: number,
  ): Promise<void>;
  listAll(): Promise<PageTokenRow[]>;
}

/** สถานะที่ยังยิง API ได้ */
const USABLE: ReadonlySet<TokenStatus> = new Set<TokenStatus>([
  "active",
  "expiring_soon",
  "missing_permissions",
  "unknown",
]);

export interface EncryptedTokenStoreOptions {
  repo: PageTokenRepository;
  keyring: Keyring;
  clock?: Clock;
  logger?: Logger;
  /**
   * cache token ที่ decrypt แล้วกี่ ms — gateway เรียก getPageToken ทุก call
   * ถ้าไม่ cache จะยิง DB + decrypt ทุกครั้ง
   */
  cacheTtlMs?: number;
}

interface CacheEntry {
  token: PageToken | null;
  expiresAtMs: number;
}

export class EncryptedTokenStore implements TokenStore {
  private readonly repo: PageTokenRepository;
  private readonly keyring: Keyring;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: EncryptedTokenStoreOptions) {
    this.repo = opts.repo;
    this.keyring = opts.keyring;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? nullLogger;
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
  }

  /** AAD ผูก ciphertext กับเพจ — ก๊อป token ข้ามเพจใน DB แล้วใช้ไม่ได้ */
  private aad(pageId: string): string {
    return `page_token:${pageId}`;
  }

  async getPageToken(pageId: string): Promise<PageToken | null> {
    const now = this.clock.now();
    const cached = this.cache.get(pageId);
    if (cached && cached.expiresAtMs > now) return cached.token;

    const row = await this.repo.findByPageId(pageId);
    const token = row ? this.rowToToken(row, now) : null;
    this.cache.set(pageId, { token, expiresAtMs: now + this.cacheTtlMs });
    return token;
  }

  private rowToToken(row: PageTokenRow, nowMs: number): PageToken | null {
    if (!USABLE.has(row.status)) {
      this.logger.warn("ข้ามการใช้ token ที่สถานะใช้ไม่ได้", {
        page_id: row.pageId,
        status: row.status,
      });
      return null;
    }
    // หมดอายุตามเวลาแล้ว แม้ status ยังไม่ถูกอัปเดต — อย่ายิงไปให้เสีย quota เปล่า
    if (row.expiresAtMs !== null && row.expiresAtMs <= nowMs) {
      this.logger.warn("token หมดอายุแล้วตามเวลาที่บันทึกไว้", {
        page_id: row.pageId,
      });
      return null;
    }

    let plain: string;
    try {
      plain = decryptToken(
        row.encryptedToken,
        this.keyring,
        this.aad(row.pageId),
      );
    } catch (err) {
      // ถอดไม่ได้ = key หาย/ข้อมูลถูกแก้ ต้องดังพอให้เห็น ไม่ใช่เงียบๆ
      this.logger.error("ถอดรหัส token ไม่สำเร็จ", {
        page_id: row.pageId,
        err,
      });
      return null;
    }

    const token: PageToken = {
      pageId: row.pageId,
      accessToken: plain,
      tokenType: row.tokenType,
      scopes: row.scopes,
    };
    if (row.expiresAtMs !== null) token.expiresAtMs = row.expiresAtMs;
    return token;
  }

  async markInvalid(pageId: string, reason: string): Promise<void> {
    this.cache.delete(pageId);
    await this.repo.updateStatus(pageId, "revoked", reason, this.clock.now());
  }

  /** บันทึก token ใหม่ (ตอน onboarding หรือ reconnect) */
  async save(args: {
    pageId: string;
    accessToken: string;
    tokenType: TokenType;
    scopes: string[];
    expiresAtMs?: number | null;
    status?: TokenStatus;
  }): Promise<void> {
    const encrypted = encryptToken(
      args.accessToken,
      this.keyring,
      this.aad(args.pageId),
    );
    await this.repo.upsert({
      pageId: args.pageId,
      encryptedToken: encrypted,
      tokenType: args.tokenType,
      scopes: args.scopes,
      expiresAtMs: args.expiresAtMs ?? null,
      status: args.status ?? "active",
      lastCheckedAtMs: this.clock.now(),
    });
    this.cache.delete(args.pageId);
  }

  /** อัปเดตสถานะจาก health check */
  async updateStatus(
    pageId: string,
    status: TokenStatus,
    reason: string,
  ): Promise<void> {
    this.cache.delete(pageId);
    await this.repo.updateStatus(pageId, status, reason, this.clock.now());
  }

  /** ดึง token ดิบทุกเพจ สำหรับ health check (decrypt ให้แล้ว) */
  async listForHealthCheck(): Promise<
    Array<{ pageId: string; token: string; tokenType: TokenType }>
  > {
    const rows = await this.repo.listAll();
    const out: Array<{
      pageId: string;
      token: string;
      tokenType: TokenType;
    }> = [];
    for (const row of rows) {
      try {
        out.push({
          pageId: row.pageId,
          token: decryptToken(
            row.encryptedToken,
            this.keyring,
            this.aad(row.pageId),
          ),
          tokenType: row.tokenType,
        });
      } catch (err) {
        this.logger.error("ถอดรหัส token ไม่สำเร็จตอน health check", {
          page_id: row.pageId,
          err,
        });
      }
    }
    return out;
  }

  /** ล้าง cache (ใช้ตอนเทสต์ หรือหลังแก้ข้อมูลจากทางอื่น) */
  clearCache(pageId?: string): void {
    if (pageId) this.cache.delete(pageId);
    else this.cache.clear();
  }
}

/** repo ในหน่วยความจำ — ใช้ในเทสต์และตอน dev ที่ยังไม่มี Postgres */
export class InMemoryPageTokenRepository implements PageTokenRepository {
  private rows = new Map<string, PageTokenRow>();

  async findByPageId(pageId: string): Promise<PageTokenRow | null> {
    return this.rows.get(pageId) ?? null;
  }

  async upsert(row: PageTokenRow): Promise<void> {
    this.rows.set(row.pageId, { ...row });
  }

  async updateStatus(
    pageId: string,
    status: TokenStatus,
    reason: string,
    checkedAtMs: number,
  ): Promise<void> {
    const row = this.rows.get(pageId);
    if (!row) return;
    this.rows.set(pageId, {
      ...row,
      status,
      statusReason: reason,
      lastCheckedAtMs: checkedAtMs,
    });
  }

  async listAll(): Promise<PageTokenRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  /** สำหรับเทสต์: ดูข้อมูลดิบที่เก็บอยู่จริง */
  raw(pageId: string): PageTokenRow | undefined {
    return this.rows.get(pageId);
  }
}
