"use client";

import { useState, useTransition } from "react";
import type { PortalPost } from "@page-os/portal";

export interface PortalPostView extends PortalPost {
  /** วันเวลาที่จัดรูปแบบไว้จากฝั่งเซิร์ฟเวอร์แล้ว */
  whenTh: string;
}

/**
 * การ์ดโพสต์หนึ่งใบในหน้าลูกค้า
 *
 * ปุ่ม "ขอแก้ไข" ต้องพิมพ์เหตุผลก่อนส่งเสมอ — ถ้ากดแล้วส่งเลย ทีมงานจะได้แค่
 * "ขอแก้" โดยไม่รู้ว่าแก้อะไร แล้วต้องโทรถามกลับ ซึ่งช้ากว่าให้พิมพ์สองบรรทัด
 */
export function PortalPostCard({
  post,
  onDecide,
}: {
  post: PortalPostView;
  onDecide: (
    postId: string,
    decision: "approve" | "request_changes",
    note?: string,
  ) => Promise<{ th: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  function send(
    decision: "approve" | "request_changes",
    noteText?: string,
  ): void {
    setError(null);
    startTransition(async () => {
      try {
        const r = await onDecide(post.postId, decision, noteText);
        setResult(r.th);
        setAsking(false);
      } catch (e) {
        // ข้อความไทยจาก server action มาถึงฝั่งนี้เป็น message ธรรมดา
        setError(
          e instanceof Error && e.message !== ""
            ? e.message
            : "ทำรายการไม่สำเร็จ กรุณาลองใหม่",
        );
      }
    });
  }

  return (
    <article
      className="rounded-2xl border p-4"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="tabular text-xs font-medium"
          style={{ color: "var(--text-muted)" }}
        >
          {post.whenTh}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs"
          style={{ background: "var(--bg-sunken)", color: "var(--text-faint)" }}
        >
          {post.pillarLabelTh}
        </span>
      </div>

      <p className="mt-2 leading-relaxed whitespace-pre-wrap">{post.body}</p>

      {result ? (
        <p
          className="mt-3 rounded-xl px-3 py-2 text-sm"
          style={{ background: "var(--ok-bg)", color: "var(--ok)" }}
        >
          {result}
        </p>
      ) : post.canDecide ? (
        <div className="mt-3">
          {error && (
            <p
              className="mb-2 rounded-xl px-3 py-2 text-sm"
              style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
            >
              {error}
            </p>
          )}

          {asking ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                autoFocus
                placeholder="อยากให้แก้ตรงไหนคะ เช่น เปลี่ยนรูปเป็นเมนูใหม่ หรือปรับราคาให้ตรงกับหน้าร้าน"
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{
                  background: "var(--bg-sunken)",
                  borderColor: "var(--border)",
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending || note.trim() === ""}
                  onClick={() => send("request_changes", note.trim())}
                  className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{
                    background: "var(--brand)",
                    color: "var(--on-brand)",
                  }}
                >
                  ส่งให้ทีมงาน
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setAsking(false)}
                  className="rounded-xl border px-4 py-2 text-sm"
                  style={{ borderColor: "var(--border-strong)" }}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => send("approve")}
                className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "var(--on-brand)" }}
              >
                {pending ? "กำลังบันทึก…" : "อนุมัติ"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAsking(true)}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
                style={{ borderColor: "var(--border-strong)" }}
              >
                ขอแก้ไข
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
          {post.approvalTh}
          {post.lockedReasonTh ? ` · ${post.lockedReasonTh}` : ""}
        </p>
      )}
    </article>
  );
}
