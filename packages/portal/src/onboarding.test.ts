import { describe, expect, it } from "vitest";
import {
  TOTAL_MINUTES,
  checkReadyToInvite,
  onboardingProgress,
  type OnboardingState,
} from "./onboarding.js";

function state(over: Partial<OnboardingState> = {}): OnboardingState {
  return {
    connectedPages: 0,
    briefReady: false,
    templatesApplied: 0,
    scheduledPosts: 0,
    brandingReady: false,
    clientInvited: false,
    ...over,
  };
}

const ALL_DONE: OnboardingState = {
  connectedPages: 2,
  briefReady: true,
  templatesApplied: 3,
  scheduledPosts: 21,
  brandingReady: true,
  clientInvited: true,
};

describe("onboardingProgress", () => {
  it("เริ่มจากศูนย์ → ขั้นแรกคือเชื่อมเพจ", () => {
    const p = onboardingProgress(state());
    expect(p.doneCount).toBe(0);
    expect(p.nextStep?.id).toBe("connect_page");
    expect(p.nextStep?.available).toBe(true);
  });

  it("เกณฑ์รับงานของ M-H คือ 30 นาที — เวลารวมต้องไม่เกินนั้น", () => {
    expect(TOTAL_MINUTES).toBeLessThanOrEqual(30);
    expect(onboardingProgress(state()).minutesLeft).toBe(TOTAL_MINUTES);
  });

  it("ยังไม่เชื่อมเพจ → ขั้นอื่นทำไม่ได้ พร้อมบอกว่าติดอะไร", () => {
    const p = onboardingProgress(state());
    const brief = p.steps.find((s) => s.id === "brand_brief")!;
    expect(brief.available).toBe(false);
    expect(brief.blockedByTh).toMatch(/เชื่อมเพจ/);
  });

  it("สร้างปฏิทินต้องรอ Brand Brief ก่อน", () => {
    // ทำสลับลำดับจะได้โพสต์กลางๆ ที่ต้องทิ้งทั้งเดือนแล้วทำใหม่
    const p = onboardingProgress(state({ connectedPages: 1, templatesApplied: 1 }));
    const cal = p.steps.find((s) => s.id === "content_calendar")!;
    expect(cal.available).toBe(false);
    expect(cal.blockedByTh).toMatch(/Brand Brief/);
  });

  it("ครบเงื่อนไขแล้ว → ขั้นสร้างปฏิทินเปิดให้ทำ", () => {
    const p = onboardingProgress(
      state({ connectedPages: 1, briefReady: true, templatesApplied: 1 }),
    );
    expect(p.steps.find((s) => s.id === "content_calendar")!.available).toBe(true);
  });

  it("ขั้นถัดไปต้องเป็นขั้นที่ทำได้จริง ไม่ใช่ขั้นแรกที่ยังไม่เสร็จ", () => {
    // ชี้ไปที่ขั้นที่ยังทำไม่ได้ = คนไปนั่งงงหน้าจอที่กดอะไรไม่ได้
    const p = onboardingProgress(state({ connectedPages: 1, briefReady: true }));
    expect(p.nextStep?.id).toBe("apply_templates");
    expect(p.nextStep?.available).toBe(true);
  });

  it("ส่งลิงก์ให้ลูกค้าเป็นขั้นสุดท้ายเสมอ", () => {
    const p = onboardingProgress(
      state({
        connectedPages: 1,
        briefReady: true,
        templatesApplied: 1,
        brandingReady: true,
      }),
    );
    // ปฏิทินยังว่าง → ยังส่งลิงก์ไม่ได้
    expect(p.steps.find((s) => s.id === "invite_client")!.available).toBe(false);
    expect(p.readyToInvite).toBe(false);
  });

  it("ทุกขั้นเสร็จ → บอกว่าลูกค้าเข้าใช้ได้แล้ว", () => {
    const p = onboardingProgress(ALL_DONE);
    expect(p.doneCount).toBe(p.steps.length);
    expect(p.nextStep).toBeNull();
    expect(p.minutesLeft).toBe(0);
    expect(p.th).toMatch(/ลูกค้าเข้าใช้งานได้เลย/);
  });

  it("เวลาที่เหลือลดลงตามขั้นที่ทำเสร็จ", () => {
    const before = onboardingProgress(state()).minutesLeft;
    const after = onboardingProgress(state({ connectedPages: 1 })).minutesLeft;
    expect(after).toBeLessThan(before);
  });

  it("ข้อความบอกทั้งขั้นถัดไปและเวลาที่เหลือ", () => {
    const p = onboardingProgress(state());
    expect(p.th).toMatch(/เชื่อมเพจ Facebook/);
    expect(p.th).toMatch(/นาที/);
  });

  it("ทุกขั้นมีคำอธิบายว่าทำไมต้องมี", () => {
    for (const s of onboardingProgress(state()).steps) {
      expect(s.whyTh.length, s.id).toBeGreaterThan(20);
    }
  });

  it("ขั้นที่ทำได้แล้ว ไม่มีข้อความบอกว่าติดอะไร", () => {
    const p = onboardingProgress(state({ connectedPages: 1 }));
    expect(p.steps.find((s) => s.id === "brand_brief")!.blockedByTh).toBeUndefined();
  });
});

