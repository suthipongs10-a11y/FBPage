/**
 * Flow engine (M2)
 *
 * สเปก: "Flow Builder แบบ visual (React Flow) — node: ส่งข้อความ / ถามคำถาม /
 *        ปุ่ม Quick Reply / เงื่อนไข / เก็บตัวแปร / ส่งต่อคน / เรียก webhook"
 *
 * ไฟล์นี้คือ **ตัวรัน** flow ส่วนตัววาดเป็นงาน UI
 * แยกกันเพราะตรรกะการรันคือส่วนที่ผิดแล้วลูกค้าเจอ (บอทวนลูป ถามซ้ำ ค้างกลางทาง)
 * จึงต้องเทสต์ได้โดยไม่ต้องมีหน้าจอ
 */
import type { BotReply } from "./types.js";

export type FlowNode =
  | { id: string; type: "message"; text: string; next?: string }
  | {
      id: string;
      type: "question";
      text: string;
      /** เก็บคำตอบลงตัวแปรชื่อนี้ */
      saveAs: string;
      next?: string;
    }
  | {
      id: string;
      type: "choice";
      text: string;
      options: Array<{ title: string; payload: string; next: string }>;
    }
  | {
      id: string;
      type: "condition";
      /** ตัวแปรที่จะเช็ค */
      variable: string;
      /** เท่ากับค่านี้ไหม (ไม่สนตัวพิมพ์) */
      equals?: string;
      /** มีคำนี้อยู่ไหม */
      contains?: string;
      ifTrue: string;
      ifFalse: string;
    }
  | { id: string; type: "handover"; reason?: string }
  | { id: string; type: "end"; text?: string };

export interface BotFlow {
  id: string;
  pageId: string;
  name: string;
  startNodeId: string;
  nodes: FlowNode[];
  isActive: boolean;
}

/** สถานะของลูกค้าคนหนึ่งใน flow */
export interface FlowState {
  flowId: string;
  currentNodeId: string;
  variables: Record<string, string>;
  /** กันวนลูป */
  visitCount: number;
}

export class FlowError extends Error {
  override readonly name = "FlowError";
  readonly th: string;
  constructor(message: string, th: string) {
    super(message);
    this.th = th;
  }
}

/**
 * เดินได้กี่ node ต่อการรับข้อความหนึ่งครั้ง
 *
 * จำเป็นเพราะ flow ที่ลูกค้าวาดเองอาจมีวงวน (A → B → A) โดยไม่ตั้งใจ
 * ถ้าไม่จำกัด บอทจะยิงข้อความรัวใส่ลูกค้าจนโดนบล็อก
 */
export const MAX_STEPS_PER_TURN = 10;

export interface FlowStepResult {
  /** ข้อความที่ต้องส่งตามลำดับ */
  replies: BotReply[];
  /** สถานะใหม่ — null = จบ flow แล้ว */
  state: FlowState | null;
  /**
   * ตัวแปรที่เก็บได้ทั้งหมด ณ ตอนนี้
   *
   * แยกจาก `state` เพราะพอ flow จบ state จะเป็น null แต่ข้อมูลที่เก็บมา
   * (ชื่อ เบอร์ ที่อยู่) คือผลลัพธ์ที่เราต้องการ — ทิ้งไปไม่ได้
   */
  variables: Record<string, string>;
  /** ต้องรอลูกค้าตอบก่อนไปต่อ */
  awaitingInput: boolean;
  /** ต้องส่งต่อให้คน */
  handover?: string;
  th: string;
}

function findNode(flow: BotFlow, id: string): FlowNode | undefined {
  return flow.nodes.find((n) => n.id === id);
}

/** เริ่ม flow ใหม่ */
export function startFlow(flow: BotFlow): FlowState {
  if (!findNode(flow, flow.startNodeId)) {
    throw new FlowError(
      `start node "${flow.startNodeId}" not found`,
      `flow "${flow.name}" ชี้ไปยัง node เริ่มต้นที่ไม่มีอยู่ — ต้องแก้ที่ตัววาด flow`,
    );
  }
  return {
    flowId: flow.id,
    currentNodeId: flow.startNodeId,
    variables: {},
    visitCount: 0,
  };
}

/**
 * เดิน flow ต่อจากสถานะปัจจุบัน
 *
 * @param input ข้อความหรือ payload ที่ลูกค้าเพิ่งส่ง (undefined = เริ่มต้นรอบแรก)
 */
