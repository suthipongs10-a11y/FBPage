'use client';
/**
 * กราฟ SVG ล้วน (ไม่มีไลบรารี) ตามหลัก dataviz: series เดียวต่อกราฟ (ไม่มี dual axis), แท่งบาง ปลายมน, เส้น 2px จุด ≥ 8px,
 * hover tooltip ทุกกราฟ, สลับดูเป็นตาราง, ค่าที่ไม่มี (null) เว้นว่างพร้อมบอกว่า "ไม่มีข้อมูล" — ไม่วาดเป็น 0
 * สี: ผูกกับแพลตฟอร์ม (Facebook = sky-600 #0284c7, YouTube = pink-600 #db2777) ตรวจผ่าน validate_palette บนพื้น #0f172a แล้ว
 */
import { useId, useState } from 'react';

export const SERIES = { facebook: '#0284c7', youtube: '#db2777', neutral: '#64748b' } as const;
export interface Point { label: string; value: number | null; hint?: string }
const fmt = (v: number | null) => (v === null ? 'ไม่มีข้อมูล' : v.toLocaleString('th-TH', { maximumFractionDigits: 1 }));

function Frame({ title, unit, points, table, children, note }: { title: string; unit?: string; points: Point[]; table: boolean; children: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-slate-300">{title}{unit ? <span className="text-slate-500"> · {unit}</span> : null}</span></div>
      {table ? (
        <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="py-1">ช่วง</th><th className="py-1 text-right">{unit ?? 'ค่า'}</th></tr></thead><tbody>{points.map(p => <tr key={p.label} className="border-t border-slate-800"><td className="py-1">{p.label}</td><td className="py-1 text-right">{fmt(p.value)}</td></tr>)}</tbody></table>
      ) : children}
      {note && <p className="mt-1 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

/** แท่งแนวตั้ง series เดียว — แสดงตัวเลขเฉพาะค่าสูงสุด (selective label) ที่เหลือดูจาก hover */
export function Bars({ title, unit, points, color, note, height = 140 }: { title: string; unit?: string; points: Point[]; color: string; note?: string; height?: number }) {
  const [table, setTable] = useState(false); const [hover, setHover] = useState<number | null>(null); const id = useId();
  const W = 600; const pad = { l: 8, r: 8, t: 14, b: 22 }; const n = Math.max(1, points.length); const gap = 2; const bw = Math.max(2, (W - pad.l - pad.r) / n - gap);
  const vals = points.map(p => p.value).filter((v): v is number => v !== null); const max = Math.max(1, ...vals); const maxIdx = points.findIndex(p => p.value === max);
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  return (
    <Frame title={title} unit={unit} points={points} table={table} note={note}>
      <div className="relative">
        <button onClick={() => setTable(v => !v)} className="absolute right-0 -top-6 text-[11px] text-slate-500 hover:text-slate-300">{table ? 'กราฟ' : 'ตาราง'}</button>
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-labelledby={id}>
          <title id={id}>{title}</title>
          {[0.5, 1].map(f => <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#1e293b" strokeWidth={1} />)}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#334155" strokeWidth={1} />
          {points.map((p, i) => { const x = pad.l + i * (bw + gap); const h = p.value === null ? 0 : Math.max(p.value > 0 ? 3 : 0, y(0) - y(p.value));
            return <g key={p.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={pad.t} width={bw} height={height - pad.t - pad.b} fill="transparent" />
              {p.value === null ? <rect x={x} y={y(0) - 3} width={bw} height={3} fill="#334155" rx={1} /> : <path d={`M${x},${y(0)} v${-h + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {(i === maxIdx || hover === i) && p.value !== null && <text x={x + bw / 2} y={y(p.value) - 4} textAnchor="middle" fontSize={10} fill="#cbd5e1">{fmt(p.value)}</text>}
              {(i === 0 || i === n - 1 || i === Math.floor(n / 2)) && <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="#64748b">{p.label}</text>}
            </g>; })}
        </svg>
        {hover !== null && points[hover] && <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 shadow">{points[hover].label}: <b>{fmt(points[hover].value)}</b>{points[hover].hint && <span className="text-slate-400"> · {points[hover].hint}</span>}</div>}
      </div>
    </Frame>
  );
}

/** เส้น series เดียว (เช่น ผู้ติดตาม) — จุด ≥ 8px, crosshair + tooltip, ช่วงที่ไม่มีข้อมูลเว้นเส้น */
export function Line({ title, unit, points, color, note, height = 140 }: { title: string; unit?: string; points: Point[]; color: string; note?: string; height?: number }) {
  const [table, setTable] = useState(false); const [hover, setHover] = useState<number | null>(null); const id = useId();
  const W = 600; const pad = { l: 8, r: 8, t: 14, b: 22 }; const n = Math.max(2, points.length);
  const vals = points.map(p => p.value).filter((v): v is number => v !== null); const max = Math.max(1, ...vals); const min = vals.length ? Math.min(...vals) : 0; const span = Math.max(1, max - min);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (n - 1); const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - (v - min) / span);
  const segs: string[] = []; let cur = '';
  points.forEach((p, i) => { if (p.value === null) { if (cur) segs.push(cur); cur = ''; return; } cur += `${cur ? 'L' : 'M'}${x(i)},${y(p.value)}`; }); if (cur) segs.push(cur);
  return (
    <Frame title={title} unit={unit} points={points} table={table} note={note}>
      <div className="relative">
        <button onClick={() => setTable(v => !v)} className="absolute right-0 -top-6 text-[11px] text-slate-500 hover:text-slate-300">{table ? 'กราฟ' : 'ตาราง'}</button>
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-labelledby={id} onMouseLeave={() => setHover(null)}>
          <title id={id}>{title}</title>
          {[0, 0.5, 1].map(f => <line key={f} x1={pad.l} x2={W - pad.r} y1={y(min + span * f)} y2={y(min + span * f)} stroke="#1e293b" strokeWidth={1} />)}
          <text x={pad.l} y={pad.t - 3} fontSize={10} fill="#64748b">{fmt(max)}</text><text x={pad.l} y={height - pad.b + 10} fontSize={10} fill="#64748b">{fmt(min)}</text>
          {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />)}
          {points.map((p, i) => <g key={p.label} onMouseEnter={() => setHover(i)}><rect x={x(i) - (W / n) / 2} y={0} width={W / n} height={height} fill="transparent" />{p.value !== null && <circle cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} fill={color} stroke="#0f172a" strokeWidth={2} />}</g>)}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="#475569" strokeDasharray="3 3" />}
          {[0, n - 1].map(i => points[i] && <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : 'end'} fontSize={10} fill="#64748b">{points[i]!.label}</text>)}
        </svg>
        {hover !== null && points[hover] && <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 shadow">{points[hover].label}: <b>{fmt(points[hover].value)}</b></div>}
      </div>
    </Frame>
  );
}
