'use client';
import { useCallback, useEffect, useState } from 'react';
import { YT_CONTENT_STATUSES } from '@fbpm/shared';
import { api, type BrandInsight, type PageRow, type YtChannel, type YtContent } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select, Textarea } from '@/components/ui';

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const tone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (['PUBLISHED', 'SCHEDULED', 'APPROVED', 'ANALYZED'].includes(s) ? 'ok' : ['READY_FOR_APPROVAL', 'AI_REVIEW', 'UPLOAD_PENDING', 'UPLOADING', 'PROCESSING'].includes(s) ? 'warn' : ['REJECTED', 'UPLOAD_FAILED', 'PROCESSING_FAILED', 'PUBLISH_FAILED', 'CANCELLED'].includes(s) ? 'bad' : 'muted');
const GROUPS: { label: string; statuses: string[] }[] = [
  { label: 'ไอเดีย / เขียน', statuses: ['IDEA', 'RESEARCH', 'OUTLINE', 'SCRIPT', 'PRODUCTION'] },
  { label: 'แพ็กเกจ / ตรวจ', statuses: ['VIDEO_READY', 'METADATA_READY', 'THUMBNAIL_READY', 'AI_REVIEW', 'READY_FOR_APPROVAL', 'REJECTED'] },
  { label: 'อนุมัติ / อัปโหลด', statuses: ['APPROVED', 'UPLOAD_PENDING', 'UPLOADING', 'UPLOAD_FAILED', 'PROCESSING', 'PROCESSING_FAILED'] },
  { label: 'เผยแพร่แล้ว', statuses: ['SCHEDULED', 'PUBLISHED', 'PUBLISH_FAILED', 'ANALYTICS_PENDING', 'ANALYZED'] },
];
const tri = (v: boolean | null | undefined) => (v === null || v === undefined ? '' : v ? '1' : '0');

