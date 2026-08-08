/**
 * Template Library (M8 — แต่ทำที่นี่เพราะเป็นเรื่องเดียวกับ Content Studio)
 *
 * สเปก: "ก๊อป bot flow / calendar / moderation rules จากลูกค้าเก่าไปลูกค้าใหม่
 *        ในคลิกเดียว ← ฟีเจอร์นี้คือตัวลดเวลา onboarding จาก 8 ชม. เหลือ 30 นาที"
 *
 * ⚠️ ฟีเจอร์นี้คือฟีเจอร์ที่ **อันตรายที่สุดในระบบทั้งหมด**
 *
 * เพราะมันเอาของจากลูกค้ารายหนึ่งไปวางที่ลูกค้าอีกราย ถ้าหลุดแม้แต่ครั้งเดียว
 * — เบอร์โทรร้านเก่าไปโผล่ในบอทร้านใหม่ ลิงก์ร้านเก่าไปอยู่ในกฎคอมเมนต์ร้านใหม่ —
 * ไม่ใช่แค่บั๊ก แต่คือ "เอเจนซี่นี้เอาข้อมูลลูกค้าไปใช้ต่อ" ซึ่งจบความสัมพันธ์
 * กับลูกค้าทั้งสองรายพร้อมกัน
 *
 * ไฟล์นี้จึงออกแบบให้ **ล้มไว้ก่อน (fail-closed)**:
 *   - แทนที่ของที่รู้ว่าเป็นของลูกค้าเดิมด้วยตัวแปร
 *   - แล้ว **สแกนซ้ำทั้งก้อน** หาเบอร์ / ลิงก์ / ไอดี / เลขเพจที่หลงเหลือ
 *   - เจออะไรที่ยังน่าสงสัย = ไม่ยอมสร้างเทมเพลต ไม่ใช่แค่เตือน
 *
 * คนที่กดปุ่มจะลืมประกาศบางอย่างเสมอ — ระบบต้องเป็นฝ่ายจับ ไม่ใช่ความจำของคน
 */
import type { BotFlow, FlowNode } from "@page-os/bot";
import { validateFlow } from "@page-os/bot";
import type { AutomationRule } from "@page-os/moderation";
import type { Pillar } from "./pillars.js";
import { validatePillars } from "./pillars.js";

/**
 * ตัวแปรของเทมเพลตใช้ `[[...]]` **ไม่ใช่ `{...}`**
 *
 * เพราะ `{...}` ถูกจองไว้แล้วโดย `renderTemplate()` ของ M3 สำหรับตัวแปร
 * ตอนรันจริง (`{ชื่อลูกค้า}` = ชื่อคนที่คอมเมนต์) ถ้าใช้ตัวเดียวกัน การกรอก
 * เทมเพลตจะไปกินตัวแปรรันไทม์ทิ้ง แล้วบอทจะทักลูกค้าทุกคนด้วยชื่อเดียวกัน
 */
export const PLACEHOLDER_RE = /\[\[([^\]\n]{1,40})\]\]/g;

export const PH = {
  brandName: "[[ชื่อร้าน]]",
  phone: "[[เบอร์โทร]]",
  lineId: "[[ไลน์]]",
  url: "[[ลิงก์]]",
} as const;

