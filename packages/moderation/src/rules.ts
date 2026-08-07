/**
 * Rule engine ของ Comment Automation (M3)
 *
 * ประเมินกฎทั้งหมดของเพจกับคอมเมนต์หนึ่งอัน แล้วสรุปว่าจะทำอะไรบ้าง
 *
 * หลักที่ยึด:
 *   - กฎที่ priority น้อยกว่าทำก่อน และ action ที่ขัดกันให้ตัวแรกชนะ
 *     (ตั้งกฎ "ซ่อน" ไว้ก่อน "ตอบกลับ" แล้วจะไม่เกิดกรณีตอบใต้คอมเมนต์ที่ซ่อนไปแล้ว)
 *   - action ที่ย้อนกลับไม่ได้ (delete) ต้องมั่นใจสูงกว่าปกติ
 */
import { normalizeText } from "./normalize.js";
import {
  detectBuyingIntent,
  detectComplaint,
  detectExternalLink,
  detectLineId,
  detectPhone,
  detectProfanity,
  type DetectionHit,
} from "./detectors.js";
import { analyzeSentiment, type SentimentResult } from "./sentiment.js";
import type {
  AutomationRule,
  IncomingComment,
  PlannedAction,
  RuleTrigger,
  TemplateVars,
} from "./types.js";

/** ต่ำกว่านี้ห้ามซ่อน/ลบอัตโนมัติ ให้แค่ปักธงให้คนดู */
export const AUTO_HIDE_MIN_CONFIDENCE = 0.8;
/** ลบคอมเมนต์กู้คืนไม่ได้ จึงต้องมั่นใจกว่าซ่อน */
export const AUTO_DELETE_MIN_CONFIDENCE = 0.95;

export interface RuleContext {
  comment: IncomingComment;
  /** คำต้องห้ามเพิ่มเติมที่ลูกค้าตั้งเอง */
  customProfanity?: string[];
  customBuyingIntent?: string[];
  customComplaint?: string[];
  vars?: TemplateVars;
}

export interface RuleEvaluation {
  actions: PlannedAction[];
  sentiment: SentimentResult;
  /** ตัวตรวจจับที่ทำงาน — เก็บไว้อธิบายให้ลูกค้าฟังได้ว่าทำไมถึงซ่อน */
  hits: DetectionHit[];
}

/** แทนค่าตัวแปรในข้อความตอบกลับ */
export function renderTemplate(
  template: string,
  vars: TemplateVars = {},
): string {
  return template.replace(/\{([^}]+)\}/g, (whole, key: string) => {
    const v = vars[key.trim()];
    // ไม่มีค่าให้แทน → ทิ้งวงเล็บไว้จะดูแปลก ตัดทิ้งทั้งก้อนดีกว่า
    return v === undefined ? "" : v;
  });
}

function matchTrigger(
  trigger: RuleTrigger,
  ctx: RuleContext,
  cached: { sentiment: SentimentResult; hits: Map<string, DetectionHit | null> },
): DetectionHit | null {
  const text = ctx.comment.message;

  const cache = (
    key: string,
    fn: () => DetectionHit | null,
  ): DetectionHit | null => {
    if (!cached.hits.has(key)) cached.hits.set(key, fn());
    return cached.hits.get(key) ?? null;
  };

  switch (trigger.type) {
    case "keyword": {
      const normal = normalizeText(text);
      for (const w of trigger.words) {
        const nw = normalizeText(w);
        if (nw !== "" && normal.includes(nw)) {
          return {
            kind: "buying_intent",
            matched: w,
            confidence: 0.9,
            th: `ตรงกับคีย์เวิร์ด "${w}"`,
          };
        }
      }
      return null;
    }
    case "regex": {
      let re: RegExp;
      try {
        re = new RegExp(trigger.pattern, trigger.flags ?? "i");
      } catch {
        // กฎที่ลูกค้าตั้งผิด ต้องไม่ทำให้ทั้งระบบพัง
        return null;
      }
      const m = re.exec(normalizeText(text));
      return m
        ? {
            kind: "buying_intent",
            matched: m[0],
            confidence: 0.9,
            th: `ตรงกับรูปแบบที่ตั้งไว้ ("${m[0]}")`,
          }
        : null;
    }
    case "phone":
      return cache("phone", () => detectPhone(text));
    case "external_link":
      return cache("link", () => detectExternalLink(text));
    case "line_id":
      return cache("line", () => detectLineId(text));
    case "profanity":
      return cache("profanity", () =>
        detectProfanity(text, ctx.customProfanity),
      );
    case "buying_intent":
      return cache("intent", () =>
        detectBuyingIntent(text, ctx.customBuyingIntent),
      );
    case "complaint":
      return cache("complaint", () =>
        detectComplaint(text, ctx.customComplaint),
      );
    case "negative_sentiment":
      return cached.sentiment.sentiment === "negative"
        ? {
            kind: "complaint",
            matched: cached.sentiment.signals.join(", "),
            confidence: cached.sentiment.confidence,
            th: cached.sentiment.th,
          }
        : null;
    case "positive_sentiment":
      return cached.sentiment.sentiment === "positive"
        ? {
            kind: "buying_intent",
            matched: cached.sentiment.signals.join(", "),
            confidence: cached.sentiment.confidence,
            th: cached.sentiment.th,
          }
        : null;
  }
}

/**
 * ลำดับอำนาจของ action — เลขมากกว่าชนะเมื่อขัดกัน
 *
 * ต้องเป็นแบบ "ไม่สมมาตร" ไม่ใช่ "ตัวแรกที่เกิดชนะ"
 * เพราะลูกค้าตั้ง priority ของกฎเองได้ ถ้าเผลอตั้งกฎ "กดไลก์" ไว้ก่อนกฎ "ซ่อน"
 * คอมเมนต์หยาบจะไม่ถูกซ่อน — และไม่มีใครรู้ตัวจนกว่าลูกค้าจะโทรมาด่า
 *
 * การปกป้องเพจต้องชนะการเพิ่ม engagement เสมอ
 */
