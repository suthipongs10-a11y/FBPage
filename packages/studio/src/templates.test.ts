import { describe, expect, it } from "vitest";
import type { BotFlow } from "@page-os/bot";
import { startFlow, stepFlow } from "@page-os/bot";
import type { AutomationRule } from "@page-os/moderation";
import { renderTemplate } from "@page-os/moderation";
import { expectThaiThrow } from "@page-os/core/testing";
import { DEFAULT_PILLARS } from "./pillars.js";
import {
  PH,
  TemplateLeakError,
  applyBotFlowTemplate,
  applyContentPlanTemplate,
  applyModerationTemplate,
  extractBotFlowTemplate,
  extractContentPlanTemplate,
  extractModerationTemplate,
  missingValues,
  onboardFromTemplates,
  sanitizeText,
  scanForLeaks,
  type SourceIdentity,
} from "./templates.js";

const NOW = Date.UTC(2026, 7, 8);

const SOURCE: SourceIdentity = {
  pageId: "102938475610293",
  brandName: "ครัวคุณยาย",
  phones: ["0812345678"],
  lineIds: ["@kruakhunyai"],
  urls: ["https://kruakhunyai.com/menu"],
};

/** flow ของลูกค้าเก่าที่มีข้อมูลลูกค้าปนอยู่เต็มไปหมด — เหมือนของจริง */
const OLD_FLOW: BotFlow = {
  id: "flow-old",
  pageId: SOURCE.pageId,
  name: "ทักทาย ครัวคุณยาย",
  startNodeId: "greet",
  isActive: true,
  nodes: [
    {
      id: "greet",
      type: "message",
      text: "สวัสดีค่ะ ครัวคุณยาย ยินดีให้บริการ",
      next: "ask",
    },
    {
      id: "ask",
      type: "choice",
      text: "สนใจเรื่องไหนคะ",
      options: [
        { title: "ดูเมนู", payload: "MENU", next: "menu" },
        { title: "สั่งอาหาร", payload: "ORDER", next: "order" },
      ],
    },
    {
      id: "menu",
      type: "message",
      text: "ดูเมนูได้ที่ https://kruakhunyai.com/menu ค่ะ",
      next: "order",
    },
    {
      id: "order",
      type: "question",
      text: "โทรสั่งได้ที่ 081-234-5678 หรือพิมพ์ชื่อเมนูมาได้เลยค่ะ",
      saveAs: "เมนู",
      next: "done",
    },
    { id: "done", type: "end", text: "แอดไลน์ @kruakhunyai เพื่อรับโปรค่ะ" },
  ],
};

const OLD_RULES: AutomationRule[] = [
  {
    id: "r1",
    pageId: SOURCE.pageId,
    name: "ตอบคนถามราคา",
    trigger: { type: "buying_intent" },
    actions: [
      {
        kind: "private_reply",
        message: "สวัสดีค่ะ {ชื่อลูกค้า} ครัวคุณยายส่งราคาให้ทางแชทนะคะ",
      },
    ],
    priority: 10,
    isActive: true,
  },
  {
    id: "r2",
    pageId: SOURCE.pageId,
    name: "ซ่อนคนแปะเบอร์",
    trigger: { type: "phone" },
    actions: [{ kind: "hide" }],
    priority: 1,
    isActive: true,
  },
];