export class TemplateError extends Error {
  // ประกาศเป็น string ไม่ใช่ literal เพราะ TemplateLeakError สืบทอดแล้วเปลี่ยนชื่อ
  override readonly name: string = "TemplateError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

export class TemplateLeakError extends TemplateError {
  override readonly name = "TemplateLeakError";
  readonly findings: LeakFinding[];
  constructor(findings: LeakFinding[]) {
    const lines = findings.map((f) => `• ${f.where}: ${f.th}`).join("\n");
    super(
      `template leak: ${findings.map((f) => f.kind).join(",")}`,
      `สร้างเทมเพลตไม่ได้ — ยังมีข้อมูลของลูกค้าเดิมหลงเหลืออยู่\n${lines}\n\nแก้ข้อความให้เป็นตัวแปร (เช่น ${PH.phone}) หรือประกาศไว้ใน "ข้อมูลลูกค้าต้นทาง" แล้วลองใหม่`,
    );
    this.findings = findings;
  }
}

/** ข้อมูลของลูกค้าต้นทางที่ต้องถูกล้างออกก่อนเก็บเป็นเทมเพลต */
export interface SourceIdentity {
  pageId: string;
  /** ชื่อร้าน/แบรนด์ที่โผล่ในข้อความ */
  brandName?: string;
  /** เบอร์โทรของร้านเดิม — จับได้แม้เขียนคั่นด้วยขีดหรือเว้นวรรค */
  phones?: string[];
  /** LINE ID / IG handle ของร้านเดิม */
  lineIds?: string[];
  /** ลิงก์ของร้านเดิม */
  urls?: string[];
  /** อย่างอื่นที่ต้องแทนที่ เช่น ชื่อสาขา ชื่อพนักงาน */
  extra?: Array<{ find: string; replaceWith: string }>;
  /**
   * ลิงก์ที่ยืนยันแล้วว่าเป็นของกลาง ไม่ใช่ของลูกค้าเดิม
   * (เช่นลิงก์นโยบายของ Meta) — ต้องประกาศเอง ระบบไม่เดาให้
   */
  allowUrls?: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * regex ที่จับเบอร์เดิมได้แม้จะเขียนคั่นไว้
 *
 * "081-234-5678" กับ "081 234 5678" กับ "0812345678" คือเบอร์เดียวกัน
 * ถ้าเทียบแบบตรงตัว จะแทนที่ไม่โดนแล้วเบอร์ร้านเก่าจะรอดไปอยู่ในบอทร้านใหม่
 */
function loosePhoneRe(phone: string): RegExp | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return new RegExp([...digits].join("[\\s.\\-()]*"), "g");
}

/** ล้างข้อมูลลูกค้าเดิมออกจากข้อความหนึ่งก้อน */
export function sanitizeText(text: string, source: SourceIdentity): string {
  let out = text;

  for (const p of source.phones ?? []) {
    const re = loosePhoneRe(p);
    if (re) out = out.replace(re, PH.phone);
  }
  for (const u of source.urls ?? []) {
    out = out.replace(new RegExp(escapeRegExp(u), "gi"), PH.url);
  }
  for (const l of source.lineIds ?? []) {
    out = out.replace(new RegExp(escapeRegExp(l), "gi"), PH.lineId);
  }
  // แทนที่คำยาวก่อนคำสั้น — ไม่งั้น "ดีดี" จะไปกินบางส่วนของ "กาแฟดีดี"
  // แล้วเหลือเศษชื่อร้านเดิมค้างอยู่
  const named = [
    ...(source.brandName
      ? [{ find: source.brandName, replaceWith: PH.brandName }]
      : []),
    ...(source.extra ?? []),
  ].sort((a, b) => b.find.length - a.find.length);
  for (const n of named) {
    if (n.find.trim() === "") continue;
    out = out.replace(new RegExp(escapeRegExp(n.find), "gi"), n.replaceWith);
  }

  // ต้องเช็คว่าไม่ว่าง — new RegExp("") ตรงกับทุกตำแหน่งในสตริง
  // แล้วจะยัด [[ชื่อร้าน]] แทรกระหว่างตัวอักษรทุกตัว
  if (source.pageId !== "") {
    out = out.replace(new RegExp(escapeRegExp(source.pageId), "g"), PH.brandName);
  }
  return out;
}

export interface LeakFinding {
  kind: "phone_or_id" | "url" | "handle" | "page_id" | "brand_name";
  matched: string;
  /** ฟิลด์ไหนในเทมเพลต เช่น "nodes[2].text" */
  where: string;
  th: string;
}

interface TextField {
  path: string;
  text: string;
}

/**
 * ลิงก์ทุกชนิด รวมถึง facebook.com และ m.me
 *
 * จงใจไม่ใช้ `detectExternalLink()` ของ M3 ที่นี่ เพราะตัวนั้นถือว่า
 * facebook.com / m.me เป็นลิงก์ปลอดภัย (ถูกสำหรับคอมเมนต์) แต่ในเทมเพลต
 * `m.me/ร้านเก่า` คือการส่งลูกค้าใหม่ไปแชทกับร้านเก่า ซึ่งแย่ที่สุดในบรรดาลิงก์ทั้งหมด
 */
// ชื่อโดเมนตัวเดียวก็ต้องจับ — "m.me" คือเคสที่อันตรายที่สุดและสั้นที่สุดพร้อมกัน
const ANY_URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9][a-z0-9-]{0,60}\.(?:com|net|org|co|co\.th|in\.th|th|shop|store|online|me|ly|link|xyz|top|club|site)\b(?:\/\S*)?/gi;

