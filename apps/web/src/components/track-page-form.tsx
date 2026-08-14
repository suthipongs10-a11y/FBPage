"use client";

/**
 * ฟอร์มเพิ่มเพจที่จะเฝ้าดู
 *
 * เลือกชนิดก่อนแล้วค่อยกรอก เพราะสองชนิดนี้ผลลัพธ์ต่างกันมาก:
 * เพจของเราดึงข้อมูลได้ทันที ส่วนคู่แข่งยังดึงไม่ได้จนกว่าจะได้สิทธิ์จาก Meta
 * — บอกไว้ตรงหน้าฟอร์มเลย ดีกว่าให้คนเพิ่มเสร็จแล้วมานั่งงงว่าทำไมไม่มีข้อมูล
 */
import { useActionState, useEffect, useRef, useState } from "react";

interface Result {
  ok: boolean;
  th: string;
}

export function TrackPageForm({
  action,
}: {
  action: (prev: unknown, formData: FormData) => Promise<Result>;
}) {
  const [state, formAction, pending] = useActionState(action, null as Result | null);
  const [kind, setKind] = useState<"OWNED" | "COMPETITOR">("OWNED");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok === true) formRef.current?.reset();
  }, [state]);

  const field =
    "w-full rounded-[var(--radius-card)] border px-3 py-2 text-sm outline-none";
  const fieldStyle = {
    background: "var(--bg-sunken)",
    borderColor: "var(--border)",
    color: "var(--text)",
  };

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { value: "OWNED", label: "เพจของเรา" },
            { value: "COMPETITOR", label: "เพจคู่แข่ง / เพจที่อยากส่อง" },
          ] as const
        ).map((o) => (
          <label
            key={o.value}
            className="cursor-pointer rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs"
            style={{
              borderColor: kind === o.value ? "var(--accent)" : "var(--border)",
              background: kind === o.value ? "var(--accent-bg)" : "transparent",
            }}
          >
            <input
              type="radio"
              name="kind"
              value={o.value}
              checked={kind === o.value}
              onChange={() => setKind(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fbPageId" className="text-sm font-medium">
            รหัสเพจ (ตัวเลข)
          </label>
          <input
            id="fbPageId"
            name="fbPageId"
            required
            inputMode="numeric"
            autoComplete="off"
            placeholder="เช่น 100064..."
            className={field}
            style={fieldStyle}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            ชื่อที่ใช้เรียก
          </label>
          <input
            id="name"
            name="name"
            required
            autoComplete="off"
            placeholder="เช่น ครัวคุณยาย"
            className={field}
            style={fieldStyle}
          />
        </div>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
        {kind === "OWNED" ? (
          <>
            ต้องเชื่อม Page Access Token ของเพจนี้ที่หน้า <b>ตั้งค่า</b> ไว้ก่อน
            แล้วระบบจะเริ่มดึงโพสต์ให้ในรอบถัดไป (ทุกชั่วโมง)
          </>
        ) : (
          <>
            ⚠️ เพจที่เราไม่ได้เป็นแอดมิน <b>ยังดึงข้อมูลอัตโนมัติไม่ได้</b> —
            Meta บังคับให้ต้องมีสิทธิ์ Page Public Content Access ซึ่งต้องผ่าน
            App Review ก่อน เพิ่มไว้ได้ แต่จะยังไม่มีตัวเลขจนกว่าจะต่อแหล่งข้อมูลได้
          </>
        )}
      </p>

      {state !== null && (
        <p
          className="rounded-[var(--radius-card)] px-3 py-2 text-sm"
          style={{
            background: state.ok ? "var(--ok-bg)" : "var(--danger-bg)",
            color: "var(--text)",
          }}
        >
          {state.th}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {pending ? "กำลังเพิ่ม…" : "เพิ่มเพจ"}
        </button>
      </div>
    </form>
  );
}
