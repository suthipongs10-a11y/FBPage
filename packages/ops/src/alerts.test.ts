import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import {
  AlertCenter,
  BATCH_THRESHOLD,
  InMemoryAlertStore,
  REMIND_AFTER_MS,
  inQuietHours,
  type AlertMessage,
  type AlertSink,
} from "./alerts.js";
import type { Problem, Severity } from "./problems.js";

const START = Date.UTC(2026, 7, 8, 3, 0, 0); // 10:00 น. เวลาไทย
const MIN = 60_000;
const HOUR = 3_600_000;

function problem(over: Partial<Problem> = {}): Problem {
  return {
    id: "webhook:p1",
    severity: "warning",
    kind: "webhook",
    pageId: "p1",
    pageName: "ครัวคุณยาย",
    clientName: "ครัวคุณยาย",
    colorIndex: 0,
    th: "ไม่ได้รับ webhook มา 45 นาที",
    ...over,
  };
}

class RecordingSink implements AlertSink {
  messages: AlertMessage[] = [];
  async send(m: AlertMessage): Promise<void> {
    this.messages.push(m);
  }
  get texts(): string[] {
    return this.messages.map((m) => m.th);
  }
}

function build(quiet?: { fromHour: number; toHour: number }): {
  center: AlertCenter;
  sink: RecordingSink;
  clock: FakeClock;
} {
  const clock = new FakeClock(START);
  const sink = new RecordingSink();
  const center = new AlertCenter({
    store: new InMemoryAlertStore(),
    sink,
    clock,
    ...(quiet
      ? { quietHours: { ...quiet, timeZone: "Asia/Bangkok" } }
      : {}),
  });
  return { center, sink, clock };
}

describe("เตือนครั้งแรก", () => {
  it("ปัญหาใหม่ → ส่งทันที", async () => {
    const { center, sink } = build();
    const r = await center.run([problem()]);
    expect(r.sent).toHaveLength(1);
    expect(sink.texts[0]).toContain("ครัวคุณยาย");
    expect(sink.texts[0]).toContain("webhook");
  });

  it("ไม่มีปัญหา → ไม่ส่งอะไรเลย", async () => {
    const { center, sink } = build();
    const r = await center.run([]);
    expect(sink.messages).toEqual([]);
    expect(r.th).toBe("ไม่มีอะไรต้องแจ้ง");
  });
});

describe("กันเตือนซ้ำจนคนปิดเสียง", () => {
  it("ปัญหาเดิมในรอบถัดมาทันที → ไม่ส่งซ้ำ", async () => {
    // worker รันทุก 5 นาที ถ้าส่งทุกรอบ = 12 ข้อความต่อชั่วโมงจากเรื่องเดียว
    const { center, sink, clock } = build();
    await center.run([problem()]);
    await clock.advance(5 * MIN);
    const r = await center.run([problem()]);

    expect(r.sent).toEqual([]);
    expect(r.heldBack).toBe(1);
    expect(sink.messages).toHaveLength(1);
  });

  it("ถึงรอบเตือนซ้ำแล้วส่งอีกครั้ง", async () => {
    const { center, sink, clock } = build();
    await center.run([problem()]);
    await clock.advance(REMIND_AFTER_MS[1]! + MIN);
    await center.run([problem()]);
    expect(sink.messages).toHaveLength(2);
  });

  it("ระยะห่างถ่างขึ้นเรื่อยๆ ไม่ใช่คงที่", async () => {
    const { center, sink, clock } = build();
    await center.run([problem()]); // ครั้งที่ 1

    // ครั้งที่ 2 หลัง 15 นาที
    await clock.advance(REMIND_AFTER_MS[1]!);
    await center.run([problem()]);
    expect(sink.messages).toHaveLength(2);

    // อีก 15 นาทีถัดมายังไม่ถึงรอบ (ต้องรอ 1 ชม.)
    await clock.advance(REMIND_AFTER_MS[1]!);
    await center.run([problem()]);
    expect(sink.messages).toHaveLength(2);

    await clock.advance(REMIND_AFTER_MS[2]!);
    await center.run([problem()]);
    expect(sink.messages).toHaveLength(3);
  });

  it("ปัญหาที่ค้างข้ามวันยังเตือนอยู่ ไม่เงียบหายไปเลย", async () => {
    // เงียบไปเลยแปลว่าลืม ซึ่งแย่พอๆ กับเตือนถี่
    const { center, sink, clock } = build();
    await center.run([problem()]);
    for (let i = 0; i < 10; i++) {
      await clock.advance(24 * HOUR + MIN);
      await center.run([problem()]);
    }
    expect(sink.messages.length).toBeGreaterThan(5);
  });
});

