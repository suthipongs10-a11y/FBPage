'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type ReportDetail, type YtReportDetail } from '@/lib/api';

type Shared = { kind: 'facebook' | 'youtube'; id: string; label: string; brand: string; client: string; createdAt: string; expiresAt: string | null; data: ReportDetail['data'] | YtReportDetail['data'] };
const na = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? 'ไม่มีข้อมูล' : `${Math.round(v * 10) / 10}${unit}`);

/** หน้ารายงานสำหรับลูกค้า — อ่านอย่างเดียว ไม่ต้องล็อกอิน (token ในลิงก์มีวันหมดอายุ) */
export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>();
  const [r, setR] = useState<Shared | null>(null); const [error, setError] = useState('');
  useEffect(() => { api<Shared>(`/share/reports/${token}`).then(setR).catch(e => setError((e as Error).message)); }, [token]);
  if (error) return <main className="mx-auto mt-16 max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-rose-300">{error}</main>;
  if (!r) return <main className="p-8 text-sm text-slate-500">กำลังโหลด…</main>;
  const fb = r.kind === 'facebook' ? (r.data as ReportDetail['data']) : null; const yt = r.kind === 'youtube' ? (r.data as YtReportDetail['data']) : null;
  const summary = r.data.summary; const limits = r.data.dataLimitations;
  const Kpi = ({ v, l }: { v: string | number; l: string }) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-xl font-bold">{v}</div><div className="text-xs text-slate-400">{l}</div></div>;
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{fb ? `รายงานเพจ ${fb.page.name}` : `รายงานช่อง YouTube ${yt!.channel.title}`}</h1><p className="text-sm text-slate-400">{r.client} · {r.brand} · ช่วง {r.label} · สร้าง {new Date(r.createdAt).toLocaleDateString('th-TH', { dateStyle: 'medium' })}{r.expiresAt && ` · ลิงก์ใช้ได้ถึง ${new Date(r.expiresAt).toLocaleDateString('th-TH', { dateStyle: 'medium' })}`}</p></div>
        <a className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500" href={`/api/share/reports/${token}/pdf`} target="_blank" rel="noreferrer">ดาวน์โหลด PDF</a>
      </div>
      {fb && <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Kpi v={na(fb.page.followers)} l="ผู้ติดตาม" /><Kpi v={`${fb.publishing.posts} (ก่อน ${fb.publishing.postsPrevPeriod})`} l="โพสต์" /><Kpi v={fb.publishing.perWeek} l="ต่อสัปดาห์" /><Kpi v={na(fb.engagement.sharesTotal)} l="แชร์รวม" /><Kpi v={`${fb.page.completeness}%`} l="ข้อมูลเพจครบ" /></div>}
      {yt && <div className="grid grid-cols-2 gap-3 sm:grid-cols-6"><Kpi v={na(yt.channel.subscribers)} l="ผู้ติดตาม" /><Kpi v={`${yt.publishing.videos} (ก่อน ${yt.publishing.videosPrevPeriod})`} l="วิดีโอ" /><Kpi v={na(yt.channelMetrics.views)} l="วิว" /><Kpi v={na(yt.channelMetrics.watchMinutes)} l="watch time (นาที)" /><Kpi v={na(yt.channelMetrics.subscribersGained)} l="ผู้ติดตามที่ได้" /><Kpi v={na(yt.channelMetrics.revenueUsd)} l="รายได้ (USD)" /></div>}
      {summary && <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="mb-2 font-semibold">สรุปผู้บริหาร</h2><p className="text-sm">{summary.executiveSummary}</p><div className="mt-3 grid gap-3 text-xs md:grid-cols-3">{([['เกิดอะไรขึ้น', summary.whatHappened], ['ทำไม', summary.whyItHappened], ['ควรทำซ้ำ', summary.repeat], ['ควรหยุด', summary.stop], ['ควรทดลอง', summary.experiments], ['เดือนหน้าเน้น', summary.nextMonthFocus]] as [string, string[]][]).filter(([, xs]) => xs.length).map(([h, xs]) => <div key={h}><div className="font-semibold text-slate-300">{h}</div><ul className="list-disc pl-4">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}</div></section>}
      {fb && fb.topPosts.length > 0 && <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="mb-2 font-semibold">โพสต์เด่น</h2><ul className="space-y-1 text-sm">{fb.topPosts.map(p => <li key={p.facebookPostId} className="flex justify-between gap-2"><span>{p.message.slice(0, 100)}</span><span className="text-xs text-slate-400">แชร์ {na(p.shares)}</span></li>)}</ul></section>}
      {yt && yt.topVideos.length > 0 && <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h2 className="mb-2 font-semibold">วิดีโอเด่น</h2><ul className="space-y-1 text-sm">{yt.topVideos.map(v => <li key={v.youtubeVideoId} className="flex justify-between gap-2"><span>{v.title}</span><span className="text-xs text-slate-400">วิว {na(v.views)} · AVD {na(v.avgViewDuration, ' วิ')}</span></li>)}</ul></section>}
      <details className="text-sm text-slate-400"><summary className="cursor-pointer">รายงานฉบับข้อความ</summary><pre className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">{r.data.text}</pre></details>
      {limits.length > 0 && <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200"><ul className="list-disc pl-4">{limits.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      <p className="text-xs text-slate-600">ตัวเลขทั้งหมดมาจาก API ทางการตามสิทธิ์ที่ได้รับ · ค่าที่อ่านไม่ได้แสดงเป็น "ไม่มีข้อมูล" ไม่ใช่ 0</p>
    </main>
  );
}