describe("sanitizeText", () => {
  it("แทนชื่อร้าน เบอร์ ลิงก์ และไลน์ ด้วยตัวแปร", () => {
    const out = sanitizeText(
      "ครัวคุณยาย โทร 0812345678 หรือดูที่ https://kruakhunyai.com/menu แอดไลน์ @kruakhunyai",
      SOURCE,
    );
    expect(out).toContain(PH.brandName);
    expect(out).toContain(PH.phone);
    expect(out).toContain(PH.url);
    expect(out).toContain(PH.lineId);
    expect(out).not.toContain("ครัวคุณยาย");
    expect(out).not.toContain("0812345678");
  });

  it("จับเบอร์ที่เขียนคั่นด้วยขีดหรือเว้นวรรคด้วย", () => {
    // เบอร์เดียวกันแต่พิมพ์คนละแบบ — เทียบตรงตัวจะหลุด
    expect(sanitizeText("โทร 081-234-5678", SOURCE)).toContain(PH.phone);
    expect(sanitizeText("โทร 081 234 5678", SOURCE)).toContain(PH.phone);
    expect(sanitizeText("โทร (081) 234-5678", SOURCE)).toContain(PH.phone);
  });

  it("แทนคำยาวก่อนคำสั้น ไม่ให้เหลือเศษชื่อร้านเดิม", () => {
    const src: SourceIdentity = {
      pageId: "1",
      brandName: "กาแฟดีดี",
      extra: [{ find: "ดีดี", replaceWith: "[[สาขา]]" }],
    };
    expect(sanitizeText("ร้านกาแฟดีดี", src)).toBe(`ร้าน${PH.brandName}`);
  });

  it("แทนรหัสเพจที่หลุดมาในข้อความ", () => {
    expect(sanitizeText(`เพจ ${SOURCE.pageId}`, SOURCE)).not.toContain(
      SOURCE.pageId,
    );
  });

  it("ข้อความที่ไม่มีอะไรของลูกค้าเดิม → ไม่ถูกแตะ", () => {
    expect(sanitizeText("สวัสดีค่ะ สนใจสอบถามได้เลย", SOURCE)).toBe(
      "สวัสดีค่ะ สนใจสอบถามได้เลย",
    );
  });

  it("pageId ว่าง → ไม่พัง (new RegExp('') ตรงกับทุกตำแหน่ง)", () => {
    expect(sanitizeText("สวัสดีค่ะ", { pageId: "" })).toBe("สวัสดีค่ะ");
  });

  it("ชื่อร้านว่างเปล่า → ไม่ไปแทรกตัวแปรกลางข้อความ", () => {
    expect(sanitizeText("สวัสดีค่ะ", { pageId: "1", brandName: "  " })).toBe(
      "สวัสดีค่ะ",
    );
  });
});

describe("scanForLeaks", () => {
  it("จับเบอร์ที่ยังไม่ได้ประกาศ", () => {
    const f = scanForLeaks([{ path: "x", text: "โทร 0899999999 นะคะ" }]);
    expect(f[0]!.kind).toBe("phone_or_id");
    expect(f[0]!.th).toMatch(/เบอร์โทรหรือ ID/);
  });

  it("จับรหัสเพจ 15 หลักที่ detectPhone ทั่วไปจับไม่ได้", () => {
    const f = scanForLeaks([{ path: "x", text: "เพจ 102938475610293" }]);
    expect(f.some((x) => x.kind === "phone_or_id")).toBe(true);
  });

  it("จับลิงก์ m.me และ facebook.com ด้วย — ตัวที่ M3 ถือว่าปลอดภัย", () => {
    // m.me/ร้านเก่า คือการส่งลูกค้าใหม่ไปแชทกับร้านเก่า แย่ที่สุดในบรรดาลิงก์
    const f = scanForLeaks([
      { path: "a", text: "ทักเลย m.me/oldshop" },
      { path: "b", text: "ดูที่ facebook.com/oldshop" },
    ]);
    expect(f.filter((x) => x.kind === "url")).toHaveLength(2);
  });

  it("จับไอดีที่ขึ้นต้นด้วย @", () => {
    const f = scanForLeaks([{ path: "x", text: "แอดไลน์ @oldshopline" }]);
    expect(f[0]!.kind).toBe("handle");
  });

  it("จับชื่อร้านเดิมแม้พิมพ์ต่างตัวพิมพ์", () => {
    const f = scanForLeaks([{ path: "x", text: "welcome to KRUA shop" }], {
      pageId: "1",
      brandName: "krua",
    });
    expect(f.some((x) => x.kind === "brand_name")).toBe(true);
  });

  it("ตัวแปรของเทมเพลตเองไม่นับเป็นข้อมูลรั่ว", () => {
    const text = `สวัสดีค่ะ ${PH.brandName} โทร ${PH.phone} ${PH.url} ${PH.lineId}`;
    expect(scanForLeaks([{ path: "x", text }], SOURCE)).toEqual([]);
  });

  it("ลิงก์ที่ประกาศว่าเป็นของกลาง → ผ่านได้", () => {
    const f = scanForLeaks([{ path: "x", text: "อ่านนโยบายที่ meta.com/policy" }], {
      pageId: "1",
      allowUrls: ["meta.com"],
    });
    expect(f).toEqual([]);
  });

  it("ข้อความปกติที่มีตัวเลขน้อยๆ ไม่โดนจับผิด", () => {
    const f = scanForLeaks([
      { path: "a", text: "ข้าวกล่อง 65 บาท สั่งก่อน 10 โมง" },
      { path: "b", text: "ส่งฟรีเมื่อครบ 500 บาท" },
      { path: "c", text: "เปิด 08:00-17:00 ทุกวัน" },
    ]);
    expect(f).toEqual([]);
  });

  it("บอกว่าเจอที่ฟิลด์ไหน จะได้ตามไปแก้ถูก", () => {
    const f = scanForLeaks([{ path: "nodes[3].text", text: "โทร 0899999999" }]);
    expect(f[0]!.where).toBe("nodes[3].text");
  });
});

