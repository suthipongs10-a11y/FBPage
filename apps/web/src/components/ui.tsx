/**
 * ชิ้นส่วน UI พื้นฐาน
 *
 * เขียนเองแทนการดึง shadcn มาทั้งชุด เพราะหน้าจอนี้ต้องการแค่ไม่กี่ชิ้น
 * และการมีของน้อยแต่คุมได้หมด ดีกว่ามีของเยอะที่ต้องคอยตามอัปเดต
 */
import type { CSSProperties, ReactNode } from "react";

export type Tone = "green" | "amber" | "red" | "gray" | "blue" | "accent";

const TONE_VAR: Record<Tone, { fg: string; bg: string }> = {
  green: { fg: "var(--ok)", bg: "var(--ok-bg)" },
  amber: { fg: "var(--warn)", bg: "var(--warn-bg)" },
  red: { fg: "var(--danger)", bg: "var(--danger-bg)" },
  blue: { fg: "var(--info)", bg: "var(--info-bg)" },
  accent: { fg: "var(--accent)", bg: "var(--accent-bg)" },
  gray: { fg: "var(--text-faint)", bg: "var(--bg-sunken)" },
};

/**
 * hue ประจำลูกค้า — กระจายให้ห่างกันพอที่คนแยกออกแม้เห็นแวบเดียว
 * 10 ค่าเพราะเกินกว่านี้คนจำสีไม่ไหวอยู่ดี ให้วนซ้ำดีกว่า
 */
const CLIENT_HUES = [25, 60, 100, 145, 178, 210, 250, 288, 320, 345];

export function clientStyle(colorIndex: number): CSSProperties {
  return {
    ["--client-hue" as string]: String(
      CLIENT_HUES[colorIndex % CLIENT_HUES.length],
    ),
  };
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border ${padded ? "p-5" : ""} ${className}`}
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  count,
  hint,
  action,
}: {
  title: string;
  count?: number;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-4 flex items-baseline justify-between gap-4">
      <div className="flex items-baseline gap-2.5 min-w-0">
        <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>
        {count !== undefined && (
          <span
            className="tabular rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-medium"
            style={{ background: "var(--bg-sunken)", color: "var(--text-muted)" }}
          >
            {count}
          </span>
        )}
        {hint && (
          <span
            className="truncate text-xs"
            style={{ color: "var(--text-faint)" }}
          >
            {hint}
          </span>
        )}
      </div>
      {action}
    </header>
  );
}

export function Badge({
  tone = "gray",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  const c = TONE_VAR[tone];
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ background: c.bg, color: c.fg }}
    >
      {children}
    </span>
  );
}

/** จุดสีประจำลูกค้า — ตัวเดียวที่ทำให้แยกเพจ 20 เพจออกจากกันได้เร็ว */
export function ClientDot({
  colorIndex,
  size = 8,
}: {
  colorIndex: number;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="client-dot inline-block shrink-0 rounded-full"
      style={{ ...clientStyle(colorIndex), width: size, height: size }}
    />
  );
}

/** แถบสีข้างการ์ด บอกว่าเป็นของลูกค้าไหนโดยไม่ต้องอ่านชื่อ */
export function ClientStripe({ colorIndex }: { colorIndex: number }) {
  return (
    <span
      aria-hidden
      className="client-dot absolute top-0 bottom-0 left-0 w-[3px] rounded-l-[var(--radius-card)]"
      style={clientStyle(colorIndex)}
    />
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "gray",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  const c = TONE_VAR[tone];
  return (
    <div
      className="rounded-[var(--radius-card)] border px-4 py-3.5"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="text-xs" style={{ color: "var(--text-faint)" }}>
        {label}
      </div>
      <div
        className="tabular mt-1 text-2xl leading-none font-semibold"
        style={{ color: tone === "gray" ? "var(--text)" : c.fg }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * สถานะว่าง — จงใจให้เป็นข้อความบวก ไม่ใช่ "ไม่มีข้อมูล"
 * เพราะในหน้านี้ "ว่าง" แปลว่างานเสร็จ ซึ่งควรรู้สึกดี
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-[var(--radius-card)] border border-dashed px-4 py-6 text-center text-sm"
      style={{ color: "var(--text-faint)", borderColor: "var(--border)" }}
    >
      {children}
    </p>
  );
}

/** แถบสัดส่วนแนวนอน ใช้แสดง mix ของเสาหลักคอนเทนต์ */
export function Meter({
  segments,
}: {
  segments: Array<{ label: string; value: number; colorIndex: number }>;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div
        className="flex h-2 overflow-hidden rounded-[var(--radius-pill)]"
        style={{ background: "var(--bg-sunken)" }}
      >
        {segments.map((s) => (
          <span
            key={s.label}
            className="client-dot h-full"
            style={{
              ...clientStyle(s.colorIndex),
              width: `${(s.value / total) * 100}%`,
            }}
            title={`${s.label} ${s.value}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1">
        {segments.map((s) => (
          <span
            key={s.label}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <ClientDot colorIndex={s.colorIndex} size={6} />
            {s.label}
            <span className="tabular" style={{ color: "var(--text-faint)" }}>
              {s.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