export function stepFlow(args: {
  flow: BotFlow;
  state: FlowState;
  input?: string;
}): FlowStepResult {
  const { flow } = args;
  let state: FlowState = {
    ...args.state,
    variables: { ...args.state.variables },
  };
  const replies: BotReply[] = [];
  let input = args.input;

  for (let step = 0; step < MAX_STEPS_PER_TURN; step++) {
    const node = findNode(flow, state.currentNodeId);
    if (!node) {
      return {
        replies,
        state: null,
        variables: state.variables,
        awaitingInput: false,
        th: `flow ชี้ไปยัง node "${state.currentNodeId}" ที่ไม่มีอยู่ — จบ flow เพื่อไม่ให้ค้าง`,
      };
    }

    switch (node.type) {
      case "message": {
        replies.push(flowReply(node.text));
        if (!node.next) {
          return {
            replies,
            state: null,
            variables: state.variables,
            awaitingInput: false,
            th: "จบ flow",
          };
        }
        state = { ...state, currentNodeId: node.next, visitCount: state.visitCount + 1 };
        continue;
      }

      case "question": {
        // ยังไม่มีคำตอบ → ถามแล้วรอ
        if (input === undefined) {
          replies.push(flowReply(node.text));
          return {
            replies,
            state,
            variables: state.variables,
            awaitingInput: true,
            th: `ถามลูกค้าแล้ว รอคำตอบเพื่อเก็บลงตัวแปร "${node.saveAs}"`,
          };
        }
        // มีคำตอบแล้ว → เก็บแล้วไปต่อ
        state = {
          ...state,
          variables: { ...state.variables, [node.saveAs]: input },
          visitCount: state.visitCount + 1,
        };
        input = undefined;
        if (!node.next) {
          return {
            replies,
            state: null,
            variables: state.variables,
            awaitingInput: false,
            th: "จบ flow",
          };
        }
        state = { ...state, currentNodeId: node.next };
        continue;
      }

      case "choice": {
        if (input === undefined) {
          const reply = flowReply(node.text);
          reply.quickReplies = node.options.map((o) => ({
            title: o.title,
            payload: o.payload,
          }));
          replies.push(reply);
          return {
            replies,
            state,
            variables: state.variables,
            awaitingInput: true,
            th: "ให้ลูกค้าเลือกตัวเลือก",
          };
        }
        const chosen = node.options.find(
          (o) =>
            o.payload === input ||
            o.title.trim().toLowerCase() === input!.trim().toLowerCase(),
        );
        if (!chosen) {
          // ลูกค้าพิมพ์อย่างอื่น — ถามซ้ำครั้งเดียวแล้วส่งต่อให้คนถ้ายังไม่ตรง
          const reply = flowReply(node.text);
          reply.quickReplies = node.options.map((o) => ({
            title: o.title,
            payload: o.payload,
          }));
          replies.push(reply);
          return {
            replies,
            state,
            variables: state.variables,
            awaitingInput: true,
            th: "ลูกค้าตอบไม่ตรงตัวเลือก ถามใหม่อีกครั้ง",
          };
        }
        input = undefined;
        state = {
          ...state,
          currentNodeId: chosen.next,
          visitCount: state.visitCount + 1,
        };
        continue;
      }

      case "condition": {
        const value = state.variables[node.variable] ?? "";
        let pass = false;
        if (node.equals !== undefined) {
          pass = value.trim().toLowerCase() === node.equals.trim().toLowerCase();
        } else if (node.contains !== undefined) {
          pass = value.toLowerCase().includes(node.contains.toLowerCase());
        }
        state = {
          ...state,
          currentNodeId: pass ? node.ifTrue : node.ifFalse,
          visitCount: state.visitCount + 1,
        };
        continue;
      }

      case "handover": {
        return {
          replies,
          state: null,
          variables: state.variables,
          awaitingInput: false,
          handover: node.reason ?? "flow กำหนดให้ส่งต่อให้เจ้าหน้าที่",
          th: "ส่งต่อให้เจ้าหน้าที่ตามที่ flow กำหนด",
        };
      }

      case "end": {
        if (node.text) replies.push(flowReply(node.text));
        return {
          replies,
          state: null,
          variables: state.variables,
          awaitingInput: false,
          th: "จบ flow",
        };
      }
    }
  }

  // เดินครบขีดจำกัดแล้วยังไม่จบ = flow มีวงวน
  return {
    replies,
    state: null,
    variables: state.variables,
    awaitingInput: false,
    handover: "flow วนลูปไม่จบ",
    th: `flow เดินเกิน ${MAX_STEPS_PER_TURN} ขั้นโดยไม่หยุด — น่าจะมีวงวน ส่งต่อให้คนแทน`,
  };
}

