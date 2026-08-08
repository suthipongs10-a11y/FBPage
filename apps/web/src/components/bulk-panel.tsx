"use client";

import { useMemo, useState, useTransition } from "react";
import { ClientDot } from "@/components/ui";

export interface BulkPageOption {
  pageId: string;
  pageName: string;
  clientName: string;
  colorIndex: number;
  /** ค่าปัจจุบันของฟิลด์ที่กำลังจะแก้ — ใช้แสดงว่าเพจไหนจะเปลี่ยนจริง */
  currentSlaMinutes: number;
}

export interface PreviewRow {
  pageId: string;
  pageName: string;
  changeTh: string;
  skipped: boolean;
  warningTh?: string;
}

export interface PreviewResult {
  rows: PreviewRow[];
  willChange: number;
  willSkip: number;
  affectedClients: number;
  needsConfirmation: boolean;
  th: string;
}

const SLA_CHOICES = [
  { value: 30, labelTh: "30 นาที (ดูแลเต็มรูปแบบ)" },
  { value: 60, labelTh: "1 ชั่วโมง (เติบโต)" },
  { value: 240, labelTh: "4 ชั่วโมง (เริ่มต้น)" },
];

/**
 * เครื่องมือแก้ค่าหลายเพจ
 *
 * บังคับให้ **ดูตัวอย่างก่อนเสมอ** — ปุ่ม "ทำเลย" ไม่ปรากฏจนกว่าจะกดดูตัวอย่าง
 * ไม่ใช่แค่ซ่อนไว้ให้สวย แต่เพราะการกดผิดครั้งเดียวพัง 20 เพจของลูกค้าหลายราย
 * และคนที่เห็นรายการก่อนกดจะจับได้เองว่าเลือกเพจผิด
 */
export function BulkPanel({
  pages,
  onPreview,
  onApply,
}: {
  pages: BulkPageOption[];
  onPreview: (
    pageIds: string[],
    slaMinutes: number,
  ) => Promise<PreviewResult>;
  onApply: (
    pageIds: string[],
    slaMinutes: number,
    confirmed: boolean,
  ) => Promise<{ th: string }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sla, setSla] = useState(60);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byClient = useMemo(() => {
    const m = new Map<string, BulkPageOption[]>();
    for (const p of pages) {
      const list = m.get(p.clientName) ?? [];
      list.push(p);
      m.set(p.clientName, list);
    }
    return [...m.entries()];
  }, [pages]);

  function toggle(pageId: string): void {
    setPreview(null);
    setDone(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  function run<T>(fn: () => Promise<T>, after: (v: T) => void): void {
    setError(null);
    startTransition(async () => {
      try {
        after(await fn());
      } catch (e) {
        setError(
          e instanceof Error && e.message !== ""
            ? e.message
            : "ทำรายการไม่สำเร็จ",
        );
      }
    });
  }

  const ids = [...selected];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div
            className="mb-2 text-xs font-semibold"
            style={{ color: "var(--text-faint)" }}
          >
            เลือกเพจ ({selected.size})
          </div>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
            {byClient.map(([client, list]) => (
              <div key={client}>
                <div
                  className="mb-1 flex items-center gap-1.5 text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  <ClientDot colorIndex={list[0]!.colorIndex} size={6} />
                  {client}
                </div>
                {list.map((p) => (
                  <label
                    key={p.pageId}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm"
                    style={{
                      background: selected.has(p.pageId)
                        ? "var(--bg-sunken)"
                        : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.pageId)}
                      onChange={() => toggle(p.pageId)}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.pageName}</span>
                    <span
                      className="tabular shrink-0 text-xs"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {p.currentSlaMinutes} น.
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div
            className="mb-2 text-xs font-semibold"
            style={{ color: "var(--text-faint)" }}
          >
            ตั้งเวลาที่สัญญาว่าจะตอบ
          </div>
          <div className="flex flex-col gap-1.5">
            {SLA_CHOICES.map((c) => (
              <label
                key={c.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor:
                    sla === c.value ? "var(--accent)" : "var(--border)",
                  background:
                    sla === c.value ? "var(--accent-bg)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="sla"
                  checked={sla === c.value}
                  onChange={() => {
                    setSla(c.value);
                    setPreview(null);
                    setDone(null);
                  }}
                />
                {c.labelTh}
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={pending || selected.size === 0}
            onClick={() =>
              run(
                () => onPreview(ids, sla),
                (r) => {
                  setPreview(r);
                  setDone(null);
                },
              )
            }
            className="mt-3 w-full rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--border-strong)" }}
          >
            {pending ? "กำลังคำนวณ…" : "ดูตัวอย่างก่อน"}
          </button>
        </div>
      </div>

      {error && (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
        >
          {error}
        </p>
      )}

      {done && (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--ok-bg)", color: "var(--ok)" }}
        >
          {done}
        </p>
      )}

      {preview && !done && (
        <div
          className="rounded-[var(--radius-card)] border p-4"
          style={{ background: "var(--bg-sunken)", borderColor: "var(--border)" }}
        >
          <div className="mb-2 text-sm font-semibold">{preview.th}</div>
          <ul className="mb-3 flex flex-col gap-1">
            {preview.rows.map((r) => (
              <li
                key={r.pageId}
                className="flex items-baseline gap-2 text-sm"
                style={{
                  color: r.skipped ? "var(--text-faint)" : "var(--text)",
                }}
              >
                <span className="min-w-0 flex-1 truncate">{r.pageName}</span>
                <span className="tabular shrink-0 text-xs">{r.changeTh}</span>
              </li>
            ))}
          </ul>

          {preview.rows.some((r) => r.warningTh) && (
            <p
              className="mb-3 rounded-lg px-3 py-2 text-xs"
              style={{ background: "var(--warn-bg)", color: "var(--warn)" }}
            >
              {preview.rows.find((r) => r.warningTh)!.warningTh}
            </p>
          )}

          {preview.needsConfirmation && (
            <p
              className="mb-3 rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--warn-bg)", color: "var(--warn)" }}
            >
              กระทบ {preview.willChange} เพจ ของลูกค้า {preview.affectedClients} ราย
              — ต้องกดยืนยันอีกครั้ง
            </p>
          )}

          <button
            type="button"
            disabled={pending || preview.willChange === 0}
            onClick={() =>
              run(
                () => onApply(ids, sla, preview.needsConfirmation),
                (r) => {
                  setDone(r.th);
                  setPreview(null);
                },
              )
            }
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{
              background: preview.needsConfirmation
                ? "var(--warn)"
                : "var(--accent)",
              color: "var(--bg)",
            }}
          >
            {preview.needsConfirmation
              ? `ยืนยันแก้ ${preview.willChange} เพจ`
              : `แก้ ${preview.willChange} เพจ`}
          </button>
        </div>
      )}
    </div>
  );
}