describe("extractBotFlowTemplate", () => {
  it("ถอด flow ของลูกค้าเก่าออกมาโดยไม่เหลือข้อมูลลูกค้า", () => {
    const t = extractBotFlowTemplate({
      id: "tpl-greet",
      flow: OLD_FLOW,
      source: SOURCE,
      nowMs: NOW,
    });

    const json = JSON.stringify(t.payload);
    expect(json).not.toContain("ครัวคุณยาย");
    expect(json).not.toContain("0812345678");
    expect(json).not.toContain("kruakhunyai");
    expect(json).not.toContain(SOURCE.pageId);
    // ยังบอกได้ว่าก๊อปมาจากใคร แต่อยู่นอก payload
    expect(t.sourcePageId).toBe(SOURCE.pageId);
  });

  it("รวบรวมตัวแปรที่ต้องกรอกไว้ให้ขึ้นฟอร์ม", () => {
    const t = extractBotFlowTemplate({
      id: "tpl",
      flow: OLD_FLOW,
      source: SOURCE,
      nowMs: NOW,
    });
    expect(t.placeholders).toEqual(
      expect.arrayContaining(["ชื่อร้าน", "เบอร์โทร", "ลิงก์", "ไลน์"]),
    );
  });

  it("โครงสร้าง flow ไม่เปลี่ยน — node id และเส้นเชื่อมยังเหมือนเดิม", () => {
    const t = extractBotFlowTemplate({
      id: "tpl",
      flow: OLD_FLOW,
      source: SOURCE,
      nowMs: NOW,
    });
    const body = t.payload.kind === "bot_flow" ? t.payload.flow : null;
    expect(body!.nodes.map((n) => n.id)).toEqual(OLD_FLOW.nodes.map((n) => n.id));
    expect(body!.startNodeId).toBe("greet");
  });

  it("มีข้อมูลลูกค้าที่ยังไม่ได้ประกาศหลงเหลือ → ไม่ยอมสร้างเทมเพลต", () => {
    // คนที่กดปุ่มลืมประกาศเบอร์สำรอง — ระบบต้องเป็นฝ่ายจับ
    const flow: BotFlow = {
      ...OLD_FLOW,
      nodes: [
        { id: "greet", type: "message", text: "โทรสำรอง 0899998888 ได้ค่ะ" },
      ],
      startNodeId: "greet",
    };
    const err = expectThaiThrow(() =>
      extractBotFlowTemplate({ id: "t", flow, source: SOURCE, nowMs: NOW }),
    );
    expect(err).toBeInstanceOf(TemplateLeakError);
    expect(err.th).toMatch(/ข้อมูลของลูกค้าเดิมหลงเหลือ/);
    expect(err.th).toMatch(/0899998888/);
    // ต้องบอกทางออกด้วย ไม่ใช่แค่บอกว่าพัง
    expect(err.th).toMatch(/\[\[เบอร์โทร\]\]/);
  });

  it("รายงานว่ารั่วที่ node ไหน", () => {
    const flow: BotFlow = {
      ...OLD_FLOW,
      nodes: [
        { id: "a", type: "message", text: "สวัสดีค่ะ", next: "b" },
        { id: "b", type: "end", text: "ดูที่ othershop.com" },
      ],
      startNodeId: "a",
    };
    const err = expectThaiThrow(() =>
      extractBotFlowTemplate({ id: "t", flow, source: SOURCE, nowMs: NOW }),
    );
    expect(err.th).toMatch(/nodes\[1\]\.text/);
  });

  it("ชื่อตัวแปรที่มีชื่อร้านเดิม ถูกเปลี่ยนพร้อมกันทั้ง saveAs และ condition", () => {
    const flow: BotFlow = {
      id: "f",
      pageId: SOURCE.pageId,
      name: "ตรวจสมาชิก",
      startNodeId: "ask",
      isActive: true,
      nodes: [
        {
          id: "ask",
          type: "question",
          text: "เป็นสมาชิกไหมคะ",
          saveAs: "สมาชิกครัวคุณยาย",
          next: "check",
        },
        {
          id: "check",
          type: "condition",
          variable: "สมาชิกครัวคุณยาย",
          equals: "ใช่",
          ifTrue: "yes",
          ifFalse: "no",
        },
        { id: "yes", type: "end", text: "ขอบคุณค่ะ" },
        { id: "no", type: "end", text: "สมัครได้เลยค่ะ" },
      ],
    };
    const t = extractBotFlowTemplate({ id: "t", flow, source: SOURCE, nowMs: NOW });
    const body = t.payload.kind === "bot_flow" ? t.payload.flow : null;
    const q = body!.nodes.find((n) => n.id === "ask")!;
    const c = body!.nodes.find((n) => n.id === "check")!;
    const saveAs = q.type === "question" ? q.saveAs : "";
    const variable = c.type === "condition" ? c.variable : "";
    // ต้องยังตรงกัน ไม่งั้น condition อ่านตัวแปรไม่เจอแล้ว flow ขาด
    expect(saveAs).toBe(variable);
    expect(saveAs).not.toContain("ครัวคุณยาย");
  });
});