describe("checkReadyToInvite", () => {
  it("ครบทุกอย่าง → ส่งลิงก์ได้", () => {
    const r = checkReadyToInvite(ALL_DONE);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("ปฏิทินยังว่าง → ห้ามส่ง ลูกค้าจะเปิดมาเจอหน้าเปล่า", () => {
    const r = checkReadyToInvite({ ...ALL_DONE, scheduledPosts: 0 });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /หน้าเปล่า/.test(b))).toBe(true);
  });

  it("ยังไม่ได้ตั้งแบรนด์ → ห้ามส่ง", () => {
    const r = checkReadyToInvite({ ...ALL_DONE, brandingReady: false });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /โลโก้/.test(b))).toBe(true);
  });

  it("บอกทุกอย่างที่ขาดพร้อมกัน ไม่ใช่ทีละอัน", () => {
    // บอกทีละอันแปลว่าต้องกดแล้วรอ แล้วกดใหม่ ซึ่งเสียเวลากว่าที่ควร
    const r = checkReadyToInvite(state());
    expect(r.blockers.length).toBeGreaterThan(2);
    expect(r.th).toMatch(/ยังส่งลิงก์ไม่ได้/);
  });
});

describe("ความสอดคล้องระหว่างสองตัวตรวจ", () => {
  it("readyToInvite ตรงกับ checkReadyToInvite เสมอ แม้ข้อมูลจะเพี้ยน", () => {
    // เคสที่เคยทำให้สองที่ตอบไม่ตรงกัน: มีโพสต์ในปฏิทินทั้งที่ brief ยังไม่ครบ
    const weird = state({
      connectedPages: 1,
      briefReady: false,
      templatesApplied: 1,
      scheduledPosts: 10,
      brandingReady: true,
    });
    expect(onboardingProgress(weird).readyToInvite).toBe(
      checkReadyToInvite(weird).ok,
    );
  });

  it("ตรงกันในทุกชุดสถานะที่เป็นไปได้", () => {
    const bools = [false, true];
    for (const briefReady of bools) {
      for (const brandingReady of bools) {
        for (const pages of [0, 1]) {
          for (const posts of [0, 5]) {
            const s = state({
              connectedPages: pages,
              briefReady,
              brandingReady,
              scheduledPosts: posts,
              templatesApplied: 1,
            });
            expect(onboardingProgress(s).readyToInvite, JSON.stringify(s)).toBe(
              checkReadyToInvite(s).ok,
            );
          }
        }
      }
    }
  });
});
