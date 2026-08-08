import { describe, expect, it } from "vitest";
import { expectThaiThrow } from "@page-os/core/testing";
import {
  FlowError,
  MAX_STEPS_PER_TURN,
  dryRunFlow,
  startFlow,
  stepFlow,
  validateFlow,
  type BotFlow,
} from "./flow.js";

/** flow เก็บข้อมูลสั่งซื้อ — ตัวอย่างที่ใกล้ของจริงที่สุด */
const ORDER_FLOW: BotFlow = {
  id: "f1",
  pageId: "p1",
  name: "เก็บข้อมูลสั่งซื้อ",
  startNodeId: "greet",
  isActive: true,
  nodes: [
    { id: "greet", type: "message", text: "ยินดีต้อนรับค่ะ", next: "ask_name" },
    {
      id: "ask_name",
      type: "question",
      text: "ขอทราบชื่อผู้สั่งด้วยค่ะ",
      saveAs: "ชื่อ",
      next: "ask_delivery",
    },
    {
      id: "ask_delivery",
      type: "choice",
      text: "รับสินค้าแบบไหนคะ",
      options: [
        { title: "ส่งไปรษณีย์", payload: "SHIP", next: "ask_address" },
        { title: "รับเอง", payload: "PICKUP", next: "done_pickup" },
      ],
    },
    {
      id: "ask_address",
      type: "question",
      text: "ขอที่อยู่จัดส่งค่ะ",
      saveAs: "ที่อยู่",
      next: "done_ship",
    },
    { id: "done_ship", type: "end", text: "รับข้อมูลครบแล้วค่ะ เดี๋ยวแจ้งยอดนะคะ" },
    { id: "done_pickup", type: "end", text: "รับที่ร้านได้เลยค่ะ" },
  ],
};

describe("startFlow", () => {
  it("เริ่มที่ node ที่กำหนด", () => {
    const s = startFlow(ORDER_FLOW);
    expect(s.currentNodeId).toBe("greet");
    expect(s.variables).toEqual({});
  });

  it("node เริ่มต้นไม่มีอยู่ → error ภาษาไทยบอกให้ไปแก้ที่ตัววาด", () => {
    const err = expectThaiThrow(() =>
      startFlow({ ...ORDER_FLOW, startNodeId: "ไม่มี" }),
    );
    expect(err.th).toContain("flow");
  });
});

describe("stepFlow — เดินตาม flow", () => {
  it("ส่งข้อความแล้วเดินต่อจนถึงจุดที่ต้องรอคำตอบ", () => {
    const r = stepFlow({ flow: ORDER_FLOW, state: startFlow(ORDER_FLOW) });
    expect(r.replies.map((x) => x.text)).toEqual([
      "ยินดีต้อนรับค่ะ",
      "ขอทราบชื่อผู้สั่งด้วยค่ะ",
    ]);
    expect(r.awaitingInput).toBe(true);
    expect(r.state!.currentNodeId).toBe("ask_name");
  });

  it("เก็บคำตอบลงตัวแปรแล้วไปต่อ", () => {
    let r = stepFlow({ flow: ORDER_FLOW, state: startFlow(ORDER_FLOW) });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "สมชาย ใจดี" });

    expect(r.state!.variables["ชื่อ"]).toBe("สมชาย ใจดี");
    expect(r.replies[0]!.text).toBe("รับสินค้าแบบไหนคะ");
    expect(r.replies[0]!.quickReplies).toEqual([
      { title: "ส่งไปรษณีย์", payload: "SHIP" },
      { title: "รับเอง", payload: "PICKUP" },
    ]);
  });

  it("เลือกตัวเลือกด้วย payload", () => {
    let r = stepFlow({ flow: ORDER_FLOW, state: startFlow(ORDER_FLOW) });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "สมชาย" });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "PICKUP" });

    expect(r.replies[0]!.text).toBe("รับที่ร้านได้เลยค่ะ");
    expect(r.state).toBeNull();
  });

  it("เลือกด้วยการพิมพ์ข้อความตรงกับชื่อปุ่มก็ได้", () => {
    let r = stepFlow({ flow: ORDER_FLOW, state: startFlow(ORDER_FLOW) });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "สมชาย" });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "รับเอง" });
    expect(r.state).toBeNull();
  });

  it("ตอบไม่ตรงตัวเลือก → ถามใหม่ ไม่เดินต่อมั่ว", () => {
    let r = stepFlow({ flow: ORDER_FLOW, state: startFlow(ORDER_FLOW) });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "สมชาย" });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "อะไรก็ไม่รู้" });

    expect(r.awaitingInput).toBe(true);
    expect(r.state!.currentNodeId).toBe("ask_delivery");
    expect(r.replies[0]!.quickReplies).toBeTruthy();
  });

  it("เส้นทางส่งไปรษณีย์เก็บที่อยู่ด้วย", () => {
    let r = stepFlow({ flow: ORDER_FLOW, state: startFlow(ORDER_FLOW) });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "สมชาย" });
    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "SHIP" });
    expect(r.replies[0]!.text).toBe("ขอที่อยู่จัดส่งค่ะ");

    r = stepFlow({ flow: ORDER_FLOW, state: r.state!, input: "123 ถนนสุขุมวิท" });
    expect(r.state).toBeNull();
    expect(r.replies[0]!.text).toContain("รับข้อมูลครบแล้ว");
  });
});