describe("ยกระดับความรุนแรง", () => {
  it("warning → critical ส่งทันที ไม่ต้องรอรอบ", async () => {
    // "webhook เงียบ 30 นาที" กับ "เงียบ 5 ชั่วโมง" คนละเรื่องกันในทางปฏิบัติ
    const { center, sink, clock } = build();
    await center.run([problem({ severity: "warning" })]);
    await clock.advance(MIN);
    const r = await center.run([
      problem({ severity: "critical", th: "ไม่ได้รับ webhook มา 5 ชม." }),
    ]);

    expect(r.sent).toHaveLength(1);
    expect(sink.messages).toHaveLength(2);
    expect(sink.texts[1]).toContain("ด่วน");
  });

  it("critical → warning ไม่ส่งซ้ำทันที (ดีขึ้นไม่ใช่เรื่องด่วน)", async () => {
    const { center, sink, clock } = build();
    await center.run([problem({ severity: "critical" })]);
    await clock.advance(MIN);
    await center.run([problem({ severity: "warning" })]);
    expect(sink.messages).toHaveLength(1);
  });
});

describe("บอกตอนกลับมาปกติ", () => {
  it("ปัญหาหายไป → ส่งข้อความว่ากลับมาปกติแล้ว", async () => {
    // ถ้าไม่บอก คนจะไม่กล้าเลิกสนใจ ต้องเข้าไปเช็คเองอยู่ดี
    const { center, sink } = build();
    await center.run([problem()]);
    const r = await center.run([]);

    expect(r.resolved).toEqual(["webhook:p1"]);
    expect(sink.texts[1]).toContain("กลับมาปกติ");
    expect(sink.texts[1]).toContain("ครัวคุณยาย");
  });

  it("ปัญหาที่ไม่เคยส่งแจ้งเตือน หายไปแล้วไม่ต้องบอก", async () => {
    // ไม่งั้นจะได้ข้อความ "กลับมาปกติ" ของเรื่องที่ไม่เคยรู้ว่ามี
    const { center, sink, clock } = build({ fromHour: 0, toHour: 24 });
    await center.run([problem()]); // ถูกกลั้นไว้เพราะเงียบทั้งวัน
    expect(sink.messages).toHaveLength(0);

    await clock.advance(MIN);
    const r = await center.run([]);
    expect(r.resolved).toEqual([]);
    expect(sink.messages).toHaveLength(0);
  });

  it("หายแล้วกลับมาใหม่ → ถือเป็นเรื่องใหม่ ส่งทันที", async () => {
    const { center, sink, clock } = build();
    await center.run([problem()]);
    await clock.advance(MIN);
    await center.run([]); // หาย
    await clock.advance(MIN);
    await center.run([problem()]); // กลับมา

    // ครั้งแรก + กลับมาปกติ + เกิดใหม่
    expect(sink.messages).toHaveLength(3);
    expect(sink.texts[2]).toContain("webhook");
  });
});

