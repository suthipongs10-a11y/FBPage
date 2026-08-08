import { describe, expect, it } from "vitest";
import { expectThaiRejection } from "@page-os/core/testing";
import type { SlotScore } from "@page-os/publish";
import type { BrandBrief } from "./brand.js";
import {
  MAX_POSTS_PER_DAY,
  MIN_GAP_HOURS,
  buildMonthCalendar,
  buildWeeklySlots,
  describeCalendar,
  groupByLocalDate,
  planCalendarSlots,
  rescheduleEntry,
  type ContentCalendar,
} from "./calendar.js";
import type { ContentLlm } from "./generator.js";
import { DEFAULT_PILLARS } from "./pillars.js";

const TZ = "Asia/Bangkok";
/** 8 ส.ค. 2026 10:00 น. เวลาไทย (UTC+7) */
const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);

const BRIEF: BrandBrief = {
  pageId: "p1",
  brandName: "ครัวคุณยาย",
  business: "ร้านอาหารตามสั่งและข้าวกล่องส่งออฟฟิศ",
  audience: "พนักงานออฟฟิศวัย 25-40 ย่านรัชดา ที่ไม่มีเวลาทำกับข้าว",
  products: ["ข้าวกล่องรายวัน"],
  ctas: ["ทักแชทสั่งเลย"],
  bannedWords: [],
};

function slot(dayOfWeek: number, hour: number, score = 1): SlotScore {
  return { dayOfWeek, hour, score, samples: 5, label: `${dayOfWeek} ${hour}` };
}

/** ชั่วโมงตาม timezone ที่กำหนด — ใช้ยืนยันว่าเวลาไม่เพี้ยนตอนแปลง UTC */
function localHour(atMs: number, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
    }).format(new Date(atMs)),
  );
}

class FakeLlm implements ContentLlm {
  async generatePosts(args: {
    brief: string;
    topic: string;
    slots: Array<{ pillar: string; guidance: string }>;
  }): Promise<Array<{ idea: string; body: string; hashtags?: string[] }>> {
    return args.slots.map((s, i) => ({
      idea: `ไอเดีย ${i}`,
      body: `เนื้อโพสต์ ${s.pillar} ลำดับ ${i} ทักแชทสั่งเลย`,
      hashtags: ["ข้าวกล่อง"],
    }));
  }
}

