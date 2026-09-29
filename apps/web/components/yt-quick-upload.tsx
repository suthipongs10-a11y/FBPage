'use client';
/** อัปคลิปขึ้น YouTube แบบคลิกเดียว — ส่งเป็น Private (ไปเปิดเองใน YouTube Studio) แล้วระบบลบไฟล์ในเครื่องเมื่อ YouTube รับครบ */
import { useEffect, useRef, useState } from 'react';
import { api, type YtChannel, type YtContent } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui';

const DONE = ['PROCESSING', 'PUBLISHED', 'SCHEDULED', 'ANALYTICS_PENDING', 'ANALYZED'];
const FAILED = ['UPLOAD_FAILED', 'PROCESSING_FAILED', 'PUBLISH_FAILED'];

export function YtQuickUpload({ wsId, channels, uploadEnabled, onDone }: { wsId: string; channels: YtChannel[]; uploadEnabled: boolean; onDone?: () => void }) {
  const oauth = channels.filter(c => c.accessMode === 'OAUTH' && !c.disconnectedAt);
  const [channelId, setChannelId] = useState(oauth[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: '', description: '', tags: '', format: 'LONG_FORM', privacy: 'private', kids: '' });
  const [progress, setProgress] = useState<number | null>(null); const [stage, setStage] = useState(''); const [item, setItem] = useState<YtContent | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  useEffect(() => { const ch = channels.find(c => c.id === channelId); const def = (ch?.policy as { defaultMadeForKids?: boolean } | null)?.defaultMadeForKids; setF(v => ({ ...v, kids: v.kids || (def === undefined ? '' : def ? '1' : '0') })); }, [channelId, channels]);
  if (!oauth.length) return null;

  const pickFile = (x: File | null) => { setFile(x); setItem(null); setStage(''); if (x && !f.title) setF(v => ({ ...v, title: x.name.replace(/\.[^.]+$/, '').slice(0, 100) })); };
  const send = (id: string, x: File) => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/workspaces/${wsId}/youtube/content/${id}/assets/video`); xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', x.type || 'video/mp4'); xhr.setRequestHeader('x-file-name', encodeURIComponent(x.name));
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else { let msg = `HTTP ${xhr.status}`; try { msg = (JSON.parse(xhr.responseText) as { message?: string }).message ?? msg; } catch { if (xhr.status === 413) msg = t('ytq.tooLarge'); } reject(new Error(msg)); } };
    xhr.onerror = () => reject(new Error(t('ytq.network'))); xhr.send(x);
  });
  const watch = (id: string) => {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try { const c = await api<YtContent>(`/workspaces/${wsId}/youtube/content/${id}`); setItem(c); if (DONE.includes(c.ytStatus) || FAILED.includes(c.ytStatus)) { if (poll.current) clearInterval(poll.current); onDone?.(); } } catch { /* ลองใหม่รอบหน้า */ }
    }, 5000);
  };
  const go = async () => {
    if (!file || !channelId || !f.title || f.kids === '') return;
    setBusy(true); setError(null); setProgress(0); setItem(null);
    try {
      setStage(t('ytq.stageCreate'));
      const c = await api<YtContent>(`/workspaces/${wsId}/youtube/content`, { method: 'POST', body: { channelId, title: f.title, format: f.format } });
      setStage(t('ytq.stageSend')); await send(c.id, file);
      setStage(t('ytq.stageQueue'));
      const r = await api<{ content: YtContent }>(`/workspaces/${wsId}/youtube/content/${c.id}/quick-upload`, { method: 'POST', body: { title: f.title, description: f.description || undefined, tags: f.tags ? f.tags.split(',').map(x => x.trim()).filter(Boolean) : undefined, madeForKids: f.kids === '1', privacyStatus: f.privacy } });
      setItem(r.content); setStage(''); watch(c.id);
      setFile(null); setF(v => ({ ...v, title: '', description: '', tags: '' }));
    } catch (e) { setError(e); setStage(''); } finally { setBusy(false); setProgress(null); }
  };
  const status = item?.ytStatus ?? '';
  const ytId = item?.externalPostId ?? item?.youtubeMeta?.youtubeVideoId ?? null;
  return (
    <Card title={t('ytq.title')}>
      <p className="mb-2 text-xs text-slate-400">{t('ytq.hint')}</p>
      {!uploadEnabled && <p className="mb-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200">{t('ytq.disabled')}</p>}
      <div className="grid gap-2 md:grid-cols-2">
        <Field label={t('yt.channel')}><Select value={channelId} onChange={e => setChannelId(e.target.value)}>{oauth.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
        <Field label={t('ytq.file')}><input type="file" accept="video/*" className="block w-full text-sm" onChange={e => pickFile(e.target.files?.[0] ?? null)} />{file && <span className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span>}</Field>
        <Field label={t('ytq.videoTitle')}><Input maxLength={100} value={f.title} onChange={e => setF(v => ({ ...v, title: e.target.value }))} /></Field>
        <Field label={t('ytq.format')}><Select value={f.format} onChange={e => setF(v => ({ ...v, format: e.target.value }))}><option value="LONG_FORM">{t('ytf.LONG_FORM')}</option><option value="SHORT">{t('ytf.SHORT')}</option></Select></Field>
        <div className="md:col-span-2"><Field label={t('ytq.description')}><Textarea className="min-h-20" maxLength={5000} value={f.description} onChange={e => setF(v => ({ ...v, description: e.target.value }))} /></Field></div>
        <Field label={t('ytq.tags')}><Input value={f.tags} onChange={e => setF(v => ({ ...v, tags: e.target.value }))} placeholder="EV, รถไฟฟ้า, รีวิว" /></Field>
        <Field label={t('ytq.privacy')}><Select value={f.privacy} onChange={e => setF(v => ({ ...v, privacy: e.target.value }))}><option value="private">{t('ytq.private')}</option><option value="unlisted">{t('ytq.unlisted')}</option></Select></Field>
        <div className="md:col-span-2 text-sm"><span className="mr-3 text-xs text-slate-400">{t('ytq.kids')}</span>
          <label className="mr-3"><input type="radio" name="yt-kids" checked={f.kids === '0'} onChange={() => setF(v => ({ ...v, kids: '0' }))} /> {t('ytq.kidsNo')}</label>
          <label><input type="radio" name="yt-kids" checked={f.kids === '1'} onChange={() => setF(v => ({ ...v, kids: '1' }))} /> {t('ytq.kidsYes')}</label></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={busy || !uploadEnabled || !file || !channelId || !f.title || f.kids === ''} onClick={go}>{busy ? t('common.loading') : t('ytq.go')}</Button>
        {stage && <span className="text-xs text-slate-400">{stage}{progress !== null && progress < 100 ? ` ${progress}%` : ''}</span>}
      </div>
      {progress !== null && <div className="mt-2 h-2 rounded bg-slate-800"><div className="h-2 rounded bg-sky-500" style={{ width: `${progress}%` }} /></div>}
      <ErrorBox error={error} />
      {item && <div className="mt-3 rounded-lg border border-slate-800 p-2 text-sm">
        <div className="font-medium">{item.youtubeMeta?.title ?? item.title}</div>
        <div className="text-xs text-slate-400">{DONE.includes(status) ? t('ytq.done') : FAILED.includes(status) ? `${t('ytq.failed')}: ${item.lastError ?? status}` : t('ytq.working')}</div>
        {ytId && <a className="text-xs text-sky-400 underline" href={`https://studio.youtube.com/video/${ytId}/edit`} target="_blank" rel="noreferrer">{t('ytq.openStudio')} ↗</a>}
      </div>}
    </Card>
  );
}
