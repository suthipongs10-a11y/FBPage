import { describe, expect, it } from "vitest";
import { expectThaiThrow } from "@page-os/core/testing";
import {
  HUMAN_AGENT_WINDOW_MS,
  MessagingPolicyError,
  RETIRED_TAGS,
  STANDARD_WINDOW_MS,
  WINDOW_URGENT_MS,
  decideSend,
  windowStatus,
} from "./messaging-policy.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

describe("กฎข้อ 8 — ห้ามใช้ legacy message tag", () => {
  it("แท็กที่ปลดระวาง 27 เม.ย. 2026 ถูกปฏิเสธทันที", () => {
    for (const tag of RETIRED_TAGS) {
      expect(
        () =>
          decideSend({
            lastCustomerMessageAtMs: NOW,
            nowMs: NOW,
            sentBy: "human",
            tag,
          }),
        tag,
      ).toThrow(MessagingPolicyError);
    }
  });

  it("บอกให้ใช้ Utility Template แทน เป็นภาษาไทย", () => {
    try {
      decideSend({
        lastCustomerMessageAtMs: NOW,
        nowMs: NOW,
        sentBy: "human",
        tag: "CONFIRMED_EVENT_UPDATE",
      });
      expect.unreachable("ควรจะโยน error");
    } catch (err) {
      const e = err as MessagingPolicyError;
      expect(e.th).toContain("Utility Template");
      expect(e.action).toBe("use_utility_template");
    }
  });

  it("ปฏิเสธแม้อยู่ในช่วง 24 ชม. (แท็กปลดระวางแล้วก็คือปลดระวาง)", () => {
    expect(() =>
      decideSend({
        lastCustomerMessageAtMs: NOW,
        nowMs: NOW + 60_000,
        sentBy: "human",
        tag: "ACCOUNT_UPDATE",
      }),
    ).toThrow(MessagingPolicyError);
  });
});

describe("กฎข้อ 7 — บอทห้ามใช้ HUMAN_AGENT tag", () => {
  it("บอทใช้แท็กนี้ไม่ได้เด็ดขาด", () => {
    for (const sentBy of ["bot", "system"] as const) {
      expect(
        () =>
          decideSend({
            lastCustomerMessageAtMs: NOW - 30 * HOUR,
            nowMs: NOW,
            sentBy,
            tag: "HUMAN_AGENT",
          }),
        sentBy,
      ).toThrow(MessagingPolicyError);
    }
  });

  it("บอกว่าเป็นบั๊กของโค้ดเรา ไม่ใช่สถานการณ์ปกติ", () => {
    try {
      decideSend({
        lastCustomerMessageAtMs: NOW,
        nowMs: NOW,
        sentBy: "bot",
        tag: "HUMAN_AGENT",
      });
      expect.unreachable("ควรจะโยน error");
    } catch (err) {
      const e = err as MessagingPolicyError;
      expect(e.action).toBe("fix_code");
      expect(e.th).toContain("คนพิมพ์");
    }
  });

  it("คนใช้ได้", () => {
    const d = decideSend({
      lastCustomerMessageAtMs: NOW - 30 * HOUR,
      nowMs: NOW,
      sentBy: "human",
      tag: "HUMAN_AGENT",
    });
    expect(d.allowed).toBe(true);
    expect(d.tag).toBe("HUMAN_AGENT");
  });

  it("แท็กที่ไม่รู้จักถูกปฏิเสธ", () => {
    const err = expectThaiThrow(() =>
      decideSend({
        lastCustomerMessageAtMs: NOW,
        nowMs: NOW,
        sentBy: "human",
        tag: "MY_CUSTOM_TAG",
      }),
    );
    expect(err.th).toMatch(/ไม่รู้จักแท็ก/);
  });
});