describe("buildWeeklySlots", () => {
  it("ใช้เวลาที่เพจได้ผลจริงก่อน", () => {
    const t = buildWeeklySlots({
      bestTimes: [slot(4, 19), slot(2, 12)],
      postsPerWeek: 2,
    });
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.fromBestTime)).toBe(true);
  });

  it("ขอมากกว่าเวลาที่รู้ → เติมวันที่ยังว่าง ไม่ยัดวันเดิม", () => {
    const t = buildWeeklySlots({ bestTimes: [slot(1, 19)], postsPerWeek: 4 });
    expect(t).toHaveLength(4);
    expect(new Set(t.map((x) => x.dayOfWeek)).size).toBe(4);
  });

  it("เวลาสำรองยึดชั่วโมงที่เพจได้ผลจริงเป็นหลัก ไม่ใช่ค่ากลาง", () => {
    // เพจที่คนอ่านตอนดึก ไม่ควรโดนยัดโพสต์เที่ยงวันเพราะเป็นค่า default
    const t = buildWeeklySlots({ bestTimes: [slot(1, 22)], postsPerWeek: 3 });
    expect(t.every((x) => x.hour === 22)).toBe(true);
  });

  it("ไม่มีข้อมูลเลย → ใช้เวลาสำรอง และกระจายวัน", () => {
    const t = buildWeeklySlots({ bestTimes: [], postsPerWeek: 3 });
    expect(t).toHaveLength(3);
    expect(t.every((x) => !x.fromBestTime)).toBe(true);
    expect(new Set(t.map((x) => x.dayOfWeek)).size).toBe(3);
  });

  it("กระจายวันไม่ให้กระจุกต้นสัปดาห์แล้วเงียบไปสี่วัน", () => {
    const t = buildWeeklySlots({ bestTimes: [], postsPerWeek: 3 });
    const days = t.map((x) => x.dayOfWeek).sort((a, b) => a - b);
    // 3 โพสต์ใน 7 วัน ห่างกันอย่างน้อย 2 วัน ถ้ากระจายจริง
    expect(days[1]! - days[0]!).toBeGreaterThanOrEqual(2);
  });

  it("สองโพสต์ในวันเดียวกันต้องห่างกันพอ ไม่แย่ง reach กันเอง", () => {
    const t = buildWeeklySlots({
      bestTimes: [slot(1, 19), slot(1, 20)],
      postsPerWeek: 2,
    });
    const monday = t.filter((x) => x.dayOfWeek === 1);
    if (monday.length === 2) {
      expect(Math.abs(monday[0]!.hour - monday[1]!.hour)).toBeGreaterThanOrEqual(
        MIN_GAP_HOURS,
      );
    }
  });

  it("ขอ 0 โพสต์ต่อสัปดาห์ → ตารางว่าง", () => {
    expect(buildWeeklySlots({ bestTimes: [], postsPerWeek: 0 })).toEqual([]);
  });

  it("เวลาที่ดีที่สุดกระจุกอยู่วันเดียว → ไม่ยัดทั้งหมดลงวันนั้น", () => {
    // เพจที่โพสต์วันพฤหัสทุกสัปดาห์จะมีคะแนนสูงสุด 5 อันดับอยู่วันพฤหัสหมด
    // ถ้าเชื่อคะแนนอย่างเดียว ตารางจะเป็นโพสต์พฤหัส 5 ครั้งแล้วเงียบหกวัน
    const t = buildWeeklySlots({
      bestTimes: [slot(4, 8), slot(4, 12), slot(4, 16), slot(4, 20), slot(4, 22)],
      postsPerWeek: 5,
    });
    expect(t.filter((x) => x.dayOfWeek === 4).length).toBeLessThanOrEqual(
      MAX_POSTS_PER_DAY,
    );
    expect(new Set(t.map((x) => x.dayOfWeek)).size).toBeGreaterThan(1);
  });

  it("ขอโพสต์ถี่เกินกว่าที่วันจะรับไหว → ได้เท่าที่ลงได้ ไม่ยัดจนชนกันเอง", () => {
    const t = buildWeeklySlots({ bestTimes: [], postsPerWeek: 30 });
    expect(t.length).toBeLessThanOrEqual(7 * MAX_POSTS_PER_DAY);
    for (let d = 0; d < 7; d++) {
      expect(t.filter((x) => x.dayOfWeek === d).length).toBeLessThanOrEqual(
        MAX_POSTS_PER_DAY,
      );
    }
  });

  it("เรียงตามวันแล้วเวลา ให้อ่านง่ายในหน้าตั้งค่า", () => {
    const t = buildWeeklySlots({ bestTimes: [], postsPerWeek: 5 });
    const sorted = [...t].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour);
    expect(t).toEqual(sorted);
  });
});