describe("รวมข้อความ", () => {
  it("เรื่องไม่ด่วนหลายเรื่อง → รวมเป็นข้อความเดียว", async () => {
    // token 8 เพจหมดพร้อมกันคือเรื่องเดียว ไม่ใช่ 8 เรื่อง
    const { center, sink } = build();
    const many = Array.from({ length: BATCH_THRESHOLD + 2 }, (_, i) =>
      problem({ id: `token:p${i}`, kind: "token", pageName: `เพจ ${i}` }),
    );
    await center.run(many);

    expect(sink.messages).toHaveLength(1);
    expect(sink.texts[0]).toContain(`มี ${many.length} เรื่อง`);
    expect(sink.messages[0]!.problemIds).toHaveLength(many.length);
  });

  it("น้อยกว่าเกณฑ์ → ส่งแยกทีละเรื่อง อ่านง่ายกว่า", async () => {
    const { center, sink } = build();
    await center.run([
      problem({ id: "a", pageName: "เพจ ก" }),
      problem({ id: "b", pageName: "เพจ ข" }),
    ]);
    expect(sink.messages).toHaveLength(2);
  });

  it("เรื่องด่วนแยกส่งเสมอ ไม่เอาไปรวมกับเรื่องไม่ด่วน", async () => {
    // ข้อความที่ขึ้นต้นว่า "มี 6 เรื่อง" ทำให้คนเลื่อนอ่านทีหลัง
    const { center, sink } = build();
    const problems = [
      problem({ id: "crit", severity: "critical", pageName: "เพจด่วน" }),
      ...Array.from({ length: BATCH_THRESHOLD + 1 }, (_, i) =>
        problem({ id: `warn${i}`, pageName: `เพจ ${i}` }),
      ),
    ];
    await center.run(problems);

    expect(sink.messages).toHaveLength(2);
    expect(sink.messages[0]!.severity).toBe("critical");
    expect(sink.texts[0]).toContain("เพจด่วน");
    expect(sink.messages[1]!.severity).toBe("warning");
  });
});

describe("ช่วงเวลาเงียบ", () => {
  it("เรื่องไม่ด่วนตอนดึก → กลั้นไว้", async () => {
    const { center, sink, clock } = build({ fromHour: 22, toHour: 7 });
    // 03:00 น. เวลาไทย
    await clock.advance(17 * HOUR);
    const r = await center.run([problem({ severity: "warning" })]);

    expect(sink.messages).toHaveLength(0);
    expect(r.heldBack).toBe(1);
    expect(r.th).toMatch(/พักไว้/);
  });

  it("เรื่องด่วนตอนดึก → ส่งอยู่ดี", async () => {
    // token หมดตอนตีสองแปลว่าโพสต์เช้าจะไม่ขึ้น ต้องรู้ก่อนตื่นมาเจอลูกค้าถาม
    const { center, sink, clock } = build({ fromHour: 22, toHour: 7 });
    await clock.advance(17 * HOUR);
    await center.run([problem({ severity: "critical" })]);
    expect(sink.messages).toHaveLength(1);
  });

  it("พ้นช่วงเงียบแล้วส่งของที่กลั้นไว้", async () => {
    const { center, sink, clock } = build({ fromHour: 22, toHour: 7 });
    await clock.advance(17 * HOUR); // 03:00 เงียบ
    await center.run([problem()]);
    expect(sink.messages).toHaveLength(0);

    await clock.advance(6 * HOUR); // 09:00 พ้นแล้ว
    await center.run([problem()]);
    expect(sink.messages).toHaveLength(1);
  });

  it("inQuietHours รองรับช่วงที่คร่อมเที่ยงคืน", () => {
    const q = { fromHour: 22, toHour: 7, timeZone: "Asia/Bangkok" };
    const at = (hourTh: number): number =>
      Date.UTC(2026, 7, 8, (hourTh - 7 + 24) % 24, 0, 0);
    expect(inQuietHours(at(23), q)).toBe(true);
    expect(inQuietHours(at(3), q)).toBe(true);
    expect(inQuietHours(at(7), q)).toBe(false);
    expect(inQuietHours(at(14), q)).toBe(false);
  });

  it("ช่วงที่ไม่คร่อมเที่ยงคืนก็ทำงานถูก", () => {
    const q = { fromHour: 12, toHour: 14, timeZone: "Asia/Bangkok" };
    const at = (hourTh: number): number =>
      Date.UTC(2026, 7, 8, (hourTh - 7 + 24) % 24, 0, 0);
    expect(inQuietHours(at(13), q)).toBe(true);
    expect(inQuietHours(at(15), q)).toBe(false);
    expect(inQuietHours(at(3), q)).toBe(false);
  });
});

