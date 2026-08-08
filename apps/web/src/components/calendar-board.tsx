"use client";

import { useMemo, useState } from "react";
import { ClientDot, clientStyle } from "@/components/ui";

export interface BoardDay {
  key: string;
  /** เที่ยงคืนของวันนั้นตาม timezone ของเวิร์กสเปซ (epoch ms, UTC) */
  startMs: number;
  dayNum: number;
  weekdayShort: string;
  monthLabel: string | null;
  isToday: boolean;
  isPast: boolean;
}

export interface BoardItem {
  postId: string;
  pageId: string;
  pageName: string;
  clientName: string;
  colorIndex: number;
  dayKey: string;
  /** นาทีนับจากเที่ยงคืน — ใช้คำนวณเวลาใหม่ตอนลากข้ามวัน */
  minutesOfDay: number;
  timeLabel: string;
  preview: string;
  pillarLabelTh: string;
  approvalLabel: string;
  approvalTone: "green" | "amber" | "red" | "gray";
}

const APPROVAL_COLOR: Record<BoardItem["approvalTone"], string> = {
  green: "var(--ok)",
  amber: "var(--warn)",
  red: "var(--danger)",
  gray: "var(--text-faint)",
};

interface Moved {
  dayKey: string;
  minutesOfDay: number;
}

/**
 * ปฏิทินรวมทุกเพจในจอเดียว (สเปกข้อ M4)
 *
 * เรื่องที่ต้องคิดให้ขาดคือ **ลากไปวางแล้วต้องห้ามอะไรบ้าง**
 * กติกาเดียวกับ `rescheduleEntry()` ของ `@page-os/studio`:
 *   - ห้ามวางในอดีต (worker จะหยิบไปโพสต์ทันทีที่รอบถัดไปมาถึง)
 *   - ห้ามวางชนโพสต์อื่น **ของเพจเดียวกัน** ในระยะที่กำหนด
 *
 * ข้อหลังต่างจากตัวใน `studio` ตรงที่นั่นเป็นปฏิทินของเพจเดียว
 * แต่จอนี้รวมทุกเพจ — โพสต์ของคนละลูกค้าเวลาเดียวกันไม่ได้แย่ reach กัน
 * ถ้าเช็คข้ามเพจจะบล็อกการวางที่ถูกต้อง แล้วคนจะเลิกใช้ปุ่มลาก
 */
