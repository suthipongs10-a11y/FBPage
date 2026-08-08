/**
 * Onboarding Wizard (M-H)
 *
 * เกณฑ์รับงานของ milestone นี้คือ **"รับลูกค้าใหม่ end-to-end ใน 30 นาที"**
 *
 * ของเดิมใช้เวลา 8 ชั่วโมงเพราะทุกอย่างเริ่มจากศูนย์: เชื่อมเพจ ตั้งบอท
 * เขียนกฎคอมเมนต์ วางปฏิทินทั้งเดือน ทำหน้า portal ให้ลูกค้า
 * ตัวที่ทำให้เหลือ 30 นาทีคือ Template Library ของ M-G — ก๊อปของที่ใช้ได้แล้ว
 * จากลูกค้าเก่ามา แล้วแก้เฉพาะส่วนที่ต่าง
 *
 * ไฟล์นี้ไม่ได้ทำงานเอง แต่เป็น **ตัวรู้ลำดับ**: อะไรต้องเสร็จก่อนอะไร
 * และตอนนี้ติดตรงไหน — เพราะสิ่งที่ทำให้ onboarding ยืดไม่ใช่แต่ละขั้นตอนช้า
 * แต่คือการทำขั้นตอนผิดลำดับแล้วต้องย้อนกลับมาทำใหม่
 */

export type StepId =
  | "connect_page"
  | "brand_brief"
  | "apply_templates"
  | "content_calendar"
  | "portal_branding"
  | "invite_client";

export interface OnboardingState {
  /** เชื่อมเพจแล้วกี่เพจ */
  connectedPages: number;
  /** Brand Brief กรอกครบหรือยัง (จาก checkBrief ของ M-G) */
  briefReady: boolean;
  /** ใช้เทมเพลตไปแล้วกี่ชุด (bot flow / กฎคอมเมนต์ / แผนคอนเทนต์) */
  templatesApplied: number;
  /** มีโพสต์ในปฏิทินกี่โพสต์ */
  scheduledPosts: number;
  /** ตั้งค่าแบรนด์ของ portal แล้วหรือยัง */
  brandingReady: boolean;
  /** ส่งลิงก์เข้าใช้งานให้ลูกค้าแล้วหรือยัง */
  clientInvited: boolean;
}

export interface OnboardingStep {
  id: StepId;
  labelTh: string;
  /** ทำไมต้องมีขั้นนี้ — แสดงใต้หัวข้อในหน้า wizard */
  whyTh: string;
  done: boolean;
  /** ทำตอนนี้ได้ไหม (ขั้นก่อนหน้าเสร็จหรือยัง) */
  available: boolean;
  /** ติดอะไรอยู่ ถ้าทำตอนนี้ไม่ได้ */
  blockedByTh?: string;
  /** ประมาณเวลาที่ใช้ (นาที) */
  minutes: number;
}

/**
 * ขั้นตอนตามลำดับที่ต้องทำ
 *
 * `requires` คือหัวใจ — ยกตัวอย่างที่เคยพลาดจริง: สร้างปฏิทินก่อนกรอก
 * Brand Brief จะได้โพสต์กลางๆ ที่ต้องทิ้งทั้งเดือนแล้วทำใหม่ ซึ่งกินเวลา
 * มากกว่ากรอก brief สิบนาทีหลายเท่า
 */
const STEPS: Array<{
  id: StepId;
  labelTh: string;
  whyTh: string;
  minutes: number;
  requires: StepId[];
  isDone: (s: OnboardingState) => boolean;
}> = [
  {
    id: "connect_page",
    labelTh: "เชื่อมเพจ Facebook",
    whyTh: "ต้องมี token ของเพจก่อน ไม่งั้นทำอย่างอื่นแล้วทดสอบไม่ได้เลย",
    minutes: 5,
    requires: [],
    isDone: (s) => s.connectedPages > 0,
  },
  {
    id: "brand_brief",
    labelTh: "กรอก Brand Brief",
    whyTh:
      "กลุ่มเป้าหมาย โทน คำต้องห้าม CTA — ต้องกรอกก่อนสร้างคอนเทนต์ ไม่งั้นได้ของกลางๆ ที่ต้องทิ้งทั้งเดือน",
    minutes: 10,
    requires: ["connect_page"],
    isDone: (s) => s.briefReady,
  },
  {
    id: "apply_templates",
    labelTh: "ก๊อปเทมเพลตจากลูกค้าเก่า",
    whyTh:
      "บทสนทนาบอท กฎคอมเมนต์ และสัดส่วนคอนเทนต์ ใช้ซ้ำได้ทันที — นี่คือขั้นที่ย่นเวลาจาก 8 ชม. เหลือ 30 นาที",
    minutes: 5,
    requires: ["connect_page"],
    isDone: (s) => s.templatesApplied > 0,
  },
  {
    id: "content_calendar",
    labelTh: "สร้างปฏิทิน 30 วัน",
    whyTh: "กดปุ่มเดียวได้ทั้งเดือน แล้วค่อยรีวิวแก้เฉพาะที่ไม่ถูกใจ",
    minutes: 5,
    requires: ["brand_brief", "apply_templates"],
    isDone: (s) => s.scheduledPosts > 0,
  },
  {
    id: "portal_branding",
    labelTh: "ตั้งค่าหน้า portal ของลูกค้า",
    whyTh: "โลโก้ สี และชื่อลิงก์ — ลูกค้าเห็นหน้าที่เป็นแบรนด์ตัวเอง ไม่ใช่ของเรา",
    minutes: 3,
    requires: ["connect_page"],
    isDone: (s) => s.brandingReady,
  },
  {
    id: "invite_client",
    labelTh: "ส่งลิงก์ให้ลูกค้า",
    whyTh:
      "ลูกค้าเข้าไปเห็นปฏิทินที่รออนุมัติได้ทันที — ขั้นนี้ต้องทำหลังสุดเสมอ ไม่งั้นลูกค้าเปิดมาเจอหน้าว่าง",
    minutes: 2,
    requires: ["content_calendar", "portal_branding"],
    isDone: (s) => s.clientInvited,
  },
];