describe("applyBotFlowTemplate", () => {
  const TPL = extractBotFlowTemplate({
    id: "tpl-greet",
    flow: OLD_FLOW,
    source: SOURCE,
    nowMs: NOW,
  });
  const VALUES = {
    ชื่อร้าน: "บ้านขนมป้าแดง",
    เบอร์โทร: "0891112222",
    ลิงก์: "https://pladang.example/menu",
    ไลน์: "@pladang",
  };

  it("ได้ flow ของเพจใหม่ที่ไม่มีร่องรอยลูกค้าเก่า", () => {
    const flow = applyBotFlowTemplate({
      template: TPL,
      targetPageId: "p-new",
      values: VALUES,
    });
    const json = JSON.stringify(flow);
    expect(flow.pageId).toBe("p-new");
    expect(json).not.toContain("ครัวคุณยาย");
    expect(json).not.toContain("kruakhunyai");
    expect(json).toContain("บ้านขนมป้าแดง");
    expect(json).toContain("0891112222");
  });

  it("ปิดไว้ก่อนโดยเจตนา — ต้องมีคนอ่านก่อนบอทคุยกับลูกค้าจริง", () => {
    const flow = applyBotFlowTemplate({
      template: TPL,
      targetPageId: "p-new",
      values: VALUES,
    });
    expect(flow.isActive).toBe(false);
  });

  it("flow ที่ได้เดินได้จริง ไม่ขาดกลางทาง", () => {
    const flow = applyBotFlowTemplate({
      template: TPL,
      targetPageId: "p-new",
      values: VALUES,
      activate: true,
    });
    const s = startFlow(flow);
    const first = stepFlow({ flow, state: s });
    expect(first.replies[0]!.text).toContain("บ้านขนมป้าแดง");
    expect(JSON.stringify(first.replies)).not.toContain("ครัวคุณยาย");
  });

  it("ยังกรอกไม่ครบ → ไม่ยอมใช้ และบอกว่าขาดตัวไหน", () => {
    const err = expectThaiThrow(() =>
      applyBotFlowTemplate({
        template: TPL,
        targetPageId: "p-new",
        values: { ชื่อร้าน: "บ้านขนมป้าแดง" },
      }),
    );
    expect(err.th).toMatch(/\[\[เบอร์โทร\]\]/);
    expect(err.th).toMatch(/วงเล็บโผล่มา/);
  });

  it("กรอกเป็นช่องว่างล้วน ถือว่ายังไม่กรอก", () => {
    const err = expectThaiThrow(() =>
      applyBotFlowTemplate({
        template: TPL,
        targetPageId: "p-new",
        values: { ...VALUES, เบอร์โทร: "   " },
      }),
    );
    expect(err.th).toMatch(/เบอร์โทร/);
  });

  it("ใช้เทมเพลตผิดประเภท → บอกว่าเป็นประเภทอะไร", () => {
    const rulesTpl = extractModerationTemplate({
      id: "r",
      rules: OLD_RULES,
      source: SOURCE,
      nowMs: NOW,
      name: "กฎมาตรฐาน",
    });
    const err = expectThaiThrow(() =>
      applyBotFlowTemplate({
        template: rulesTpl,
        targetPageId: "p-new",
        values: VALUES,
      }),
    );
    expect(err.th).toMatch(/กฎจัดการคอมเมนต์/);
  });

  it("เทมเพลตที่ flow ขาด → ไม่ยอมสร้างให้ลูกค้าใหม่", () => {
    const broken = {
      ...TPL,
      payload: {
        kind: "bot_flow" as const,
        flow: {
          name: "พัง",
          startNodeId: "ไม่มีจริง",
          nodes: [{ id: "a", type: "end" as const }],
        },
      },
      placeholders: [],
    };
    const err = expectThaiThrow(() =>
      applyBotFlowTemplate({ template: broken, targetPageId: "p", values: {} }),
    );
    expect(err.th).toMatch(/ใช้ไม่ได้/);
  });

  it("ตัวแปรที่ไม่ได้อยู่ในรายการ placeholders ก็ยังไม่หลุดไปถึงลูกค้า", () => {
    // เทมเพลตที่แก้ในฐานข้อมูลหรือเขียนมือ อาจมีตัวแปรที่ placeholders ไม่รู้จัก
    // ถ้าหลุดไป บอทจะพิมพ์ "[[โปรเดือนนี้]]" ให้ลูกค้าอ่าน
    const sneaky = {
      ...TPL,
      payload: {
        kind: "bot_flow" as const,
        flow: {
          name: "n",
          startNodeId: "a",
          nodes: [
            { id: "a", type: "end" as const, text: "โปรวันนี้ [[โปรเดือนนี้]] ค่ะ" },
          ],
        },
      },
      placeholders: [],
    };
    const err = expectThaiThrow(() =>
      applyBotFlowTemplate({ template: sneaky, targetPageId: "p", values: {} }),
    );
    expect(err.th).toMatch(/\[\[โปรเดือนนี้\]\]/);
  });

  it("id ของ flow เดาซ้ำได้ ไม่สุ่ม — กดสองครั้งไม่ได้ flow ซ้อน", () => {
    const a = applyBotFlowTemplate({ template: TPL, targetPageId: "p", values: VALUES });
    const b = applyBotFlowTemplate({ template: TPL, targetPageId: "p", values: VALUES });
    expect(a.id).toBe(b.id);
  });
});

