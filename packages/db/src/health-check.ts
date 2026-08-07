/**
 * Health check ทุก 6 ชม. (สเปกข้อ M0)
 *
 * "Token ของลูกค้าหลุดเงียบๆ (ลูกค้าเปลี่ยนรหัส/ถอดสิทธิ์) → health check ทุก 6 ชม.
 *  เท่านั้นถึงจะจับได้ทัน" — สเปกข้อ 6.5
 */
import { nullLogger, systemClock, type Clock, type Logger } from "@page-os/core";
import {
  needsAlert,
  type ConnectionState,
  type PageConnectionHealth,
  type TokenService,
} from "@page-os/meta";
import type { EncryptedTokenStore, TokenStatus } from "./token-store.js";

/** ส่ง alert เข้า LINE (M8 Alert Center) */
export interface AlertSink {
  send(alert: {
    severity: "warn" | "critical";
    title: string;
    body: string;
    pageId?: string;
  }): Promise<void>;
}

export const noopAlertSink: AlertSink = { send: async () => {} };

/** ตรวจพร้อมกันได้กี่เพจ — gateway คุมโควตาจริงอยู่แล้ว ตรงนี้แค่กันไม่ให้เพจที่ค้างดองคิว */
export const HEALTH_CHECK_CONCURRENCY = 5;

/** ConnectionState ของ meta → TokenStatus ที่เก็บใน DB */
const STATE_TO_STATUS: Record<ConnectionState, TokenStatus> = {
  ok: "active",
  expiring_soon: "expiring_soon",
  expired: "expired",
  revoked: "revoked",
  missing_permissions: "missing_permissions",
  no_token: "unknown",
  unknown: "unknown",
};

export interface HealthCheckResult {
  checked: number;
  alerts: number;
  /** สรุปต่อเพจ ใช้เรนเดอร์หน้า Connection Status */
  pages: PageConnectionHealth[];
  /** เพจที่ตรวจไม่ได้เลย (ถอดรหัสไม่ได้ ฯลฯ) */
  failed: string[];
}

export interface TokenHealthCheckerOptions {
  store: EncryptedTokenStore;
  tokenService: TokenService;
  alerts?: AlertSink;
  logger?: Logger;
  clock?: Clock;
}

export class TokenHealthChecker {
  private readonly store: EncryptedTokenStore;
  private readonly svc: TokenService;
  private readonly alerts: AlertSink;
  private readonly logger: Logger;
  private readonly clock: Clock;

  constructor(opts: TokenHealthCheckerOptions) {
    this.store = opts.store;
    this.svc = opts.tokenService;
    this.alerts = opts.alerts ?? noopAlertSink;
    this.logger = opts.logger ?? nullLogger;
    this.clock = opts.clock ?? systemClock;
  }

  /**
   * รันครบทุกเพจ — เรียกจาก cron ทุก 6 ชม.
   *
   * ทำแบบขนานจำกัดจำนวน ไม่ใช่ทีละเพจ: ถ้ายิงไม่ผ่าน gateway จะ backoff ~7 วิต่อเพจ
   * แบบเรียงทีละตัว 30 เพจใช้เวลาเป็นนาทีจนทับรอบ cron ถัดไป
   * (การยิง debug_token ใช้โควตาระดับแอปร่วมกันอยู่แล้ว gateway จึงคุมอัตราให้เอง)
   */
  async runAll(): Promise<HealthCheckResult> {
    const started = this.clock.now();
    const entries = await this.store.listForHealthCheck();
    const pages: PageConnectionHealth[] = [];
    const failed: string[] = [];
    let alerts = 0;

    const queue = [...entries];
    const checkOne = async (
      e: (typeof entries)[number],
    ): Promise<void> => {
      try {
        const health = await this.svc.checkPageHealth({
          pageId: e.pageId,
          token: e.token,
          tokenType: e.tokenType,
        });
        pages.push(health);

        await this.store.updateStatus(
          e.pageId,
          STATE_TO_STATUS[health.state],
          health.th,
        );

        if (needsAlert(health.state)) {
          alerts++;
          await this.alerts
            .send({
              severity:
                health.state === "expired" || health.state === "revoked"
                  ? "critical"
                  : "warn",
              title: `เพจ ${e.pageId}: ${health.state}`,
              body: health.th,
              pageId: e.pageId,
            })
            .catch((err: unknown) => {
              // ส่ง alert ไม่ได้ ต้องไม่ทำให้ตรวจเพจที่เหลือหยุด
              this.logger.error("ส่ง alert ไม่สำเร็จ", {
                page_id: e.pageId,
                err,
              });
            });
        }
      } catch (err) {
        // เพจเดียวพัง ต้องไม่ทำให้ทั้ง cron ล้ม
        failed.push(e.pageId);
        this.logger.error("ตรวจสุขภาพเพจไม่สำเร็จ", {
          page_id: e.pageId,
          err,
        });
      }
    };

    const workers = Array.from(
      { length: Math.min(HEALTH_CHECK_CONCURRENCY, queue.length) },
      async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await checkOne(next);
        }
      },
    );
    await Promise.all(workers);

    const result: HealthCheckResult = {
      checked: pages.length,
      alerts,
      pages,
      failed,
    };
    this.logger.info("health check เสร็จ", {
      checked: result.checked,
      alerts: result.alerts,
      failed: failed.length,
      durationMs: this.clock.now() - started,
    });
    return result;
  }
}

/** ป้ายไทยสำหรับหน้า Connection Status */
export const STATE_LABEL_TH: Record<ConnectionState, string> = {
  ok: "ปกติ",
  expiring_soon: "ใกล้หมดอายุ",
  expired: "หมดอายุแล้ว",
  revoked: "ถูกเพิกถอน",
  missing_permissions: "สิทธิ์ไม่ครบ",
  no_token: "ยังไม่ได้เชื่อม",
  unknown: "ตรวจไม่ได้",
};

/** สีสำหรับ badge ในหน้า Connection Status */
export const STATE_TONE: Record<ConnectionState, "green" | "amber" | "red" | "gray"> = {
  ok: "green",
  expiring_soon: "amber",
  missing_permissions: "amber",
  expired: "red",
  revoked: "red",
  no_token: "gray",
  unknown: "gray",
};
