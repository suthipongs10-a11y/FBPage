'use client';
import { useState, type FormEvent } from 'react';
import { api, type ContentItem, type ContentRevisionRow, type MediaAsset, type MediaCapabilities, type PublishOutcome } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, ErrorBox, Field, Input, Pill, Select, Textarea } from '@/components/ui';

export const statusTone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (['PUBLISHED', 'ANALYZED', 'APPROVED', 'SCHEDULED'].includes(s) ? 'ok' : ['NEEDS_REVISION', 'READY_FOR_APPROVAL', 'PUBLISHING', 'AI_REVIEW'].includes(s) ? 'warn' : ['REJECTED', 'PUBLISH_FAILED'].includes(s) ? 'bad' : 'muted');
const fmt = (d: string | null | undefined, tz?: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', ...(tz && { timeZone: tz }) }) : '—');
const defaultLocal = () => { const d = new Date(Date.now() + 3_600_000); d.setMinutes(0, 0, 0); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** การ์ดคอนเทนต์ + การกระทำตามสถานะ (§38) — ใช้ทั้งหน้าคอนเทนต์และปฏิทิน */
export function ContentCard({ item, onChange }: { item: ContentItem; onChange: () => Promise<void> }) {
  const { ws, can } = useWorkspace();
  const [open, setOpen] = useState(false); const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: item.title ?? '', caption: item.caption ?? '', cta: item.cta ?? '', hashtags: item.hashtags.join(' '), mediaBrief: item.mediaBrief ?? '', mediaPaths: item.mediaPaths.join('\n'), reason: '' });
  const [comment, setComment] = useState(''); const [when, setWhen] = useState(defaultLocal());
  const [revs, setRevs] = useState<ContentRevisionRow[] | null>(null);
  const [assets, setAssets] = useState<MediaAsset[] | null>(null); const [caps, setCaps] = useState<MediaCapabilities | null>(null);
  const [card, setCard] = useState({ template: 'quote', theme: 'default', hint: '', kicker: '', title: '', quote: '', sub: '', items: '' });
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const base = `/workspaces/${ws.id}/content/${item.id}`;
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await onChange(); } catch (e) { setError(e); } finally { setBusy(''); } };
  const act = (key: string, path: string, body: unknown = {}) => run(key, async () => { await api(`${base}/${path}`, { method: 'POST', body }); });
  const save = (e: FormEvent) => { e.preventDefault(); void run('save', async () => { await api(base, { method: 'PATCH', body: { title: f.title, caption: f.caption, cta: f.cta, hashtags: f.hashtags.split(/\s+/).filter(Boolean).map(h => h.replace(/^#/, '')), mediaBrief: f.mediaBrief, mediaPaths: f.mediaPaths.split('\n').map(x => x.trim()).filter(Boolean), reason: f.reason || undefined } }); setEdit(false); }); };
  const publish = () => { if (!confirm(t('content.confirmPublish'))) return; void run('publish', async () => { const r = await api<{ outcome: PublishOutcome }>(`${base}/publish`, { method: 'POST', body: {} }); setNotice(r.outcome.status === 'PUBLISHED' ? `${t('content.published')} ${r.outcome.permalink ?? ''}` : `${r.outcome.status}: ${r.outcome.reason ?? r.outcome.error ?? ''}`); }); };
  const cancel = () => { if (confirm(t('content.confirmCancel'))) void run('cancel', async () => { await api(base, { method: 'DELETE' }); }); };
  const loadRevs = () => api<ContentRevisionRow[]>(`${base}/revisions`).then(setRevs).catch(setError);
  const loadMedia = () => Promise.all([api<MediaAsset[]>(`/workspaces/${ws.id}/media?contentId=${item.id}`), api<MediaCapabilities>(`/workspaces/${ws.id}/media/capabilities`)]).then(([a, c]) => { setAssets(a); setCaps(c); }).catch(setError);
  const aiCard = () => run('aicard', async () => { await api(`${base}/media/card/ai`, { method: 'POST', body: { theme: card.theme, template: card.template || undefined, hint: card.hint || undefined } }); await loadMedia(); });
  const renderCard = () => run('card', async () => {
    const data: Record<string, unknown> = { theme: card.theme, brand: item.page.name, ...(card.kicker && { kicker: card.kicker }) };
    if (card.template === 'quote') Object.assign(data, { quote: card.quote || item.title || (item.caption ?? '').slice(0, 80), sub: card.sub || undefined });
    else if (card.template === 'tips') Object.assign(data, { title: card.title || item.title || 'เคล็ดลับ', items: card.items.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 7).map(x => ({ title: x })) });
    else Object.assign(data, { title: card.title || item.title || (item.caption ?? '').slice(0, 40), sub: card.sub || undefined, punch: card.quote || undefined });
    await api(`${base}/media/card`, { method: 'POST', body: { template: card.template, data, attach: true } }); await loadMedia();
  });
  const removeAsset = (id: string) => run(`rm:${id}`, async () => { await api(`/workspaces/${ws.id}/media/${id}`, { method: 'DELETE' }); await loadMedia(); });
  const s = item.status; const editable = ['PLANNED', 'IDEA', 'DRAFT', 'NEEDS_REVISION', 'READY_FOR_APPROVAL', 'APPROVED', 'SCHEDULED', 'REJECTED', 'PUBLISH_FAILED'].includes(s);
  const cEdit = can('content.edit'); const cApprove = can('content.approve'); const cPublish = can('content.publish'); const cAi = can('ai.use');
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button onClick={() => setOpen(v => !v)} className="text-left">
          <div className="flex flex-wrap items-center gap-2"><Pill tone={statusTone(s)}>{t(`cs.${s}` as MessageKey)}</Pill><span className="font-medium">{item.title || (item.caption ?? '').slice(0, 60) || '(ไม่มีหัวข้อ)'}</span>{item.aiProvider && <Pill>{t('content.byAi')} {item.aiModel}</Pill>}{item.editedByHuman && <Pill>{t('content.byHuman')}</Pill>}{item.aiNotes?.needsHumanInput && <Pill tone="warn">NEEDS_HUMAN_INPUT</Pill>}</div>
          <div className="mt-1 text-xs text-slate-500">{item.page.name} · {item.page.brand.client.name} · {item.contentPillar ?? '—'} · {item.contentType}{item.scheduledAt && ` · ⏰ ${fmt(item.scheduledAt, item.scheduledTz)} (${item.scheduledTz})`}{item.publishedAt && ` · ✔ ${fmt(item.publishedAt)}`}</div>
        </button>
        <div className="flex flex-wrap gap-1">
          {cAi && cEdit && ['PLANNED', 'IDEA', 'DRAFT', 'NEEDS_REVISION'].includes(s) && <Button variant="ghost" disabled={busy === 'gen'} onClick={() => act('gen', 'generate')}>{t('content.generate')}</Button>}
          {cEdit && ['DRAFT', 'NEEDS_REVISION'].includes(s) && item.caption && <Button disabled={busy === 'submit'} onClick={() => act('submit', 'submit')}>{t('content.submit')}</Button>}
          {cApprove && s === 'READY_FOR_APPROVAL' && <><Button disabled={busy === 'approve'} onClick={() => act('approve', 'approve', { comment: comment || undefined })}>{t('content.approve')}</Button><Button variant="ghost" disabled={busy === 'changes'} onClick={() => act('changes', 'request-changes', { comment: comment || undefined })}>{t('content.changes')}</Button><Button variant="danger" disabled={busy === 'reject'} onClick={() => act('reject', 'reject', { comment: comment || undefined })}>{t('content.reject')}</Button></>}
          {cPublish && ['APPROVED', 'PUBLISH_FAILED'].includes(s) && <Button disabled={busy === 'publish'} onClick={publish}>{t('content.publishNow')}</Button>}
          {cEdit && ['REJECTED', 'SCHEDULED', 'PUBLISH_FAILED'].includes(s) && <Button variant="ghost" disabled={busy === 'reopen'} onClick={() => act('reopen', 'reopen')}>{t('content.reopen')}</Button>}
          {cEdit && editable && <button className="text-xs text-rose-400 hover:underline" onClick={cancel}>{t('content.cancel')}</button>}
        </div>
      </div>
      {notice && <p className="mt-2 text-xs text-emerald-400">✔ {notice}</p>}
      {item.lastError && <p className="mt-2 text-xs text-rose-400">{t('content.lastError')}: {item.lastError}</p>}
      <ErrorBox error={error} />
      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
          {edit ? (
            <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
              <Field label={t('content.titleField')}><Input value={f.title} onChange={e => setF(v => ({ ...v, title: e.target.value }))} /></Field>
              <Field label={t('content.cta')}><Input value={f.cta} onChange={e => setF(v => ({ ...v, cta: e.target.value }))} /></Field>
              <div className="sm:col-span-2"><Field label={t('content.caption')}><Textarea value={f.caption} onChange={e => setF(v => ({ ...v, caption: e.target.value }))} className="min-h-40" /></Field></div>
              <Field label={t('content.hashtags')}><Input value={f.hashtags} onChange={e => setF(v => ({ ...v, hashtags: e.target.value }))} /></Field>
              <Field label={t('content.mediaBrief')}><Input value={f.mediaBrief} onChange={e => setF(v => ({ ...v, mediaBrief: e.target.value }))} /></Field>
              <div className="sm:col-span-2"><Field label={t('content.mediaPaths')}><Textarea value={f.mediaPaths} onChange={e => setF(v => ({ ...v, mediaPaths: e.target.value }))} className="min-h-16" /></Field></div>
              <Field label={t('content.comment')} hint={t('common.optional')}><Input value={f.reason} onChange={e => setF(v => ({ ...v, reason: e.target.value }))} /></Field>
              <div className="flex items-end gap-2"><Button type="submit" disabled={busy === 'save'}>{t('common.save')}</Button><Button type="button" variant="ghost" onClick={() => setEdit(false)}>{t('common.cancel')}</Button></div>
            </form>
          ) : (
            <div>
              <p className="whitespace-pre-wrap">{item.caption || <span className="text-slate-600">— {t('content.caption')} —</span>}</p>
              {item.hashtags.length > 0 && <p className="mt-1 text-xs text-sky-400">{item.hashtags.map(h => `#${h}`).join(' ')}</p>}
              {item.cta && <p className="mt-1 text-xs text-slate-400">CTA: {item.cta}</p>}
              {item.mediaBrief && <p className="mt-1 text-xs text-slate-400">{t('content.mediaBrief')}: {item.mediaBrief}</p>}
              {item.mediaPaths.length > 0 && <p className="mt-1 text-xs text-slate-400">{item.mediaPaths.length} รูป</p>}
              {item.aiNotes?.hook && <p className="mt-1 text-xs text-slate-500">hook: {item.aiNotes.hook}</p>}
              {item.aiNotes?.missingInfo && item.aiNotes.missingInfo.length > 0 && <div className="mt-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200"><div className="font-semibold">{t('content.missingInfo')}</div><ul className="list-disc pl-4">{item.aiNotes.missingInfo.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
              {item.reviewResult && <div className={`mt-2 rounded-lg border p-2 text-xs ${item.reviewResult.result === 'PASS' ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200' : 'border-rose-900/60 bg-rose-950/30 text-rose-200'}`}><div className="font-semibold">{t('content.review')}: {item.reviewResult.result} {item.reviewResult.summary && `— ${item.reviewResult.summary}`}</div>{item.reviewResult.issues.length > 0 && <ul className="list-disc pl-4">{item.reviewResult.issues.map((x, i) => <li key={i}>[{x.severity}] {x.type}: {x.detail}</li>)}</ul>}</div>}
              {item.externalPostId && <a className="mt-2 inline-block text-xs text-sky-400 hover:underline" href={`https://www.facebook.com/${item.externalPostId}`} target="_blank" rel="noreferrer">{t('content.openPost')} →</a>}
              {cEdit && editable && <Button variant="ghost" className="mt-2" onClick={() => setEdit(true)}>{t('common.edit')}</Button>}
            </div>
          )}
          {cApprove && s === 'READY_FOR_APPROVAL' && <Field label={t('content.comment')}><Input value={comment} onChange={e => setComment(e.target.value)} /></Field>}
          {cPublish && ['APPROVED', 'PUBLISH_FAILED', 'SCHEDULED'].includes(s) && (
            <div className="flex flex-wrap items-end gap-2"><Field label={`${t('content.scheduleAt')} · ${item.page.timezone ?? ws.timezone}`}><Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field><Button variant="ghost" disabled={busy === 'schedule'} onClick={() => act('schedule', 'schedule', { scheduledLocal: when })}>{t('content.schedule')}</Button></div>
          )}
          {cEdit && editable && (
            <div className="rounded-lg border border-slate-800 p-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-300">{t('media.title')}</span><button className="text-sky-400 hover:underline" onClick={loadMedia}>{t('media.attached')} ({item.mediaPaths.length}) ↓</button></div>
              {assets && (
                <div className="space-y-2">
                  {caps && !caps.chromium && <p className="text-xs text-amber-300">{t('media.noChromium')}</p>}
                  {assets.length > 0 && <div className="flex flex-wrap gap-2">{assets.map(a => <div key={a.id} className="relative"><img src={`/api/workspaces/${ws.id}/media/${a.id}/file`} alt="" className="h-28 w-28 rounded-lg object-cover" /><button onClick={() => removeAsset(a.id)} className="absolute right-1 top-1 rounded bg-slate-900/80 px-1 text-[10px] text-rose-300">{t('common.delete')}</button></div>)}</div>}
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Field label={t('media.template')}><Select value={card.template} onChange={e => setCard(v => ({ ...v, template: e.target.value }))}>{(caps?.templates ?? ['quote', 'tips', 'hero', 'stat']).map(x => <option key={x} value={x}>{x}</option>)}</Select></Field>
                    <Field label={t('media.theme')}><Select value={card.theme} onChange={e => setCard(v => ({ ...v, theme: e.target.value }))}>{(caps?.themes ?? ['default']).map(x => <option key={x} value={x}>{x}</option>)}</Select></Field>
                    <div className="sm:col-span-2"><Field label={t('media.hint')}><Input value={card.hint} onChange={e => setCard(v => ({ ...v, hint: e.target.value }))} /></Field></div>
                    <Field label="kicker"><Input value={card.kicker} onChange={e => setCard(v => ({ ...v, kicker: e.target.value }))} /></Field>
                    <Field label={card.template === 'quote' ? 'quote' : 'title'}><Input value={card.template === 'quote' ? card.quote : card.title} onChange={e => setCard(v => card.template === 'quote' ? { ...v, quote: e.target.value } : { ...v, title: e.target.value })} /></Field>
                    {card.template === 'tips' ? <div className="sm:col-span-2"><Field label="items (บรรทัดละข้อ)"><Textarea value={card.items} onChange={e => setCard(v => ({ ...v, items: e.target.value }))} className="min-h-16" /></Field></div> : <div className="sm:col-span-2"><Field label="sub"><Input value={card.sub} onChange={e => setCard(v => ({ ...v, sub: e.target.value }))} /></Field></div>}
                  </div>
                  <div className="flex flex-wrap gap-2">{cAi && <Button disabled={busy === 'aicard' || !caps?.chromium} onClick={aiCard}>{busy === 'aicard' ? t('media.rendering') : t('media.aiCard')}</Button>}<Button variant="ghost" disabled={busy === 'card' || !caps?.chromium} onClick={renderCard}>{busy === 'card' ? t('media.rendering') : t('media.render')}</Button></div>
                </div>
              )}
            </div>
          )}
          <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
            <div><div className="mb-1 font-semibold">{t('content.approvals')}</div>{item.approvals.length === 0 ? '—' : <ul>{item.approvals.map(a => <li key={a.id}>{a.status} · {a.requestedBy.name}{a.reviewedBy && ` → ${a.reviewedBy.name}`}{a.reviewerComment && ` "${a.reviewerComment}"`} · {fmt(a.reviewedAt ?? a.requestedAt)}</li>)}</ul>}</div>
            <div><div className="mb-1 font-semibold"><button className="hover:text-sky-400" onClick={loadRevs}>{t('content.revisions')} ({item._count.revisions}) ↓</button></div>{revs && <ul className="space-y-1">{revs.map(r => <li key={r.version}>v{r.version} · {r.editedBy === 'ai' ? 'AI' : r.editedBy ? 'คน' : '—'} · {r.reason ?? ''} · {fmt(r.createdAt)}<div className="truncate text-slate-500">{r.caption?.slice(0, 100)}</div></li>)}</ul>}</div>
          </div>
        </div>
      )}
    </div>
  );
}
