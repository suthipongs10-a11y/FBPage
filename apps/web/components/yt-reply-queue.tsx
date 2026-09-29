'use client';
/** คิว "รอตอบ" ของ YouTube: เธรดที่ผู้ชมพูดหลังการตอบครั้งล่าสุดของช่อง (รวม reply ใต้คำตอบของเรา) → AI ร่าง → คนตรวจ → ส่ง */
import { useCallback, useEffect, useState } from 'react';
import { api, type YtThread } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { Button, Empty, ErrorBox, Pill, Textarea } from '@/components/ui';

const fmt = (d: string) => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

export function YtReplyQueue({ wsId, channelId, canReply, canAi, version = 0, onChanged }: { wsId: string; channelId: string; canReply: boolean; canAi: boolean; version?: number; onChanged?: () => void }) {
  const [threads, setThreads] = useState<YtThread[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { const q = channelId ? `?channelId=${channelId}` : ''; setThreads(await api<YtThread[]>(`/workspaces/${wsId}/youtube/comments/threads${q}`)); } catch (e) { setError(e); }
  }, [wsId, channelId]);
  useEffect(() => { void load(); }, [load, version]);   // version: หน้าหลักซิงก์/จำแนกเสร็จ → โหลดคิวใหม่
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); onChanged?.(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const text = (th: YtThread) => drafts[th.target.id] ?? th.target.draftReply ?? '';
  const edited = (th: YtThread) => drafts[th.target.id] !== undefined && drafts[th.target.id] !== (th.target.draftReply ?? '');

  // AI ร่างทีละ 25 จนครบ (สูงสุด 4 รอบต่อการกด)
  const draftAll = () => run('draft', async () => {
    let n = 0;
    for (let i = 0; i < 4; i++) { const r = await api<{ classified: number }>(`/workspaces/${wsId}/youtube/comments/classify`, { method: 'POST', body: { ...(channelId && { channelId }), pendingOnly: true, limit: 25 } }); n += r.classified; if (r.classified < 25) break; }
    setNotice(`${t('ytr.drafted')} ${n}`);
  });
  const send = (th: YtThread) => run(`send:${th.target.id}`, async () => { await api(`/workspaces/${wsId}/youtube/comments/${th.target.id}/reply`, { method: 'POST', body: { message: text(th) } }); setNotice(t('ytr.sentOne')); });
  const skip = (th: YtThread) => run(`skip:${th.target.id}`, async () => { await api(`/workspaces/${wsId}/youtube/comments/${th.target.id}`, { method: 'PATCH', body: { resolved: true } }); });
  const sendPicked = () => run('bulk', async () => {
    const list = (threads ?? []).filter(th => picked[th.target.id] && text(th).trim());
    for (const th of list) if (edited(th)) await api(`/workspaces/${wsId}/youtube/comments/${th.target.id}`, { method: 'PATCH', body: { draftReply: text(th) } });
    const r = await api<{ sent: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>(`/workspaces/${wsId}/youtube/comments/reply-bulk`, { method: 'POST', body: { ids: list.slice(0, 30).map(th => th.target.id) } });
    setPicked({}); setNotice(`${t('ytr.sent')} ${r.sent}${r.failed ? ` · ${t('ytr.failed')} ${r.failed}: ${r.results.find(x => !x.ok)?.error ?? ''}` : ''}`);
  });
  if (!threads) return <ErrorBox error={error} />;
  const ready = threads.filter(th => text(th).trim() && th.target.classification !== 'SPAM');
  const nPicked = ready.filter(th => picked[th.target.id]).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-400">{t('ytr.waiting')} <b>{threads.length}</b> {t('ytr.threads')}</span>
        {canAi && <Button disabled={busy === 'draft' || threads.length === 0} onClick={draftAll}>{busy === 'draft' ? t('common.loading') : t('ytr.draftAll')}</Button>}
        {canReply && <><Button variant="ghost" disabled={ready.length === 0} onClick={() => setPicked(Object.fromEntries(ready.map(th => [th.target.id, true])))}>{t('ytr.pickAll')} ({ready.length})</Button>
          <Button disabled={busy === 'bulk' || nPicked === 0} onClick={() => { if (confirm(t('ytr.confirmBulk').replace('{n}', String(nPicked)))) void sendPicked(); }}>{t('ytr.sendPicked')} ({nPicked})</Button></>}
      </div>
      <p className="text-xs text-slate-500">{t('ytr.hint')}</p>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />
      {threads.length === 0 ? <Empty text={t('ytr.empty')} /> : threads.map(th => {
        const tg = th.target; const hidden = th.total - th.messages.length;
        return (
          <div key={tg.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {canReply && <input type="checkbox" aria-label={t('ytr.pick')} disabled={!text(th).trim()} checked={!!picked[tg.id]} onChange={e => setPicked(v => ({ ...v, [tg.id]: e.target.checked }))} />}
                <Pill tone={tg.isReply ? 'warn' : 'muted'}>{tg.isReply ? t('ytr.replyInThread') : t('ytr.newComment')}</Pill>
                {tg.classification && <Pill tone="muted">{t(`ycc.${tg.classification}` as MessageKey)}</Pill>}
                {tg.riskFlag && <Pill tone="bad">{t('comments.risk')}</Pill>}
                {th.pendingCount > 1 && <span className="text-xs text-amber-500">{t('ytr.pendingMany').replace('{n}', String(th.pendingCount))}</span>}
              </div>
              {tg.video && <a href={`https://www.youtube.com/watch?v=${tg.video.youtubeVideoId}&lc=${tg.youtubeCommentId}`} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">{tg.video.title.slice(0, 50)} ↗</a>}
            </div>
            <div className="mt-2 space-y-1 border-l-2 border-slate-800 pl-3">
              {hidden > 0 && <div className="text-xs text-slate-500">… {t('ytr.earlier').replace('{n}', String(hidden))}</div>}
              {th.messages.map(m => (
                <div key={m.id} className={`rounded-md p-1.5 ${m.fromChannel ? 'bg-sky-950/40' : m.id === tg.id ? 'bg-amber-950/30' : ''} ${m.isReply ? 'ml-4' : ''}`}>
                  <span className={`text-xs font-medium ${m.fromChannel ? 'text-sky-400' : ''}`}>{m.fromChannel ? `🎬 ${t('ytr.channel')}` : m.author ?? '—'}</span> <span className="text-xs text-slate-500">{fmt(m.publishedAt)}</span>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>))}
            </div>
            {canReply && tg.classification !== 'SPAM' && <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Textarea className="min-h-14" placeholder={t('ytr.placeholder')} value={text(th)} onChange={e => setDrafts(v => ({ ...v, [tg.id]: e.target.value }))} />
              <div className="flex flex-col gap-1">
                <Button disabled={busy === `send:${tg.id}` || !text(th).trim()} onClick={() => send(th)}>{t('comments.send')}</Button>
                <Button variant="ghost" disabled={busy === `skip:${tg.id}`} onClick={() => skip(th)}>{t('ytr.skip')}</Button>
              </div>
            </div>}
            {tg.isReply && tg.authorDisplayName && <p className="mt-1 text-xs text-slate-500">{t('ytr.tagNote').replace('{a}', tg.authorDisplayName.startsWith('@') ? tg.authorDisplayName : `@${tg.authorDisplayName}`)}</p>}
          </div>);
      })}
    </div>
  );
}