/** ไอดีที่ขึ้นต้นด้วย @ — LINE OA, IG, TikTok */
const HANDLE_RE = /@[A-Za-z0-9._-]{3,30}/g;

/** เลขติดกันยาวขนาดนี้ในเทมเพลต แทบไม่มีทางเป็นอย่างอื่นนอกจากเบอร์หรือ ID */
const LONG_DIGITS_RE = /\d[\d\s.\-()]{7,}\d/g;

/**
 * สแกนหาข้อมูลลูกค้าเดิมที่หลงเหลือ
 *
 * ตัวนี้คือด่านสุดท้ายก่อนเทมเพลตถูกเก็บ — ทำงานบนสมมติฐานว่า
 * คนที่กดปุ่ม "ประกาศ" ข้อมูลลูกค้าเดิมมาไม่ครบเสมอ
 */
export function scanForLeaks(
  fields: readonly TextField[],
  source?: Pick<SourceIdentity, "pageId" | "brandName" | "allowUrls">,
): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const allow = (source?.allowUrls ?? []).map((u) => u.toLowerCase());

  for (const f of fields) {
    if (f.text === "") continue;

    // ตัวแปรของเทมเพลตเองไม่นับเป็นข้อมูลรั่ว
    const text = f.text.replace(PLACEHOLDER_RE, " ");

    for (const m of text.match(LONG_DIGITS_RE) ?? []) {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 9) continue;
      findings.push({
        kind: "phone_or_id",
        matched: m.trim(),
        where: f.path,
        th: `พบเลขยาว "${m.trim()}" — น่าจะเป็นเบอร์โทรหรือ ID ของลูกค้าเดิม`,
      });
    }

    for (const m of text.match(ANY_URL_RE) ?? []) {
      if (allow.some((a) => m.toLowerCase().includes(a))) continue;
      findings.push({
        kind: "url",
        matched: m,
        where: f.path,
        th: `พบลิงก์ "${m}" — ลิงก์ในเทมเพลตจะพาลูกค้าใหม่ไปหาร้านเก่า`,
      });
    }

    for (const m of text.match(HANDLE_RE) ?? []) {
      findings.push({
        kind: "handle",
        matched: m,
        where: f.path,
        th: `พบไอดี "${m}" — น่าจะเป็น LINE/IG ของลูกค้าเดิม`,
      });
    }

    if (source?.pageId && text.includes(source.pageId)) {
      findings.push({
        kind: "page_id",
        matched: source.pageId,
        where: f.path,
        th: "พบรหัสเพจของลูกค้าเดิม",
      });
    }
    const brand = source?.brandName?.trim();
    if (brand && brand.length >= 2 && text.toLowerCase().includes(brand.toLowerCase())) {
      findings.push({
        kind: "brand_name",
        matched: brand,
        where: f.path,
        th: `พบชื่อร้านเดิม "${brand}" — ต้องเปลี่ยนเป็น ${PH.brandName}`,
      });
    }
  }

  return findings;
}

// ── รูปร่างของเทมเพลต ──────────────────────────────────────────────────────

/** flow ที่ถอด pageId และข้อมูลลูกค้าออกแล้ว */
export interface FlowTemplateBody {
  name: string;
  startNodeId: string;
  nodes: FlowNode[];
}

/** กฎคอมเมนต์ที่ถอด id และ pageId ออกแล้ว */
export type RuleTemplateBody = Omit<AutomationRule, "id" | "pageId">;