const ACTION_RANK: Record<string, number> = {
  delete: 100,
  hide: 90,
  flag: 50,
  alert: 50,
  unhide: 40,
  reply: 30,
  private_reply: 30,
  like: 10,
};

/** คู่ที่ทำพร้อมกันไม่ได้ */
const CONFLICTS: Array<[string, string]> = [
  ["hide", "reply"],
  ["hide", "like"],
  ["hide", "private_reply"],
  ["hide", "unhide"],
  ["delete", "reply"],
  ["delete", "like"],
  ["delete", "private_reply"],
  ["delete", "hide"],
  ["delete", "unhide"],
];

function conflictsWith(existing: string, candidate: string): boolean {
  return CONFLICTS.some(
    ([a, b]) =>
      (a === existing && b === candidate) || (a === candidate && b === existing),
  );
}

function rank(kind: string): number {
  return ACTION_RANK[kind] ?? 0;
}

export function evaluateRules(
  rules: readonly AutomationRule[],
  ctx: RuleContext,
): RuleEvaluation {
  const sentiment = analyzeSentiment(ctx.comment.message);
  const cached = { sentiment, hits: new Map<string, DetectionHit | null>() };

  const active = rules
    .filter((r) => r.isActive && r.pageId === ctx.comment.pageId)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const actions: PlannedAction[] = [];
  const hits: DetectionHit[] = [];

  for (const rule of active) {
    const hit = matchTrigger(rule.trigger, ctx, cached);
    if (!hit) continue;
    hits.push(hit);

    for (const a of rule.actions) {
      // action ที่ทำแล้วย้อนไม่ได้ต้องมั่นใจพอ ไม่งั้นลดเหลือแค่ปักธง
      const floor =
        a.kind === "delete"
          ? AUTO_DELETE_MIN_CONFIDENCE
          : a.kind === "hide"
            ? AUTO_HIDE_MIN_CONFIDENCE
            : 0;
      if (hit.confidence < floor) {
        actions.push({
          kind: "flag",
          reason: `${hit.th} — แต่ความมั่นใจ ${Math.round(hit.confidence * 100)}% ยังไม่พอจะ${a.kind === "delete" ? "ลบ" : "ซ่อน"}เอง จึงปักธงให้ตรวจ`,
          confidence: hit.confidence,
          ruleId: rule.id,
        });
        continue;
      }

      if (actions.some((x) => x.kind === a.kind)) continue;

      const blockers = actions.filter((x) => conflictsWith(x.kind, a.kind));
      if (blockers.length > 0) {
        // ตัวใหม่อ่อนกว่าตัวที่วางแผนไว้แล้ว → ทิ้งตัวใหม่
        if (blockers.some((b) => rank(b.kind) >= rank(a.kind))) continue;
        // ตัวใหม่แรงกว่า (เช่น hide มาทีหลัง like) → ถอนตัวที่อ่อนกว่าออก
        for (const b of blockers) {
          actions.splice(actions.indexOf(b), 1);
        }
      }

      const planned: PlannedAction = {
        kind: a.kind,
        reason: `${rule.name}: ${hit.th}`,
        confidence: hit.confidence,
        ruleId: rule.id,
      };
      if (a.message !== undefined) {
        planned.message = renderTemplate(a.message, ctx.vars);
      }
      actions.push(planned);
    }
  }

  return { actions, sentiment, hits };
}

/** กฎเริ่มต้นที่ควรเปิดให้ทุกเพจ — ใช้ตอน onboarding ลูกค้าใหม่ */
export function defaultRules(pageId: string): AutomationRule[] {
  return [
    {
      id: `${pageId}:profanity`,
      pageId,
      name: "ซ่อนคำหยาบ",
      trigger: { type: "profanity" },
      actions: [{ kind: "hide" }],
      priority: 10,
      isActive: true,
    },
    {
      id: `${pageId}:phone`,
      pageId,
      name: "ซ่อนเบอร์โทรคู่แข่ง",
      trigger: { type: "phone" },
      actions: [{ kind: "hide" }],
      priority: 20,
      isActive: true,
    },
    {
      id: `${pageId}:link`,
      pageId,
      name: "ซ่อนลิงก์สแปม",
      trigger: { type: "external_link" },
      actions: [{ kind: "hide" }],
      priority: 30,
      isActive: true,
    },
    {
      id: `${pageId}:complaint`,
      pageId,
      name: "แจ้งเตือนคอมเมนต์เชิงลบ",
      trigger: { type: "negative_sentiment" },
      actions: [{ kind: "alert" }],
      priority: 40,
      isActive: true,
    },
    {
      id: `${pageId}:intent`,
      pageId,
      name: "ทักลูกค้าที่สนใจเข้า inbox",
      trigger: { type: "buying_intent" },
      actions: [
        {
          kind: "private_reply",
          message:
            "สวัสดีค่ะ{ชื่อลูกค้า} ขอบคุณที่สนใจ{ชื่อร้าน}นะคะ 😊 รบกวนสอบถามรายละเอียดเพิ่มเติมทางแชทนี้ได้เลยค่ะ",
        },
      ],
      priority: 50,
      isActive: true,
    },
    {
      id: `${pageId}:positive`,
      pageId,
      name: "กดไลก์คอมเมนต์เชิงบวก",
      trigger: { type: "positive_sentiment" },
      actions: [{ kind: "like" }],
      priority: 60,
      isActive: true,
    },
  ];
}
