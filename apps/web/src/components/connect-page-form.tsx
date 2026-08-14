"use client";

/**
 * ฟอร์มวาง Page Access Token
 *
 * ─── สองอย่างที่ตั้งใจทำแบบนี้ ───
 *
 * 1. **ไม่เก็บ token ไว้ใน state ของ React** ใช้ `<form action={...}>` ตรงๆ
 *    ให้ค่าเดินทางจาก DOM ไปหา server action แล้วหายไป — ไม่ค้างอยู่ใน memory
 *    ของหน้าเว็บ ไม่ติดไปกับ React DevTools และไม่มีทางหลุดไปกับ error report
 * 2. **ล้างช่องทันทีที่สำเร็จ** เพราะ token ที่ค้างอยู่บนจอคือ token ที่คนอื่น
 *    ในห้องอ่านได้ และคนมักเปิดหน้านี้ทิ้งไว้
 */
import { useActionState, useEffect, useRef } from "react";

interface Result {
  ok: boolean;
  th: string;
  /** เชื่อมสำเร็จแต่ token ขาดสิทธิ์ — ต้องเห็นชัดพอๆ กับข้อความสำเร็จ */
  warnTh?: string;
  page?: { name: string; fbPageId: string };
}

export function ConnectPageForm({
  action,
}: {
  action: (prev: unknown, formData: FormData) => Promise<Result>;
}) {
  const [state, formAction, pending] = useActionState(action, null as Result | null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok === true) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="token" className="text-sm font-medium">
          Page Access Token
        </label>
        <textarea
          id="token"
          name="token"
          required
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="EAAG..."
          className="w-full resize-y rounded-[var(--radius-card)] border px-3 py-2 font-mono text-xs leading-relaxed outline-none"
          style={{
            background: "var(--bg-sunken)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="clientName" className="text-sm font-medium">
          ชื่อลูกค้า{" "}
          <span className="font-normal" style={{ color: "var(--text-faint)" }}>
            (ไม่ใส่ก็ได้ — จะใช้ชื่อเพจแทน)
          </span>
        </label>
        <input
          id="clientName"
          name="clientName"
          type="text"
          autoComplete="off"
          placeholder="เช่น ครัวคุณยาย"
          className="w-full rounded-[var(--radius-card)] border px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--bg-sunken)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        />
        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          เพจที่ใส่ชื่อลูกค้าเดียวกันจะถูกจัดกลุ่มไว้ด้วยกัน
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          {pending ? "กำลังตรวจกับ Meta..." : "เชื่อมเพจ"}
        </button>

        {state !== null && (
          <p
            role="status"
            className="text-sm leading-relaxed"
            style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}
          >
            {state.ok ? "✓ " : "✗ "}
            {state.th}
          </p>
        )}

        {/*
          แยกกล่องออกมาต่างหาก ไม่ต่อท้ายข้อความสำเร็จ — เพราะคนอ่านคำว่า
          "เรียบร้อย" แล้วหยุดอ่าน ถ้าคำเตือนอยู่ในบรรทัดเดียวกันจะไม่มีใครเห็น
        */}
        {state?.warnTh !== undefined && (
          <p
            role="alert"
            className="rounded-[var(--radius-row)] px-3 py-2.5 text-sm leading-relaxed"
            style={{ background: "var(--warn-bg)", color: "var(--text)" }}
          >
            <span className="font-semibold" style={{ color: "var(--warn)" }}>
              สิทธิ์ไม่ครบ{" "}
            </span>
            {state.warnTh}
          </p>
        )}
      </div>
    </form>
  );
}
