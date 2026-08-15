"use client";

/**
 * เลือกคอมเมนต์แล้วสั่งซ่อน/ปล่อย/ลบเป็นก้อน
 *
 * ─── ทำไมต้องเลือกหลายอันแล้วสั่งทีเดียว ไม่ใช่ปุ่มต่อคอมเมนต์ ───
 *
 * ปุ่มต่อคอมเมนต์อ่านง่ายกว่า แต่บน YouTube **หนึ่ง call ราคา 50 หน่วย**
 * จากโควตาวันละ 10,000 — กดทีละอัน 200 ครั้งก็หมดวัน ส่วนการเลือก 50 อัน
 * แล้วกดทีเดียวใช้ 50 หน่วยเท่ากับกดครั้งเดียว **ถูกกว่า 50 เท่า**
 *
 * รูปแบบหน้าจอจึงต้องพาคนไปทางที่ถูก ไม่ใช่ปล่อยให้เลือกทางที่แพงได้ง่ายๆ
 *
 * ─── ทำไมแถบคำสั่งลอยอยู่ล่างจอ ───
 *
 * รายการคอมเมนต์ยาว คนติ๊กตัวที่ 1 แล้วเลื่อนลงไปติ๊กตัวที่ 40 ถ้าปุ่มอยู่หัว
 * รายการ ต้องเลื่อนกลับขึ้นไปกด — แถบที่ลอยอยู่จึงโผล่มาเมื่อมีของถูกเลือก
 * และหายไปเมื่อไม่มี
 */
import { useState } from "react";
import { dateTimeTh, truncate } from "@/lib/format";

/**
 * คอมเมนต์หนึ่งอันในรูปที่**ส่งข้ามฝั่งได้**
 *
 * ─── ทำไมคอมโพเนนต์นี้วาดรายการเอง แทนที่จะรับ render prop ───
 *
 * เคยออกแบบให้รับ `children` เป็นฟังก์ชันแล้วให้ฝั่งเซิร์ฟเวอร์วาดรายการ ซึ่ง
 * **พังตอนรันจริง**: React ส่งฟังก์ชันจาก Server Component ไป Client Component
 * ไม่ได้ ("Functions cannot be passed directly to Client Components")
 *
 * และ `pnpm check` กับ `next build` จับไม่ได้ทั้งคู่ เพราะชนิดข้อมูลถูกต้อง
 * ทุกอย่าง — เห็นก็ต่อเมื่อเปิดหน้าจริงที่มีข้อมูล
 *
 * ทางแก้คือส่ง**ข้อมูลล้วน** (สตริง/ตัวเลข) มาแทน แล้ววาดที่ฝั่งนี้ทั้งหมด
 */
export interface ModeratableComment {
  id: string;
  platform: "FACEBOOK" | "YOUTUBE";
  /** ช่องนี้เป็นของเราไหม — ตัดสินว่าสั่งได้หรือเปล่า */
  canModerate: boolean;
  authorName: string | null;
  pageName: string;
  createdAtMs: number;
  message: string | null;
  postPermalink: string | null;
  /** สถานะที่ **เราสั่งไป** ไม่ใช่สถานะจริงบนแพลตฟอร์ม ณ ตอนนี้ */
  moderatedStatus: string | null;
}

interface Result {
  ok: boolean;
  th: string;
}

export type ModerationAction = "hide" | "unhide" | "delete";

/**
 * เพดานการลบต่อครั้ง — ต้องตรงกับที่ `YouTubeCommentActions.remove()` ตั้งไว้
 *
 * ซ้ำกันสองที่โดยตั้งใจ: ฝั่งนี้กันไม่ให้ยิงคำขอที่รู้อยู่แล้วว่าจะถูกปฏิเสธ
 * ส่วนฝั่งโน้นเป็นด่านจริงที่เชื่อถือได้ (หน้าเว็บแก้ค่าได้ เซิร์ฟเวอร์แก้ไม่ได้)
 */
const DELETE_MAX = 20;