/** แผนคอนเทนต์ — สัดส่วนกับจังหวะโพสต์ ใช้ซ้ำได้ ไม่ผูกกับลูกค้า */
export interface ContentPlanBody {
  pillars: Pillar[];
  postsPerWeek: number;
  /** หัวข้อตั้งต้นสำหรับธุรกิจประเภทเดียวกัน */
  topicIdeas: string[];
}

export type TemplatePayload =
  | { kind: "bot_flow"; flow: FlowTemplateBody }
  | { kind: "moderation_rules"; rules: RuleTemplateBody[] }
  | { kind: "content_plan"; plan: ContentPlanBody };

export type TemplateKind = TemplatePayload["kind"];

export const TEMPLATE_KIND_TH: Record<TemplateKind, string> = {
  bot_flow: "ชุดบทสนทนาบอท",
  moderation_rules: "กฎจัดการคอมเมนต์",
  content_plan: "แผนคอนเทนต์",
};

export interface Template {
  id: string;
  name: string;
  description?: string;
  /**
   * เพจต้นทาง — เก็บไว้เพื่อตรวจสอบย้อนหลังเท่านั้น (ใครก๊อปจากใคร)
   * ห้ามส่งค่านี้ลงไปใน payload เด็ดขาด
   */
  sourcePageId: string;
  payload: TemplatePayload;
  /** ตัวแปรที่ต้องกรอกก่อนเอาไปใช้ */
  placeholders: string[];
  createdAtMs: number;
}

function collectPlaceholders(fields: readonly TextField[]): string[] {
  const found = new Set<string>();
  for (const f of fields) {
    for (const m of f.text.matchAll(PLACEHOLDER_RE)) found.add(m[1]!.trim());
  }
  return [...found].sort();
}

// ── ถอดของจากลูกค้าเดิมออกมาเป็นเทมเพลต ────────────────────────────────────

function flowFields(body: FlowTemplateBody): TextField[] {
  const fields: TextField[] = [{ path: "name", text: body.name }];
  body.nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if ("text" in n && n.text !== undefined) {
      fields.push({ path: `${p}.text`, text: n.text });
    }
    if (n.type === "choice") {
      n.options.forEach((o, j) => {
        fields.push({ path: `${p}.options[${j}].title`, text: o.title });
        fields.push({ path: `${p}.options[${j}].payload`, text: o.payload });
      });
    }
    if (n.type === "handover" && n.reason !== undefined) {
      fields.push({ path: `${p}.reason`, text: n.reason });
    }
    // ชื่อตัวแปรก็ถูกสแกนด้วย — ลูกค้าบางรายตั้งชื่อตัวแปรเป็นชื่อร้านตัวเอง
    // (saveAs กับ condition.variable ต้องผ่าน sanitize ตัวเดียวกัน ไม่งั้นชื่อจะไม่ตรงกันแล้ว flow ขาด)
    if (n.type === "question") {
      fields.push({ path: `${p}.saveAs`, text: n.saveAs });
    }
    if (n.type === "condition") {
      fields.push({ path: `${p}.variable`, text: n.variable });
      if (n.equals !== undefined) fields.push({ path: `${p}.equals`, text: n.equals });
      if (n.contains !== undefined) {
        fields.push({ path: `${p}.contains`, text: n.contains });
      }
    }
  });
  return fields;
}

function sanitizeNode(node: FlowNode, source: SourceIdentity): FlowNode {
  const s = (t: string): string => sanitizeText(t, source);
  switch (node.type) {
    case "message":
      return { ...node, text: s(node.text) };
    case "question":
      // saveAs ต้องผ่านฟังก์ชันเดียวกับ condition.variable เสมอ
      // ทั้งคู่เป็น deterministic ชื่อจึงยังตรงกันหลังแปลง flow ไม่ขาด
      return { ...node, text: s(node.text), saveAs: s(node.saveAs) };
    case "choice":
      return {
        ...node,
        text: s(node.text),
        options: node.options.map((o) => ({
          ...o,
          title: s(o.title),
          payload: s(o.payload),
        })),
      };
    case "condition":
      return {
        ...node,
        variable: s(node.variable),
        ...(node.equals !== undefined ? { equals: s(node.equals) } : {}),
        ...(node.contains !== undefined ? { contains: s(node.contains) } : {}),
      };
    case "handover":
      return node.reason !== undefined ? { ...node, reason: s(node.reason) } : { ...node };
    case "end":
      return node.text !== undefined ? { ...node, text: s(node.text) } : { ...node };
  }
}

