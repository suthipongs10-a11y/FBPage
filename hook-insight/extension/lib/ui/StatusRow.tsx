import type { ReactNode } from 'react';

export type StatusTone = 'ok' | 'wait' | 'bad';

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-gauge-warm',
  wait: 'bg-gauge-base',
  bad: 'bg-gauge-hot',
};

interface StatusRowProps {
  label: string;
  value: ReactNode;
  tone: StatusTone;
  /** ข้อความอธิบายว่าต้องทำอะไรต่อ — ห้ามเขียนแค่ "เกิดข้อผิดพลาด" */
  hint?: string;
}

/** แถวสถานะแบบหน้าปัดเครื่องวัด — ป้ายซ้าย ตัวเลขขวา อ่านเทียบกันได้ */
export function StatusRow({ label, value, tone, hint }: StatusRowProps) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_CLASS[tone]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
      </div>
      <div className="num shrink-0 text-sm text-text">{value}</div>
    </div>
  );
}