describe("ความทนทาน", () => {
  it("รันซ้ำด้วยข้อมูลเดิมไม่ทำให้ส่งซ้ำ — worker ตายแล้วรันใหม่ได้", async () => {
    const { center, sink } = build();
    const set = [problem()];
    await center.run(set);
    await center.run(set);
    await center.run(set);
    expect(sink.messages).toHaveLength(1);
  });

  it("หลายเพจหลายลูกค้า แยกกันนับรอบเตือนซ้ำ", async () => {
    const { center, sink, clock } = build();
    await center.run([problem({ id: "a", pageId: "p1" })]);
    await clock.advance(MIN);
    await center.run([
      problem({ id: "a", pageId: "p1" }),
      problem({ id: "b", pageId: "p2", pageName: "เพจสอง" }),
    ]);
    // เพจแรกยังไม่ถึงรอบ เพจสองเพิ่งเกิด → ส่งเฉพาะเพจสอง
    expect(sink.messages).toHaveLength(2);
    expect(sink.texts[1]).toContain("เพจสอง");
  });

  it("สรุปผลบอกครบทั้งส่ง กลั้น และกลับมาปกติ", async () => {
    const { center, clock } = build();
    await center.run([problem({ id: "a" }), problem({ id: "b" })]);
    await clock.advance(MIN);
    const r = await center.run([problem({ id: "a" })]);
    expect(r.th).toMatch(/กลับมาปกติ 1 เรื่อง/);
    expect(r.th).toMatch(/พักไว้ 1 เรื่อง/);
  });
});

const severities: Severity[] = ["critical", "warning", "info"];
describe("ระดับความรุนแรง", () => {
  it("ทุกระดับมีป้ายภาษาไทยของตัวเอง", async () => {
    for (const severity of severities) {
      const { center, sink } = build();
      await center.run([problem({ severity })]);
      expect(sink.texts[0], severity).toMatch(/[ก-๙]/);
    }
  });
});

describe("ปัญหาที่แกว่งอยู่ตรงเส้นแบ่ง", () => {
  it("สลับ warning/critical ไปมา → ยกระดับได้ครั้งเดียว ไม่ส่งทุกรอบ", async () => {
    // webhook เงียบ 3 ชม. 58 นาที ↔ 4 ชม. 2 นาที ข้ามเส้นไปมาได้ทุกรอบที่ worker รัน
    // ถ้าเทียบกับ "ครั้งก่อน" จะนับเป็นยกระดับทุกครั้งที่ข้ามขึ้น = ส่งทุก 5 นาที
    const { center, sink, clock } = build();
    await center.run([problem({ severity: "warning" })]);
    expect(sink.messages).toHaveLength(1);

    for (let i = 0; i < 6; i++) {
      await clock.advance(MIN);
      await center.run([problem({ severity: "critical" })]);
      await clock.advance(MIN);
      await center.run([problem({ severity: "warning" })]);
    }

    // ครั้งแรก + ยกระดับอีกครั้งเดียว
    expect(sink.messages).toHaveLength(2);
  });

  it("หายแล้วกลับมาแรงกว่าเดิม → นับเป็นเรื่องใหม่ ยกระดับได้อีก", async () => {
    const { center, sink, clock } = build();
    await center.run([problem({ severity: "warning" })]);
    await clock.advance(MIN);
    await center.run([]); // หาย → สถานะถูกล้าง
    await clock.advance(MIN);
    await center.run([problem({ severity: "warning" })]);
    await clock.advance(MIN);
    await center.run([problem({ severity: "critical" })]);

    // แรก + กลับมาปกติ + เกิดใหม่ + ยกระดับ
    expect(sink.messages).toHaveLength(4);
  });
});