describe("extractModerationTemplate / applyModerationTemplate", () => {
  const TPL = extractModerationTemplate({
    id: "tpl-rules",
    rules: OLD_RULES,
    source: SOURCE,
    nowMs: NOW,
    name: "กฎคอมเมนต์มาตรฐาน",
  });

  it("ล้างชื่อร้านเดิมออกจากข้อความตอบกลับ", () => {
    expect(JSON.stringify(TPL.payload)).not.toContain("ครัวคุณยาย");
  });

  it("ตัวแปรรันไทม์ {ชื่อลูกค้า} ต้องรอด — คนละระบบกับ [[...]] ของเทมเพลต", () => {
    // ถ้าใช้วงเล็บชุดเดียวกัน การกรอกเทมเพลตจะกิน {ชื่อลูกค้า} ทิ้ง
    // แล้วบอทจะทักลูกค้าทุกคนด้วยชื่อเดียวกัน
    const rules = applyModerationTemplate({
      template: TPL,
      targetPageId: "p-new",
      values: { ชื่อร้าน: "บ้านขนมป้าแดง" },
    });
    const msg = rules[0]!.actions[0]!.message!;
    expect(msg).toContain("{ชื่อลูกค้า}");
    expect(msg).toContain("บ้านขนมป้าแดง");
    expect(renderTemplate(msg, { ชื่อลูกค้า: "สมชาย" })).toContain("สมชาย");
  });

  it("กฎที่ได้ผูกกับเพจใหม่ และปิดไว้ก่อน", () => {
    const rules = applyModerationTemplate({
      template: TPL,
      targetPageId: "p-new",
      values: { ชื่อร้าน: "บ้านขนมป้าแดง" },
    });
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.pageId === "p-new")).toBe(true);
    expect(rules.every((r) => !r.isActive)).toBe(true);
  });

  it("เปิดใช้ได้ถ้าสั่ง แต่กฎที่ปิดอยู่ในต้นฉบับยังปิดอยู่", () => {
    const tpl = extractModerationTemplate({
      id: "t2",
      rules: [OLD_RULES[0]!, { ...OLD_RULES[1]!, isActive: false }],
      source: SOURCE,
      nowMs: NOW,
      name: "n",
    });
    const rules = applyModerationTemplate({
      template: tpl,
      targetPageId: "p",
      values: { ชื่อร้าน: "ร้านใหม่" },
      activate: true,
    });
    expect(rules[0]!.isActive).toBe(true);
    expect(rules[1]!.isActive).toBe(false);
  });

  it("id ของกฎไม่ชนกับของเพจอื่น", () => {
    const a = applyModerationTemplate({
      template: TPL,
      targetPageId: "pA",
      values: { ชื่อร้าน: "ก" },
    });
    const b = applyModerationTemplate({
      template: TPL,
      targetPageId: "pB",
      values: { ชื่อร้าน: "ข" },
    });
    expect(new Set([...a, ...b].map((r) => r.id)).size).toBe(4);
  });

  it("คีย์เวิร์ดที่มีชื่อร้านเดิม ถูกล้างด้วย", () => {
    const tpl = extractModerationTemplate({
      id: "t3",
      rules: [
        {
          ...OLD_RULES[0]!,
          trigger: { type: "keyword", words: ["ครัวคุณยาย", "ราคา"] },
        },
      ],
      source: SOURCE,
      nowMs: NOW,
      name: "n",
    });
    expect(JSON.stringify(tpl.payload)).not.toContain("ครัวคุณยาย");
  });
});

