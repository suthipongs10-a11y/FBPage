/**
 * ข้อมูลตัวอย่างสำหรับหน้าจอ — จนกว่า Prisma repository จะพร้อม
 *
 * สองข้อที่ตั้งใจทำ:
 *
 * 1. **ปฏิทินสร้างจาก `planCalendarSlots()` ของจริง** ไม่ได้เขียนวันที่มือ
 *    หน้าจอที่เห็นจึงเป็นผลลัพธ์จริงของโมดูล M-G รวมถึงการกระจายวัน
 *    การข้ามช่วงที่ผ่านไปแล้ว และการแปลง timezone
 * 2. **ไม่มีการสุ่มจริง** ใช้ LCG ที่ seed คงที่ — เปิดหน้าสองครั้งได้ของเหมือนกัน
 *    ไม่งั้นเทสต์เชื่อไม่ได้ และ React จะเจอ hydration mismatch
 */
import {
  DEFAULT_PILLARS,
  buildPillarPlan,
  planCalendarSlots,
} from "@page-os/studio";
import type { ConnectionState } from "@page-os/meta";
import type {
  ClientPage,
  ConversationRow,
  IncidentRow,
  PlanKey,
  ScheduledPostRow,
  Workspace,
  WorkspaceSource,
} from "./workspace.js";

/** LCG ง่ายๆ — ต้องการแค่ "ดูไม่เป็นระเบียบ" ไม่ได้ต้องการคุณภาพเชิงสถิติ */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

interface PageSeed {
  pageId: string;
  pageName: string;
  clientName: string;
  plan: PlanKey;
  followers: number;
  state: ConnectionState;
  hoursUntilExpiry?: number;
  /** webhook เงียบมากี่นาที — null = ไม่เคยได้รับเลย */
  webhookSilentMinutes: number | null;
  postsPerWeek: number;
  /** ชั่วโมงที่เพจนี้ได้ผลดี (จาก Insights) */
  bestHours: Array<{ dayOfWeek: number; hour: number }>;
}

const PAGE_SEEDS: PageSeed[] = [
  {
    pageId: "1013",
    pageName: "ครัวคุณยาย — ข้าวกล่องส่งออฟฟิศ",
    clientName: "ครัวคุณยาย",
    plan: "FULL",
    followers: 18_420,
    state: "ok",
    webhookSilentMinutes: 2,
    postsPerWeek: 5,
    bestHours: [
      { dayOfWeek: 1, hour: 11 },
      { dayOfWeek: 3, hour: 11 },
      { dayOfWeek: 5, hour: 17 },
    ],
  },
  {
    pageId: "1027",
    pageName: "ครัวคุณยาย Catering",
    clientName: "ครัวคุณยาย",
    plan: "FULL",
    followers: 4_110,
    state: "expiring_soon",
    hoursUntilExpiry: 96,
    webhookSilentMinutes: 7,
    postsPerWeek: 3,
    bestHours: [
      { dayOfWeek: 2, hour: 10 },
      { dayOfWeek: 4, hour: 14 },
    ],
  },
  {
    pageId: "1044",
    pageName: "บ้านขนมป้าแดง",
    clientName: "บ้านขนมป้าแดง",
    plan: "GROWTH",
    followers: 9_860,
    state: "ok",
    webhookSilentMinutes: 51,
    postsPerWeek: 4,
    bestHours: [
      { dayOfWeek: 6, hour: 9 },
      { dayOfWeek: 0, hour: 19 },
    ],
  },
  {
    pageId: "1058",
    pageName: "คลินิกหมอฟันรัชดา",
    clientName: "รัชดาเดนทัล",
    plan: "FULL",
    followers: 22_305,
    state: "ok",
    webhookSilentMinutes: 1,
    postsPerWeek: 4,
    bestHours: [
      { dayOfWeek: 2, hour: 19 },
      { dayOfWeek: 4, hour: 19 },
      { dayOfWeek: 6, hour: 13 },
    ],
  },
  {
    pageId: "1063",
    pageName: "รัชดาเดนทัล จัดฟัน",
    clientName: "รัชดาเดนทัล",
    plan: "GROWTH",
    followers: 6_740,
    state: "expired",
    webhookSilentMinutes: 410,
    postsPerWeek: 3,
    bestHours: [{ dayOfWeek: 3, hour: 20 }],
  },
  {
    pageId: "1071",
    pageName: "สวนกาแฟดอยหลวง",
    clientName: "ดอยหลวง",
    plan: "STARTER",
    followers: 3_290,
    state: "ok",
    webhookSilentMinutes: 12,
    postsPerWeek: 2,
    bestHours: [],
  },
  {
    pageId: "1085",
    pageName: "PT Studio ฟิตเนสส่วนตัว",
    clientName: "PT Studio",
    plan: "GROWTH",
    followers: 12_050,
    state: "missing_permissions",
    webhookSilentMinutes: 4,
    postsPerWeek: 4,
    bestHours: [
      { dayOfWeek: 1, hour: 6 },
      { dayOfWeek: 4, hour: 18 },
    ],
  },
  {
    pageId: "1092",
    pageName: "ร้านต้นไม้ใบเขียว",
    clientName: "ใบเขียว",
    plan: "STARTER",
    followers: 5_610,
    state: "ok",
    webhookSilentMinutes: null,
    postsPerWeek: 2,
    bestHours: [{ dayOfWeek: 6, hour: 10 }],
  },
];

