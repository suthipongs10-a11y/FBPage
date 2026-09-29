'use client';
/** ⭐ คอมเมนต์น่าสนใจ: AI จัดอันดับความเห็นของผู้ชมทั้งช่อง + ไอเดียหัวข้อ → ส่งเข้า YT Content Lab เป็นไอเดีย */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type YtChannel, type YtContent, type YtHighlight, type YtHighlights } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { Button, Empty, ErrorBox, Pill, Select } from '@/components/ui';
import { copyText, fullDate, replyPrompt, timeAgo } from '@/lib/yt-comment';

const kindTone = (k: string): 'ok' | 'warn' | 'bad' | 'muted' => (k === 'LEAD' || k === 'CONTENT_REQUEST' ? 'ok' : k === 'COMPLAINT' || k === 'MISINFO' ? 'bad' : k === 'PRAISE' ? 'muted' : 'warn');

export function YtCommentHighlights({ wsId, channels, canAi, canCreate }: { wsId: string; channels: YtChannel[]; canAi: boolean; canCreate: boolean }) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? ''); const [days, setDays] = useState(180);
  const [data, setData] = useState<YtHighlights | null | undefined>(undefined);
  const [sent, setSent] = useState<Record<string, string>>({});   // key → contentId ที่สร้างแล้ว
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    if (!channelId) { setData(null); return; }
    try { setData(await api<YtHighlights | null>(`/workspaces/${wsId}/youtube/channels/${channelId}/comments/highlights`)); } catch (e) { setError(e); }
  }, [wsId, channelId]);
  useEffect(() => { setData(undefined); void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const analyze = () => run('analyze', async () => { setData(await api<YtHighlights>(`/workspaces/${wsId}/youtube/channels/${channelId}/comments/highlights`, { method: 'POST', body: { days } })); });
  const toLab = (key: string, title: string, why: string, quotes: string[]) => run(`lab:${key}`, async () => {
    const notes = [`ที่มา: คอมเมนต์ผู้ชม (วิเคราะห์คอมเมนต์น่าสนใจ)`, why && `เหตุผล: ${why}`, ...quotes.map(q => `• "${q.slice(0, 200)}"`)].filter(Boolean).join('\n').slice(0, 2000);
    const c = await api<YtContent>(`/workspaces/${wsId}/youtube/content`, { method: 'POST', body: { channelId, title: title.slice(0, 200), objective: 'ตอบสิ่งที่ผู้ชมถาม/สนใจในคอมเมนต์', notes } });
    setSent(v => ({ ...v, [key]: c.id })); setNotice(`${t('ytk.sentToLab')}: ${title}`);
  });
  const copy = async (h: YtHighlight) => {
    const c = h.comment; const ok = await copyText(replyPrompt({ channel: c.channel?.title, videoTitle: c.video?.title, videoUrl: c.video ? `https://www.youtube.com/watch?v=${c.video.youtubeVideoId}&lc=${c.youtubeCommentId}` : null, target: { author: c.authorDisplayName, text: c.text, publishedAt: c.publishedAt, fromChannel: false } }));
    setNotice(ok ? t('ytr.copied') : t('ytr.copyFailed'));
  };
  if (!channels.length) return <Empty text={t('yt.noChannels')} />;
  const labLink = (key: string) => sent[key] && <Link href="/youtube/content" className="text-xs text-sky-400 underline">{t('ytk.openLab')} →</Link>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={channelId} onChange={e => setChannelId(e.target.value)}>{channels.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>
        <Select className="w-auto" value={days} onChange={e => setDays(Number(e.target.value))}>{[30, 90, 180, 365].map(d => <option key={d} value={d}>{t('ytk.days').replace('{n}', String(d))}</option>)}</Select>
        {canAi && <Button disabled={busy === 'analyze' || !channelId} onClick={analyze}>{busy === 'analyze' ? t('ytk.running') : t('ytk.run')}</Button>}
        {data && <span className="text-xs text-slate-500">{t('ytk.last')} {fullDate(data.createdAt)} · {data.commentCount} {t('ytk.comments')} · {data.model}</span>}
      </div>
      <p className="text-xs text-slate-500">{t('ytk.hint')}</p>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />
      {data === undefined ? null : !data ? <Empty text={t('ytk.empty')} /> : <>
        {data.summary.length > 0 && <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm"><div className="mb-1 text-xs font-semibold text-slate-400">{t('ytk.summary')}</div><ul className="list-disc pl-5">{data.summary.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
        {data.topicIdeas.length > 0 && <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
          <div className="mb-2 text-xs font-semibold text-slate-400">💡 {t('ytk.topics')}</div>
          <div className="space-y-2">{data.topicIdeas.map((ti, i) => { const key = `topic:${i}`; return (
            <div key={key} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-800 p-2">
              <div className="min-w-0 flex-1"><div className="font-medium">{ti.title}</div><div className="text-xs text-slate-400">{ti.why}</div>{ti.comments.length > 0 && <div className="mt-1 text-xs text-slate-500">{ti.comments.map(c => `“${c.text.slice(0, 80)}”`).join(' · ')}</div>}</div>
              <div className="flex flex-col items-end gap-1">{canCreate && <Button variant="ghost" disabled={!!sent[key] || busy === `lab:${key}`} onClick={() => toLab(key, ti.title, ti.why, ti.comments.map(c => c.text))}>{sent[key] ? `✔ ${t('ytk.inLab')}` : `➕ ${t('ytk.toLab')}`}</Button>}{labLink(key)}</div>
            </div>); })}</div>
        </div>}
        <div className="text-xs font-semibold text-slate-400">⭐ {t('ytk.ranked')} ({data.highlights.length})</div>
        {data.highlights.map((h, i) => { const c = h.comment; const key = `hl:${h.id}`; return (
          <div key={h.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold text-sky-400">#{i + 1}</span>
                <span className="w-16 rounded bg-slate-800" title={`${h.score}/100`}><span className="block h-1.5 rounded bg-sky-500" style={{ width: `${h.score}%` }} /></span>
                <Pill tone={kindTone(h.kind)}>{t(`ytk.kind.${h.kind}` as MessageKey)}</Pill>
                {c.needsReply && <Pill tone="warn">{t('ytk.waiting')}</Pill>}
                <span className="font-medium">{c.authorDisplayName ?? '—'}</span>
                <span className="text-xs text-slate-500" title={fullDate(c.publishedAt)}>· {timeAgo(c.publishedAt)} · 👍 {c.likeCount}</span>
              </div>
              {c.video && <a href={`https://www.youtube.com/watch?v=${c.video.youtubeVideoId}&lc=${c.youtubeCommentId}`} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">{c.video.title.slice(0, 50)} ↗</a>}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
            <p className="mt-1 text-xs text-slate-400">{t('ytk.why')}: {h.why}</p>
            {h.topicIdea && <p className="mt-1 text-xs">💡 {h.topicIdea}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => void copy(h)}>📋 {t('ytr.copyAi')}</Button>
              {canCreate && <Button variant="ghost" disabled={!!sent[key] || busy === `lab:${key}`} onClick={() => toLab(key, h.topicIdea ?? c.text.slice(0, 120), h.why, [c.text])}>{sent[key] ? `✔ ${t('ytk.inLab')}` : `➕ ${t('ytk.toLab')}`}</Button>}
              {labLink(key)}
            </div>
          </div>); })}
      </>}
    </div>
  );
}