describe("หน้าต่าง 24 ชั่วโมง", () => {
  it("อยู่ในช่วง 24 ชม. ส่งได้ทั้งคนและบอท ไม่ต้องใช้แท็ก", () => {
    for (const sentBy of ["human", "bot", "system"] as const) {
      const d = decideSend({
        lastCustomerMessageAtMs: NOW - 2 * HOUR,
        nowMs: NOW,
        sentBy,
      });
      expect(d.allowed, sentBy).toBe(true);
      expect(d.tag, sentBy).toBeUndefined();
    }
  });

  it("เกิน 24 ชม. บอทส่งไม่ได้ แต่คนส่งได้ด้วย HUMAN_AGENT", () => {
    const bot = decideSend({
      lastCustomerMessageAtMs: NOW - 25 * HOUR,
      nowMs: NOW,
      sentBy: "bot",
    });
    expect(bot.allowed).toBe(false);
    expect(bot.th).toContain("Utility Template");

    const human = decideSend({
      lastCustomerMessageAtMs: NOW - 25 * HOUR,
      nowMs: NOW,
      sentBy: "human",
    });
    expect(human.allowed).toBe(true);
    expect(human.tag).toBe("HUMAN_AGENT");
  });

  it("เกิน 7 วันแล้วคนก็ส่งไม่ได้", () => {
    const d = decideSend({
      lastCustomerMessageAtMs: NOW - HUMAN_AGENT_WINDOW_MS - 1000,
      nowMs: NOW,
      sentBy: "human",
    });
    expect(d.allowed).toBe(false);
    expect(d.th).toContain("7 วัน");
  });

  it("ลูกค้ายังไม่เคยทัก เพจทักไปก่อนไม่ได้", () => {
    const d = decideSend({
      lastCustomerMessageAtMs: null,
      nowMs: NOW,
      sentBy: "human",
    });
    expect(d.allowed).toBe(false);
    expect(d.th).toContain("ยังไม่เคยทัก");
  });

  it("เส้นแบ่งพอดี 24 ชม. ถือว่าหมดแล้ว", () => {
    const d = decideSend({
      lastCustomerMessageAtMs: NOW - STANDARD_WINDOW_MS,
      nowMs: NOW,
      sentBy: "bot",
    });
    expect(d.allowed).toBe(false);
  });

  it("ก่อนหมดเวลา 1 มิลลิวินาที ยังส่งได้", () => {
    const d = decideSend({
      lastCustomerMessageAtMs: NOW - STANDARD_WINDOW_MS + 1,
      nowMs: NOW,
      sentBy: "bot",
    });
    expect(d.allowed).toBe(true);
  });

  it("บอกเวลาที่เหลือเป็นภาษาไทย", () => {
    const d = decideSend({
      lastCustomerMessageAtMs: NOW - 22 * HOUR,
      nowMs: NOW,
      sentBy: "bot",
    });
    expect(d.th).toMatch(/[ก-๙]/);
    expect(d.th).toContain("2 ชม.");
  });
});

describe("windowStatus — badge ใน conversation list", () => {
  it("เหลือเวลาเยอะ = เขียว", () => {
    const s = windowStatus(NOW - HOUR, NOW);
    expect(s.tone).toBe("green");
    expect(s.open).toBe(true);
    expect(s.badgeTh).toContain("⏰");
  });

  it("เหลือน้อยกว่า 2 ชม. = แดง (ตามสเปกข้อ M1)", () => {
    const s = windowStatus(NOW - (24 * HOUR - WINDOW_URGENT_MS) - 1000, NOW);
    expect(s.tone).toBe("red");
  });

  it("เหลือปานกลาง = เหลือง", () => {
    expect(windowStatus(NOW - 19 * HOUR, NOW).tone).toBe("amber");
  });

  it("หมดเวลาแล้ว = เทา", () => {
    const s = windowStatus(NOW - 25 * HOUR, NOW);
    expect(s.open).toBe(false);
    expect(s.tone).toBe("gray");
    expect(s.badgeTh).toContain("หมดเวลา");
  });

  it("ยังไม่เคยคุย = เทา", () => {
    expect(windowStatus(null, NOW).tone).toBe("gray");
  });

  it("badge แสดงเวลาที่เหลือแบบอ่านง่าย", () => {
    expect(windowStatus(NOW - 21 * HOUR, NOW).badgeTh).toContain("3 ชม.");
    expect(windowStatus(NOW - (24 * HOUR - 30 * 60_000), NOW).badgeTh).toContain(
      "30 นาที",
    );
  });
});
