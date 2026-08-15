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
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-card)",
      }}
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
    <header className="mb-3 flex items-baseline justify-between gap-4">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="text-[1.0625rem] font-semibold tracking-tight">{title}</h2>
        {count !== undefined && (
          <span
            className="tabular rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[0.7rem] font-semibold"
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

/**
 * ตัวเลขสรุปหนึ่งช่อง
 *
 * ─── ทำไมตัวเลขต้องใหญ่ขนาดนี้ ───
 *
 * นี่คือของที่คนกวาดตาดูตอนเปิดหน้าจอวินาทีแรก ก่อนจะอ่านอะไรทั้งสิ้น
 * ถ้าตัวเลขเล็กพอๆ กับข้อความรอบข้าง มันก็ไม่ได้ทำหน้าที่ "สรุป" อะไรเลย
 * — แค่เป็นข้อความอีกบรรทัด
 *
 * ─── แถบสีด้านซ้าย ───
 *
 * สถานะบอกด้วย**ตำแหน่งและรูปทรง**ก่อน แล้วค่อยเสริมด้วยสี ไม่ใช่สีอย่างเดียว
 * คนตาบอดสีแยก "แดง/ส้ม/เขียว" ไม่ออก แต่แยก "มีแถบ/ไม่มีแถบ" ออกเสมอ
 * และตัวเลขที่ยังเป็นสีตามสถานะคือชั้นที่สอง ไม่ใช่ชั้นเดียว
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "gray",
  trend,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  /** ค่าย้อนหลังไว้วาดเส้นแนวโน้มเล็กๆ — ไม่ส่งมาก็ได้ */
  trend?: readonly number[];
  /** ส่วนต่างเทียบกับช่วงก่อนหน้า พร้อมชื่อช่วงที่เทียบ */
  delta?: { text: string; good: boolean | null };
}) {
  const c = TONE_VAR[tone];
  const quiet = tone === "gray";
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-card)] border px-4 py-4"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {!quiet && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: c.fg }}
        />
      )}
      <div
        className="text-[0.7rem] font-medium tracking-wide"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </div>

      <div className="mt-1.5">
        {/*
          ⚠️ ตัวเลขก้อนใหญ่ **ห้ามใช้ `tabular`**
          `tabular-nums` บังคับให้ทุกหลักกว้างเท่าเลข 0 ซึ่งช่วยตอนเรียงเป็น
          คอลัมน์ แต่พอเอามาใช้กับตัวเลขเดี่ยวขนาดใหญ่ เลขอย่าง "121" จะดูโหว่
          เป็นช่องๆ — เก็บ `tabular` ไว้ใช้ในตารางที่หลักต้องตรงกันเท่านั้น
        */}
        <div
          className="text-[2rem] leading-none font-semibold tracking-tight"
          style={{ color: quiet ? "var(--text)" : c.fg }}
        >
          {value}
        </div>
      </div>

      {/*
        เส้นแนวโน้มอยู่**ใต้**ตัวเลข เต็มความกว้างของกล่อง ไม่ใช่เบียดอยู่ข้างๆ
        ตอนวางไว้ข้างตัวเลขมันกว้างแค่ 96px ซึ่งแคบเกินกว่าจะเห็นรูปร่าง —
        ออกมาเป็นขีดทแยงที่ดูเหมือนวาดพลาด มากกว่าจะดูเหมือนกราฟ
      */}
      {trend !== undefined && trend.length >= 2 && (
        <div className="mt-2.5">
          <Sparkline
            values={trend}
            tone={tone === "red" ? "danger" : tone === "green" ? "ok" : "accent"}
            width={220}
            height={30}
          />
        </div>
      )}

      {delta !== undefined && (
        <div className="mt-2 text-xs font-medium" style={{ color: deltaColor(delta.good) }}>
          {delta.text}
        </div>
      )}

      {sub && (
        <div
          className={`text-xs leading-snug ${delta === undefined ? "mt-2" : "mt-1"}`}
          style={{ color: "var(--text-muted)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * สีของส่วนต่าง — **ทิศทาง × ขึ้นแล้วดีหรือเปล่า**
 *
 * ขึ้นไม่ได้แปลว่าดีเสมอ: ผู้ติดตามเพิ่มคือดี แต่ "เรื่องที่พัง" เพิ่มคือแย่
 * ตัวเรียกจึงเป็นคนบอกว่าดีหรือไม่ดี ไม่ใช่ให้ที่นี่เดาจากเครื่องหมายบวกลบ
 *
 * `null` = ไม่ตัดสิน (เช่น ยังไม่มีข้อมูลพอ) → ใช้สีข้อความปกติ
 */
function deltaColor(good: boolean | null): string {
  if (good === null) return "var(--text-muted)";
  return good ? "var(--ok)" : "var(--danger)";
}

/**
 * แถวหนึ่งบรรทัดในรายการ — ตัวที่ทำให้หน้าจอแน่นขึ้นเท่าตัว
 *
 * ของเดิมทุกแถวเป็น "การ์ดซ้อนในการ์ด" (มีพื้นหลัง มีขอบ มี padding รอบด้าน)
 * หกแถวจึงกลายเป็นกำแพงสี่เหลี่ยมสูง 660px ที่บรรจุข้อความจริงแค่สิบสองบรรทัด
 *
 * แบบใหม่ใช้**เส้นคั่น**แทนกล่อง และแถบสีลูกค้าบางๆ ด้านซ้ายแทนขอบเต็มใบ
 * ได้ข้อมูลเท่าเดิมในพื้นที่ราวครึ่งเดียว และสายตาไล่ลงตามคอลัมน์ได้
 * แทนที่จะต้องกระโดดข้ามขอบกล่องทีละใบ
 */
export function Row({
  colorIndex,
  children,
  className = "",
}: {
  /** สีประจำลูกค้า — ไม่ส่งมาก็ได้ถ้าแถวนี้ไม่ผูกกับลูกค้าคนไหน */
  colorIndex?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={`interactive relative flex items-center gap-3 rounded-[var(--radius-row)] px-2.5 py-2.5 ${className}`}
    >
      {colorIndex !== undefined && (
        <span
          aria-hidden
          className="client-dot absolute top-2 bottom-2 left-0 w-[2px] rounded-full"
          style={clientStyle(colorIndex)}
        />
      )}
      {children}
    </li>
  );
}

/**
 * สถานะว่าง — จงใจให้เป็นข้อความบวก ไม่ใช่ "ไม่มีข้อมูล"
 * เพราะในหน้านี้ "ว่าง" แปลว่างานเสร็จ ซึ่งควรรู้สึกดี
 */
/**
 * สถานะว่าง
 *
 * ─── "ว่าง" มีสองความหมาย และห้ามใช้หน้าตาเดียวกัน ───
 *
 * `done` = **ทำครบแล้ว** ("ตอบครบทุกข้อความแล้ว") — ควรรู้สึกดี ติดเครื่องหมายถูก
 * `none` = **ยังไม่มีข้อมูล** ("ยังไม่มี engagement ในช่วงนี้") — เป็นกลาง
 *
 * ค่าเริ่มต้นคือ `none` โดยตั้งใจ เพราะถ้าเผลอไม่ระบุ การได้ข้อความกลางๆ
 * เสียหายน้อยกว่าการติดเครื่องหมายถูกสีเขียวไว้ข้างข้อความที่แปลว่า
 * "ยังตั้งค่าไม่เสร็จ" — อันหลังคือการบอกคนใช้ว่าเรียบร้อยดีทั้งที่ยังไม่เรียบร้อย
 */
export function EmptyState({
  children,
  kind = "none",
}: {
  children: ReactNode;
  kind?: "done" | "none";
}) {
  return (
    <p
      className="flex items-center justify-center gap-2 rounded-[var(--radius-row)] px-4 py-7 text-center text-sm"
      style={{ color: "var(--text-faint)", background: "var(--bg-sunken)" }}
    >
      {kind === "done" && <CheckIcon />}
      {children}
    </p>
  );
}

/** เครื่องหมายถูก — ใช้กับสถานะว่างที่แปลว่า "งานเสร็จ" ไม่ใช่ "ไม่มีข้อมูล" */
function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
      style={{ color: "var(--ok)" }}
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
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

/**
 * ป้ายบอกแพลตฟอร์ม
 *
 * จำเป็นตั้งแต่วินาทีที่ระบบเก็บได้ทั้งเพจ Facebook และช่อง YouTube —
 * ตัวเลขของสองฝั่งเทียบกันตรงๆ ไม่ได้ (YouTube ไม่มียอดแชร์เลย ส่วน Facebook
 * ไม่มียอดวิว) ถ้าไม่มีป้ายกำกับ คนจะอ่านตารางเดียวกันแล้วสรุปผิด
 *
 * ใช้สีประจำแบรนด์แทนที่จะเป็นสีตามสถานะ เพราะนี่คือ "มันคืออะไร"
 * ไม่ใช่ "มันเป็นยังไง" — สีเขียว/แดงในระบบนี้สงวนไว้บอกสถานะเท่านั้น
 */
export function PlatformTag({ platform }: { platform: "FACEBOOK" | "YOUTUBE" }) {
  const yt = platform === "YOUTUBE";
  return (
    <span
      title={yt ? "ช่อง YouTube" : "เพจ Facebook"}
      className="inline-flex shrink-0 items-center rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[0.625rem] font-semibold whitespace-nowrap"
      style={{
        background: yt ? "#ff000018" : "#0866ff18",
        color: yt ? "#d90000" : "#0866ff",
      }}
    >
      {yt ? "YouTube" : "Facebook"}
    </span>
  );
}

/**
 * เส้นแนวโน้มขนาดจิ๋วในกล่องตัวเลข (sparkline)
 *
 * ─── กฎที่ทำตามจากคู่มือทำกราฟ ───
 *
 * - เส้นหนา **2px** ปลายและข้อต่อมน (`round`) — บางกว่านี้หายไปบนพื้นมืด
 * - จุดปลาย **รัศมี ≥ 4px** พร้อม**วงแหวนสีพื้น 2px** ให้ยังเห็นชัดเมื่อทับเส้น
 * - ช่วงที่ผ่านมาใช้สี**จาง** ส่วนจุดปัจจุบันใช้สีเน้น — สายตาจึงไปหยุดที่
 *   "ตอนนี้เท่าไร" ก่อน แล้วค่อยไล่ย้อนดูว่ามาจากไหน
 * - **ไม่มีแกน ไม่มีเส้นตาราง ไม่มีตัวเลขกำกับทุกจุด** — หน้าที่ของมันคือบอก
 *   ทิศทาง ไม่ใช่ให้อ่านค่า ตัวเลขจริงอยู่ตัวใหญ่ข้างบนอยู่แล้ว
 *
 * ─── ทำไมไม่ใช้กราฟแท่ง ───
 *
 * ค่าผู้ติดตามเป็นหลักหมื่นและขยับวันละไม่กี่สิบ ถ้าวาดแท่งจากศูนย์จะได้แท่ง
 * สูงเท่ากันหมดจนดูไม่ออก — เส้นที่ปรับสเกลตามช่วงของข้อมูลเองเท่านั้นที่เห็น
 * การเปลี่ยนแปลง (และนั่นคือเหตุผลที่มันต้องอยู่คู่กับตัวเลขจริงเสมอ
 * เส้นที่ไม่มีแกนบอกได้แค่ "ขึ้นหรือลง" ไม่ได้บอกว่า "ขึ้นเท่าไร")
 */
export function Sparkline({
  values,
  tone = "accent",
  width = 96,
  height = 28,
}: {
  values: readonly number[];
  tone?: "accent" | "ok" | "danger";
  width?: number;
  height?: number;
}) {
  // จุดเดียวลากเส้นไม่ได้ และไม่มีอะไรให้ดู — ไม่ต้องวาดเลยดีกว่าวาดของเปล่า
  if (values.length < 2) return null;

  const color =
    tone === "ok" ? "var(--ok)" : tone === "danger" ? "var(--danger)" : "var(--accent)";

  const min = Math.min(...values);
  const max = Math.max(...values);
  /**
   * ค่าเท่ากันหมดทั้งช่วง (ยังไม่ขยับเลย) → วาดเป็นเส้นตรงกลางกรอบ
   * ถ้าไม่ดัก จะหารด้วยศูนย์แล้วได้ `NaN` ซึ่งทำให้ทั้ง path หายไปเงียบๆ
   */
  const span = max - min;
  const pad = 3;
  const usableH = height - pad * 2;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = span === 0 ? height / 2 : pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1] as readonly [number, number];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      /*
       * ยืดเต็มความกว้างแบบ**คงสัดส่วน** (ไม่ใช่ `preserveAspectRatio="none"`)
       * — ถ้าบีบเฉพาะแกนใดแกนหนึ่ง จุดปลายวงกลมจะกลายเป็นวงรี และเส้นจะหนา
       *   ไม่เท่ากันสองด้าน ซึ่งเห็นชัดมากในที่เล็กๆ แบบนี้
       */
      className="block w-full overflow-visible"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* วงแหวนสีพื้นก่อน แล้วค่อยจุดจริงทับ — จุดจึงไม่จมหายไปในเส้น */}
      <circle cx={last[0]} cy={last[1]} r={4.5} fill="var(--surface)" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
    </svg>
  );
}
