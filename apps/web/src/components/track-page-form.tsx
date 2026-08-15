"use client";

/**
 * ฟอร์มเพิ่มเพจ/ช่องที่จะเฝ้าดู
 *
 * เลือกแพลตฟอร์มและชนิดก่อนแล้วค่อยกรอก เพราะสี่ชุดนี้ผลลัพธ์ต่างกันมาก
 * และคนที่ไม่รู้จะเพิ่มเสร็จแล้วมานั่งงงว่าทำไมไม่มีข้อมูล:
 *
 * | | เพจของเรา | คู่แข่ง |
 * |---|---|---|
 * | **Facebook** | ต้องเชื่อม token ที่หน้าตั้งค่าก่อน | ⚠️ ดึงไม่ได้จนกว่าจะได้ PPCA |
 * | **YouTube** | ดึงได้เลย | **ดึงได้เลย** |
 *
 * ช่องขวาล่างคือความต่างที่สำคัญที่สุด — บน YouTube เราส่องคู่แข่งได้ทันที
 * แต่บน Facebook ทำไม่ได้จนกว่าจะผ่าน App Review ของ Meta
 */
import { useActionState, useEffect, useRef, useState } from "react";

interface Result {
  ok: boolean;
  th: string;
}

type Platform = "FACEBOOK" | "YOUTUBE";
type Kind = "OWNED" | "COMPETITOR";

/** ข้อความที่ต่างกันไปตามแพลตฟอร์ม — รวมไว้ที่เดียวจะได้ไม่หลุดกันคนละที่ */
const COPY: Record<
  Platform,
  {
    label: string;
    idLabel: string;
    idPlaceholder: string;
    idHint: string;
    inputMode: "numeric" | "text";
    ownedLabel: string;
    rivalLabel: string;
  }
> = {
  FACEBOOK: {
    label: "เพจ Facebook",
    idLabel: "รหัสเพจ (ตัวเลข)",
    idPlaceholder: "เช่น 100064…",
    idHint: "หาได้จากหน้าเพจ → เกี่ยวกับ → ความโปร่งใสของเพจ → รหัสเพจ",
    inputMode: "numeric",
    ownedLabel: "เพจของเรา",
    rivalLabel: "เพจคู่แข่ง / เพจที่อยากส่อง",
  },
  YOUTUBE: {
    label: "ช่อง YouTube",
    idLabel: "รหัสช่อง (ขึ้นต้นด้วย UC)",
    idPlaceholder: "เช่น UCabc123…",
    // ย้ำว่าไม่ใช่ @handle เพราะนั่นคือสิ่งที่คนเห็นบน URL สมัยใหม่
    idHint: "หน้าช่อง → เกี่ยวกับ → แชร์ช่อง → คัดลอกรหัสช่อง (ไม่ใช่ @ชื่อช่อง)",
    inputMode: "text",
    ownedLabel: "ช่องของเรา",
    rivalLabel: "ช่องคู่แข่ง / ช่องที่อยากส่อง",
  },
};