export function extractBotFlowTemplate(args: {
  id: string;
  flow: BotFlow;
  source: SourceIdentity;
  nowMs: number;
  name?: string;
  description?: string;
}): Template {
  const body: FlowTemplateBody = {
    name: sanitizeText(args.name ?? args.flow.name, args.source),
    startNodeId: args.flow.startNodeId,
    nodes: args.flow.nodes.map((n) => sanitizeNode(n, args.source)),
  };

  const fields = flowFields(body);
  const findings = scanForLeaks(fields, args.source);
  if (findings.length > 0) throw new TemplateLeakError(findings);

  return {
    id: args.id,
    name: body.name,
    ...(args.description !== undefined ? { description: args.description } : {}),
    sourcePageId: args.source.pageId,
    payload: { kind: "bot_flow", flow: body },
    placeholders: collectPlaceholders(fields),
    createdAtMs: args.nowMs,
  };
}

function ruleFields(rules: readonly RuleTemplateBody[]): TextField[] {
  const fields: TextField[] = [];
  rules.forEach((r, i) => {
    fields.push({ path: `rules[${i}].name`, text: r.name });
    r.actions.forEach((a, j) => {
      if (a.message !== undefined) {
        fields.push({ path: `rules[${i}].actions[${j}].message`, text: a.message });
      }
    });
    if (r.trigger.type === "keyword") {
      r.trigger.words.forEach((w, k) => {
        fields.push({ path: `rules[${i}].trigger.words[${k}]`, text: w });
      });
    }
    if (r.trigger.type === "regex") {
      fields.push({ path: `rules[${i}].trigger.pattern`, text: r.trigger.pattern });
    }
  });
  return fields;
}

function sanitizeRule(
  rule: AutomationRule,
  source: SourceIdentity,
): RuleTemplateBody {
  const s = (t: string): string => sanitizeText(t, source);
  const trigger =
    rule.trigger.type === "keyword"
      ? { ...rule.trigger, words: rule.trigger.words.map(s) }
      : rule.trigger.type === "regex"
        ? { ...rule.trigger, pattern: s(rule.trigger.pattern) }
        : rule.trigger;

  return {
    name: s(rule.name),
    trigger,
    actions: rule.actions.map((a) =>
      a.message !== undefined ? { ...a, message: s(a.message) } : { ...a },
    ),
    priority: rule.priority,
    isActive: rule.isActive,
  };
}

export function extractModerationTemplate(args: {
  id: string;
  rules: readonly AutomationRule[];
  source: SourceIdentity;
  nowMs: number;
  name: string;
  description?: string;
}): Template {
  const rules = args.rules.map((r) => sanitizeRule(r, args.source));
  const fields = ruleFields(rules);
  const findings = scanForLeaks(fields, args.source);
  if (findings.length > 0) throw new TemplateLeakError(findings);

  return {
    id: args.id,
    name: args.name,
    ...(args.description !== undefined ? { description: args.description } : {}),
    sourcePageId: args.source.pageId,
    payload: { kind: "moderation_rules", rules },
    placeholders: collectPlaceholders(fields),
    createdAtMs: args.nowMs,
  };
}