describe("planCalendarSlots", () => {
  it("เวลาที่ได้เป็น UTC แต่ตรงกับชั่วโมงท้องถิ่นที่ตั้งไว้ (กฎข้อ 4)", () => {
    const slots = planCalendarSlots({
      startAtMs: NOW,
      nowMs: NOW,
      timeZone: TZ,
      days: 7,
      postsPerWeek: 2,
      bestTimes: [slot(4, 19), slot(1, 12)],
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(localHour(s.atMs, TZ)).toBe(s.hour);
      expect([19, 12]).toContain(s.hour);
    }
  });

  it("ข้ามช่องที่เวลาผ่านไปแล้ว — ไม่งั้น worker หยิบไปโพสต์ทันที", () => {
    // ตอนนี้ 10:00 น. วันเสาร์ ช่อง 09:00 ของวันเดียวกันต้องไม่ติดมา
    const saturday = new Date(NOW).getUTCDay();
    const slots = planCalendarSlots({
      startAtMs: NOW,
      nowMs: NOW,
      timeZone: TZ,
      days: 1,
      postsPerWeek: 1,
      bestTimes: [slot(saturday, 9)],
    });
    expect(slots).toEqual([]);
  });

  it("ช่องที่ยังมาไม่ถึงในวันเดียวกัน ยังใช้ได้", () => {
    const saturday = new Date(NOW).getUTCDay();
    const slots = planCalendarSlots({
      startAtMs: NOW,
      nowMs: NOW,
      timeZone: TZ,
      days: 1,
      postsPerWeek: 1,
      bestTimes: [slot(saturday, 19)],
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.atMs).toBeGreaterThan(NOW);
  });

  it("30 วัน 5 โพสต์/สัปดาห์ → ได้ราวๆ 20 กว่าโพสต์", () => {
    const slots = planCalendarSlots({
      startAtMs: NOW,
      nowMs: NOW,
      timeZone: TZ,
      days: 30,
      postsPerWeek: 5,
    });
    expect(slots.length).toBeGreaterThanOrEqual(19);
    expect(slots.length).toBeLessThanOrEqual(23);
  });

  it("เรียงตามเวลาเสมอ", () => {
    const slots = planCalendarSlots({
      startAtMs: NOW,
      nowMs: NOW,
      timeZone: TZ,
      days: 30,
      postsPerWeek: 5,
    });
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.atMs).toBeGreaterThan(slots[i - 1]!.atMs);
    }
  });

  it("จำกัดจำนวนโพสต์สูงสุดได้ (โควตาของแพ็กเกจลูกค้า)", () => {
    const slots = planCalendarSlots({
      startAtMs: NOW,
      nowMs: NOW,
      timeZone: TZ,
      days: 30,
      postsPerWeek: 5,
      maxPosts: 8,
    });
    expect(slots).toHaveLength(8);
  });

  it("ข้ามเส้นเปลี่ยน DST แล้วเวลาท้องถิ่นต้องไม่เพี้ยน", () => {
    // อเมริกาเปลี่ยนเวลา 8 มี.ค. 2026 — บวกวันเป็นมิลลิวินาทีจะทำให้
    // โพสต์หลังวันนั้นเลื่อนไปหนึ่งชั่วโมงทั้งหมด
    const start = Date.UTC(2026, 2, 1, 12, 0, 0);
    const slots = planCalendarSlots({
      startAtMs: start,
      nowMs: start,
      timeZone: "America/New_York",
      days: 21,
      postsPerWeek: 7,
      bestTimes: [0, 1, 2, 3, 4, 5, 6].map((d) => slot(d, 9)),
    });
    expect(slots.length).toBeGreaterThan(14);
    for (const s of slots) {
      expect(localHour(s.atMs, "America/New_York")).toBe(9);
    }
  });

  it("ขอ 0 วัน → ปฏิทินว่าง", () => {
    expect(
      planCalendarSlots({ startAtMs: NOW, nowMs: NOW, timeZone: TZ, days: 0 }),
    ).toEqual([]);
  });

  it("บอกได้ว่าช่องไหนมาจากข้อมูลจริง ช่องไหนเป็นค่าสำรอง", () => {
    const slots = planCalendarSlots({
      startAtMs: NOW,
      nowMs: NOW,
      timeZone: TZ,
      days: 14,
      postsPerWeek: 3,
      bestTimes: [slot(1, 19)],
    });
    expect(slots.some((s) => s.fromBestTime)).toBe(true);
    expect(slots.some((s) => !s.fromBestTime)).toBe(true);
  });
});