function flowReply(text: string): BotReply {
  return {
    layer: "flow",
    text,
    confidence: 1,
    th: "ตอบตาม flow ที่ตั้งไว้",
  };
}

// ---------------------------------------------------------------------------

export interface FlowValidationIssue {
  nodeId: string;
  th: string;
}

/**
 * ตรวจ flow ก่อนเปิดใช้งาน — เจอปัญหาตอนตั้งค่าดีกว่าตอนลูกค้าคุยอยู่
 *
 * ตรวจ: node ปลายทางมีจริงไหม, มี node ที่เข้าไม่ถึงไหม, มีวงวนไหม
 */
export function validateFlow(flow: BotFlow): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const ids = new Set(flow.nodes.map((n) => n.id));

  if (!ids.has(flow.startNodeId)) {
    issues.push({
      nodeId: flow.startNodeId,
      th: `ไม่มี node เริ่มต้น "${flow.startNodeId}" อยู่ใน flow`,
    });
  }

  const targetsOf = (n: FlowNode): string[] => {
    switch (n.type) {
      case "message":
      case "question":
        return n.next ? [n.next] : [];
      case "choice":
        return n.options.map((o) => o.next);
      case "condition":
        return [n.ifTrue, n.ifFalse];
      case "handover":
      case "end":
        return [];
    }
  };

  for (const node of flow.nodes) {
    for (const t of targetsOf(node)) {
      if (!ids.has(t)) {
        issues.push({
          nodeId: node.id,
          th: `node "${node.id}" ชี้ไปยัง "${t}" ที่ไม่มีอยู่จริง`,
        });
      }
    }
    if (node.type === "choice" && node.options.length === 0) {
      issues.push({
        nodeId: node.id,
        th: `node "${node.id}" เป็นตัวเลือกแต่ไม่มีตัวเลือกให้เลือก`,
      });
    }
  }

  // node ที่เข้าไม่ถึง — ไม่ใช่ error แต่บอกไว้ให้รู้ว่าลืมต่อเส้น
  const reachable = new Set<string>();
  const queue = [flow.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const n = flow.nodes.find((x) => x.id === id);
    if (n) queue.push(...targetsOf(n));
  }
  for (const n of flow.nodes) {
    if (!reachable.has(n.id)) {
      issues.push({
        nodeId: n.id,
        th: `node "${n.id}" เข้าไม่ถึงจากจุดเริ่มต้น — ลืมต่อเส้นหรือเปล่า`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------

export interface DryRunTurn {
  /** ลูกค้าพิมพ์อะไร */
  input?: string;
  /** บอทตอบอะไรบ้าง */
  replies: string[];
  awaitingInput: boolean;
  handover?: string;
}

/**
 * Test Console (สเปกข้อ M2) — ลอง flow โดยไม่ต้องส่งจริง
 *
 * ป้อนลำดับข้อความที่ลูกค้าจะพิมพ์ แล้วดูว่าบอทตอบอะไรกลับ
 * ใช้ตอนตั้งค่าให้ลูกค้าใหม่ ก่อนเปิดใช้จริง
 */
export function dryRunFlow(
  flow: BotFlow,
  inputs: readonly string[],
): { turns: DryRunTurn[]; variables: Record<string, string>; th: string } {
  const turns: DryRunTurn[] = [];
  let state: FlowState | null = startFlow(flow);
  let variables: Record<string, string> = {};

  // รอบแรกไม่มี input — เดินจนกว่าจะเจอจุดที่ต้องรอ
  let result = stepFlow({ flow, state });
  turns.push({
    replies: result.replies.map((r) => r.text),
    awaitingInput: result.awaitingInput,
    ...(result.handover !== undefined ? { handover: result.handover } : {}),
  });
  state = result.state;
  variables = result.variables;

  for (const input of inputs) {
    if (!state) break;
    result = stepFlow({ flow, state, input });
    turns.push({
      input,
      replies: result.replies.map((r) => r.text),
      awaitingInput: result.awaitingInput,
      ...(result.handover !== undefined ? { handover: result.handover } : {}),
    });
    state = result.state;
    variables = result.variables;
  }

  const ended = state === null;
  return {
    turns,
    variables,
    th: ended
      ? `flow จบแล้วหลัง ${turns.length} รอบ`
      : `flow ยังไม่จบ กำลังรอคำตอบจากลูกค้า (เดินไป ${turns.length} รอบ)`,
  };
}