const TZ = "Asia/Bangkok";

const CONTACT_NAMES = [
  "คุณนภัส",
  "คุณธีร์",
  "พี่แหม่ม",
  "คุณเจน",
  "คุณอาร์ม",
  "น้องพลอย",
  "คุณวรุณ",
  "พี่ตั้ม",
  "คุณมิ้นท์",
  "คุณกฤต",
  "คุณฝน",
  "พี่โอ๋",
];

const PREVIEWS = [
  "สนใจสั่ง 30 กล่อง วันศุกร์นี้ได้ไหมคะ",
  "ราคาส่งฟรีขั้นต่ำเท่าไหร่ครับ",
  "ของที่สั่งไว้เมื่อวานยังไม่ได้เลยค่ะ",
  "เปิดกี่โมงคะ พรุ่งนี้จะแวะไป",
  "มีเมนูสำหรับคนแพ้นมไหมคะ",
  "อยากจองคิววันเสาร์ครับ",
  "ขอใบเสนอราคาสำหรับ 100 คนหน่อยค่ะ",
  "โปรที่โพสต์ไว้ยังใช้ได้อยู่ไหมคะ",
  "จ่ายเงินแล้วนะคะ ส่งสลิปให้",
  "อยากเปลี่ยนวันที่นัดไว้ครับ",
];

/**
 * หัวข้อโพสต์แยกตามเสาหลัก
 *
 * ต้องตรงกับเสาหลักของช่องนั้น ไม่ใช่หยิบจากกองเดียวกันหมด — ไม่งั้นหน้าจอจะโชว์
 * "5 วิธีเก็บอาหาร..." โดยติดป้ายว่าเป็นโพสต์ "ขาย" ซึ่งอ่านแล้วรู้ทันทีว่าเป็นของปลอม
 */
const POST_IDEAS: Record<string, string[]> = {
  educate: [
    "5 วิธีเก็บอาหารให้อยู่ได้ 3 วันโดยไม่เสียรสชาติ",
    "ทำไมเราไม่ใส่ผงชูรส",
    "ตอบคำถามที่ถูกถามบ่อยที่สุดสัปดาห์นี้",
    "จัดเลี้ยงประชุม 50 คน ต้องเตรียมอะไรบ้าง",
  ],
  sell: [
    "เมนูใหม่สัปดาห์นี้ พร้อมราคา",
    "โปรสิ้นเดือน สั่งครบ 20 กล่องลด 10%",
    "เปิดจองล่วงหน้าสัปดาห์หน้าแล้ววันนี้",
    "ส่งฟรีในรัศมี 3 กม. ถึงสิ้นเดือน",
  ],
  engage: [
    "ถามหน่อย — เมนูไหนที่อยากให้กลับมาขายอีก",
    "ทายกันเล่นๆ ว่าเมนูนี้ใช้เวลาทำกี่นาที",
    "วันนี้อยากกินเผ็ดหรือไม่เผ็ดคะ",
    "คอมเมนต์บอกเมนูโปรดมาหน่อย",
  ],
  behind_scenes: [
    "พาดูเบื้องหลังตอนตีสี่ที่ตลาด",
    "วันหยุดนี้เปิดตามปกตินะคะ",
    "แนะนำทีมครัวของเรา",
    "กว่าจะได้แกงส้มหนึ่งหม้อ ผ่านมือคนกี่คน",
  ],
};

const FALLBACK_IDEAS = POST_IDEAS.educate!;

const FAIL_REASONS = [
  "Token หมดอายุระหว่างโพสต์ — ต้องเชื่อมเพจใหม่",
  "Meta ตอบกลับช้าเกินกำหนด (timeout) — ระบบจะลองใหม่ให้",
  "รูปที่แนบมีขนาดใหญ่เกินที่ Meta รับ",
];

/** หยิบหัวข้อที่เข้ากับเสาหลักของช่องนั้น แบบกำหนดได้ ไม่สุ่ม */
function ideasFor(pillar: string, seed: number): string {
  const list = POST_IDEAS[pillar] ?? FALLBACK_IDEAS;
  return list[seed % list.length]!;
}