export function extractContentPlanTemplate(args: {
  id: string;
  pillars: readonly Pillar[];
  postsPerWeek: number;
  topicIdeas?: readonly string[];
  source: SourceIdentity;
  nowMs: number;
  name: string;
  description?: string;
}): Template {
  validatePillars(args.pillars);

  const plan: ContentPlanBody = {
    pillars: args.pillars.map((p) => ({ ...p })),
    postsPerWeek: args.postsPerWeek,
    topicIdeas: (args.topicIdeas ?? []).map((t) => sanitizeText(t, args.source)),
  };

  const fields: TextField[] = plan.topicIdeas.map((t, i) => ({
    path: `topicIdeas[${i}]`,
    text: t,
  }));
  const findings = scanForLeaks(fields, args.source);
  if (findings.length > 0) throw new TemplateLeakError(findings);

  return {
    id: args.id,
    name: args.name,
    ...(args.description !== undefined ? { description: args.description } : {}),
    sourcePageId: args.source.pageId,
    payload: { kind: "content_plan", plan },
    placeholders: collectPlaceholders(fields),
    createdAtMs: args.nowMs,
  };
}

// ── เอาเทมเพลตไปใช้กับลูกค้าใหม่ ────────────────────────────────────────────

/** ตัวแปรที่ยังไม่ได้กรอก — ใช้ขึ้นฟอร์มก่อนกดใช้เทมเพลต */
export function missingValues(
  template: Template,
  values: Readonly<Record<string, string>>,
): string[] {
  return template.placeholders.filter(
    (p) => (values[p] ?? "").trim() === "",
  );
}

function fillPlaceholders(
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const v = values[key.trim()];
    // ปล่อยของเดิมไว้ถ้าไม่มีค่า — assertFilled จะเป็นคนจับ
    // (แทนด้วยค่าว่างเงียบๆ = บอทพูดประโยคขาดๆ ให้ลูกค้าอ่าน)
    return v === undefined || v.trim() === "" ? whole : v;
  });
}

function assertFilled(
  template: Template,
  values: Readonly<Record<string, string>>,
): void {
  const missing = missingValues(template, values);
  if (missing.length > 0) {
    throw new TemplateError(
      `missing values: ${missing.join(",")}`,
      `ยังกรอกไม่ครบ ขาด: ${missing.map((m) => `[[${m}]]`).join(", ")} — ถ้าใช้ทั้งที่ยังไม่กรอก ลูกค้าจะเห็นข้อความที่มีวงเล็บโผล่มา`,
    );
  }
}

/**
 * ด่านสุดท้าย: ของที่จะส่งให้ลูกค้าใหม่ต้องไม่มีวงเล็บ [[...]] เหลืออยู่
 *
 * `assertFilled` เชื่อฟิลด์ `placeholders` ที่คำนวณตอนถอดเทมเพลต
 * แต่เทมเพลตที่เขียนมือหรือแก้ใน DB อาจมีตัวแปรที่ไม่ได้อยู่ในรายการนั้น
 * ถ้าหลุดไป ลูกค้าจะเห็นบอทพิมพ์ "[[เบอร์โทร]]" ให้อ่าน
 */
function assertNoPlaceholdersLeft(value: unknown, what: string): void {
  const left = [
    ...new Set(
      [...JSON.stringify(value).matchAll(PLACEHOLDER_RE)].map((m) => m[0]),
    ),
  ];
  if (left.length > 0) {
    throw new TemplateError(
      `unfilled placeholders: ${left.join(",")}`,
      `${what} ยังมีตัวแปรที่ไม่ได้กรอก: ${left.join(", ")} — ถ้าปล่อยไป ลูกค้าจะเห็นวงเล็บพวกนี้ในข้อความจริง`,
    );
  }
}

function fillNode(
  node: FlowNode,
  values: Readonly<Record<string, string>>,
): FlowNode {
  const f = (t: string): string => fillPlaceholders(t, values);
  switch (node.type) {
    case "message":
      return { ...node, text: f(node.text) };
    case "question":
      return { ...node, text: f(node.text), saveAs: f(node.saveAs) };
    case "choice":
      return {
        ...node,
        text: f(node.text),
        options: node.options.map((o) => ({
          ...o,
          title: f(o.title),
          payload: f(o.payload),
        })),
      };
    case "condition":
      return {
        ...node,
        variable: f(node.variable),
        ...(node.equals !== undefined ? { equals: f(node.equals) } : {}),
        ...(node.contains !== undefined ? { contains: f(node.contains) } : {}),
      };
    case "handover":
      return node.reason !== undefined ? { ...node, reason: f(node.reason) } : { ...node };
    case "end":
      return node.text !== undefined ? { ...node, text: f(node.text) } : { ...node };
  }
}