describe("buildMonthCalendar", () => {
  const base = {
    brief: BRIEF,
    topic: "ข้าวกล่องประจำเดือน",
    llm: new FakeLlm(),
    timeZone: TZ,
    startAtMs: NOW,
    nowMs: NOW,
    pillars: DEFAULT_PILLARS,
  };

  it("กดปุ่มเดียวได้ปฏิทินพร้อมเนื้อหาครบทุกช่อง", async () => {
    const cal = await buildMonthCalendar({ ...base, days: 30, postsPerWeek: 5 });
    expect(cal.entries.length).toBeGreaterThan(15);
    expect(cal.entries.every((e) => e.status === "draft")).toBe(true);
    expect(cal.entries.every((e) => e.post !== undefined)).toBe(true);
    expect(cal.pageId).toBe("p1");
  });

  it("สัดส่วนเสาหลักในปฏิทินตรงกับที่ตั้งไว้", async () => {
    const cal = await buildMonthCalendar({ ...base, days: 30, postsPerWeek: 7 });
    const educate = cal.mix.find((m) => m.key === "educate")!;
    expect(educate.percent).toBeGreaterThan(30);
    expect(educate.percent).toBeLessThan(50);
  });

  it("Brand Brief ยังไม่ครบ → ไม่ยอมสร้าง และบอกว่าขาดอะไร", async () => {
    // เจตนา: ปล่อยให้สร้างจาก brief ครึ่งๆ = ได้โพสต์กลางๆ 20 อันที่ต้องแก้ทุกอัน
    // ซึ่งช้ากว่าเขียนเองตั้งแต่แรก
    const err = await expectThaiRejection(
      buildMonthCalendar({ ...base, brief: { ...BRIEF, ctas: [], products: [] } }),
    );
    expect(err.th).toMatch(/CTA ประจำ/);
    expect(err.th).toMatch(/สินค้า\/บริการ/);
  });

  it("ไม่มีข้อมูล Insights → เตือนว่าใช้เวลามาตรฐานไปก่อน", async () => {
    const cal = await buildMonthCalendar({
      ...base,
      days: 14,
      postsPerWeek: 3,
      bestTimesConfident: false,
    });
    expect(cal.warnings.some((w) => /ยังไม่มีข้อมูล Insights/.test(w))).toBe(true);
  });

  it("มีข้อมูล Insights → ไม่ต้องเตือน", async () => {
    const cal = await buildMonthCalendar({
      ...base,
      days: 14,
      postsPerWeek: 3,
      bestTimes: [slot(1, 19), slot(3, 12), slot(5, 20)],
      bestTimesConfident: true,
    });
    expect(cal.warnings.some((w) => /Insights/.test(w))).toBe(false);
  });

  it("AI สร้างไม่ครบ → ช่องที่ขาดถูกทำเครื่องหมายให้เติมเอง ไม่ล้มทั้งปฏิทิน", async () => {
    const lazy: ContentLlm = {
      async generatePosts() {
        return [{ idea: "อันเดียว", body: "โพสต์เดียวจบ ทักแชทสั่งเลย" }];
      },
    };
    const cal = await buildMonthCalendar({
      ...base,
      llm: lazy,
      days: 14,
      postsPerWeek: 3,
    });
    expect(cal.entries.filter((e) => e.status === "needs_content").length).toBeGreaterThan(0);
    expect(cal.warnings.some((w) => /ต้องเติมเองก่อนอนุมัติ/.test(w))).toBe(true);
  });

  it("โพสต์ถูกตัดเพราะซ้ำกันเอง → เสาหลักของช่องที่เหลือต้องไม่เลื่อน", async () => {
    // generateBatch ตัดตัวซ้ำออก จำนวนจึงน้อยกว่าแผน
    // ถ้าจับคู่ด้วย index ตรงๆ โพสต์แนว "ให้ความรู้" จะไปขึ้นว่าเป็น "ขาย"
    const dupes: ContentLlm = {
      async generatePosts(args) {
        return args.slots.map((_, i) => ({
          idea: `i${i}`,
          // สองอันแรกเหมือนกันเป๊ะ → ตัวที่สองโดนตัด
          body: i <= 1 ? "ข้อความซ้ำกันเป๊ะ ทักแชทสั่งเลย" : `โพสต์ ${i} ทักแชทสั่งเลย`,
        }));
      },
    };
    const cal = await buildMonthCalendar({
      ...base,
      llm: dupes,
      days: 14,
      postsPerWeek: 3,
    });

    for (const e of cal.entries) {
      if (e.post) {
        expect(e.pillar).toBe(e.post.pillar);
        expect(e.pillarLabelTh).toBe(e.post.pillarLabelTh);
      }
    }
  });

  it("สัดส่วนที่แสดง สรุปจากของที่จะโพสต์จริง ไม่ใช่จากแผนที่ขอไป", async () => {
    const cal = await buildMonthCalendar({ ...base, days: 14, postsPerWeek: 3 });
    const fromEntries = new Map<string, number>();
    for (const e of cal.entries) {
      fromEntries.set(e.pillar, (fromEntries.get(e.pillar) ?? 0) + 1);
    }
    for (const m of cal.mix) expect(m.count).toBe(fromEntries.get(m.key));
    expect(cal.mix.reduce((s, m) => s + m.count, 0)).toBe(cal.entries.length);
  });

  it("โพสต์ที่มีคำเตือน → สรุปไว้ในระดับปฏิทินให้เห็นก่อนกดอนุมัติ", async () => {
    const noCta: ContentLlm = {
      async generatePosts(args) {
        return args.slots.map((_, i) => ({
          idea: `i${i}`,
          body: `โพสต์ที่ ${i} ไม่มีคำชวนอะไรเลย`,
        }));
      },
    };
    const cal = await buildMonthCalendar({
      ...base,
      llm: noCta,
      days: 7,
      postsPerWeek: 2,
    });
    expect(cal.warnings.some((w) => /ระบบขึ้นเตือน/.test(w))).toBe(true);
  });

  it("หาเวลาไม่ได้เลย → error ไทยที่บอกทางออก", async () => {
    await expect(
      buildMonthCalendar({ ...base, days: 30, postsPerWeek: 0 }),
    ).rejects.toMatchObject({
      th: expect.stringMatching(/ขยายจำนวนวัน|เพิ่มจำนวนโพสต์/),
    });
  });

  it("ทุกโพสต์ในปฏิทินอยู่ในอนาคต", async () => {
    const cal = await buildMonthCalendar({ ...base, days: 30, postsPerWeek: 5 });
    expect(cal.entries.every((e) => e.slot.atMs > NOW)).toBe(true);
  });
});

