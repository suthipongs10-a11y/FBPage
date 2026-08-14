import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_QUOTA,
  QUOTA_COST,
  QuotaBucket,
  quotaDayKey,
  RESERVED_FOR_INTERACTIVE,
} from "./quota.js";

/** เที่ยงวันของวันที่ 14 ส.ค. 2026 ตามเวลา UTC */
const NOON_UTC = Date.UTC(2026, 7, 14, 12);

describe("ตารางราคาโควตา", () => {
  /**
   * ข้อนี้ไม่ใช่เทสต์ค่าคงที่เฉยๆ — มันคือกฎที่กันไม่ให้ใครเผลอเติม
   * `search.list` เข้ามา ซึ่งราคา 100 หน่วย เรียกแค่ 100 ครั้งโควตาหมดทั้งวัน
   * และเป็นวิธีที่ตัวอย่างโค้ดในเน็ตส่วนมากใช้เพราะเขียนง่ายกว่า
   */
  it("ไม่มี search.list อยู่ในตารางเลย", () => {
    expect(Object.keys(QUOTA_COST)).not.toContain("search.list");
  });

  it("ทางที่เราใช้ดึงวิดีโอของช่องราคา 1 หน่วย ไม่ใช่ 100", () => {
    expect(QUOTA_COST["playlistItems.list"]).toBe(1);
    expect(QUOTA_COST["commentThreads.list"]).toBe(1);
    expect(QUOTA_COST["channels.list"]).toBe(1);
  });

  /** เขียนแพงกว่าอ่าน 50 เท่า — ต้องรู้ก่อนวางแผนงานซ่อน/ลบคอมเมนต์จำนวนมาก */
  it("การซ่อน/ลบคอมเมนต์แพงกว่าการอ่านมาก", () => {
    expect(QUOTA_COST["comments.setModerationStatus"]).toBe(50);
    expect(QUOTA_COST["comments.delete"]).toBe(50);
  });

  /**
   * งบจริงที่ใช้ได้ต่อวัน — ถ้าตัวเลขนี้เปลี่ยน แผนการดึงข้อมูลต้องคิดใหม่
   * 10 ช่อง × 50 วิดีโอ × 2 หน้าคอมเมนต์ = 1,000 หน่วย ยังอยู่ในงบสบายๆ
   */
  it("งบรายวันพอสำหรับ 10 ช่อง × 50 วิดีโอ × 2 หน้าคอมเมนต์", () => {
    const cost = 10 * (1 + 1 + 50 * 2 * QUOTA_COST["commentThreads.list"]);
    expect(cost).toBeLessThan(DEFAULT_DAILY_QUOTA - RESERVED_FOR_INTERACTIVE);
  });
});

describe("วันของโควตา", () => {
  /**
   * โควตารีเซ็ตเที่ยงคืน**เวลาแปซิฟิก** ไม่ใช่ UTC และไม่ใช่เวลาไทย
   * ถ้าคิดเป็น UTC ระบบจะนึกว่าข้ามวันแล้วทั้งที่ Google ยังไม่รีเซ็ต
   * แล้วยิงต่อจนโดนปฏิเสธยาว
   */
  it("ใช้เวลาแปซิฟิก ไม่ใช่ UTC", () => {
    // 06:00 UTC ของวันที่ 15 = 23:00 ของวันที่ 14 ที่แคลิฟอร์เนีย
    expect(quotaDayKey(Date.UTC(2026, 7, 15, 6))).toBe("2026-08-14");
    // 07:00 UTC = เที่ยงคืนพอดี → ข้ามวันแล้ว (ฤดูร้อน PDT = UTC-7)
    expect(quotaDayKey(Date.UTC(2026, 7, 15, 7))).toBe("2026-08-15");
  });

  /**
   * เส้นแบ่งวันขยับตาม DST ปีละสองครั้ง — ฤดูร้อน 07:00 UTC ฤดูหนาว 08:00 UTC
   *
   * นี่คือเหตุผลที่ต้องใช้ `Intl` คำนวณ ไม่ใช่ลบเลขคงที่ออกจาก UTC เอง
   * ถ้าฮาร์ดโค้ด -7 ไว้ พอถึงเดือนพฤศจิกายนระบบจะนึกว่าข้ามวันเร็วไปหนึ่งชั่วโมง
   * แล้วยิงต่อทั้งที่ Google ยังไม่รีเซ็ตโควตาให้
   */
  it("เส้นแบ่งวันขยับตาม DST — ฤดูหนาวช้ากว่าฤดูร้อนหนึ่งชั่วโมง", () => {
    // ฤดูหนาว (PST = UTC-8): 07:00 UTC ยังไม่ข้ามวัน
    expect(quotaDayKey(Date.UTC(2026, 0, 15, 7))).toBe("2026-01-14");
    expect(quotaDayKey(Date.UTC(2026, 0, 15, 8))).toBe("2026-01-15");
  });

  it("เวลาไทยเที่ยงคืนยังไม่ข้ามวันของโควตา", () => {
    // เที่ยงคืนวันที่ 15 เวลาไทย = 17:00 UTC วันที่ 14 = ยังวันที่ 14 ที่นั่น
    expect(quotaDayKey(Date.UTC(2026, 7, 14, 17))).toBe("2026-08-14");
  });
});

