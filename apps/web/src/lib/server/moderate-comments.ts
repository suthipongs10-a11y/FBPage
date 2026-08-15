import "server-only";

/**
 * สั่งซ่อน / ปล่อย / ลบ คอมเมนต์จากหน้าอ่านคอมเมนต์
 *
 * ─── สามด่านที่คำสั่งต้องผ่านก่อนถึง YouTube ───
 *
 * 1. **แปลง id ภายใน → รหัสบนแพลตฟอร์ม โดยอ่านจากฐานข้อมูลเราเอง**
 *    ไม่เชื่อรหัสที่มากับฟอร์ม — ถ้าเชื่อ คนที่แก้ค่าในฟอร์มจะสั่งซ่อนคอมเมนต์
 *    อะไรก็ได้บนช่องที่เราเป็นเจ้าของ
 * 2. **ต้องเป็นช่องของเราเอง** YouTube ให้จัดการได้เฉพาะช่องตัวเอง ยิงไปช่องอื่น
 *    ได้ 403 กลับมาแต่เสียโควตา 50 หน่วยไปแล้ว
 * 3. **ต้องมี OAuth** API key อ่านได้อย่างเดียว เขียนไม่ได้เลย
 *
 * ─── ทำไมไม่ผ่านคิวเหมือนงานอื่น (กฎข้อ 5) ───
 *
 * กฎข้อ 5 มีไว้กัน request handler ค้างเพราะรอ external API และกัน rate limit
 * ของงานที่มีคนรอ — งานนี้**คือ**งานที่มีคนรอ คนกดปุ่มแล้วยืนดูอยู่ว่าซ่อนสำเร็จไหม
 * ถ้าโยนเข้าคิวแล้วตอบ "รับเรื่องแล้ว" คนจะไม่รู้ว่าสำเร็จหรือเปล่าจนกว่าจะรีเฟรช
 *
 * และงานนี้จบเร็ว: ซ่อน 50 คอมเมนต์ = ยิงครั้งเดียว เพราะ
 * `comments.setModerationStatus` รับ id ได้หลายตัวใน call เดียว
 */
import {
  googleOAuthFromEnv,
  YouTubeCommentActions,
  YouTubeGateway,
  type ModerationResult,
} from "@page-os/youtube";
import { PrismaListeningQueries } from "@page-os/store";
import { prisma, webLogger } from "@/lib/server/deps";
import {
  blockReasonTh,
  missingConfigTh,
  STATUS_OF,
  VERB_TH,
  type ModerationAction,
} from "@/lib/moderation-guard";

export type { ModerationAction };

export interface ModerateResult {
  ok: boolean;
  th: string;
  /** จำนวนคอมเมนต์ที่สำเร็จจริง */
  done: number;
  /** โควตา YouTube ที่ใช้ไปกับคำสั่งนี้ */
  quotaSpent: number;
}

export async function moderateComments(args: {
  commentIds: readonly string[];
  action: ModerationAction;
  nowMs: number;
}): Promise<ModerateResult> {
  const verb = VERB_TH[args.action];
  const no = (th: string): ModerateResult => ({ ok: false, th, done: 0, quotaSpent: 0 });

  if (args.commentIds.length === 0) return no("ยังไม่ได้เลือกคอมเมนต์");

  const db = prisma();
  const queries = new PrismaListeningQueries(db);
  const groups = await queries.resolveCommentsForModeration({
    commentIds: args.commentIds,
  });

  const blocked = blockReasonTh({ groups, action: args.action });
  if (blocked !== null) return no(blocked);

  const apiKey = process.env["YOUTUBE_API_KEY"]?.trim() ?? "";
  const oauth = googleOAuthFromEnv(process.env);
  const missing = missingConfigTh({
    hasApiKey: apiKey !== "",
    hasOAuth: oauth !== null,
  });
  if (missing !== null || oauth === null) {
    return no(missing ?? "ยังเชื่อมบัญชี YouTube ไม่ครบ");
  }

  const actions = new YouTubeCommentActions({
    gateway: new YouTubeGateway({ apiKey }, { logger: webLogger }),
    accessToken: () => oauth.token(),
    logger: webLogger,
  });

  let done = 0;
  let quotaSpent = 0;
  const problems: string[] = [];

  // ทีละช่อง เพราะสิทธิ์ผูกกับช่อง และ id ของคนละช่องรวมใน call เดียวไม่ได้
  for (const g of groups) {
    const channel = { id: g.channelExternalId, owned: g.owned };
    const ids = g.comments.map((c) => c.externalId);

    let res: ModerationResult;
    try {
      res =
        args.action === "hide"
          ? await actions.hide({ commentIds: ids, channel })
          : args.action === "unhide"
            ? await actions.unhide({ commentIds: ids, channel })
            : await actions.remove({ commentIds: ids, channel });
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    quotaSpent += res.quotaSpent;
    if (res.errors.length > 0) problems.push(...res.errors);

    /**
     * จดเฉพาะจำนวนที่สำเร็จจริง
     *
     * ตัวจัดการคืนมาแค่ "สำเร็จกี่อัน" ไม่ได้บอกว่าอันไหน (API ก็ไม่บอก) —
     * เมื่อสำเร็จบางส่วน เราจึงรู้จำนวนแต่ไม่รู้ตัว จดตามลำดับที่ส่งไปเพราะ
     * นั่นคือลำดับที่ก้อนถูกยิง และก้อนที่พังคือก้อนท้ายๆ เสมอ (หยุดทันทีที่พัง)
     */
    if (res.done > 0) {
      await queries.recordModeration({
        commentIds: g.comments.slice(0, res.done).map((c) => c.id),
        status: STATUS_OF[args.action],
        atMs: args.nowMs,
      });
      done += res.done;
    }
  }

  const quotaTh = quotaSpent === 0 ? "" : ` (ใช้โควตา YouTube ${quotaSpent} หน่วย)`;

  if (done === 0) {
    return {
      ok: false,
      th: `${verb}ไม่สำเร็จ — ${problems[0] ?? "ไม่ทราบสาเหตุ"}${quotaTh}`,
      done: 0,
      quotaSpent,
    };
  }

  return {
    ok: true,
    th:
      problems.length === 0
        ? `${verb} ${done} คอมเมนต์แล้ว${quotaTh}`
        : `${verb}ได้ ${done} คอมเมนต์ แต่มี ${problems.length} เรื่องที่พลาด — ` +
          `${problems[0]}${quotaTh}`,
    done,
    quotaSpent,
  };
}
