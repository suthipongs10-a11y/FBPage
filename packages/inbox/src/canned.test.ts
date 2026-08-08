import { describe, expect, it } from "vitest";
import {
  HOLDING_REPLY_TH,
  buildEscalation,
  escalationReasonTh,
  findByShortcut,
  renderCanned,
  searchCanned,
  type CannedReply,
  type EscalationReason,
} from "./canned.js";

const REPLIES: CannedReply[] = [
  {
    id: "1",
    pageId: "p1",
    shortcut: "/ราคา",
    title: "แจ้งราคา",
    body: "สวัสดีค่ะ {ชื่อลูกค้า} ราคาสินค้าเริ่มต้นที่ 250 บาทค่ะ",
    order: 1,
  },
  {
    id: "2",
    pageId: "p1",
    shortcut: "/ส่ง",
    title: "ค่าจัดส่ง",
    body: "ค่าส่ง 50 บาททั่วประเทศค่ะ",
    order: 2,
  },
  {
    id: "3",
    pageId: "p2",
    shortcut: "/ราคา",
    title: "ราคาเพจสอง",
    body: "ราคาของ{ชื่อร้าน}เริ่มที่ 500 บาทค่ะ",
  },
];

describe("renderCanned — ตัวแปรในคำตอบสำเร็จรูป", () => {
  it("แทนค่าตัวแปรภาษาไทย", () => {
    expect(
      renderCanned("สวัสดีค่ะ {ชื่อลูกค้า} ยินดีต้อนรับสู่ {ชื่อร้าน}", {
        ชื่อลูกค้า: "คุณสมชาย",
        ชื่อร้าน: "ร้านกาแฟดีดี",
      }),
    ).toBe("สวัสดีค่ะ คุณสมชาย ยินดีต้อนรับสู่ ร้านกาแฟดีดี");
  });

  it("ตัวแปรที่ไม่มีค่าถูกตัดทิ้ง ไม่ทิ้งวงเล็บให้ลูกค้าเห็น", () => {
    const out = renderCanned("สวัสดีค่ะ {ชื่อลูกค้า} มีอะไรให้ช่วยไหมคะ");
    expect(out).not.toContain("{");
    expect(out).toBe("สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ");
  });

  it("เก็บกวาดช่องว่างซ้ำที่เหลือจากตัวแปรที่ถูกตัด", () => {
    expect(renderCanned("ขอบคุณ {ชื่อลูกค้า}  ค่ะ")).toBe("ขอบคุณ ค่ะ");
  });

  it("ไม่ทิ้งช่องว่างหน้าเครื่องหมายวรรคตอน", () => {
    expect(renderCanned("สวัสดี {ชื่อลูกค้า}, ยินดีค่ะ")).toBe(
      "สวัสดี, ยินดีค่ะ",
    );
  });

  it("ข้อความที่ไม่มีตัวแปรไม่เปลี่ยน", () => {
    expect(renderCanned("ค่าส่ง 50 บาทค่ะ")).toBe("ค่าส่ง 50 บาทค่ะ");
  });
});

describe("findByShortcut", () => {
  it("หาเจอจาก shortcut ที่พิมพ์", () => {
    expect(findByShortcut(REPLIES, "p1", "/ราคา")?.id).toBe("1");
  });

  it("แยกตามเพจ — shortcut เดียวกันคนละเพจได้คนละคำตอบ", () => {
    expect(findByShortcut(REPLIES, "p1", "/ราคา")?.id).toBe("1");
    expect(findByShortcut(REPLIES, "p2", "/ราคา")?.id).toBe("3");
  });

  it("ตัดช่องว่างและไม่สนตัวพิมพ์", () => {
    expect(findByShortcut(REPLIES, "p1", "  /ส่ง  ")?.id).toBe("2");
  });

  it("ไม่เจอคืน null", () => {
    expect(findByShortcut(REPLIES, "p1", "/ไม่มี")).toBeNull();
    expect(findByShortcut(REPLIES, "p9", "/ราคา")).toBeNull();
    expect(findByShortcut(REPLIES, "p1", "  ")).toBeNull();
  });
});