describe("ถังโควตา", () => {
  it("เริ่มต้นยังไม่ได้ใช้อะไรเลย", () => {
    const b = new QuotaBucket(DEFAULT_DAILY_QUOTA, NOON_UTC);
    const s = b.snapshot(NOON_UTC);
    expect(s.used).toBe(0);
    expect(s.remaining).toBe(DEFAULT_DAILY_QUOTA);
    expect(s.usedPct).toBe(0);
  });

  it("ใช้แล้วนับเพิ่ม", () => {
    const b = new QuotaBucket(100, NOON_UTC);
    b.spend(30, NOON_UTC);
    expect(b.snapshot(NOON_UTC)).toMatchObject({ used: 30, remaining: 70, usedPct: 30 });
  });

  /**
   * หัวใจของการกันโควตา — งานเบื้องหลังต้องหยุด**ก่อน**โควตาหมดจริง
   * ไม่งั้น cron ตอนเช้าดูดจนเกลี้ยง พอตอนบ่ายคนกดปุ่มแล้วไม่มีอะไรเกิดขึ้น
   */
  it("งานเบื้องหลังโดนเบรกก่อน แต่งานที่คนกดเองยังยิงได้", () => {
    const b = new QuotaBucket(2_000, NOON_UTC);
    b.spend(2_000 - RESERVED_FOR_INTERACTIVE, NOON_UTC);

    expect(b.canSpend({ cost: 1, nowMs: NOON_UTC, background: true }).ok).toBe(false);
    expect(b.canSpend({ cost: 1, nowMs: NOON_UTC, background: false }).ok).toBe(true);
  });

  it("โควตาหมดจริง → งานที่คนกดเองก็ยิงไม่ได้", () => {
    const b = new QuotaBucket(100, NOON_UTC);
    b.spend(100, NOON_UTC);
    expect(b.canSpend({ cost: 1, nowMs: NOON_UTC, background: false }).ok).toBe(false);
  });

  /** ข้อความต้องบอกว่ารอถึงเมื่อไหร่ ไม่ใช่แค่ว่า "ตอนนี้ไม่ได้" */
  it("ข้อความปฏิเสธบอกเวลาที่จะรีเซ็ตเป็นเวลาบ้านเรา", () => {
    const b = new QuotaBucket(10, NOON_UTC);
    b.spend(10, NOON_UTC);
    const th = b.canSpend({ cost: 1, nowMs: NOON_UTC, background: false }).th;
    expect(th).toContain("แปซิฟิก");
    expect(th).toContain("บ้านเรา");
    expect(th).toContain("10/10");
  });

  /** ข้ามวันแล้วต้องเริ่มนับใหม่เอง ไม่ต้องมีใครไปสั่งรีเซ็ต */
  it("ข้ามเที่ยงคืนแปซิฟิก → นับใหม่จากศูนย์", () => {
    const b = new QuotaBucket(100, NOON_UTC);
    b.spend(100, NOON_UTC);
    expect(b.snapshot(NOON_UTC).remaining).toBe(0);

    // +1 วัน ยังเวลาเดียวกัน = ข้ามวันแปซิฟิกไปแล้วแน่นอน
    const nextDay = NOON_UTC + 86_400_000;
    expect(b.snapshot(nextDay)).toMatchObject({ used: 0, remaining: 100 });
  });

  it("เพดานเป็นศูนย์ → ไม่หารด้วยศูนย์ และยิงอะไรไม่ได้", () => {
    const b = new QuotaBucket(0, NOON_UTC);
    const s = b.snapshot(NOON_UTC);
    expect(s.usedPct).toBe(100);
    expect(Number.isNaN(s.usedPct)).toBe(false);
    expect(b.canSpend({ cost: 1, nowMs: NOON_UTC, background: false }).ok).toBe(false);
  });

  it("ใช้เกินเพดาน → remaining ไม่ติดลบ", () => {
    const b = new QuotaBucket(10, NOON_UTC);
    b.spend(50, NOON_UTC);
    const s = b.snapshot(NOON_UTC);
    expect(s.remaining).toBe(0);
    expect(s.remainingForBackground).toBe(0);
  });
});