export default function YtContentLabPage() {
  const { ws, can } = useWorkspace();
  const [channels, setChannels] = useState<YtChannel[] | null>(null); const [items, setItems] = useState<YtContent[] | null>(null); const [insights, setInsights] = useState<BrandInsight[]>([]); const [pages, setPages] = useState<PageRow[]>([]);
  const [channelId, setChannelId] = useState(''); const [ideaForm, setIdeaForm] = useState({ count: 3, objective: '' }); const [manual, setManual] = useState({ title: '', format: 'LONG_FORM', objective: '' });
  const [sel, setSel] = useState<YtContent | null>(null); const [meta, setMeta] = useState<Record<string, string>>({}); const [files, setFiles] = useState<{ video?: File; thumbnail?: File }>({}); const [targetPage, setTargetPage] = useState(''); const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(); if (channelId) q.set('channelId', channelId);
      const [c, i, ins, p] = await Promise.all([api<YtChannel[]>(`/workspaces/${ws.id}/youtube/channels`), api<YtContent[]>(`/workspaces/${ws.id}/youtube/content?${q}`), api<BrandInsight[]>(`/workspaces/${ws.id}/youtube/insights`), api<PageRow[]>(`/workspaces/${ws.id}/pages`)]);
      const active = c.filter(x => !x.disconnectedAt); setChannels(active); setItems(i); setInsights(ins); setPages(p.filter(x => !x.disconnectedAt));
      setChannelId(v => v || active[0]?.id || '');
      setSel(prev => (prev ? i.find(x => x.id === prev.id) ?? prev : prev));   // อัปเดตรายการที่เลือกโดยไม่ผูก dependency กับ sel (กัน loop)
    } catch (e) { setError(e); }
  }, [ws.id, channelId]);
  useEffect(() => { void load(); }, [load]);
  const pick = (c: YtContent) => { setSel(c); const m = c.youtubeMeta; setMeta({ title: m?.title ?? '', description: m?.description ?? '', tags: m?.tags.join(', ') ?? '', privacyStatus: m?.privacyStatus ?? 'private', madeForKids: tri(m?.madeForKids), syntheticMedia: tri(m?.syntheticMedia), paidPlacement: tri(m?.paidPlacement), scheduledPublishAt: m?.scheduledPublishAt ? new Date(m.scheduledPublishAt).toISOString().slice(0, 16) : '', hook: m?.hook ?? '', script: m?.script ?? '' }); setFiles({}); setComment(''); };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const post = <T,>(path: string, body: unknown = {}) => api<T>(`/workspaces/${ws.id}/youtube${path}`, { method: 'POST', body });
  const ideas = () => run('ideas', async () => { const r = await post<{ items: YtContent[] }>(`/channels/${channelId}/ideas`, { count: ideaForm.count, objective: ideaForm.objective || undefined }); setNotice(`${r.items.length} ${t('yts.IDEA')}`); });
  const create = () => run('create', async () => { const c = await post<YtContent>('/content', { channelId, title: manual.title, format: manual.format, objective: manual.objective || undefined }); setManual({ title: '', format: 'LONG_FORM', objective: '' }); pick(c); });
  const act = (c: YtContent, path: string, body: unknown = {}, key = path) => run(`${key}:${c.id}`, async () => { const r = await post<YtContent & { outcome?: { status: string; jobId?: string }; state?: string; content?: YtContent }>(`/content/${c.id}${path}`, body); const fresh = r.content ?? r; if (fresh?.id) pick(fresh); if (r.outcome) setNotice(`${t('yt.upload')}: ${r.outcome.status}`); if (r.state) setNotice(`${t('yt.checkProcessing')}: ${r.state}`); });
  const save = (c: YtContent) => run(`save:${c.id}`, async () => {
    const b = (k: string) => (meta[k] === '' ? undefined : meta[k] === '1');
    const r = await api<YtContent>(`/workspaces/${ws.id}/youtube/content/${c.id}`, { method: 'PATCH', body: { title: meta.title || undefined, description: meta.description || undefined, tags: meta.tags ? meta.tags.split(',').map(x => x.trim()).filter(Boolean) : undefined, privacyStatus: meta.privacyStatus, madeForKids: b('madeForKids'), syntheticMedia: b('syntheticMedia'), paidPlacement: b('paidPlacement'), scheduledPublishAt: meta.scheduledPublishAt ? new Date(meta.scheduledPublishAt).toISOString() : null, hook: meta.hook || undefined, script: meta.script || undefined } });
    pick(r); setNotice(t('common.saved' as MessageKey));
  });
  const upload = (c: YtContent, kind: 'video' | 'thumbnail') => run(`file:${kind}:${c.id}`, async () => {
    const f = files[kind]; if (!f) return;
    const res = await fetch(`/api/workspaces/${ws.id}/youtube/content/${c.id}/assets/${kind}`, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) }, body: f, credentials: 'same-origin' });
    if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? `HTTP ${res.status}`); }
    setNotice(`${t('yt.attach')} ✔ ${f.name}`); setFiles(v => ({ ...v, [kind]: undefined }));
  });
  const repurpose = (c: YtContent) => run(`rp:${c.id}`, async () => { const r = await post<{ created: unknown[] }>(`/content/${c.id}/repurpose`, { targetPageId: targetPage, count: 3 }); setNotice(`${t('yt.repurpose')}: ${r.created.length}`); });
  const insightStatus = (id: string, status: string) => run(`ins:${id}`, async () => { await api(`/workspaces/${ws.id}/youtube/insights/${id}`, { method: 'PATCH', body: { status } }); });
  if (!channels || !items) return <div><ErrorBox error={error} /><Loading /></div>;
  const cCreate = can('youtube.content.create'); const cEdit = can('youtube.content.edit'); const cApprove = can('youtube.content.approve'); const cUpload = can('youtube.upload'); const cAi = can('ai.use');
  const s = sel?.ytStatus ?? ''; const m = sel?.youtubeMeta; const ch = channels.find(c => c.id === sel?.youtubeChannelId);
  const ytLink = sel?.externalPostId ? `https://www.youtube.com/watch?v=${sel.externalPostId}` : null;
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('yt.labTitle')}</h1><p className="text-sm text-slate-400">{t('yt.labSubtitle')}</p></div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />
      {channels.length === 0 ? <Empty text={t('yt.noChannels')} /> : (
        <Card>
          <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_auto]">
            <Field label={t('yt.channel')}><Select value={channelId} onChange={e => { setChannelId(e.target.value); setSel(null); }}>{channels.map(c => <option key={c.id} value={c.id}>{c.title} · {c.brand.name}</option>)}</Select></Field>
            <Field label={t('yt.ideasCount')}><Input type="number" min={1} max={10} className="w-20" value={ideaForm.count} onChange={e => setIdeaForm(f => ({ ...f, count: Number(e.target.value) }))} /></Field>
            <Field label={t('yt.objective')}><Input value={ideaForm.objective} onChange={e => setIdeaForm(f => ({ ...f, objective: e.target.value }))} placeholder="เช่น ตอบคำถามที่ผู้ชมถามซ้ำ" /></Field>
            <div className="flex items-end">{cCreate && cAi && <Button disabled={busy === 'ideas' || !channelId} onClick={ideas}>{busy === 'ideas' ? t('common.loading') : t('yt.ideas')}</Button>}</div>
            <div className="flex items-end"><details><summary className="cursor-pointer rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">{t('yt.newIdea')}</summary></details></div>
          </div>
          {cCreate && <div className="mt-2 grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]"><Input placeholder={t('content.titleField')} value={manual.title} onChange={e => setManual(f => ({ ...f, title: e.target.value }))} /><Select value={manual.format} onChange={e => setManual(f => ({ ...f, format: e.target.value }))}>{['LONG_FORM', 'SHORT', 'LIVE'].map(x => <option key={x} value={x}>{t(`ytf.${x}` as MessageKey)}</option>)}</Select><Input placeholder={t('yt.objective')} value={manual.objective} onChange={e => setManual(f => ({ ...f, objective: e.target.value }))} /><Button variant="ghost" disabled={busy === 'create' || !manual.title} onClick={create}>{t('yt.newIdea')}</Button></div>}
        </Card>)}
      <div className="grid gap-3 lg:grid-cols-[1fr_520px]">
        <div className="space-y-3">
          {items.length === 0 ? <Empty text={t('yt.noContent')} /> : GROUPS.map(g => { const list = items.filter(i => g.statuses.includes(i.ytStatus)); if (!list.length) return null; return (
            <div key={g.label}><div className="mb-1 text-xs font-semibold text-slate-400">{g.label} ({list.length})</div><div className="space-y-1">{list.map(c => (
              <button key={c.id} onClick={() => pick(c)} className={`block w-full rounded-lg border p-2 text-left text-sm ${sel?.id === c.id ? 'border-sky-600 bg-slate-900' : 'border-slate-800 hover:bg-slate-900'}`}>
                <div className="flex flex-wrap items-center gap-2"><Pill tone={tone(c.ytStatus)}>{t(`yts.${c.ytStatus}` as MessageKey)}</Pill><Pill tone="muted">{t(`ytf.${c.youtubeMeta?.format ?? 'LONG_FORM'}` as MessageKey)}</Pill><span className="font-medium">{c.youtubeMeta?.title || c.title || '(ไม่มีชื่อ)'}</span></div>
                <div className="mt-0.5 text-xs text-slate-500">{c.youtubeChannel.title} · {c.contentPillar ?? '—'}{c.aiProvider && ` · AI ${c.aiModel}`} · {fmt(c.updatedAt)}{c.lastError && <span className="text-rose-300"> · {c.lastError.slice(0, 80)}</span>}</div>
              </button>))}</div></div>); })}
          {insights.length > 0 && <Card title={t('yt.insights')}><div className="space-y-2 text-sm">{insights.map(i => <div key={i.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-800 p-2"><div><div className="font-medium"><Pill tone="muted">{i.type}</Pill> {i.title} <span className="text-xs text-slate-500">{i.platforms.join(' + ')}</span></div><div className="text-xs text-slate-400">{i.observation}{i.recommendation && ` → ${i.recommendation}`}</div></div>{cEdit && <div className="flex gap-1"><Button variant="ghost" onClick={() => insightStatus(i.id, 'APPLIED')}>{t('yt.recDone')}</Button><Button variant="ghost" onClick={() => insightStatus(i.id, 'DISMISSED')}>{t('yt.recIgnore')}</Button></div>}</div>)}</div></Card>}
        </div>
        <div>{sel && m && (
          <Card title={m.title || sel.title || '(ไม่มีชื่อ)'} actions={<div className="flex items-center gap-2"><Pill tone={tone(s)}>{t(`yts.${s}` as MessageKey)}</Pill>{ytLink && <a href={ytLink} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">{t('yt.openYt')}</a>}</div>}>
            <div className="space-y-3 text-sm">
              <div className="text-xs text-slate-500">{sel.youtubeChannel.title} · {sel.objective ?? '—'} · {sel.contentPillar ?? '—'}{ch?.uploadsPaused && <span className="text-rose-300"> · {t('yt.uploadsPaused')}</span>}</div>
              {sel.aiNotes && <details className="text-xs"><summary className="cursor-pointer text-slate-400">AI notes</summary><pre className="whitespace-pre-wrap text-slate-400">{JSON.stringify(sel.aiNotes, null, 1).slice(0, 1500)}</pre></details>}
              {/* ---- AI agents ---- */}
              {cEdit && cAi && ['IDEA', 'RESEARCH', 'OUTLINE', 'SCRIPT', 'PRODUCTION', 'VIDEO_READY', 'METADATA_READY', 'THUMBNAIL_READY', 'REJECTED'].includes(s) && <div className="flex flex-wrap gap-1">
                <Button variant="ghost" disabled={busy.startsWith('/script')} onClick={() => act(sel, '/script', { targetDurationSec: m.targetDurationSec ?? undefined })}>{t('yt.script')}</Button>
                <Button variant="ghost" disabled={busy.startsWith('/titles')} onClick={() => act(sel, '/titles', { count: 5 })}>{t('yt.titles')}</Button>
                <Button variant="ghost" disabled={busy.startsWith('/thumbnail-brief')} onClick={() => act(sel, '/thumbnail-brief')}>{t('yt.thumbBrief')}</Button>
                <Button variant="ghost" disabled={busy.startsWith('/metadata')} onClick={() => act(sel, '/metadata')}>{t('yt.metadata')}</Button>
              </div>}
              {m.titleCandidates && m.titleCandidates.length > 0 && <div><div className="text-xs text-slate-400">{t('yt.titleCandidates')}</div><div className="space-y-1">{m.titleCandidates.map((c, i) => <div key={i} className="flex items-center justify-between gap-2 rounded border border-slate-800 p-1 text-xs"><span>{c.title} <span className="text-slate-500">· {c.angle} · risk {c.risk}</span></span>{cEdit && <button className="text-sky-400 hover:underline" onClick={() => setMeta(v => ({ ...v, title: c.title }))}>{t('yt.useTitle')}</button>}</div>)}</div></div>}
              {m.outline && m.outline.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-slate-400">{t('yt.outline')} ({m.outline.length})</summary><ol className="list-decimal pl-4">{m.outline.map((o, i) => <li key={i}><b>{o.section}</b> {o.durationSec ? `(${o.durationSec}s)` : ''} — {o.points.join(' · ')}</li>)}</ol></details>}
              {m.thumbnailBrief && <details className="text-xs"><summary className="cursor-pointer text-slate-400">{t('yt.thumbBrief')}</summary><pre className="whitespace-pre-wrap text-slate-400">{JSON.stringify(m.thumbnailBrief, null, 1).slice(0, 1500)}</pre></details>}
              {/* ---- metadata + policy (human) ---- */}
              <div className="space-y-2 rounded-lg border border-slate-800 p-2">
                <Field label={t('content.titleField')}><Input maxLength={100} value={meta.title} onChange={e => setMeta(v => ({ ...v, title: e.target.value }))} disabled={!cEdit} /></Field>
                <Field label={t('yt.hook')}><Input value={meta.hook} onChange={e => setMeta(v => ({ ...v, hook: e.target.value }))} disabled={!cEdit} /></Field>
                <Field label={t('yt.description')}><Textarea className="min-h-24" value={meta.description} onChange={e => setMeta(v => ({ ...v, description: e.target.value }))} disabled={!cEdit} /></Field>
                <Field label={t('yt.tags')}><Input value={meta.tags} onChange={e => setMeta(v => ({ ...v, tags: e.target.value }))} disabled={!cEdit} /></Field>
                <details><summary className="cursor-pointer text-xs text-slate-400">{t('yt.script')}</summary><Textarea className="mt-1 min-h-40" value={meta.script} onChange={e => setMeta(v => ({ ...v, script: e.target.value }))} disabled={!cEdit} /></details>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label={t('yt.privacy')}><Select value={meta.privacyStatus} onChange={e => setMeta(v => ({ ...v, privacyStatus: e.target.value }))} disabled={!cEdit}><option value="private">private</option><option value="unlisted">unlisted</option><option value="public">public</option></Select></Field>
                  <Field label={t('yt.scheduleAt')}><Input type="datetime-local" value={meta.scheduledPublishAt} onChange={e => setMeta(v => ({ ...v, scheduledPublishAt: e.target.value }))} disabled={!cEdit} /></Field>
                </div>
                <p className="text-xs text-amber-300">{t('yt.policyHint')}</p>
                <div className="grid gap-2 sm:grid-cols-3">{(['madeForKids', 'syntheticMedia', 'paidPlacement'] as const).map(k => <Field key={k} label={t(`yt.${k}` as MessageKey)}><Select value={meta[k]} onChange={e => setMeta(v => ({ ...v, [k]: e.target.value }))} disabled={!cEdit}><option value="">{t('yt.notSet')}</option><option value="0">{t('yt.no')}</option><option value="1">{t('yt.yes')}</option></Select></Field>)}</div>
                {cEdit && <Button disabled={busy === `save:${sel.id}`} onClick={() => save(sel)}>{t('common.save')}</Button>}
              </div>
              {/* ---- assets ---- */}
              {cEdit && <div className="grid gap-2 rounded-lg border border-slate-800 p-2 sm:grid-cols-2">
                <Field label={`${t('yt.videoFile')} ${m.videoAssetId ? '✔' : ''}`}><div className="flex gap-1"><input type="file" accept="video/*" className="text-xs" onChange={e => setFiles(v => ({ ...v, video: e.target.files?.[0] }))} /><Button variant="ghost" disabled={!files.video || busy === `file:video:${sel.id}`} onClick={() => upload(sel, 'video')}>{t('yt.attach')}</Button></div></Field>
                <Field label={`${t('yt.thumbFile')} ${m.thumbnailAssetId ? '✔' : ''}`}><div className="flex gap-1"><input type="file" accept="image/jpeg,image/png,image/webp" className="text-xs" onChange={e => setFiles(v => ({ ...v, thumbnail: e.target.files?.[0] }))} /><Button variant="ghost" disabled={!files.thumbnail || busy === `file:thumbnail:${sel.id}`} onClick={() => upload(sel, 'thumbnail')}>{t('yt.attach')}</Button></div></Field>
              </div>}
              {/* ---- review / approval / upload ---- */}
              {sel.reviewResult && <div className={`rounded-lg border p-2 text-xs ${sel.reviewResult.result === 'PASS' ? 'border-emerald-900/60 text-emerald-200' : 'border-amber-900/60 text-amber-200'}`}><div className="font-semibold">{t('yt.reviewResult')}: {sel.reviewResult.result} — {sel.reviewResult.summary}</div><ul className="list-disc pl-4">{sel.reviewResult.issues.map((i, k) => <li key={k}>[{i.severity}] {i.detail}</li>)}</ul></div>}
              <div className="flex flex-wrap gap-1">
                {cEdit && ['SCRIPT', 'PRODUCTION', 'VIDEO_READY', 'METADATA_READY', 'THUMBNAIL_READY'].includes(s) && <Button disabled={busy.startsWith('/submit')} onClick={() => act(sel, '/submit')}>{t('yt.submit')}</Button>}
                {cApprove && s === 'READY_FOR_APPROVAL' && <><Input className="w-48" placeholder={t('content.comment')} value={comment} onChange={e => setComment(e.target.value)} /><Button disabled={busy.startsWith('/approve')} onClick={() => act(sel, '/approve', { comment: comment || undefined })}>{t('yt.approve')}</Button><Button variant="ghost" onClick={() => act(sel, '/request-changes', { comment: comment || undefined })}>{t('yt.requestChanges')}</Button><Button variant="danger" onClick={() => act(sel, '/reject', { comment: comment || undefined })}>{t('yt.reject')}</Button></>}
                {cUpload && ['APPROVED', 'UPLOAD_FAILED', 'PROCESSING_FAILED'].includes(s) && <><Button disabled={busy.startsWith('/upload') || ch?.uploadsPaused} onClick={() => act(sel, '/upload', { inline: false })}>{t('yt.uploadQueue')}</Button><Button variant="ghost" disabled={busy.startsWith('/upload') || ch?.uploadsPaused} onClick={() => act(sel, '/upload', { inline: true })}>{t('yt.upload')}</Button></>}
                {['PROCESSING', 'UPLOADING', 'UPLOAD_PENDING'].includes(s) && <Button variant="ghost" disabled={busy.startsWith('/check-processing')} onClick={() => act(sel, '/check-processing')}>{t('yt.checkProcessing')}</Button>}
                {cEdit && ['REJECTED', 'UPLOAD_FAILED', 'APPROVED'].includes(s) && <Button variant="ghost" onClick={() => act(sel, '/status', { to: 'METADATA_READY' }, '/status')}>{t('yts.METADATA_READY')}</Button>}
                {cEdit && !['PUBLISHED', 'SCHEDULED', 'CANCELLED', 'UPLOADING', 'PROCESSING'].includes(s) && <Button variant="ghost" onClick={() => act(sel, '/status', { to: 'CANCELLED' }, '/cancel')}>{t('common.cancel')}</Button>}
              </div>
              {sel.uploadOps[0] && <div className="text-xs text-slate-400">{t('yt.upload')}: {sel.uploadOps[0].status} · {Math.round(Number(sel.uploadOps[0].bytesSent) / 1048576)}/{sel.uploadOps[0].totalBytes ? Math.round(Number(sel.uploadOps[0].totalBytes) / 1048576) : '?'} MB{sel.uploadOps[0].error && <span className="text-rose-300"> · {sel.uploadOps[0].error}</span>}</div>}
              {sel.approvals.length > 0 && <div className="text-xs text-slate-500">{sel.approvals.map(a => <div key={a.id}>{a.status} · {a.requestedBy?.name} {fmt(a.requestedAt)}{a.reviewedBy && ` → ${a.reviewedBy.name} ${fmt(a.reviewedAt)}`}{a.reviewerComment && ` “${a.reviewerComment}”`}</div>)}</div>}
              {/* ---- cross-platform ---- */}
              {can('content.create') && cAi && pages.length > 0 && <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 p-2"><Field label={t('yt.targetPage')}><Select value={targetPage} onChange={e => setTargetPage(e.target.value)}><option value="">—</option>{pages.filter(p => p.brandId === sel.youtubeChannel.brand.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><Button variant="ghost" disabled={!targetPage || busy === `rp:${sel.id}`} onClick={() => repurpose(sel)}>{t('yt.repurpose')}</Button></div>}
              {(sel.relationsFrom.length > 0 || sel.relationsTo.length > 0) && <div className="text-xs text-slate-400">{t('yt.relations')}: {sel.relationsFrom.map(r => `${r.relationType} → ${r.child.platform} ${r.child.title ?? r.child.id.slice(0, 6)} (${r.child.status})`).concat(sel.relationsTo.map(r => `${r.relationType} ← ${r.parent.platform} ${r.parent.title ?? ''}`)).join(' · ')}</div>}
            </div>
          </Card>)}</div>
      </div>
      <p className="text-xs text-slate-600">{YT_CONTENT_STATUSES.length} states · AGENTS_YOUTUBE §55–61</p>
    </div>
  );
}
