'use client';
/**
 * โพสต์ชุมชน YouTube — YouTube ไม่มี API ให้โพสต์ (ปิดตั้งแต่ 2020) จึงให้ AI ร่าง → คนแก้ → คัดลอกไปโพสต์ในแท็บ "โพสต์" ของช่อง
 * ตั้งเวลาไว้ได้ ถึงเวลา worker แจ้งเตือน (ไม่โพสต์เอง)
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type YtChannel, type YtCommunityDraft, type YtVideo } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Pill, Select, Textarea } from '@/components/ui';
import { copyText, fullDate, timeAgo } from '@/lib/yt-comment';

const POLL_MAX = 5; const OPTION_MAX = 65;
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const postsUrl = (c: YtCommunityDraft['channel']) => `https://www.youtube.com/channel/${c.youtubeChannelId}/posts`;

export default function YtCommunityPage() {
  const { ws, can } = useWorkspace();
  const [channels, setChannels] = useState<YtChannel[] | null>(null); const [videos, setVideos] = useState<YtVideo[]>([]);
  const [drafts, setDrafts] = useState<YtCommunityDraft[] | null>(null); const [status, setStatus] = useState<'DRAFT' | 'POSTED'>('DRAFT');
  const [f, setF] = useState({ channelId: '', source: 'VIDEO' as 'VIDEO' | 'HIGHLIGHTS' | 'TEXT', videoId: '', text: '', kind: 'AUTO', count: 3, note: '' });
  const [manual, setManual] = useState({ open: false, kind: 'TEXT' as YtCommunityDraft['kind'], text: '', options: ['', ''] });
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const ch = (await api<YtChannel[]>(`/workspaces/${ws.id}/youtube/channels`)).filter(c => !c.disconnectedAt); setChannels(ch);
      const cid = f.channelId || ch[0]?.id || ''; if (!f.channelId && cid) setF(v => ({ ...v, channelId: cid }));
      if (cid) {
        const [d, v] = await Promise.all([api<YtCommunityDraft[]>(`/workspaces/${ws.id}/youtube/community?channelId=${cid}&status=${status}`), api<YtVideo[]>(`/workspaces/${ws.id}/youtube/videos?channelId=${cid}&limit=30`)]);
        setDrafts(d); setVideos(v);
      } else setDrafts([]);
    } catch (e) { setError(e); }
  }, [ws.id, f.channelId, status]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<string | void>) => { setBusy(key); setError(null); setNotice(''); try { const n = await fn(); if (n) setNotice(n); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const generate = () => run('ai', async () => {
    const r = await api<YtCommunityDraft[]>(`/workspaces/${ws.id}/youtube/channels/${f.channelId}/community/draft`, { method: 'POST', body: { source: f.source, videoId: f.source === 'VIDEO' && f.videoId ? f.videoId : undefined, text: f.source === 'TEXT' ? f.text : undefined, kind: f.kind, count: f.count, note: f.note || undefined } });
    setStatus('DRAFT'); return `${t('ytc.drafted')} ${r.length}`;
  });
  const createManual = () => run('manual', async () => {
    await api(`/workspaces/${ws.id}/youtube/community`, { method: 'POST', body: { channelId: f.channelId, kind: manual.kind, text: manual.text, pollOptions: manual.kind === 'POLL' ? manual.options.filter(o => o.trim()) : undefined } });
    setManual({ open: false, kind: 'TEXT', text: '', options: ['', ''] }); setStatus('DRAFT'); return t('ytc.saved');
  });
  if (!channels || !drafts) return <div><ErrorBox error={error} /><Loading /></div>;
  const canCreate = can('youtube.content.create'); const canEdit = can('youtube.content.edit');
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('ytc.title')}</h1><p className="text-sm text-slate-400">{t('ytc.subtitle')}</p></div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />
      {channels.length === 0 ? <Empty text={t('yt.noChannels')} /> : <>
        {canCreate && <Card title={`✨ ${t('ytc.aiTitle')}`}>
          <div className="grid gap-2 md:grid-cols-4">
            <Field label={t('yt.channel')}><Select value={f.channelId} onChange={e => setF(v => ({ ...v, channelId: e.target.value, videoId: '' }))}>{channels.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
            <Field label={t('ytc.kind')}><Select value={f.kind} onChange={e => setF(v => ({ ...v, kind: e.target.value }))}>{['AUTO', 'TEXT', 'POLL', 'IMAGE'].map(k => <option key={k} value={k}>{t(`ytc.kind.${k}` as MessageKey)}</option>)}</Select></Field>
            <Field label={t('ytc.count')}><Select value={f.count} onChange={e => setF(v => ({ ...v, count: Number(e.target.value) }))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
            <Field label={t('ytc.note')}><Input value={f.note} maxLength={500} onChange={e => setF(v => ({ ...v, note: e.target.value }))} placeholder={t('ytc.notePh')} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{(['VIDEO', 'HIGHLIGHTS', 'TEXT'] as const).map(s => <Button key={s} variant={f.source === s ? 'primary' : 'ghost'} onClick={() => setF(v => ({ ...v, source: s }))}>{t(`ytc.src.${s}` as MessageKey)}</Button>)}</div>
          <div className="mt-2">
            {f.source === 'VIDEO' && <Field label={t('ytc.video')}><Select value={f.videoId} onChange={e => setF(v => ({ ...v, videoId: e.target.value }))}><option value="">{t('ytc.latestVideo')}</option>{videos.map(v => <option key={v.id} value={v.id}>{v.title.slice(0, 80)}</option>)}</Select></Field>}
            {f.source === 'HIGHLIGHTS' && <p className="text-xs text-slate-400">{t('ytc.fromHighlights')}</p>}
            {f.source === 'TEXT' && <Field label={t('ytc.textSrc')}><Textarea className="min-h-24" value={f.text} maxLength={5000} onChange={e => setF(v => ({ ...v, text: e.target.value }))} placeholder={t('ytc.textPh')} /></Field>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {can('ai.use') && <Button disabled={busy === 'ai' || !f.channelId || (f.source === 'TEXT' && !f.text.trim())} onClick={generate}>{busy === 'ai' ? t('ytc.working') : `✨ ${t('ytc.generate')}`}</Button>}
            <Button variant="ghost" onClick={() => setManual(m => ({ ...m, open: !m.open }))}>✍️ {t('ytc.manual')}</Button>
          </div>
          {manual.open && <div className="mt-3 space-y-2 rounded-lg border border-slate-800 p-3">
            <Select className="w-auto" value={manual.kind} onChange={e => setManual(m => ({ ...m, kind: e.target.value as YtCommunityDraft['kind'] }))}>{['TEXT', 'POLL', 'IMAGE'].map(k => <option key={k} value={k}>{t(`ytc.kind.${k}` as MessageKey)}</option>)}</Select>
            <Textarea className="min-h-20" value={manual.text} maxLength={5000} onChange={e => setManual(m => ({ ...m, text: e.target.value }))} placeholder={manual.kind === 'POLL' ? t('ytc.pollQuestion') : t('ytc.postText')} />
            {manual.kind === 'POLL' && <PollEditor options={manual.options} onChange={options => setManual(m => ({ ...m, options }))} />}
            <Button disabled={busy === 'manual' || !manual.text.trim() || (manual.kind === 'POLL' && manual.options.filter(o => o.trim()).length < 2)} onClick={createManual}>{t('common.save')}</Button>
          </div>}
        </Card>}
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
          <Button variant={status === 'DRAFT' ? 'primary' : 'ghost'} onClick={() => setStatus('DRAFT')}>📝 {t('ytc.tabDraft')}</Button>
          <Button variant={status === 'POSTED' ? 'primary' : 'ghost'} onClick={() => setStatus('POSTED')}>✔ {t('ytc.tabPosted')}</Button>
        </div>
        {drafts.length === 0 ? <Empty text={status === 'DRAFT' ? t('ytc.empty') : t('ytc.emptyPosted')} /> : <div className="space-y-3">{drafts.map(d => <DraftCard key={`${d.id}:${d.updatedAt}`} d={d} wsId={ws.id} canEdit={canEdit} onDone={(msg) => { if (msg) setNotice(msg); void load(); }} onError={setError} />)}</div>}
      </>}
    </div>
  );
}

function PollEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  return (
    <div className="space-y-1">
      {options.map((o, i) => <div key={i} className="flex items-center gap-2">
        <span className="w-5 text-xs text-slate-500">{i + 1}.</span>
        <Input aria-label={`${t('ytc.option')} ${i + 1}`} value={o} maxLength={OPTION_MAX} onChange={e => onChange(options.map((x, j) => (j === i ? e.target.value : x)))} />
        <span className={`w-12 text-right text-xs ${o.length >= OPTION_MAX ? 'text-amber-500' : 'text-slate-500'}`}>{o.length}/{OPTION_MAX}</span>
        {options.length > 2 && <button type="button" className="text-xs text-rose-400" onClick={() => onChange(options.filter((_, j) => j !== i))}>✕</button>}
      </div>)}
      {options.length < POLL_MAX && <button type="button" className="text-xs text-sky-500 hover:underline" onClick={() => onChange([...options, ''])}>+ {t('ytc.addOption')}</button>}
    </div>
  );
}

function DraftCard({ d, wsId, canEdit, onDone, onError }: { d: YtCommunityDraft; wsId: string; canEdit: boolean; onDone: (msg?: string) => void; onError: (e: unknown) => void }) {
  const [kind, setKind] = useState(d.kind); const [text, setText] = useState(d.text); const [options, setOptions] = useState(d.pollOptions.length ? d.pollOptions : ['', ''] as string[]);
  const [idea, setIdea] = useState(d.imageIdea ?? ''); const [when, setWhen] = useState(toLocal(d.scheduledAt)); const [busy, setBusy] = useState(''); const [copied, setCopied] = useState('');
  const dirty = kind !== d.kind || text !== d.text || (kind === 'POLL' && options.join('\n') !== d.pollOptions.join('\n')) || (kind === 'IMAGE' && idea !== (d.imageIdea ?? '')) || when !== toLocal(d.scheduledAt);
  const patch = async (key: string, body: Record<string, unknown>, msg?: string) => { setBusy(key); try { await api(`/workspaces/${wsId}/youtube/community/${d.id}`, { method: 'PATCH', body }); onDone(msg); } catch (e) { onError(e); } finally { setBusy(''); } };
  const save = () => patch('save', { kind, text, ...(kind === 'POLL' && { pollOptions: options.filter(o => o.trim()) }), ...(kind === 'IMAGE' && { imageIdea: idea || null }), scheduledAt: when ? new Date(when).toISOString() : null }, t('ytc.saved'));
  const copy = async (key: string, s: string) => { const ok = await copyText(s); setCopied(ok ? key : ''); if (ok) setTimeout(() => setCopied(''), 2000); };
  const posted = d.status === 'POSTED';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !posted ? <Select className="w-auto" aria-label={t('ytc.kind')} value={kind} onChange={e => setKind(e.target.value as YtCommunityDraft['kind'])}>{['TEXT', 'POLL', 'IMAGE'].map(k => <option key={k} value={k}>{t(`ytc.kind.${k}` as MessageKey)}</option>)}</Select> : <Pill tone="muted">{t(`ytc.kind.${d.kind}` as MessageKey)}</Pill>}
          <span className="text-xs text-slate-500" title={fullDate(d.createdAt)}>{t(`ytc.src.${d.source}` as MessageKey)} · {timeAgo(d.createdAt)}</span>
          {d.scheduledAt && !posted && <Pill tone={new Date(d.scheduledAt).getTime() <= Date.now() ? 'warn' : 'muted'}>⏰ {fullDate(d.scheduledAt)}</Pill>}
          {posted && d.postedAt && <Pill tone="ok">✔ {t('ytc.postedAt')} {fullDate(d.postedAt)}</Pill>}
        </div>
        <a href={postsUrl(d.channel)} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">🔗 {t('ytc.openYt')} ↗</a>
      </div>
      <Textarea className="mt-2 min-h-24" aria-label={t('ytc.postText')} value={text} readOnly={!canEdit || posted} onChange={e => setText(e.target.value)} />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => void copy('text', text)}>📋 {copied === 'text' ? t('ytc.copied') : kind === 'POLL' ? t('ytc.copyQuestion') : t('ytc.copyText')}</Button>
        <span className="text-xs text-slate-500">{text.length} {t('ytc.chars')}</span>
      </div>
      {kind === 'POLL' && <div className="mt-2 rounded-lg border border-slate-800 p-2">
        <div className="mb-1 text-xs font-semibold text-slate-400">{t('ytc.pollOptions')}</div>
        {canEdit && !posted ? <PollEditor options={options} onChange={setOptions} /> : null}
        <div className="mt-1 flex flex-wrap gap-1">{options.filter(o => o.trim()).map((o, i) => <Button key={i} variant="ghost" title={t('ytc.copyOption')} onClick={() => void copy(`o${i}`, o)}>📋 {i + 1}. {copied === `o${i}` ? t('ytc.copied') : o}</Button>)}</div>
      </div>}
      {kind === 'IMAGE' && <div className="mt-2 rounded-lg border border-slate-800 p-2">
        <div className="mb-1 text-xs font-semibold text-slate-400">🖼 {t('ytc.imageIdea')}</div>
        <Textarea className="min-h-14" value={idea} readOnly={!canEdit || posted} onChange={e => setIdea(e.target.value)} />
        <Button variant="ghost" onClick={() => void copy('img', idea)}>📋 {copied === 'img' ? t('ytc.copied') : t('ytc.copyIdea')}</Button>
      </div>}
      {canEdit && <div className="mt-2 flex flex-wrap items-end gap-2">
        {!posted && <><Field label={t('ytc.when')}><Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>
          <Button disabled={!dirty || busy === 'save' || !text.trim()} onClick={save}>💾 {t('common.save')}</Button>
          <Button variant="ghost" disabled={busy === 'posted' || dirty} title={dirty ? t('ytc.saveFirst') : undefined} onClick={() => void patch('posted', { status: 'POSTED' }, t('ytc.markedPosted'))}>✔ {t('ytc.markPosted')}</Button>
          <Button variant="danger" disabled={busy === 'del'} onClick={() => { if (confirm(t('ytc.confirmDelete'))) void patch('del', { status: 'ARCHIVED' }); }}>🗑 {t('ytc.delete')}</Button></>}
        {posted && <Button variant="ghost" disabled={busy === 'undo'} onClick={() => void patch('undo', { status: 'DRAFT' })}>↩ {t('ytc.backToDraft')}</Button>}
      </div>}
    </div>
  );
}