describe("extractContentPlanTemplate / applyContentPlanTemplate", () => {
  it("สัดส่วนและจังหวะโพสต์ถูกเก็บไว้ครบ", () => {
    const t = extractContentPlanTemplate({
      id: "tpl-plan",
      pillars: DEFAULT_PILLARS,
      postsPerWeek: 5,
      topicIdeas: ["เมนูประจำสัปดาห์", "เบื้องหลังครัว"],
      source: SOURCE,
      nowMs: NOW,
      name: "แผนร้านอาหาร",
    });
    const plan = applyContentPlanTemplate({ template: t });
    expect(plan.postsPerWeek).toBe(5);
    expect(plan.pillars).toHaveLength(4);
    expect(plan.topicIdeas).toHaveLength(2);
  });

  it("สัดส่วนไม่ครบ 100 → ไม่ยอมเก็บเป็นเทมเพลต", () => {
    const err = expectThaiThrow(() =>
      extractContentPlanTemplate({
        id: "t",
        pillars: [{ ...DEFAULT_PILLARS[0]!, percent: 50 }],
        postsPerWeek: 5,
        source: SOURCE,
        nowMs: NOW,
        name: "n",
      }),
    );
    expect(err.th).toMatch(/100%/);
  });

  it("หัวข้อที่มีชื่อร้านเดิม ถูกล้างเป็นตัวแปร", () => {
    const t = extractContentPlanTemplate({
      id: "t",
      pillars: DEFAULT_PILLARS,
      postsPerWeek: 3,
      topicIdeas: ["เมนูใหม่ของครัวคุณยาย"],
      source: SOURCE,
      nowMs: NOW,
      name: "n",
    });
    const plan = applyContentPlanTemplate({
      template: t,
      values: { ชื่อร้าน: "บ้านขนมป้าแดง" },
    });
    expect(plan.topicIdeas[0]).toBe("เมนูใหม่ของบ้านขนมป้าแดง");
  });

  it("แผนที่ไม่มีตัวแปรเลย → ใช้ได้โดยไม่ต้องกรอกอะไร", () => {
    const t = extractContentPlanTemplate({
      id: "t",
      pillars: DEFAULT_PILLARS,
      postsPerWeek: 3,
      topicIdeas: ["เมนูประจำสัปดาห์"],
      source: SOURCE,
      nowMs: NOW,
      name: "n",
    });
    expect(missingValues(t, {})).toEqual([]);
    expect(() => applyContentPlanTemplate({ template: t })).not.toThrow();
  });
});