describe("rescheduleEntry", () => {
  async function calendar(): Promise<ContentCalendar> {
    return buildMonthCalendar({
      brief: BRIEF,
      topic: "t",
      llm: new FakeLlm(),
      timeZone: TZ,
      startAtMs: NOW,
      nowMs: NOW,
      pillars: DEFAULT_PILLARS,
      days: 14,
      postsPerWeek: 2,
    });
  }

  it("เลื่อนไปเวลาว่าง → สำเร็จ และรายการยังเรียงตามเวลา", async () => {
    const cal = await calendar();
    const to = cal.entries[0]!.slot.atMs + 2 * 86_400_000;
    const r = rescheduleEntry({ calendar: cal, index: 0, toAtMs: to, nowMs: NOW });

    expect(r.ok).toBe(true);
    const moved = r.calendar.entries.find((e) => e.index === 0)!;
    expect(moved.slot.atMs).toBe(to);
    for (let i = 1; i < r.calendar.entries.length; i++) {
      expect(r.calendar.entries[i]!.slot.atMs).toBeGreaterThanOrEqual(
        r.calendar.entries[i - 1]!.slot.atMs,
      );
    }
  });

  it("ลากไปวางในอดีต → ปฏิเสธพร้อมบอกว่าจะเกิดอะไร", async () => {
    const cal = await calendar();
    const r = rescheduleEntry({
      calendar: cal,
      index: 0,
      toAtMs: NOW - 3_600_000,
      nowMs: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.th).toMatch(/โพสต์ทันที/);
    expect(r.calendar).toBe(cal);
  });

  it("ลากไปชนโพสต์อื่น → ปฏิเสธพร้อมบอกว่าชนกับอันไหน", async () => {
    const cal = await calendar();
    const target = cal.entries[1]!.slot.atMs + 3_600_000;
    const r = rescheduleEntry({ calendar: cal, index: 0, toAtMs: target, nowMs: NOW });
    expect(r.ok).toBe(false);
    expect(r.th).toMatch(/แย่ง reach/);
  });

  it("ห่างพอดีเกณฑ์ → ผ่าน", async () => {
    const cal = await calendar();
    const target = cal.entries[1]!.slot.atMs + MIN_GAP_HOURS * 3_600_000;
    const r = rescheduleEntry({ calendar: cal, index: 0, toAtMs: target, nowMs: NOW });
    expect(r.ok).toBe(true);
  });

  it("ลำดับที่ไม่มีอยู่ → บอกไปตรงๆ ไม่เงียบ", async () => {
    const cal = await calendar();
    const r = rescheduleEntry({ calendar: cal, index: 999, toAtMs: NOW + 86_400_000, nowMs: NOW });
    expect(r.ok).toBe(false);
    expect(r.th).toMatch(/ไม่พบโพสต์/);
  });

  it("เลื่อนเองแล้ว ไม่นับเป็นเวลาที่ระบบแนะนำอีกต่อไป", async () => {
    const cal = await calendar();
    const to = cal.entries[0]!.slot.atMs + 3 * 86_400_000 + 3_600_000;
    const r = rescheduleEntry({ calendar: cal, index: 0, toAtMs: to, nowMs: NOW });
    expect(r.calendar.entries.find((e) => e.index === 0)!.slot.fromBestTime).toBe(false);
  });

  it("ช่วงของปฏิทินขยับตามหลังเลื่อน — ไม่ปล่อยให้คนถือค่าที่ค้าง", async () => {
    const cal = await calendar();
    const to = cal.endAtMs + 3 * 86_400_000;
    const r = rescheduleEntry({ calendar: cal, index: 0, toAtMs: to, nowMs: NOW });
    expect(r.ok).toBe(true);
    expect(r.calendar.endAtMs).toBe(to);
    expect(r.calendar.startAtMs).toBe(r.calendar.entries[0]!.slot.atMs);
    // ของเดิมต้องไม่ถูกแก้ในที่
    expect(cal.endAtMs).not.toBe(to);
  });

  it("ข้อความแสดงผลอัปเดตตามเวลาใหม่", async () => {
    const cal = await calendar();
    const to = cal.entries[0]!.slot.atMs + 3 * 86_400_000;
    const r = rescheduleEntry({ calendar: cal, index: 0, toAtMs: to, nowMs: NOW });
    const moved = r.calendar.entries.find((e) => e.index === 0)!;
    expect(moved.th).toContain(moved.slot.localText);
  });
});

describe("describeCalendar / groupByLocalDate", () => {
  it("สรุปเป็นบรรทัดเดียวสำหรับการ์ดเพจในแดชบอร์ด", async () => {
    const cal = await buildMonthCalendar({
      brief: BRIEF,
      topic: "t",
      llm: new FakeLlm(),
      timeZone: TZ,
      startAtMs: NOW,
      nowMs: NOW,
      pillars: DEFAULT_PILLARS,
      days: 30,
      postsPerWeek: 5,
    });
    const text = describeCalendar(cal);
    expect(text).toMatch(/พร้อมรีวิว/);
    expect(text).toMatch(/ให้ความรู้/);
  });

  it("จัดกลุ่มตามวันท้องถิ่น เรียงจากวันแรก", async () => {
    const cal = await buildMonthCalendar({
      brief: BRIEF,
      topic: "t",
      llm: new FakeLlm(),
      timeZone: TZ,
      startAtMs: NOW,
      nowMs: NOW,
      pillars: DEFAULT_PILLARS,
      days: 14,
      postsPerWeek: 3,
    });
    const groups = groupByLocalDate(cal);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups[0]!.date < groups[1]!.date).toBe(true);
    expect(groups[0]!.dayLabelTh).toMatch(/จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์/);
    const total = groups.reduce((s, g) => s + g.entries.length, 0);
    expect(total).toBe(cal.entries.length);
  });
});
