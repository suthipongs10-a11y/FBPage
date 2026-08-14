/**
 * แถบส่วนแบ่งเสียง
 *
 * ต่างจาก `<Meter>` ที่มีอยู่ตรงที่ตัวนี้รับเปอร์เซ็นต์มาแล้ว ไม่ได้คิดเอง —
 * สัดส่วนคำนวณใน `shareOfVoice()` ซึ่งมีเทสต์ครอบไว้ ถ้าให้ component คิดซ้ำ
 * จะกลายเป็นสูตรสองที่ที่ต้องตรงกันเอง
 */
export interface VoiceSegment {
  label: string;
  sharePct: number;
  colorIndex: number;
}

export function VoiceBar({ segments }: { segments: VoiceSegment[] }) {
  return (
    <div>
      <div
        className="flex h-3 overflow-hidden rounded-[var(--radius-pill)]"
        style={{ background: "var(--bg-sunken)" }}
      >
        {segments.map((s) => (
          <span
            key={s.label}
            className="h-full"
            style={{
              width: `${s.sharePct}%`,
              background: `var(--client-${s.colorIndex})`,
            }}
            title={`${s.label} ${s.sharePct.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ background: `var(--client-${s.colorIndex})` }}
            />
            <span>{s.label}</span>
            <span className="tabular font-semibold" style={{ color: "var(--text-muted)" }}>
              {s.sharePct.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