export const TOTAL_MINUTES = STEPS.reduce((s, x) => s + x.minutes, 0);

export interface OnboardingProgress {
  steps: OnboardingStep[];
  doneCount: number;
  /** ขั้นถัดไปที่ควรทำ — null = เสร็จหมดแล้ว */
  nextStep: OnboardingStep | null;
  /** เวลาที่เหลือโดยประมาณ (นาที) */
  minutesLeft: number;
  /** พร้อมส่งมอบให้ลูกค้าหรือยัง */
  readyToInvite: boolean;
  th: string;
}

export function onboardingProgress(state: OnboardingState): OnboardingProgress {
  const doneMap = new Map<StepId, boolean>(
    STEPS.map((s) => [s.id, s.isDone(state)]),
  );

  const steps: OnboardingStep[] = STEPS.map((s) => {
    const done = doneMap.get(s.id)!;
    const missing = s.requires.filter((r) => !doneMap.get(r));
    const available = missing.length === 0;
    const blockedBy =
      missing.length === 0
        ? undefined
        : `ต้องทำ "${missing
            .map((m) => STEPS.find((x) => x.id === m)!.labelTh)
            .join(" และ ")}" ให้เสร็จก่อน`;

    return {
      id: s.id,
      labelTh: s.labelTh,
      whyTh: s.whyTh,
      done,
      available,
      minutes: s.minutes,
      ...(blockedBy !== undefined ? { blockedByTh: blockedBy } : {}),
    };
  });

  const doneCount = steps.filter((s) => s.done).length;
  // ขั้นถัดไป = ขั้นแรกที่ยังไม่เสร็จ **และทำได้แล้ว** ไม่ใช่ขั้นแรกที่ยังไม่เสร็จเฉยๆ
  // เพราะการชี้ไปที่ขั้นที่ยังทำไม่ได้ทำให้คนไปนั่งงงหน้าจอที่กดอะไรไม่ได้
  const nextStep = steps.find((s) => !s.done && s.available) ?? null;
  const minutesLeft = steps
    .filter((s) => !s.done)
    .reduce((sum, s) => sum + s.minutes, 0);

  // ใช้ตัวตรวจตัวเดียวกับตอนกดส่งจริง ไม่คำนวณซ้ำจากลำดับขั้น
  //
  // เคยแยกกันแล้วสองที่ตอบไม่ตรงกัน: ถ้าข้อมูลเพี้ยนจนมีโพสต์ในปฏิทิน
  // ทั้งที่ Brand Brief ยังไม่ครบ หน้าจอจะบอกว่า "ส่งได้" แต่พอกดจริงจะถูกปฏิเสธ
  const readyToInvite = checkReadyToInvite(state).ok;

  let th: string;
  if (doneCount === steps.length) {
    th = "ตั้งค่าครบทุกขั้นแล้ว ลูกค้าเข้าใช้งานได้เลย";
  } else if (nextStep) {
    th = `เสร็จไป ${doneCount}/${steps.length} ขั้น — ต่อไปคือ "${nextStep.labelTh}" (ประมาณ ${nextStep.minutes} นาที เหลือทั้งหมด ${minutesLeft} นาที)`;
  } else {
    // ไม่มีขั้นที่ทำได้เลยทั้งที่ยังไม่เสร็จ = มีขั้นที่ติดบางอย่างอยู่
    const stuck = steps.find((s) => !s.done);
    th = `ติดอยู่ที่ "${stuck?.labelTh}" — ${stuck?.blockedByTh ?? "ตรวจสอบขั้นตอนก่อนหน้า"}`;
  }

  return { steps, doneCount, nextStep, minutesLeft, readyToInvite, th };
}

/**
 * เช็คก่อนกดส่งลิงก์ให้ลูกค้า
 *
 * แยกจาก `onboardingProgress` เพราะขั้นนี้ทำแล้วย้อนไม่ได้ — ลูกค้าได้อีเมล
 * ไปแล้วจะกดเข้ามาเลย ถ้าตอนนั้นปฏิทินยังว่างหรือหน้ายังไม่มีโลโก้
 * ความประทับใจแรกคือ "จ้างไปแล้วยังไม่ได้อะไร"
 */
export function checkReadyToInvite(state: OnboardingState): {
  ok: boolean;
  blockers: string[];
  th: string;
} {
  const blockers: string[] = [];
  if (state.connectedPages === 0) blockers.push("ยังไม่ได้เชื่อมเพจ");
  if (!state.briefReady) blockers.push("Brand Brief ยังกรอกไม่ครบ");
  if (state.scheduledPosts === 0) {
    blockers.push("ปฏิทินยังว่าง — ลูกค้าจะเปิดมาเจอหน้าเปล่า");
  }
  if (!state.brandingReady) {
    blockers.push("ยังไม่ได้ตั้งโลโก้และสีของหน้า portal");
  }

  return {
    ok: blockers.length === 0,
    blockers,
    th:
      blockers.length === 0
        ? "พร้อมส่งลิงก์ให้ลูกค้าแล้ว"
        : `ยังส่งลิงก์ไม่ได้ — ${blockers.join(" · ")}`,
  };
}