export function TrackPageForm({
  action,
}: {
  action: (prev: unknown, formData: FormData) => Promise<Result>;
}) {
  const [state, formAction, pending] = useActionState(action, null as Result | null);
  const [platform, setPlatform] = useState<Platform>("FACEBOOK");
  const [kind, setKind] = useState<Kind>("OWNED");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok === true) formRef.current?.reset();
  }, [state]);

  const copy = COPY[platform];

  const field =
    "w-full rounded-[var(--radius-card)] border px-3 py-2 text-sm outline-none";
  const fieldStyle = {
    background: "var(--bg-sunken)",
    borderColor: "var(--border)",
    color: "var(--text)",
  };

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      {/* แพลตฟอร์ม — เปลี่ยนแล้วป้ายกำกับข้างล่างเปลี่ยนตาม */}
      <input type="hidden" name="platform" value={platform} />
      <Chips
        options={[
          { value: "FACEBOOK", label: "Facebook" },
          { value: "YOUTUBE", label: "YouTube" },
        ]}
        selected={platform}
        onSelect={(v) => setPlatform(v as Platform)}
      />

      <Chips
        name="kind"
        options={[
          { value: "OWNED", label: copy.ownedLabel },
          { value: "COMPETITOR", label: copy.rivalLabel },
        ]}
        selected={kind}
        onSelect={(v) => setKind(v as Kind)}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="externalId" className="text-sm font-medium">
            {copy.idLabel}
          </label>
          <input
            id="externalId"
            name="externalId"
            required
            inputMode={copy.inputMode}
            autoComplete="off"
            placeholder={copy.idPlaceholder}
            className={field}
            style={fieldStyle}
          />
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            {copy.idHint}
          </span>
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
        <Guidance platform={platform} kind={kind} />
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
          {pending ? "กำลังเพิ่ม…" : `เพิ่ม${platform === "YOUTUBE" ? "ช่อง" : "เพจ"}`}
        </button>
      </div>
    </form>
  );
}

/**
 * บอกล่วงหน้าว่าจะเกิดอะไรขึ้นหลังกดเพิ่ม
 *
 * มีอยู่ชุดเดียวที่เป็นคำเตือน — Facebook + คู่แข่ง — เพราะเป็นชุดเดียวที่
 * **เพิ่มสำเร็จแต่จะไม่มีข้อมูลมา** ถ้าไม่บอกไว้ คนจะรอทั้งวันแล้วคิดว่าระบบพัง
 */
function Guidance({ platform, kind }: { platform: Platform; kind: Kind }) {
  if (platform === "YOUTUBE") {
    return (
      <>
        ดึงได้เลยด้วย <b>YOUTUBE_API_KEY</b> ที่ตั้งไว้ในไฟล์ .env —{" "}
        {kind === "OWNED" ? (
          <>ช่องของเราไม่ต้องเชื่อมบัญชีก็อ่านได้ (จะต้องเชื่อมตอนซ่อน/ลบคอมเมนต์)</>
        ) : (
          <>
            <b>อ่านคอมเมนต์ของช่องคนอื่นได้เลย</b> ไม่ต้องขออนุมัติเหมือนฝั่ง Facebook
          </>
        )}{" "}
        รอบดึงข้อมูลทุก 3 ชั่วโมง
      </>
    );
  }

  if (kind === "OWNED") {
    return (
      <>
        ต้องเชื่อม Page Access Token ของเพจนี้ที่หน้า <b>ตั้งค่า</b> ไว้ก่อน
        แล้วระบบจะเริ่มดึงโพสต์ให้ในรอบถัดไป (ทุกชั่วโมง)
      </>
    );
  }

  return (
    <>
      ⚠️ เพจที่เราไม่ได้เป็นแอดมิน <b>ยังดึงข้อมูลอัตโนมัติไม่ได้</b> — Meta บังคับให้ต้องมี
      สิทธิ์ Page Public Content Access ซึ่งต้องผ่าน App Review ก่อน เพิ่มไว้ได้
      แต่จะยังไม่มีตัวเลขจนกว่าจะต่อแหล่งข้อมูลได้
    </>
  );
}

/** แถวปุ่มเลือกแบบเลือกได้อันเดียว — ใช้ radio จริงเพื่อให้ใช้คีย์บอร์ดได้ */
function Chips({
  name,
  options,
  selected,
  onSelect,
}: {
  name?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className="cursor-pointer rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs"
          style={{
            borderColor: selected === o.value ? "var(--accent)" : "var(--border)",
            background: selected === o.value ? "var(--accent-bg)" : "transparent",
            fontWeight: selected === o.value ? 600 : 400,
          }}
        >
          <input
            type="radio"
            {...(name !== undefined ? { name } : {})}
            value={o.value}
            checked={selected === o.value}
            onChange={() => onSelect(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