describe("stepFlow — เงื่อนไขและส่งต่อคน", () => {
  const condFlow: BotFlow = {
    id: "f2",
    pageId: "p1",
    name: "เช็คเงื่อนไข",
    startNodeId: "ask",
    isActive: true,
    nodes: [
      {
        id: "ask",
        type: "question",
        text: "สั่งกี่ชิ้นคะ",
        saveAs: "จำนวน",
        next: "check",
      },
      {
        id: "check",
        type: "condition",
        variable: "จำนวน",
        contains: "10",
        ifTrue: "wholesale",
        ifFalse: "retail",
      },
      { id: "wholesale", type: "handover", reason: "ลูกค้าสั่งจำนวนมาก ต้องคุยราคาส่ง" },
      { id: "retail", type: "end", text: "รับออเดอร์แล้วค่ะ" },
    ],
  };

  it("เงื่อนไขเป็นจริง → ส่งต่อให้คน", () => {
    let r = stepFlow({ flow: condFlow, state: startFlow(condFlow) });
    r = stepFlow({ flow: condFlow, state: r.state!, input: "10 ชิ้น" });
    expect(r.handover).toContain("ราคาส่ง");
    expect(r.state).toBeNull();
  });

  it("เงื่อนไขเป็นเท็จ → ไปอีกทาง", () => {
    let r = stepFlow({ flow: condFlow, state: startFlow(condFlow) });
    r = stepFlow({ flow: condFlow, state: r.state!, input: "2 ชิ้น" });
    expect(r.handover).toBeUndefined();
    expect(r.replies[0]!.text).toBe("รับออเดอร์แล้วค่ะ");
  });

  it("เงื่อนไข equals ไม่สนตัวพิมพ์", () => {
    const f: BotFlow = {
      ...condFlow,
      nodes: condFlow.nodes.map((n) =>
        n.id === "check"
          ? {
              id: "check",
              type: "condition",
              variable: "จำนวน",
              equals: "YES",
              ifTrue: "wholesale",
              ifFalse: "retail",
            }
          : n,
      ),
    };
    let r = stepFlow({ flow: f, state: startFlow(f) });
    r = stepFlow({ flow: f, state: r.state!, input: "yes" });
    expect(r.handover).toBeTruthy();
  });
});

describe("stepFlow — ทนต่อ flow ที่ตั้งผิด", () => {
  it("ชี้ไป node ที่ไม่มี → จบ flow ไม่ค้าง", () => {
    const broken: BotFlow = {
      id: "f3",
      pageId: "p1",
      name: "พัง",
      startNodeId: "a",
      isActive: true,
      nodes: [{ id: "a", type: "message", text: "สวัสดี", next: "ไม่มีจริง" }],
    };
    const r = stepFlow({ flow: broken, state: startFlow(broken) });
    expect(r.state).toBeNull();
    expect(r.th).toMatch(/[ก-๙]/);
  });

  it("flow ที่วนลูปถูกตัดและส่งต่อให้คน", () => {
    const loop: BotFlow = {
      id: "f4",
      pageId: "p1",
      name: "วนลูป",
      startNodeId: "a",
      isActive: true,
      nodes: [
        { id: "a", type: "message", text: "A", next: "b" },
        { id: "b", type: "message", text: "B", next: "a" },
      ],
    };
    const r = stepFlow({ flow: loop, state: startFlow(loop) });
    expect(r.handover).toContain("วนลูป");
    expect(r.replies.length).toBeLessThanOrEqual(MAX_STEPS_PER_TURN);
  });

  it("ไม่แก้สถานะเดิม (ส่ง state เดิมเข้าไปซ้ำได้ผลเดิม)", () => {
    const s = startFlow(ORDER_FLOW);
    const a = stepFlow({ flow: ORDER_FLOW, state: s });
    const b = stepFlow({ flow: ORDER_FLOW, state: s });
    expect(a.replies.map((x) => x.text)).toEqual(b.replies.map((x) => x.text));
    expect(s.currentNodeId).toBe("greet");
  });
});