export function CalendarBoard({
  days,
  items,
  clients,
  minGapHours,
  nowMs,
}: {
  days: BoardDay[];
  items: BoardItem[];
  clients: Array<{ name: string; colorIndex: number }>;
  minGapHours: number;
  nowMs: number;
}) {
  const [moves, setMoves] = useState<Record<string, Moved>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const dayByKey = useMemo(
    () => new Map(days.map((d) => [d.key, d])),
    [days],
  );

  /** ตำแหน่งปัจจุบันของทุกโพสต์ หลังรวมการลากที่ยังไม่ได้บันทึก */
  const placed = useMemo(
    () =>
      items.map((it) => {
        const m = moves[it.postId];
        const dayKey = m?.dayKey ?? it.dayKey;
        const minutesOfDay = m?.minutesOfDay ?? it.minutesOfDay;
        const day = dayByKey.get(dayKey);
        return {
          ...it,
          dayKey,
          minutesOfDay,
          atMs: (day?.startMs ?? 0) + minutesOfDay * 60_000,
          moved: m !== undefined,
        };
      }),
    [items, moves, dayByKey],
  );

  const visible = placed.filter((p) => !hidden.has(p.clientName));

  const byDay = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const p of visible) {
      const list = map.get(p.dayKey) ?? [];
      list.push(p);
      map.set(p.dayKey, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.minutesOfDay - b.minutesOfDay);
    }
    return map;
  }, [visible]);

  function toggleClient(name: string): void {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function drop(targetDayKey: string): void {
    const postId = dragging;
    setDragging(null);
    if (!postId) return;

    const item = placed.find((p) => p.postId === postId);
    const target = dayByKey.get(targetDayKey);
    if (!item || !target) return;
    if (item.dayKey === targetDayKey) return;

    const newAtMs = target.startMs + item.minutesOfDay * 60_000;

    if (newAtMs <= nowMs) {
      setMessage({
        tone: "error",
        text: "เลื่อนไปเวลาที่ผ่านมาแล้วไม่ได้ — ระบบจะโพสต์ทันทีที่รอบถัดไปมาถึง",
      });
      return;
    }

    const gapMs = minGapHours * 3_600_000;
    const clash = placed.find(
      (p) =>
        p.postId !== postId &&
        p.pageId === item.pageId &&
        Math.abs(p.atMs - newAtMs) < gapMs,
    );
    if (clash) {
      setMessage({
        tone: "error",
        text: `ชนกับโพสต์ ${clash.timeLabel} ของเพจเดียวกัน — ต้องห่างกันอย่างน้อย ${minGapHours} ชั่วโมง ไม่งั้นสองโพสต์แย่ง reach กันเอง`,
      });
      return;
    }

    setMoves((prev) => ({
      ...prev,
      [postId]: { dayKey: targetDayKey, minutesOfDay: item.minutesOfDay },
    }));
    setMessage({
      tone: "ok",
      text: `เลื่อน "${item.preview.slice(0, 24)}…" ไป ${target.weekdayShort} ${target.dayNum} ${item.timeLabel} แล้ว (ยังไม่บันทึก)`,
    });
  }

  const movedCount = Object.keys(moves).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {clients.map((c) => {
            const off = hidden.has(c.name);
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => toggleClient(c.name)}
                aria-pressed={!off}
                className="flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs transition-opacity"
                style={{
                  borderColor: "var(--border)",
                  background: off ? "transparent" : "var(--surface)",
                  color: off ? "var(--text-faint)" : "var(--text)",
                  opacity: off ? 0.55 : 1,
                }}
              >
                <ClientDot colorIndex={c.colorIndex} size={7} />
                {c.name}
              </button>
            );
          })}
        </div>

        {movedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              เลื่อนไว้ {movedCount} โพสต์ ยังไม่ได้บันทึก
            </span>
            <button
              type="button"
              onClick={() => {
                setMoves({});
                setMessage(null);
              }}
              className="rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs"
              style={{ borderColor: "var(--border-strong)" }}
            >
              คืนค่าเดิม
            </button>
          </div>
        )}
      </div>

      {message && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border px-3 py-2 text-sm"
          style={{
            borderColor:
              message.tone === "error" ? "var(--danger)" : "var(--border)",
            background:
              message.tone === "error" ? "var(--danger-bg)" : "var(--bg-sunken)",
            color: message.tone === "error" ? "var(--danger)" : "var(--text-muted)",
          }}
        >
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="grid min-w-[860px] grid-cols-7 gap-1.5">
          {days.slice(0, 7).map((d) => (
            <div
              key={`head-${d.key}`}
              className="pb-1 text-center text-xs font-semibold"
              style={{ color: "var(--text-faint)" }}
            >
              {d.weekdayShort}
            </div>
          ))}

          {days.map((d) => {
            const list = byDay.get(d.key) ?? [];
            return (
              <div
                key={d.key}
                onDragOver={(e) => {
                  if (dragging) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(d.key);
                }}
                className="flex min-h-[110px] flex-col gap-1 rounded-lg border p-1.5"
                style={{
                  borderColor: d.isToday ? "var(--accent)" : "var(--border)",
                  background: d.isPast
                    ? "transparent"
                    : d.isToday
                      ? "var(--accent-bg)"
                      : "var(--surface)",
                  opacity: d.isPast ? 0.5 : 1,
                }}
              >
                <div className="flex items-baseline justify-between px-0.5">
                  <span
                    className="tabular text-xs font-semibold"
                    style={{
                      color: d.isToday ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    {d.dayNum}
                  </span>
                  {d.monthLabel && (
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {d.monthLabel}
                    </span>
                  )}
                </div>

                {list.map((p) => (
                  <article
                    key={p.postId}
                    draggable
                    onDragStart={() => setDragging(p.postId)}
                    onDragEnd={() => setDragging(null)}
                    title={`${p.pageName} · ${p.timeLabel} · ${p.pillarLabelTh}\n${p.preview}`}
                    className="client-bg client-border cursor-grab rounded-md border px-1.5 py-1 text-[11px] leading-snug active:cursor-grabbing"
                    style={{
                      ...clientStyle(p.colorIndex),
                      opacity: dragging === p.postId ? 0.45 : 1,
                      outline: p.moved ? "1px dashed var(--accent)" : "none",
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span
                        className="tabular font-semibold"
                        style={{ color: "var(--text)" }}
                      >
                        {p.timeLabel}
                      </span>
                      <span
                        aria-hidden
                        className="ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: APPROVAL_COLOR[p.approvalTone] }}
                        title={p.approvalLabel}
                      />
                    </div>
                    <div className="truncate" style={{ color: "var(--text)" }}>
                      {p.preview}
                    </div>
                    <div
                      className="truncate"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {p.pageName}
                    </div>
                  </article>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
        style={{ color: "var(--text-faint)" }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--ok)" }}
          />
          อนุมัติแล้ว
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--warn)" }}
          />
          รออนุมัติ
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--danger)" }}
          />
          ขอแก้ไข
        </span>
        <span>ลากการ์ดข้ามวันเพื่อเลื่อนเวลาโพสต์</span>
      </div>
    </div>
  );
}