describe("searchCanned", () => {
  it("คืนเฉพาะของเพจนั้น เรียงตาม order", () => {
    const r = searchCanned(REPLIES, "p1", "");
    expect(r.map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("ค้นจากชื่อ shortcut หรือเนื้อหา", () => {
    expect(searchCanned(REPLIES, "p1", "จัดส่ง").map((x) => x.id)).toEqual(["2"]);
    expect(searchCanned(REPLIES, "p1", "250").map((x) => x.id)).toEqual(["1"]);
    expect(searchCanned(REPLIES, "p1", "/ราคา").map((x) => x.id)).toEqual(["1"]);
  });

  it("เพจที่ไม่มีคำตอบสำเร็จรูปคืน array ว่าง", () => {
    expect(searchCanned(REPLIES, "p9", "")).toEqual([]);
  });
});

describe("buildEscalation — ส่ง LINE พร้อม deep link (สเปกข้อ M1)", () => {
  const base = {
    conversationId: "conv-123",
    pageId: "p1",
    pageName: "ร้านกาแฟดีดี",
    contactName: "คุณสมชาย",
    lastMessage: "ขอใบกำกับภาษีด้วยครับ",
    baseUrl: "https://pageos.app/",
    windowRemainingMs: 5 * 3600_000,
  };

  it("มี deep link เข้า thread โดยตรง", () => {
    const a = buildEscalation({ ...base, reason: "low_confidence" });
    expect(a.deepLink).toBe("https://pageos.app/inbox/conv-123");
  });

  it("encode id ที่มีอักขระพิเศษ", () => {
    const a = buildEscalation({
      ...base,
      conversationId: "p1:u1/ก",
      reason: "low_confidence",
    });
    expect(a.deepLink).toContain(encodeURIComponent("p1:u1/ก"));
  });

  it("ข้อความบอกว่าเพจไหน ใครทัก และเหลือเวลาเท่าไหร่", () => {
    const a = buildEscalation({ ...base, reason: "low_confidence" });
    expect(a.th).toContain("ร้านกาแฟดีดี");
    expect(a.th).toContain("คุณสมชาย");
    expect(a.th).toContain("300 นาที");
  });

  it("ใกล้หมดหน้าต่าง 24 ชม. → ระดับ critical", () => {
    const a = buildEscalation({
      ...base,
      reason: "low_confidence",
      windowRemainingMs: 90 * 60_000,
    });
    expect(a.severity).toBe("critical");
  });

  it("เรื่องอ่อนไหว → critical เสมอแม้ยังมีเวลาเหลือ", () => {
    const a = buildEscalation({ ...base, reason: "sensitive_topic" });
    expect(a.severity).toBe("critical");
  });

  it("เรื่องทั่วไปที่ยังมีเวลา → warn", () => {
    expect(
      buildEscalation({ ...base, reason: "low_confidence" }).severity,
    ).toBe("warn");
  });

  it("หมดหน้าต่างแล้วบอกตรงๆ", () => {
    const a = buildEscalation({
      ...base,
      reason: "low_confidence",
      windowRemainingMs: 0,
    });
    expect(a.th).toContain("หมดหน้าต่าง 24 ชม.");
  });

  it("ไม่มีชื่อเพจก็ยังใช้ได้", () => {
    const a = buildEscalation({
      conversationId: "c1",
      pageId: "p1",
      reason: "low_confidence",
      lastMessage: "x",
      baseUrl: "https://pageos.app",
      windowRemainingMs: 3600_000,
    });
    expect(a.th).toContain("p1");
    expect(a.pageName).toBeUndefined();
  });

  it("ทุกเหตุผลมีคำอธิบายภาษาไทย", () => {
    const reasons: EscalationReason[] = [
      "low_confidence",
      "customer_asked_for_human",
      "sensitive_topic",
      "repeated_question",
      "window_closing",
    ];
    for (const r of reasons) {
      expect(escalationReasonTh(r), r).toMatch(/[ก-๙]/);
      expect(buildEscalation({ ...base, reason: r }).th).toMatch(/[ก-๙]/);
    }
  });
});

describe("ข้อความรอระหว่าง escalate (สเปกข้อ M2 ชั้นที่ 3)", () => {
  it("ตรงกับที่สเปกเขียนไว้", () => {
    expect(HOLDING_REPLY_TH).toContain("รอสักครู่");
    expect(HOLDING_REPLY_TH).toContain("ตรวจสอบ");
  });
});