export function CommentModeration({
  comments,
  action,
  timeZone,
}: {
  comments: ModeratableComment[];
  action: (formData: FormData) => Promise<Result>;
  timeZone: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<ModerationAction | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byId = new Map(comments.map((c) => [c.id, c]));
  const usable = comments.filter((c) => c.canModerate);

  const toggle = (id: string): void => {
    setResult(null);
    setConfirmDelete(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clear = (): void => {
    setSelected(new Set());
    setConfirmDelete(false);
  };

  const run = async (what: ModerationAction): Promise<void> => {
    /**
     * การลบกู้คืนไม่ได้ — ถามซ้ำหนึ่งครั้งก่อนเสมอ
     *
     * ไม่ใช้ `confirm()` ของเบราว์เซอร์เพราะมันหยุดทั้งหน้าและหน้าตาไม่เข้ากับ
     * ที่อื่น — เปลี่ยนปุ่มเป็น "แน่ใจนะ?" แทน ซึ่งกดพลาดก็แค่กดที่อื่นหนีได้
     */
    if (what === "delete" && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setPending(what);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("action", what);
      for (const id of selected) fd.append("ids", id);
      const r = await action(fd);
      setResult(r);
      // สำเร็จแล้วล้างที่เลือกไว้ ไม่งั้นกดซ้ำจะยิงคำสั่งเดิมกับของเดิมอีกรอบ
      if (r.ok) setSelected(new Set());
    } catch (err) {
      setResult({
        ok: false,
        th: `สั่งไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPending(null);
      setConfirmDelete(false);
    }
  };

  const checkbox = (id: string): React.ReactNode => {
    const c = byId.get(id);
    if (c === undefined || !c.canModerate) {
      return (
        <span
          className="mt-0.5 inline-block size-4 shrink-0 rounded-[4px] border"
          style={{ borderColor: "var(--border)", opacity: 0.35 }}
          title={
            c?.platform === "FACEBOOK"
              ? "ฝั่ง Facebook ยังสั่งจากหน้านี้ไม่ได้"
              : "ช่องนี้ไม่ใช่ของเรา จึงจัดการคอมเมนต์ไม่ได้"
          }
        />
      );
    }
    return (
      <input
        type="checkbox"
        checked={selected.has(id)}
        onChange={() => toggle(id)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
        aria-label="เลือกคอมเมนต์นี้"
      />
    );
  };

  const tooManyToDelete = selected.size > DELETE_MAX;

  return (
    <>
      {usable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setSelected(new Set(usable.map((c) => c.id)));
            }}
            className="underline underline-offset-2"
            style={{ color: "var(--accent)" }}
          >
            เลือกทั้งหมดในหน้านี้ ({usable.length})
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clear}
              className="underline underline-offset-2"
              style={{ color: "var(--text-faint)" }}
            >
              ล้างที่เลือก
            </button>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-2.5">
        {comments.map((c) => (
          <li
            key={c.id}
            className="flex gap-3 rounded-[var(--radius-card)] px-4 py-3 transition-colors"
            style={{
              background: selected.has(c.id) ? "var(--accent-bg)" : "var(--bg-sunken)",
            }}
          >
            {checkbox(c.id)}
            <div className="min-w-0 flex-1">
              <div
                className="flex flex-wrap items-baseline gap-x-2 text-xs"
                style={{ color: "var(--text-faint)" }}
              >
                <b style={{ color: "var(--text-muted)" }}>
                  {c.authorName ?? "ไม่ทราบชื่อ"}
                </b>
                <span>
                  · ใต้{c.platform === "YOUTUBE" ? "วิดีโอ" : "โพสต์"}ของ {c.pageName}
                </span>
                <span>· {dateTimeTh(c.createdAtMs, timeZone)}</span>
                <ModeratedTag status={c.moderatedStatus} />
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">
                {c.message === null || c.message.trim() === "" ? (
                  <i style={{ color: "var(--text-faint)" }}>
                    (ไม่มีข้อความ — อาจเป็นรูปหรือสติกเกอร์)
                  </i>
                ) : (
                  truncate(c.message, 500)
                )}
              </p>
              {c.postPermalink !== null && (
                <a
                  href={c.postPermalink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-xs underline underline-offset-2"
                  style={{ color: "var(--accent)" }}
                >
                  {c.platform === "YOUTUBE"
                    ? "เปิดวิดีโอบน YouTube ↗"
                    : "เปิดโพสต์บน Facebook ↗"}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      {result !== null && (
        <p
          className="mt-3 rounded-[var(--radius-card)] px-3 py-2 text-sm"
          style={{
            background: result.ok ? "var(--ok-bg)" : "var(--danger-bg)",
            color: "var(--text)",
          }}
        >
          {result.th}
        </p>
      )}

      {/* แถบคำสั่งลอยอยู่ล่างจอ — โผล่เมื่อมีของถูกเลือกเท่านั้น */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
          <div
            className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-2 shadow-lg backdrop-blur"
            style={{
              background: "color-mix(in srgb, var(--bg-raised) 92%, transparent)",
              borderColor: "var(--border)",
            }}
          >
            <span className="tabular px-1 text-sm font-semibold">
              เลือกไว้ {selected.size}
            </span>

            <ActionButton
              label="ซ่อน"
              busy={pending === "hide"}
              disabled={pending !== null}
              onClick={() => void run("hide")}
            />
            <ActionButton
              label="เอาการซ่อนออก"
              busy={pending === "unhide"}
              disabled={pending !== null}
              onClick={() => void run("unhide")}
            />
            <ActionButton
              label={
                tooManyToDelete
                  ? `ลบได้ทีละ ${DELETE_MAX}`
                  : confirmDelete
                    ? "แน่ใจนะ? กดอีกครั้ง"
                    : "ลบถาวร"
              }
              busy={pending === "delete"}
              disabled={pending !== null || tooManyToDelete}
              danger
              onClick={() => void run("delete")}
            />

            <button
              type="button"
              onClick={clear}
              className="px-2 text-sm"
              style={{ color: "var(--text-faint)" }}
              aria-label="ล้างที่เลือก"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ActionButton({
  label,
  busy,
  disabled,
  danger,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-medium whitespace-nowrap disabled:opacity-50"
      style={{
        background: danger === true ? "var(--danger-bg)" : "var(--accent)",
        color: danger === true ? "var(--danger)" : "white",
      }}
    >
      {busy ? "กำลังทำ…" : label}
    </button>
  );
}

/**
 * ป้ายบอกว่า**เราสั่งอะไรไปแล้ว** ไม่ใช่สถานะจริงบนแพลตฟอร์ม ณ ตอนนี้
 *
 * เจ้าของช่องเปลี่ยนเองในแอป YouTube ได้ตลอด และการไปถามว่าตอนนี้เป็นยังไง
 * กินโควตาทุกครั้ง — พูดเฉพาะสิ่งที่เรารู้แน่ดีกว่าเดาแล้วแสดงผิด
 */
function ModeratedTag({ status }: { status: string | null }) {
  if (status === null) return null;
  const map: Record<string, { th: string; fg: string; bg: string }> = {
    rejected: { th: "สั่งซ่อนแล้ว", fg: "var(--warn)", bg: "var(--warn-bg)" },
    published: { th: "สั่งให้แสดงแล้ว", fg: "var(--text-muted)", bg: "var(--bg-elevated)" },
    heldForReview: { th: "พักรอตรวจ", fg: "var(--warn)", bg: "var(--warn-bg)" },
    deleted: { th: "ลบถาวรแล้ว", fg: "var(--danger)", bg: "var(--danger-bg)" },
  };
  const m = map[status];
  if (m === undefined) return null;
  return (
    <span
      className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[0.6875rem] font-medium"
      style={{ background: m.bg, color: m.fg }}
    >
      {m.th}
    </span>
  );
}