function buildScheduled(nowMs: number): ScheduledPostRow[] {
  const out: ScheduledPostRow[] = [];
  const rand = rng(20260808);

  PAGE_SEEDS.forEach((seed, pageOffset) => {
    // เพจที่ต่อไม่ได้ ไม่ควรมีปฏิทินใหม่ให้ดู — สะท้อนความจริงว่าใช้งานไม่ได้
    if (seed.state === "expired" || seed.state === "revoked") return;

    const slots = planCalendarSlots({
      startAtMs: nowMs,
      nowMs,
      timeZone: TZ,
      days: 21,
      postsPerWeek: seed.postsPerWeek,
      bestTimes: seed.bestHours.map((b, i) => ({
        ...b,
        score: 1 - i * 0.1,
        samples: 8,
        label: `${b.dayOfWeek} ${b.hour}`,
      })),
    });

    const plan = buildPillarPlan(DEFAULT_PILLARS, slots.length);

    slots.forEach((slot, i) => {
      const planned = plan[i]!;
      const r = rand();
      // โพสต์ที่ใกล้ถึงคิวมักอนุมัติแล้ว ที่ไกลออกไปยังรออยู่
      const approval =
        i === 0 && r < 0.5
          ? "pending"
          : r < 0.22
            ? "pending"
            : r < 0.3
              ? "changes_requested"
              : "approved";
      const failed = r > 0.985 ? 3 : r > 0.965 ? 1 : 0;

      out.push({
        postId: `${seed.pageId}-p${i}`,
        pageId: seed.pageId,
        scheduledAtMs: slot.atMs,
        type: i % 3 === 0 ? "photo" : "text",
        preview: ideasFor(planned.pillar, i + pageOffset),
        pillarLabelTh: planned.labelTh,
        approval,
        failedAttempts: failed,
        ...(failed > 0
          ? { lastErrorTh: FAIL_REASONS[(i + pageOffset) % FAIL_REASONS.length]! }
          : {}),
      });
    });
  });

  return out.sort((a, b) => a.scheduledAtMs - b.scheduledAtMs);
}

function buildConversations(nowMs: number): ConversationRow[] {
  const rand = rng(778899);
  const out: ConversationRow[] = [];

  PAGE_SEEDS.forEach((seed, pi) => {
    if (seed.state === "expired" || seed.state === "revoked") return;
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const r = rand();
      // ส่วนใหญ่บอทจัดการได้เอง — ตัวเลขนี้คือคุณค่าหลักของ M-F
      const handledByBot = r < 0.45;
      // ยิ่งเก่ายิ่งด่วน กระจายตั้งแต่ 3 นาทีถึง 5 ชั่วโมง
      const waitedMinutes = Math.floor(3 + rand() * 300);
      out.push({
        conversationId: `${seed.pageId}-c${i}`,
        pageId: seed.pageId,
        contactName: CONTACT_NAMES[(pi * 3 + i) % CONTACT_NAMES.length]!,
        preview: PREVIEWS[(pi * 2 + i) % PREVIEWS.length]!,
        awaitingSinceMs: nowMs - waitedMinutes * 60_000,
        unread: 1 + Math.floor(rand() * 3),
        handledByBot,
      });
    }
  });

  return out;
}

function buildIncidents(nowMs: number): IncidentRow[] {
  return [
    {
      id: "inc-rate-1085",
      pageId: "1085",
      kind: "rate_limit",
      atMs: nowMs - 18 * 60_000,
      th: "ใช้โควตา API ของเพจไปแล้ว 84% ระบบชะลอคิวให้อัตโนมัติ — ถ้าถึง 95% โพสต์จะเลื่อน",
    },
    {
      id: "inc-mod-1044",
      pageId: "1044",
      kind: "comment_deleted",
      atMs: nowMs - 52 * 60_000,
      th: "ลบคอมเมนต์ที่แปะเบอร์คู่แข่ง 2 รายการ — ตรวจได้ที่ประวัติการดำเนินการ",
    },
  ];
}

export function buildDemoWorkspace(nowMs: number): Workspace {
  const clients = [...new Set(PAGE_SEEDS.map((s) => s.clientName))];

  const pages: ClientPage[] = PAGE_SEEDS.map((seed) => ({
    pageId: seed.pageId,
    pageName: seed.pageName,
    clientName: seed.clientName,
    // เพจของลูกค้าเดียวกันได้สีเดียวกัน — นั่นคือประเด็นของ "สีแยกตามลูกค้า"
    colorIndex: clients.indexOf(seed.clientName),
    plan: seed.plan,
    timeZone: TZ,
    connection: {
      state: seed.state,
      ...(seed.hoursUntilExpiry !== undefined
        ? { hoursUntilExpiry: seed.hoursUntilExpiry }
        : {}),
    },
    lastWebhookAtMs:
      seed.webhookSilentMinutes === null
        ? null
        : nowMs - seed.webhookSilentMinutes * 60_000,
    followers: seed.followers,
  }));

  return {
    nowMs,
    pages,
    conversations: buildConversations(nowMs),
    scheduled: buildScheduled(nowMs),
    incidents: buildIncidents(nowMs),
  };
}

export const demoSource: WorkspaceSource = {
  async load(nowMs: number) {
    return buildDemoWorkspace(nowMs);
  },
};