describe("onboardFromTemplates", () => {
  const flowTpl = extractBotFlowTemplate({
    id: "tpl-greet",
    flow: OLD_FLOW,
    source: SOURCE,
    nowMs: NOW,
  });
  const ruleTpl = extractModerationTemplate({
    id: "tpl-rules",
    rules: OLD_RULES,
    source: SOURCE,
    nowMs: NOW,
    name: "กฎมาตรฐาน",
  });
  const planTpl = extractContentPlanTemplate({
    id: "tpl-plan",
    pillars: DEFAULT_PILLARS,
    postsPerWeek: 5,
    source: SOURCE,
    nowMs: NOW,
    name: "แผน",
  });
  const VALUES = {
    ชื่อร้าน: "บ้านขนมป้าแดง",
    เบอร์โทร: "0891112222",
    ลิงก์: "https://pladang.example/menu",
    ไลน์: "@pladang",
  };

  it("ก๊อปทั้งชุดเข้าเพจใหม่ในครั้งเดียว", () => {
    const r = onboardFromTemplates({
      templates: [flowTpl, ruleTpl, planTpl],
      targetPageId: "p-new",
      values: VALUES,
    });
    expect(r.flows).toHaveLength(1);
    expect(r.rules).toHaveLength(2);
    expect(r.plans).toHaveLength(1);
    expect(r.failed).toEqual([]);
    expect(r.th).toMatch(/ยังปิดไว้ทั้งหมด/);
  });

  it("ทุกอย่างปิดไว้ก่อนเป็นค่าเริ่มต้น", () => {
    const r = onboardFromTemplates({
      templates: [flowTpl, ruleTpl],
      targetPageId: "p-new",
      values: VALUES,
    });
    expect(r.flows.every((f) => !f.isActive)).toBe(true);
    expect(r.rules.every((x) => !x.isActive)).toBe(true);
  });

  it("อันหนึ่งพัง ไม่ล้มทั้งชุด และบอกว่าอันไหนพังเพราะอะไร", () => {
    const r = onboardFromTemplates({
      templates: [flowTpl, ruleTpl, planTpl],
      targetPageId: "p-new",
      // ขาดค่าที่ flow ต้องใช้ แต่กฎกับแผนไม่ต้องใช้
      values: { ชื่อร้าน: "บ้านขนมป้าแดง" },
    });
    expect(r.flows).toHaveLength(0);
    expect(r.rules).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.templateId).toBe("tpl-greet");
    expect(r.failed[0]!.th).toMatch(/เบอร์โทร/);
    expect(r.th).toMatch(/ใช้ได้ 2 จาก 3/);
  });

  it("ไม่มีเทมเพลตเลย → ไม่พัง", () => {
    const r = onboardFromTemplates({
      templates: [],
      targetPageId: "p",
      values: {},
    });
    expect(r.failed).toEqual([]);
    expect(r.flows).toEqual([]);
  });

  it("ข้อมูลลูกค้าเก่าไม่หลุดไปเพจใหม่แม้แต่ที่เดียว", () => {
    const r = onboardFromTemplates({
      templates: [flowTpl, ruleTpl, planTpl],
      targetPageId: "p-new",
      values: VALUES,
    });
    const json = JSON.stringify(r);
    for (const secret of [
      "ครัวคุณยาย",
      "0812345678",
      "081-234-5678",
      "kruakhunyai",
      SOURCE.pageId,
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});
