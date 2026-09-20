'use client';
/** W-3 บทความเว็บไซต์ — AI ร่างจากคลิป/โพสต์/แบรนด์ → ตรวจ → อนุมัติ → ขึ้น WordPress (ทุกปุ่มที่แตะเว็บลูกค้าต้องผ่านอนุมัติก่อน) */
import { useCallback, useEffect, useState } from 'react';
import { api, type SiteRow, type WebContent, type WebContentSources, type WebContentSummary, type WebPublishOutcome } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select, Textarea } from '@/components/ui';

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const statusTone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (s === 'PUBLISHED' || s === 'APPROVED' || s === 'ANALYZED' ? 'ok' : s === 'READY_FOR_APPROVAL' || s === 'SCHEDULED' ? 'warn' : s === 'PUBLISH_FAILED' || s === 'REJECTED' ? 'bad' : 'muted');
const wpTone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (s === 'OK' ? 'ok' : s === 'UNKNOWN' ? 'muted' : 'bad');

export default function WebContentPage() {
  const { ws, can } = useWorkspace();
  const [sites, setSites] = useState<SiteRow[] | null>(null); const [items, setItems] = useState<WebContent[]>([]); const [summary, setSummary] = useState<WebContentSummary | null>(null);
  const [sel, setSel] = useState<WebContent | null>(null); const [sources, setSources] = useState<WebContentSources | null>(null);
  const [form, setForm] = useState({ siteId: '', topic: '', targetQuery: '' }); const [showNew, setShowNew] = useState(false);
  const [wp, setWp] = useState({ siteId: '', username: '', appPassword: '' }); const [showWp, setShowWp] = useState(false);
  const [pickYt, setPickYt] = useState<string[]>([]); const [pickFb, setPickFb] = useState<string[]>([]); const [when, setWhen] = useState('');
  const [edit, setEdit] = useState<{ title: string; bodyHtml: string; excerpt: string; metaDescription: string } | null>(null);
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, list, sum] = await Promise.all([api<SiteRow[]>(`/workspaces/${ws.id}/web/sites`), api<WebContent[]>(`/workspaces/${ws.id}/web/content`), api<WebContentSummary>(`/workspaces/${ws.id}/web/content/summary`)]);
      const active = s.filter(x => !x.disconnectedAt); setSites(active); setItems(list); setSummary(sum);
      setForm(f => ({ ...f, siteId: f.siteId || active[0]?.id || '' })); setWp(w => ({ ...w, siteId: w.siteId || active[0]?.id || '' }));
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    setError(null);
    try {
      const d = await api<WebContent>(`/workspaces/${ws.id}/web/content/${id}`); setSel(d); setEdit(null); setPickYt([]); setPickFb([]);
      if (d.siteId) setSources(await api<WebContentSources>(`/workspaces/${ws.id}/web/sites/${d.siteId}/content-sources`).catch(() => null));
    } catch (e) { setError(e); }
  };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); if (sel) await open(sel.id); } catch (e) { setError(e); } finally { setBusy(''); } };
  const create = () => run('new', async () => { const r = await api<WebContent>(`/workspaces/${ws.id}/web/content`, { method: 'POST', body: { siteId: form.siteId, topic: form.topic || undefined, targetQuery: form.targetQuery || undefined } }); setShowNew(false); setForm(f => ({ ...f, topic: '', targetQuery: '' })); setSel(r); });
  const generate = (id: string) => run('gen', async () => { const r = await api<WebContent>(`/workspaces/${ws.id}/web/content/${id}/generate`, { method: 'POST', body: { ...(pickYt.length && { youtubeContentIds: pickYt }), ...(pickFb.length && { facebookPostIds: pickFb }) } }); setNotice(`✔ ${r.webMeta?.title ?? ''}`); });
  const act = (id: string, path: string, label: string, body: unknown = {}) => run(path, async () => { await api(`/workspaces/${ws.id}/web/content/${id}/${path}`, { method: 'POST', body }); setNotice(label); });
  const save = (id: string) => run('save', async () => { await api(`/workspaces/${ws.id}/web/content/${id}`, { method: 'PATCH', body: { title: edit!.title, bodyHtml: edit!.bodyHtml, excerpt: edit!.excerpt || undefined, metaDescription: edit!.metaDescription || undefined } }); setEdit(null); setNotice(t('common.saved')); });
  const publish = (id: string, asDraft: boolean) => run('pub', async () => { const r = await api<{ outcome: WebPublishOutcome }>(`/workspaces/${ws.id}/web/content/${id}/publish`, { method: 'POST', body: { asDraft } }); setNotice(`${t('wc.publish')}: ${r.outcome.link ?? r.outcome.status}`); });
  const schedule = (id: string) => run('sch', async () => { await api(`/workspaces/${ws.id}/web/content/${id}/schedule`, { method: 'POST', body: { scheduledLocal: when } }); setNotice(t('wc.schedule')); });
  const connectWp = () => run('wp', async () => { const r = await api<{ userName: string }>(`/workspaces/${ws.id}/web/sites/${wp.siteId}/wordpress`, { method: 'POST', body: { username: wp.username, appPassword: wp.appPassword } }); setWp(w => ({ ...w, username: '', appPassword: '' })); setShowWp(false); setNotice(`${t('wc.wpStatus.OK')} · ${r.userName}`); });
  const disconnectWp = (siteId: string) => run('wpx', async () => { await api(`/workspaces/${ws.id}/web/sites/${siteId}/wordpress`, { method: 'DELETE' }); setNotice(t('wc.wpDisconnect')); });

  if (!sites) return <div><ErrorBox error={error} /><Loading /></div>;
  const manage = can('web.content.create'); const approve = can('web.content.approve'); const pub = can('web.content.publish');
  const m = sel?.webMeta; const notes = sel?.aiNotes ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('wc.title')}</h1><p className="text-sm text-slate-400">{t('wc.subtitle')}</p></div>
        <div className="flex gap-2">{can('web.manage') && <Button variant="ghost" onClick={() => setShowWp(v => !v)}>{t('wc.wpConnect')}</Button>}{manage && sites.length > 0 && <Button onClick={() => setShowNew(v => !v)}>{t('wc.new')}</Button>}</div>
      </div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi value={summary.drafts} label={t('wc.drafts')} accent="amber" icon="✍️" />
          <Kpi value={summary.pendingApproval} label={t('wc.pending')} tone={summary.pendingApproval ? 'warn' : undefined} accent="violet" icon="⏳" />
          <Kpi value={summary.published} label={t('wc.published')} accent="emerald" icon="🌐" />
          <Kpi value={`${summary.wordpressConnected}/${sites.length}`} label={t('wc.wordpress')} accent="blue" icon="🔌" sub={summary.failed ? `${summary.failed} ${t('ecs.SEND_FAILED')}` : undefined} />
        </div>
      )}

      {showWp && can('web.manage') && (
        <Card title={t('wc.wpConnect')}>
          <div className="grid gap-2 md:grid-cols-4">
            <Field label={t('wc.site')}><Select value={wp.siteId} onChange={e => setWp(w => ({ ...w, siteId: e.target.value }))}>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label={t('wc.wpUser')}><Input value={wp.username} onChange={e => setWp(w => ({ ...w, username: e.target.value }))} autoComplete="off" /></Field>
            <Field label={t('wc.wpPassword')} hint={t('wc.wpHint')}><Input type="password" value={wp.appPassword} onChange={e => setWp(w => ({ ...w, appPassword: e.target.value }))} autoComplete="new-password" /></Field>
            <div className="flex items-end"><Button disabled={busy === 'wp' || !wp.username || !wp.appPassword} onClick={connectWp}>{busy === 'wp' ? t('common.loading') : t('common.save')}</Button></div>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {sites.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 border-t border-slate-800 py-1">
                <span className="font-medium">{s.name}</span><Pill tone={wpTone(s.wpStatus)}>{t(`wc.wpStatus.${s.wpStatus}` as MessageKey)}</Pill>
                {s.wpUserName && <span className="text-xs text-slate-500">{s.wpUserName}</span>}
                {s.publishingPaused && <Pill tone="warn">{t('wc.publishPaused')}</Pill>}
                {s.wpStatus !== 'UNKNOWN' && <button className="text-xs text-slate-400 hover:underline" onClick={() => disconnectWp(s.id)}>{t('wc.wpDisconnect')}</button>}
                {s.wpLastError && <span className="text-xs text-rose-400">{s.wpLastError}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showNew && manage && (
        <Card title={t('wc.new')}>
          <div className="grid gap-2 md:grid-cols-4">
            <Field label={t('wc.site')}><Select value={form.siteId} onChange={e => setForm(f => ({ ...f, siteId: e.target.value }))}>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label={t('wc.topic')}><Input value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} /></Field>
            <Field label={t('wc.targetQuery')}><Input value={form.targetQuery} onChange={e => setForm(f => ({ ...f, targetQuery: e.target.value }))} /></Field>
            <div className="flex items-end"><Button disabled={busy === 'new' || !form.siteId} onClick={create}>{busy === 'new' ? t('common.loading') : t('common.save')}</Button></div>
          </div>
        </Card>
      )}

      {sites.length === 0 ? <Empty text={t('web.noSites')} /> : items.length === 0 ? <Empty text={t('wc.noArticles')} /> : (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
          <Card title={`${t('wc.title')} (${items.length})`}>
            <ul className="space-y-1">
              {items.map(c => (
                <li key={c.id}>
                  <button onClick={() => open(c.id)} className={`w-full rounded-lg border p-2 text-left text-sm ${sel?.id === c.id ? 'border-sky-500 bg-sky-500/5' : 'border-slate-800 hover:bg-slate-800/60'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.webMeta?.title ?? c.title ?? '—'}</span><Pill tone={statusTone(c.status)}>{t(`cs.${c.status}` as MessageKey)}</Pill></div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{c.site?.name} · {fmt(c.updatedAt)}{c.aiModel ? ` · ${c.aiModel}` : ''}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {sel && (
            <div className="space-y-3">
              <Card title={m?.title ?? sel.title ?? t('wc.new')} actions={<Pill tone={statusTone(sel.status)}>{t(`cs.${sel.status}` as MessageKey)}</Pill>}>
                <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                  <span>{sel.site?.name}</span><span>·</span><span>{sel.site?.brand.client.name} / {sel.site?.brand.name}</span>
                  {m?.slug && <><span>·</span><span className="truncate">/{m.slug}</span></>}
                  {sel.site && <Pill tone={wpTone(sel.site.wpStatus)}>{t(`wc.wpStatus.${sel.site.wpStatus}` as MessageKey)}</Pill>}
                </div>
                {sel.relationsTo.length > 0 && <p className="mt-2 text-xs text-slate-500">{t('wc.sources')}: {sel.relationsTo.map(r => r.parent.title).join(' · ')}</p>}
                {sel.lastError && <p className="mt-2 text-sm text-rose-400">{sel.lastError}</p>}
                {sel.reviewResult && sel.reviewResult.result !== 'PASS' && (
                  <div className="mt-2 rounded-lg border border-amber-900 bg-amber-950/40 p-2 text-sm text-amber-200">
                    <div>{sel.reviewResult.summary}</div>
                    <ul className="mt-1 list-disc pl-5 text-xs">{sel.reviewResult.issues.map((i, n) => <li key={n}>[{i.severity}] {i.detail}</li>)}</ul>
                  </div>
                )}
                {(notes?.missingInfo?.length ?? 0) > 0 && <div className="mt-2 text-sm"><span className="text-amber-400">{t('wc.missingInfo')}:</span><ul className="list-disc pl-5 text-xs text-slate-300">{notes!.missingInfo!.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                {(notes?.aiInterpretation?.length ?? 0) > 0 && <div className="mt-2 text-xs text-slate-500">{t('wc.aiInterpretation')}: {notes!.aiInterpretation!.join(' · ')}</div>}

                <div className="mt-3 flex flex-wrap gap-2">
                  {manage && ['DRAFT', 'IDEA', 'PLANNED', 'NEEDS_REVISION'].includes(sel.status) && <Button variant="ghost" disabled={busy === 'gen'} onClick={() => generate(sel.id)}>{busy === 'gen' ? t('common.loading') : m?.bodyHtml ? t('wc.regenerate') : t('wc.generate')}</Button>}
                  {manage && ['DRAFT', 'NEEDS_REVISION'].includes(sel.status) && m?.bodyHtml && <Button disabled={busy === 'submit'} onClick={() => act(sel.id, 'submit', t('wc.submit'))}>{t('wc.submit')}</Button>}
                  {approve && sel.status === 'READY_FOR_APPROVAL' && <>
                    <Button disabled={busy === 'approve'} onClick={() => act(sel.id, 'approve', t('wc.approve'))}>{t('wc.approve')}</Button>
                    <Button variant="ghost" onClick={() => act(sel.id, 'request-changes', t('wc.requestChanges'))}>{t('wc.requestChanges')}</Button>
                    <Button variant="danger" onClick={() => act(sel.id, 'reject', t('wc.reject'))}>{t('wc.reject')}</Button>
                  </>}
                  {pub && ['APPROVED', 'PUBLISH_FAILED', 'SCHEDULED'].includes(sel.status) && <>
                    <Button disabled={busy === 'pub'} onClick={() => publish(sel.id, false)}>{busy === 'pub' ? t('common.loading') : t('wc.publish')}</Button>
                    <Button variant="ghost" onClick={() => publish(sel.id, true)}>{t('wc.publishDraft')}</Button>
                    <Input type="datetime-local" className="w-52" value={when} onChange={e => setWhen(e.target.value)} />
                    <Button variant="ghost" disabled={!when || busy === 'sch'} onClick={() => schedule(sel.id)}>{t('wc.schedule')}</Button>
                  </>}
                  {pub && sel.status === 'PUBLISHED' && <Button variant="ghost" disabled={busy === 'wordpress-update'} onClick={() => act(sel.id, 'wordpress-update', t('wc.wpUpdate'))}>{t('wc.wpUpdate')}</Button>}
                  {m?.wpLink && <a className="self-center text-sm text-sky-400 hover:underline" href={m.wpLink} target="_blank" rel="noreferrer">{t('wc.viewOnSite')} ↗</a>}
                  {manage && !['PUBLISHED', 'ANALYZED', 'CANCELLED'].includes(sel.status) && <Button variant="ghost" onClick={() => act(sel.id, 'reopen', t('wc.reopen'))}>{t('wc.reopen')}</Button>}
                </div>
                {sel.scheduledAt && <p className="mt-2 text-xs text-slate-500">{t('wc.schedule')}: {fmt(sel.scheduledAt)} ({sel.scheduledTz})</p>}
              </Card>

              {manage && ['DRAFT', 'IDEA', 'PLANNED', 'NEEDS_REVISION'].includes(sel.status) && sources && (
                <Card title={t('wc.sources')}>
                  <p className="mb-2 text-xs text-slate-500">{t('wc.sourcesHint')}</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div><div className="mb-1 text-xs font-semibold text-slate-400">YouTube</div>
                      {sources.youtube.length === 0 ? <p className="text-xs text-slate-500">—</p> : sources.youtube.slice(0, 10).map(v => (
                        <label key={v.id} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={pickYt.includes(v.id)} onChange={e => setPickYt(p => e.target.checked ? [...p, v.id] : p.filter(x => x !== v.id))} /><span className="truncate">{v.title}</span></label>
                      ))}
                    </div>
                    <div><div className="mb-1 text-xs font-semibold text-slate-400">Facebook</div>
                      {sources.facebook.length === 0 ? <p className="text-xs text-slate-500">—</p> : sources.facebook.slice(0, 10).map(p => (
                        <label key={p.id} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={pickFb.includes(p.id)} onChange={e => setPickFb(v => e.target.checked ? [...v, p.id] : v.filter(x => x !== p.id))} /><span className="truncate">{p.message || '—'}</span></label>
                      ))}
                    </div>
                  </div>
                </Card>
              )}

              {m?.bodyHtml && (
                <Card title={t('wc.body')} actions={manage && !['PUBLISHED', 'ANALYZED', 'CANCELLED'].includes(sel.status) ? (
                  edit ? <span className="flex gap-2"><Button disabled={busy === 'save'} onClick={() => save(sel.id)}>{t('common.save')}</Button><Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button></span>
                    : <Button variant="ghost" onClick={() => setEdit({ title: m.title ?? '', bodyHtml: m.bodyHtml ?? '', excerpt: m.excerpt ?? '', metaDescription: m.metaDescription ?? '' })}>{t('common.edit')}</Button>
                ) : undefined}>
                  {edit ? (
                    <div className="space-y-2">
                      <Field label={t('wc.new')}><Input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field>
                      <Field label={t('wc.excerpt')}><Input value={edit.excerpt} onChange={e => setEdit({ ...edit, excerpt: e.target.value })} /></Field>
                      <Field label={t('wc.metaDescription')}><Input value={edit.metaDescription} onChange={e => setEdit({ ...edit, metaDescription: e.target.value })} /></Field>
                      <Field label={t('wc.body')}><Textarea className="min-h-64 font-mono text-xs" value={edit.bodyHtml} onChange={e => setEdit({ ...edit, bodyHtml: e.target.value })} /></Field>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex flex-wrap gap-1 text-xs text-slate-500">{m.tags.map(x => <span key={x} className="rounded bg-slate-800 px-1.5 py-0.5">#{x}</span>)}{m.categories.map(x => <span key={x} className="rounded bg-slate-800 px-1.5 py-0.5">{x}</span>)}</div>
                      {m.excerpt && <p className="mb-2 text-sm text-slate-400">{m.excerpt}</p>}
                      <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm leading-7" dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
                    </>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