/**
 * สร้าง bot flow ให้เพจใหม่จากเทมเพลต
 *
 * **คง node id เดิมไว้** เพราะ `next` / `ifTrue` / `options[].next` อ้างถึงกัน
 * เปลี่ยน id เมื่อไหร่ flow ขาดทันที — และตรวจซ้ำด้วย `validateFlow()`
 * ก่อนคืนออกไป กันเทมเพลตที่พังอยู่แล้วไปโผล่ที่ลูกค้าใหม่
 */
export function applyBotFlowTemplate(args: {
  template: Template;
  targetPageId: string;
  values: Readonly<Record<string, string>>;
  /** ตั้ง id เองได้ ไม่งั้นสร้างจาก pageId + template id ให้เดาซ้ำได้ */
  flowId?: string;
  /** เปิดใช้เลยไหม — ค่าเริ่มต้นคือปิดไว้ให้คนตรวจก่อน */
  activate?: boolean;
}): BotFlow {
  if (args.template.payload.kind !== "bot_flow") {
    throw new TemplateError(
      `wrong kind: ${args.template.payload.kind}`,
      `เทมเพลตนี้เป็น "${TEMPLATE_KIND_TH[args.template.payload.kind]}" ใช้สร้างบทสนทนาบอทไม่ได้`,
    );
  }
  assertFilled(args.template, args.values);

  const body = args.template.payload.flow;
  const flow: BotFlow = {
    id: args.flowId ?? `${args.targetPageId}:${args.template.id}`,
    pageId: args.targetPageId,
    name: fillPlaceholders(body.name, args.values),
    startNodeId: body.startNodeId,
    nodes: body.nodes.map((n) => fillNode(n, args.values)),
    // ปิดไว้ก่อนโดยเจตนา — เทมเพลตที่เพิ่งก๊อปมาต้องมีคนอ่านก่อนคุยกับลูกค้าจริง
    isActive: args.activate ?? false,
  };

  const issues = validateFlow(flow);
  const blocking = issues.filter((i) => !i.th.includes("เข้าไม่ถึง"));
  if (blocking.length > 0) {
    throw new TemplateError(
      `invalid flow: ${blocking.map((i) => i.nodeId).join(",")}`,
      `เทมเพลตนี้สร้าง flow ที่ใช้ไม่ได้:\n${blocking.map((i) => `• ${i.th}`).join("\n")}`,
    );
  }
  assertNoPlaceholdersLeft(flow, "บทสนทนาบอทที่สร้างจากเทมเพลต");
  return flow;
}

export function applyModerationTemplate(args: {
  template: Template;
  targetPageId: string;
  values: Readonly<Record<string, string>>;
  /** เปิดใช้เลยไหม — ค่าเริ่มต้นคือปิดไว้ */
  activate?: boolean;
}): AutomationRule[] {
  if (args.template.payload.kind !== "moderation_rules") {
    throw new TemplateError(
      `wrong kind: ${args.template.payload.kind}`,
      `เทมเพลตนี้เป็น "${TEMPLATE_KIND_TH[args.template.payload.kind]}" ใช้สร้างกฎคอมเมนต์ไม่ได้`,
    );
  }
  assertFilled(args.template, args.values);

  const rules: AutomationRule[] = args.template.payload.rules.map((r, i) => ({
    id: `${args.targetPageId}:${args.template.id}:${i}`,
    pageId: args.targetPageId,
    name: fillPlaceholders(r.name, args.values),
    trigger:
      r.trigger.type === "keyword"
        ? {
            ...r.trigger,
            words: r.trigger.words.map((w) => fillPlaceholders(w, args.values)),
          }
        : r.trigger.type === "regex"
          ? {
              ...r.trigger,
              pattern: fillPlaceholders(r.trigger.pattern, args.values),
            }
          : r.trigger,
    actions: r.actions.map((a) =>
      a.message !== undefined
        ? { ...a, message: fillPlaceholders(a.message, args.values) }
        : { ...a },
    ),
    priority: r.priority,
    isActive: (args.activate ?? false) && r.isActive,
  }));

  assertNoPlaceholdersLeft(rules, "กฎคอมเมนต์ที่สร้างจากเทมเพลต");
  return rules;
}