describe("validateFlow — ตรวจก่อนเปิดใช้งาน", () => {
  it("flow ที่ถูกต้องไม่มีปัญหา", () => {
    expect(validateFlow(ORDER_FLOW)).toEqual([]);
  });

  it("จับ node ปลายทางที่ไม่มีอยู่", () => {
    const bad: BotFlow = {
      ...ORDER_FLOW,
      nodes: [
        { id: "greet", type: "message", text: "hi", next: "ไม่มีจริง" },
      ],
    };
    const issues = validateFlow(bad);
    expect(issues.some((i) => i.th.includes("ไม่มีอยู่จริง"))).toBe(true);
  });

  it("จับ node ที่เข้าไม่ถึง (ลืมต่อเส้น)", () => {
    const bad: BotFlow = {
      ...ORDER_FLOW,
      nodes: [
        ...ORDER_FLOW.nodes,
        { id: "ลอย", type: "end", text: "ไม่มีใครมาถึง" },
      ],
    };
    const issues = validateFlow(bad);
    expect(issues.some((i) => i.nodeId === "ลอย")).toBe(true);
  });

  it("จับตัวเลือกที่ไม่มีตัวเลือก", () => {
    const bad: BotFlow = {
      id: "f5",
      pageId: "p1",
      name: "x",
      startNodeId: "c",
      isActive: true,
      nodes: [{ id: "c", type: "choice", text: "เลือก", options: [] }],
    };
    expect(validateFlow(bad).some((i) => i.th.includes("ไม่มีตัวเลือก"))).toBe(
      true,
    );
  });

  it("จับ node เริ่มต้นที่ไม่มีอยู่", () => {
    expect(
      validateFlow({ ...ORDER_FLOW, startNodeId: "ไม่มี" }).length,
    ).toBeGreaterThan(0);
  });

  it("ทุกปัญหาอธิบายเป็นภาษาไทย", () => {
    const bad: BotFlow = {
      ...ORDER_FLOW,
      nodes: [{ id: "greet", type: "message", text: "hi", next: "ผิด" }],
    };
    for (const i of validateFlow(bad)) expect(i.th).toMatch(/[ก-๙]/);
  });
});

describe("dryRunFlow — Test Console (สเปกข้อ M2)", () => {
  it("ลองทั้ง flow โดยไม่ต้องส่งจริง", () => {
    const r = dryRunFlow(ORDER_FLOW, ["สมชาย", "SHIP", "123 ถนนสุขุมวิท"]);

    expect(r.turns[0]!.replies).toContain("ยินดีต้อนรับค่ะ");
    expect(r.variables["ชื่อ"]).toBe("สมชาย");
    expect(r.variables["ที่อยู่"]).toBe("123 ถนนสุขุมวิท");
    expect(r.th).toContain("จบแล้ว");
  });

  it("บอกว่ายังไม่จบถ้าป้อนข้อมูลไม่ครบ", () => {
    const r = dryRunFlow(ORDER_FLOW, ["สมชาย"]);
    expect(r.th).toContain("ยังไม่จบ");
    expect(r.turns.at(-1)!.awaitingInput).toBe(true);
  });

  it("แสดง handover ถ้า flow ส่งต่อให้คน", () => {
    const f: BotFlow = {
      id: "f6",
      pageId: "p1",
      name: "x",
      startNodeId: "h",
      isActive: true,
      nodes: [{ id: "h", type: "handover", reason: "ต้องให้คนดู" }],
    };
    const r = dryRunFlow(f, []);
    expect(r.turns[0]!.handover).toBe("ต้องให้คนดู");
  });

  it("ไม่ป้อนอะไรเลยก็รันได้", () => {
    expect(dryRunFlow(ORDER_FLOW, []).turns.length).toBeGreaterThan(0);
  });

  it("flow ที่ node เริ่มต้นพัง โยน FlowError ตั้งแต่ต้น", () => {
    expect(() => dryRunFlow({ ...ORDER_FLOW, startNodeId: "x" }, [])).toThrow(
      FlowError,
    );
  });
});
