'use client';
/**
 * ChatGPT หลายหัวข้อ (docs/CONTENT_IMPORT.md) — ① สร้างคำสั่งตามที่กำหนด → ② วางผลจาก ChatGPT → ③ แนบรูป + ตั้งเวลารายหัวข้อ → นำเข้า + อนุมัติ + ตั้งเวลาในคลิกเดียว
 * ทุกหัวข้อยังผ่านตัวตรวจเดิม (ที่มา/ซ้ำ/[ต้องยืนยัน]) และโพสต์ตามคิวทีละโพสต์เหมือนงานตั้งเวลาปกติ
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUpload, type ContentImportRow, type ImportReport, type PageRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { Button, ErrorBox, Field, Input, Pill, Select, Textarea } from '@/components/ui';

const KINDS = ['original', 'news', 'mixed'] as const;
const LENGTHS = ['short', 'medium', 'long'] as const;
const IMAGES = ['chatgpt', 'stock', 'own'] as const;
const FALLBACKS = ['stock', 'ai', 'none'] as const;
const GAPS = [24, 48, 12, 6, 3] as const;
const tone = (s: string) => (s === 'PASS' ? 'ok' : s === 'FAIL' ? 'bad' : 'warn') as 'ok' | 'bad' | 'warn';
const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tomorrowAt = (h: number) => { const d = new Date(Date.now() + 86_400_000); d.setHours(h, 0, 0, 0); return toLocal(d); };

type Row = { include: boolean; when: string; image?: { id: string; name: string; preview: string }; result?: string; ok?: boolean };

export function ChatGptBatch({ base, brandId, pages, canWrite, canSchedule, onDone }: { base: string; brandId: string; pages: PageRow[]; canWrite: boolean; canSchedule: boolean; onDone: () => void }) {
  const [f, setF] = useState({ pageId: pages.length === 1 ? pages[0]!.id : '', count: 5, topic: '', kind: 'original' as (typeof KINDS)[number], length: 'medium' as (typeof LENGTHS)[number], emoji: true, images: 'chatgpt' as (typeof IMAGES)[number], recencyDays: 0, extra: '' });
  const [prompt, setPrompt] = useState('');
  const [text, setText] = useState(''); const [report, setReport] = useState<ImportReport | null>(null); const [rows, setRows] = useState<Row[]>([]);
  const [spread, setSpread] = useState({ start: tomorrowAt(9), gap: 24 as (typeof GAPS)[number] });
  const [photoOnly, setPhotoOnly] = useState(true); const [fallback, setFallback] = useState<(typeof FALLBACKS)[number]>('stock');
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach(u => URL.revokeObjectURL(u)), []);
  const run = async (k: string, fn: () => Promise<string | void>) => { setBusy(k); setError(null); setNotice(''); try { const n = await fn(); if (n) setNotice(n); } catch (e) { setError(e); } finally { setBusy(''); } };
  const url = `${base}/brands/${brandId}/news/import`;

  const makePrompt = () => run('prompt', async () => {
    const r = await api<{ prompt: string }>(`${url}/chat-prompt`, { method: 'POST', body: { ...(f.pageId && { pageId: f.pageId }), count: f.count, topic: f.topic || undefined, kind: f.kind, length: f.length, emoji: f.emoji, images: f.images, ...(f.recencyDays && { recencyDays: f.recencyDays }), extra: f.extra || undefined } });
    setPrompt(r.prompt);
    try { await navigator.clipboard.writeText(r.prompt); return t('gpt.copied'); } catch { return t('gpt.copyManual'); }
  });
  const spreadTimes = (list: Row[], start = spread.start, gap = spread.gap) => {
    const s = new Date(start); let i = 0;
    return list.map(r => r.include ? { ...r, when: toLocal(new Date(s.getTime() + (i++) * gap * 3_600_000)) } : r);
  };
  const check = () => run('check', async () => {
    const rep = await api<ImportReport>(`${url}/check`, { method: 'POST', body: { text, ...(f.pageId && { pageId: f.pageId }) } });
    setReport(rep);
    setRows(spreadTimes(rep.posts.map(p => ({ include: p.status !== 'FAIL', when: '' }))));
    if (!rep.parseError) return `${t('gpt.found')} ${rep.posts.length} ${t('gpt.topics')}`;
  });
  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickImage = (i: number, file: File | undefined) => file && run(`img:${i}`, async () => {
    const up = await apiUpload<{ id: string }>(`${base}/news/import/files?name=${encodeURIComponent(file.name)}`, file);
    const old = rows[i]?.image; if (old) URL.revokeObjectURL(old.preview);
    const preview = URL.createObjectURL(file); previews.current.push(preview);
    setRow(i, { image: { id: up.id, name: file.name, preview } });
  });
  const copy = (s: string) => run('copy', async () => { await navigator.clipboard.writeText(s); return t('gpt.copied'); });

  const chosen = useMemo(() => rows.map((r, i) => ({ r, i })).filter(x => x.r.include && report?.posts[x.i]?.status !== 'FAIL'), [rows, report]);
  const submit = () => run('import', async () => {
    const postImages = Object.fromEntries(chosen.filter(x => x.r.image).map(x => [String(x.i), x.r.image!.id]));
    const imp = await api<ContentImportRow>(url, { method: 'POST', body: { text, ...(f.pageId && { pageId: f.pageId }), postImages, include: chosen.map(x => x.i), cardMode: photoOnly ? 'photo' : 'auto', imageFallback: fallback } });
    let scheduled = 0; const next = [...rows];
    for (const [j, p] of imp.report.posts.entries()) {
      const { i, r } = chosen[j]!;
      const id = p.result?.contentId;
      if (!id) { next[i] = { ...r, ok: false, result: p.result?.error ?? p.checks.find(c => c.level === 'error')?.message ?? t('gpt.notImported') }; continue; }
      if (!canSchedule || !r.when) { next[i] = { ...r, ok: true, result: t('gpt.drafted') }; continue; }
      try { await api(`${base}/content/${id}/approve-schedule`, { method: 'POST', body: { scheduledLocal: r.when } }); scheduled++; next[i] = { ...r, ok: true, result: `${t('gpt.scheduled')} ${new Date(r.when).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}` }; }
      catch (e) { next[i] = { ...r, ok: false, result: `${t('gpt.draftedNotScheduled')}: ${(e as Error).message}` }; }
    }
    setRows(next.map(r => ({ ...r, include: false })));
    if (imp.draftCount) onDone();
    return `${t('gpt.imported')} ${imp.draftCount}/${chosen.length} · ${t('gpt.scheduled')} ${scheduled}`;
  });

  const L = (k: string) => t(k as MessageKey);
  return (
    <div className="mt-3 space-y-4">
      {/* ① สร้างคำสั่ง */}
      <section className="space-y-2 rounded-lg border border-slate-800 p-3">
        <h3 className="font-semibold">① {t('gpt.step1')}</h3>
        <div className="grid gap-2 md:grid-cols-4">
          <Field label={t('imp.defaultPage')}><Select value={f.pageId} onChange={e => setF({ ...f, pageId: e.target.value })}><option value="">—</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label={t('gpt.count')}><Input type="number" min={1} max={20} value={f.count} onChange={e => setF({ ...f, count: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
          <Field label={t('gpt.kind')}><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as typeof f.kind })}>{KINDS.map(k => <option key={k} value={k}>{L(`gpt.kind.${k}`)}</option>)}</Select></Field>
          <Field label={t('gpt.length')}><Select value={f.length} onChange={e => setF({ ...f, length: e.target.value as typeof f.length })}>{LENGTHS.map(k => <option key={k} value={k}>{L(`gpt.length.${k}`)}</option>)}</Select></Field>
        </div>
        <Field label={t('gpt.topic')} hint={t('gpt.topicHint')}><Textarea className="min-h-16" value={f.topic} maxLength={1000} placeholder={t('gpt.topicPlaceholder')} onChange={e => setF({ ...f, topic: e.target.value })} /></Field>
        <div className="grid gap-2 md:grid-cols-3">
          <Field label={t('gpt.images')}><Select value={f.images} onChange={e => setF({ ...f, images: e.target.value as typeof f.images })}>{IMAGES.map(k => <option key={k} value={k}>{L(`gpt.images.${k}`)}</option>)}</Select></Field>
          <Field label={t('gpt.recency')}><Select value={f.recencyDays} onChange={e => setF({ ...f, recencyDays: Number(e.target.value) })}>{[0, 7, 30, 90].map(d => <option key={d} value={d}>{d ? `${d} ${t('gpt.days')}` : t('gpt.anyTime')}</option>)}</Select></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.emoji} onChange={e => setF({ ...f, emoji: e.target.checked })} /> {t('gpt.emoji')}</label>
        </div>
        <Field label={t('gpt.extra')}><Input value={f.extra} maxLength={1000} placeholder={t('gpt.extraPlaceholder')} onChange={e => setF({ ...f, extra: e.target.value })} /></Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!!busy} onClick={makePrompt}>{busy === 'prompt' ? '…' : `🧩 ${t('gpt.makePrompt')}`}</Button>
          <a href="https://chatgpt.com/" target="_blank" rel="noreferrer" className="text-sm text-sky-500 hover:underline">{t('gpt.openChatGpt')} ↗</a>
        </div>
        {prompt && <details className="text-xs"><summary className="cursor-pointer text-sky-400">{t('gpt.showPrompt')}</summary><textarea readOnly className="mt-1 h-48 w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px]" value={prompt} onFocus={e => e.currentTarget.select()} /></details>}
        <p className="text-xs text-slate-400">{t('gpt.step1Help')}</p>
      </section>

      {/* ② วางผลลัพธ์ */}
      <section className="space-y-2 rounded-lg border border-slate-800 p-3">
        <h3 className="font-semibold">② {t('gpt.step2')}</h3>
        <textarea className="h-36 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-xs" placeholder={t('gpt.pasteHere')} value={text} onChange={e => { setText(e.target.value); setReport(null); setRows([]); }} />
        <Button variant="ghost" disabled={!text.trim() || !!busy} onClick={check}>{busy === 'check' ? '…' : t('gpt.split')}</Button>
        {report?.parseError && <p className="rounded border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{report.parseError}</p>}
      </section>

      {/* ③ รูป + เวลา รายหัวข้อ */}
      {report && !report.parseError && (
        <section className="space-y-3 rounded-lg border border-slate-800 p-3">
          <h3 className="font-semibold">③ {t('gpt.step3')}</h3>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <Field label={t('gpt.firstPost')}><Input type="datetime-local" value={spread.start} onChange={e => setSpread({ ...spread, start: e.target.value })} /></Field>
            <Field label={t('gpt.gap')}><Select value={spread.gap} onChange={e => setSpread({ ...spread, gap: Number(e.target.value) as typeof spread.gap })}>{GAPS.map(g => <option key={g} value={g}>{L(`gpt.gap.${g}`)}</option>)}</Select></Field>
            <Button variant="ghost" onClick={() => setRows(rs => spreadTimes(rs))}>{t('gpt.spread')}</Button>
          </div>
          <ul className="space-y-3">{report.posts.map((p, i) => {
            const r = rows[i]; if (!r) return null; const post = p.post;
            return (
              <li key={p.index} className={`rounded-lg border p-3 text-sm ${r.ok === true ? 'border-emerald-800' : r.ok === false ? 'border-rose-800' : 'border-slate-800'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" aria-label={`${t('gpt.includeTopic')} ${i + 1}`} checked={r.include} disabled={p.status === 'FAIL' || r.ok !== undefined} onChange={e => setRow(i, { include: e.target.checked })} />
                  <Pill tone={tone(p.status)}>{t(`imp.status.${p.status}` as MessageKey)}</Pill>
                  <span className="font-medium">{i + 1}. {p.title}</span>
                </div>
                {p.checks.filter(c => c.level !== 'info').map((c, k) => <div key={k} className={`text-xs ${c.level === 'error' ? 'text-rose-400' : 'text-amber-500'}`}>{c.level === 'error' ? '✖' : '⚠'} {c.message}</div>)}
                {post && <details className="mt-1"><summary className="cursor-pointer text-xs text-sky-400">{t('gpt.preview')}</summary><p className="mt-1 whitespace-pre-wrap rounded bg-slate-950 p-2 text-sm">{post.caption}{post.hashtags.length ? `\n\n${post.hashtags.map(h => `#${h}`).join(' ')}` : ''}</p></details>}
                <div className="mt-2 grid gap-2 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <div className="flex items-center gap-2">
                    {r.image ? <img src={r.image.preview} alt="" className="h-16 w-16 rounded object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-slate-700 text-[10px] text-slate-500">{t('gpt.noImage')}</div>}
                    <label className={`cursor-pointer rounded-md border border-slate-700 px-2 py-1 text-xs ${r.ok !== undefined || !canWrite ? 'pointer-events-none opacity-50' : 'hover:border-sky-500'}`}>{busy === `img:${i}` ? '…' : r.image ? t('gpt.changeImage') : `🖼️ ${t('gpt.uploadImage')}`}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => pickImage(i, e.target.files?.[0])} /></label>
                    {post?.imagePrompt && <button type="button" className="text-xs text-sky-500 hover:underline" onClick={() => copy(post.imagePrompt!)}>📋 {t('gpt.copyImagePrompt')}</button>}
                  </div>
                  <div />
                  {canSchedule && <Input type="datetime-local" aria-label={`${t('gpt.time')} ${i + 1}`} value={r.when} disabled={!r.include || r.ok !== undefined} onChange={e => setRow(i, { when: e.target.value })} />}
                </div>
                {r.result && <p className={`mt-2 text-xs ${r.ok ? 'text-emerald-500' : 'text-rose-400'}`}>{r.ok ? '✔' : '✖'} {r.result}</p>}
              </li>
            );
          })}</ul>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={photoOnly} onChange={e => setPhotoOnly(e.target.checked)} /> {t('gpt.photoOnly')}</label>
            <label className="flex items-center gap-2">{t('gpt.fallback')} <Select className="w-auto" value={fallback} onChange={e => setFallback(e.target.value as typeof fallback)}>{FALLBACKS.map(x => <option key={x} value={x}>{t(`news.img.${x}` as MessageKey)}</option>)}</Select></label>
          </div>
          {canWrite && <Button disabled={!!busy || chosen.length === 0} onClick={submit}>{busy === 'import' ? '…' : `${canSchedule ? t('gpt.importSchedule') : t('gpt.importOnly')} (${chosen.length})`}</Button>}
          <p className="text-xs text-slate-400">{canSchedule ? t('gpt.step3Help') : t('gpt.noSchedulePermission')}</p>
        </section>
      )}
      {notice && <p className="text-sm text-emerald-500">✔ {notice}</p>}
      <ErrorBox error={error} />
    </div>
  );
}