export function applyContentPlanTemplate(args: {
  template: Template;
  values?: Readonly<Record<string, string>>;
}): ContentPlanBody {
  if (args.template.payload.kind !== "content_plan") {
    throw new TemplateError(
      `wrong kind: ${args.template.payload.kind}`,
      `เทมเพลตนี้เป็น "${TEMPLATE_KIND_TH[args.template.payload.kind]}" ใช้สร้างแผนคอนเทนต์ไม่ได้`,
    );
  }
  const values = args.values ?? {};
  assertFilled(args.template, values);

  const plan = args.template.payload.plan;
  const out: ContentPlanBody = {
    pillars: plan.pillars.map((p) => ({ ...p })),
    postsPerWeek: plan.postsPerWeek,
    topicIdeas: plan.topicIdeas.map((t) => fillPlaceholders(t, values)),
  };
  assertNoPlaceholdersLeft(out, "แผนคอนเทนต์ที่สร้างจากเทมเพลต");
  return out;
}

// ── onboarding คลิกเดียว ────────────────────────────────────────────────────

export interface OnboardResult {
  flows: BotFlow[];
  rules: AutomationRule[];
  plans: ContentPlanBody[];
  /** เทมเพลตที่ใช้ไม่ได้ พร้อมเหตุผลภาษาไทย */
  failed: Array<{ templateId: string; th: string }>;
  th: string;
}

/**
 * ก๊อปหลายเทมเพลตเข้าเพจใหม่ในครั้งเดียว — นี่คือ "คลิกเดียว" ในสเปก
 *
 * ตัวไหนพังไม่ล้มทั้งชุด เพราะ onboarding ที่ได้ 2 ใน 3 แล้วรู้ว่าอันไหนพัง
 * ดีกว่าได้ 0 แล้วต้องไล่หาเองว่าติดตรงไหน
 */
export function onboardFromTemplates(args: {
  templates: readonly Template[];
  targetPageId: string;
  values: Readonly<Record<string, string>>;
  activate?: boolean;
}): OnboardResult {
  const flows: BotFlow[] = [];
  const rules: AutomationRule[] = [];
  const plans: ContentPlanBody[] = [];
  const failed: Array<{ templateId: string; th: string }> = [];

  for (const template of args.templates) {
    try {
      switch (template.payload.kind) {
        case "bot_flow":
          flows.push(
            applyBotFlowTemplate({
              template,
              targetPageId: args.targetPageId,
              values: args.values,
              ...(args.activate !== undefined ? { activate: args.activate } : {}),
            }),
          );
          break;
        case "moderation_rules":
          rules.push(
            ...applyModerationTemplate({
              template,
              targetPageId: args.targetPageId,
              values: args.values,
              ...(args.activate !== undefined ? { activate: args.activate } : {}),
            }),
          );
          break;
        case "content_plan":
          plans.push(
            applyContentPlanTemplate({ template, values: args.values }),
          );
          break;
      }
    } catch (err) {
      failed.push({
        templateId: template.id,
        th:
          err instanceof TemplateError
            ? err.th
            : `ใช้เทมเพลต "${template.name}" ไม่สำเร็จ`,
      });
    }
  }

  const ok = args.templates.length - failed.length;
  const th =
    failed.length === 0
      ? `ตั้งค่าเพจใหม่จาก ${ok} เทมเพลตเรียบร้อย — ยังปิดไว้ทั้งหมด ตรวจแล้วค่อยเปิด`
      : `ใช้ได้ ${ok} จาก ${args.templates.length} เทมเพลต — มี ${failed.length} อันที่ต้องแก้ก่อน`;

  return { flows, rules, plans, failed, th };
}
