'use client';
/** W-4 อีเมลการตลาด — ผู้ให้บริการส่งจำนวนมาก + รายชื่อที่ยินยอม (PDPA) + แคมเปญที่ต้องอนุมัติก่อนส่ง · ตัวเลขที่ไม่มี = "ไม่มีข้อมูล" ไม่ใช่ 0 */
import { useCallback, useEffect, useState } from 'react';
import { EMAIL_PROVIDERS } from '@fbpm/shared';
import { api, type BrandLite, type Client, type ClientDetail, type EmailCampaignRow, type EmailListRow, type EmailProviderView, type EmailSendOutcome, type EmailStats, type EmailSubscriberRow, type EmailSummary } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select, Textarea } from '@/components/ui';

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const num = (v: number | null | undefined) => (v === null || v === undefined ? t('em.noData') : v.toLocaleString('th-TH'));
const tone = (s: string): 'ok' | 'warn' | 'bad' | 'muted' => (s === 'SENT' || s === 'APPROVED' ? 'ok' : s === 'READY_FOR_APPROVAL' || s === 'SCHEDULED' || s === 'SENDING' ? 'warn' : s === 'SEND_FAILED' || s === 'REJECTED' ? 'bad' : 'muted');

export default function EmailPage() {
  const { ws, me, can } = useWorkspace();
  const [provider, setProvider] = useState<EmailProviderView | null>(null); const [lists, setLists] = useState<EmailListRow[] | null>(null); const [campaigns, setCampaigns] = useState<EmailCampaignRow[]>([]); const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [brands, setBrands] = useState<(BrandLite & { clientName: string })[]>([]);
  const [pForm, setPForm] = useState({ provider: 'brevo', apiKey: '', webhookSecret: '' }); const [showProvider, setShowProvider] = useState(false);
  const [lForm, setLForm] = useState({ brandId: '', name: '', fromEmail: '', fromName: '', replyTo: '', consentText: '' }); const [showList, setShowList] = useState(false);
  const [selList, setSelList] = useState<EmailListRow | null>(null); const [subs, setSubs] = useState<EmailSubscriberRow[]>([]);
  const [imp, setImp] = useState({ text: '', consentSource: '', consentConfirmed: false }); const [showImport, setShowImport] = useState(false);
  const [cForm, setCForm] = useState({ listId: '', name: '' }); const [showCampaign, setShowCampaign] = useState(false);
  const [sel, setSel] = useState<EmailCampaignRow | null>(null); const [stats, setStats] = useState<EmailStats | null>(null);
  const [edit, setEdit] = useState<{ subject: string; preheader: string; bodyHtml: string } | null>(null); const [goal, setGoal] = useState(''); const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, l, c, s] = await Promise.all([api<EmailProviderView>(`/workspaces/${ws.id}/email/provider`), api<EmailListRow[]>(`/workspaces/${ws.id}/email/lists`), api<EmailCampaignRow[]>(`/workspaces/${ws.id}/email/campaigns`), api<EmailSummary>(`/workspaces/${ws.id}/email/summary`)]);
      setProvider(p); setLists(l); setCampaigns(c); setSummary(s);
      setCForm(f => ({ ...f, listId: f.listId || l.find(x => !x.archivedAt)?.id || '' }));
      const cl = await api<Client[]>(`/workspaces/${ws.id}/clients`);
      const details = await Promise.all(cl.map(x => api<ClientDetail>(`/workspaces/${ws.id}/clients/${x.id}`)));
      const bs = details.flatMap(d => d.brands.map(b => ({ ...b, clientName: d.name }))); setBrands(bs); setLForm(f => ({ ...f, brandId: f.brandId || bs[0]?.id || '' }));
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setNotice(''); try { await fn(); await load(); if (sel) await openCampaign(sel.id); if (selList) await openList(selList.id); } catch (e) { setError(e); } finally { setBusy(''); } };
  const openList = async (id: string) => { const l = await api<EmailListRow>(`/workspaces/${ws.id}/email/lists/${id}`); setSelList(l); setSubs(await api<EmailSubscriberRow[]>(`/workspaces/${ws.id}/email/lists/${id}/subscribers`)); };
  const openCampaign = async (id: string) => { const c = await api<EmailCampaignRow>(`/workspaces/${ws.id}/email/campaigns/${id}`); setSel(c); setEdit(null); setStats(await api<EmailStats>(`/workspaces/${ws.id}/email/campaigns/${id}/stats`).catch(() => null)); };
  const saveProvider = () => run('prov', async () => { const r = await api<EmailProviderView>(`/workspaces/${ws.id}/email/provider`, { method: 'PUT', body: { provider: pForm.provider, apiKey: pForm.apiKey, webhookSecret: pForm.webhookSecret || undefined } }); setPForm(f => ({ ...f, apiKey: '', webhookSecret: '' })); setShowProvider(false); setNotice(`${t('em.provider')}: ${r.account?.status}${r.account?.lastError ? ` · ${r.account.lastError}` : ''}`); });
  const pauseProvider = (paused: boolean) => run('pause', async () => { await api(`/workspaces/${ws.id}/email/provider/pause`, { method: 'PATCH', body: { sendingPaused: paused } }); setNotice(paused ? t('em.pause') : t('em.resume')); });
  const createList = () => run('list', async () => { const r = await api<EmailListRow>(`/workspaces/${ws.id}/email/lists`, { method: 'POST', body: { brandId: lForm.brandId, name: lForm.name, fromEmail: lForm.fromEmail, fromName: lForm.fromName, replyTo: lForm.replyTo || undefined, consentText: lForm.consentText || undefined } }); setShowList(false); setLForm(f => ({ ...f, name: '', fromEmail: '', fromName: '', replyTo: '', consentText: '' })); await openList(r.id); });
  const importSubs = () => run('imp', async () => {
    const subscribers = imp.text.split('\n').map(l => l.trim()).filter(Boolean).map(line => { const [email, ...rest] = line.split(','); return { email: email!.trim(), name: rest.join(',').trim() || undefined }; });
    const r = await api<{ added: number; updated: number; skippedUnsubscribed: number; duplicates: number }>(`/workspaces/${ws.id}/email/lists/${selList!.id}/subscribers/import`, { method: 'POST', body: { subscribers, consentConfirmed: imp.consentConfirmed, consentSource: imp.consentSource } });
    setShowImport(false); setImp({ text: '', consentSource: '', consentConfirmed: false }); setNotice(`+${r.added} · ${r.updated} · ${t('em.unsubscribed')} ${r.skippedUnsubscribed}`);
  });
  const unsubscribe = (sid: string) => run('unsub', async () => { await api(`/workspaces/${ws.id}/email/lists/${selList!.id}/subscribers/${sid}`, { method: 'PATCH', body: { status: 'UNSUBSCRIBED' } }); });
  const createCampaign = () => run('camp', async () => { const r = await api<EmailCampaignRow>(`/workspaces/${ws.id}/email/campaigns`, { method: 'POST', body: { listId: cForm.listId, name: cForm.name } }); setShowCampaign(false); setCForm(f => ({ ...f, name: '' })); await openCampaign(r.id); });
  const generate = (id: string) => run('gen', async () => { const r = await api<EmailCampaignRow>(`/workspaces/${ws.id}/email/campaigns/${id}/generate`, { method: 'POST', body: { goal: goal || undefined } }); setNotice(`✔ ${r.subject ?? ''}`); });
  const act = (id: string, path: string, label: string, body: unknown = {}) => run(path, async () => { await api(`/workspaces/${ws.id}/email/campaigns/${id}/${path}`, { method: 'POST', body }); setNotice(label); });
  const saveCampaign = (id: string) => run('save', async () => { await api(`/workspaces/${ws.id}/email/campaigns/${id}`, { method: 'PATCH', body: { subject: edit!.subject, preheader: edit!.preheader || undefined, bodyHtml: edit!.bodyHtml } }); setEdit(null); setNotice(t('common.saved')); });
  const send = (id: string) => run('send', async () => { const r = await api<{ outcome: EmailSendOutcome }>(`/workspaces/${ws.id}/email/campaigns/${id}/send`, { method: 'POST', body: {} }); setNotice(`${t('em.send')}: ${r.outcome.sent}/${r.outcome.total}${r.outcome.failed ? ` · ${t('em.failed')} ${r.outcome.failed}` : ''}`); });
  const schedule = (id: string) => run('sch', async () => { await api(`/workspaces/${ws.id}/email/campaigns/${id}/schedule`, { method: 'POST', body: { scheduledLocal: when } }); setNotice(t('em.schedule')); });

  if (!lists || !provider) return <div><ErrorBox error={error} /><Loading /></div>;
  const manage = can('email.manage'); const approve = can('email.approve'); const sendPerm = can('email.send');
  const acc = provider.account;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">{t('em.title')}</h1><p className="text-sm text-slate-400">{t('em.subtitle')}</p></div>
        <div className="flex gap-2">{manage && <Button variant="ghost" onClick={() => setShowProvider(v => !v)}>{t('em.provider')}</Button>}{manage && lists.length > 0 && <Button onClick={() => setShowCampaign(v => !v)}>{t('em.newCampaign')}</Button>}</div>
      </div>
      {notice && <p className="text-sm text-emerald-400">✔ {notice}</p>}
      {!provider.sendEnabled && <p className="text-sm text-amber-400">⚠ {t('em.sendOff')}</p>}
      <ErrorBox error={error} />

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi value={summary.subscribers.toLocaleString('th-TH')} label={t('em.subscribed')} accent="teal" icon="👥" sub={`${summary.lists} ${t('em.lists')}`} />
          <Kpi value={summary.pendingApproval} label={t('wc.pending')} tone={summary.pendingApproval ? 'warn' : undefined} accent="violet" icon="⏳" />
          <Kpi value={summary.sent} label={t('em.sent')} accent="blue" icon="✉️" sub={summary.failed ? `${summary.failed} ${t('em.failed')}` : undefined} />
          <Kpi value={num(summary.totals.opened)} label={t('em.opened')} accent="amber" icon="👁" sub={t('em.statsHint')} />
        </div>
      )}

      {showProvider && manage && (
        <Card title={t('em.provider')}>
          <p className="mb-2 text-xs text-slate-500">{t('em.providerHint')}</p>
          <div className="grid gap-2 md:grid-cols-4">
            <Field label={t('em.provider')}><Select value={pForm.provider} onChange={e => setPForm(f => ({ ...f, provider: e.target.value }))}>{EMAIL_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}</Select></Field>
            <Field label={t('em.apiKey')}><Input type="password" value={pForm.apiKey} onChange={e => setPForm(f => ({ ...f, apiKey: e.target.value }))} autoComplete="new-password" /></Field>
            <Field label={t('em.webhookSecret')} hint={t('em.webhookHint')}><Input type="password" value={pForm.webhookSecret} onChange={e => setPForm(f => ({ ...f, webhookSecret: e.target.value }))} autoComplete="new-password" /></Field>
            <div className="flex items-end"><Button disabled={busy === 'prov' || !pForm.apiKey} onClick={saveProvider}>{busy === 'prov' ? t('common.loading') : t('common.save')}</Button></div>
          </div>
        </Card>
      )}

      {acc ? <Card title={t('em.provider')}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={acc.status === 'OK' ? 'ok' : acc.status === 'UNKNOWN' ? 'muted' : 'bad'}>{acc.provider} · {acc.status}</Pill>
            {acc.keyHint && <span className="text-xs text-slate-500">key {acc.keyHint}</span>}
            {acc.accountEmail && <span className="text-xs text-slate-500">{acc.accountEmail}</span>}
            {acc.lastError && <span className="text-xs text-amber-400">{acc.lastError}</span>}
            <Button variant="ghost" onClick={() => run('verify', async () => { await api(`/workspaces/${ws.id}/email/provider/verify`, { method: 'POST', body: {} }); })}>{t('em.verify')}</Button>
            <Button variant="ghost" onClick={() => pauseProvider(!acc.sendingPaused)}>{acc.sendingPaused ? t('em.resume') : t('em.pause')}</Button>
            {acc.sendingPaused && <Pill tone="warn">{t('em.pause')}</Pill>}
            {provider.webhookPath && <span className="text-xs text-slate-500">{t('em.webhookUrl')}: <code className="rounded bg-slate-800 px-1">{provider.webhookPath}</code>{acc.webhookConfigured ? '' : ' · ยังไม่ได้ตั้ง secret (webhook ปิดอยู่)'}</span>}
          </div>
      </Card> : <p className="text-sm text-amber-400">⚠ {t('em.needProvider')}</p>}

      <Card title={t('em.lists')} actions={manage && brands.length > 0 ? <Button variant="ghost" onClick={() => setShowList(v => !v)}>{t('em.newList')}</Button> : undefined}>
        {showList && manage && (
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            <Field label={t('yt.brand')}><Select value={lForm.brandId} onChange={e => setLForm(f => ({ ...f, brandId: e.target.value }))}>{brands.map(b => <option key={b.id} value={b.id}>{b.clientName} · {b.name}</option>)}</Select></Field>
            <Field label={t('em.listName')}><Input value={lForm.name} onChange={e => setLForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label={t('em.fromEmail')}><Input type="email" value={lForm.fromEmail} onChange={e => setLForm(f => ({ ...f, fromEmail: e.target.value }))} /></Field>
            <Field label={t('em.fromName')}><Input value={lForm.fromName} onChange={e => setLForm(f => ({ ...f, fromName: e.target.value }))} /></Field>
            <Field label={t('em.replyTo')}><Input type="email" value={lForm.replyTo} onChange={e => setLForm(f => ({ ...f, replyTo: e.target.value }))} /></Field>
            <Field label={t('em.consentText')}><Input value={lForm.consentText} onChange={e => setLForm(f => ({ ...f, consentText: e.target.value }))} /></Field>
            <div className="flex items-end"><Button disabled={busy === 'list' || !lForm.name || !lForm.fromEmail || !lForm.fromName} onClick={createList}>{t('common.save')}</Button></div>
          </div>
        )}
        {lists.length === 0 ? <Empty text={t('em.noLists')} /> : (
          <ul className="space-y-1 text-sm">
            {lists.map(l => (
              <li key={l.id}>
                <button onClick={() => openList(l.id)} className={`w-full rounded-lg border p-2 text-left ${selList?.id === l.id ? 'border-sky-500 bg-sky-500/5' : 'border-slate-800 hover:bg-slate-800/60'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{l.name}</span><span className="text-xs text-slate-500">{l.brand.name} · {l.fromEmail}</span></div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-400"><span>{t('em.subscribed')} {l.counts.subscribed}</span><span>{t('em.unsubscribed')} {l.counts.unsubscribed}</span><span>{t('em.bounced')} {l.counts.bounced}</span>{l.archivedAt && <Pill tone="muted">archived</Pill>}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selList && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{selList.name} · {t('em.subscribers')} ({subs.length})</span>
              {manage && <Button variant="ghost" onClick={() => setShowImport(v => !v)}>{t('em.import')}</Button>}
            </div>
            {showImport && manage && (
              <div className="mb-3 space-y-2">
                <Field label={t('em.import')} hint={t('em.importHint')}><Textarea value={imp.text} onChange={e => setImp(i => ({ ...i, text: e.target.value }))} placeholder={'somchai@example.com, สมชาย\nsuda@example.com'} /></Field>
                <Field label={t('em.consentSource')}><Input value={imp.consentSource} onChange={e => setImp(i => ({ ...i, consentSource: e.target.value }))} /></Field>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={imp.consentConfirmed} onChange={e => setImp(i => ({ ...i, consentConfirmed: e.target.checked }))} />{t('em.consentConfirm')}</label>
                <Button disabled={busy === 'imp' || !imp.consentConfirmed || !imp.consentSource || !imp.text.trim()} onClick={importSubs}>{busy === 'imp' ? t('common.loading') : t('em.import')}</Button>
              </div>
            )}
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="py-1">{t('em.subscribers')}</th><th>{t('em.subscribed')}</th><th>{t('em.consentSource')}</th><th /></tr></thead>
                <tbody>{subs.map(s => (
                  <tr key={s.id} className="border-t border-slate-800"><td className="py-1">{s.email}{s.name ? ` · ${s.name}` : ''}</td><td><Pill tone={s.status === 'SUBSCRIBED' ? 'ok' : s.status === 'UNSUBSCRIBED' ? 'muted' : 'bad'}>{t(`em.${s.status === 'SUBSCRIBED' ? 'subscribed' : s.status === 'UNSUBSCRIBED' ? 'unsubscribed' : s.status === 'BOUNCED' ? 'bounced' : 'complained'}` as MessageKey)}</Pill></td><td className="text-slate-500">{s.consentSource ?? '—'}</td><td className="text-right">{manage && s.status === 'SUBSCRIBED' && <button className="text-slate-400 hover:underline" onClick={() => unsubscribe(s.id)}>{t('em.unsubscribe')}</button>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {showCampaign && manage && (
        <Card title={t('em.newCampaign')}>
          <div className="grid gap-2 md:grid-cols-3">
            <Field label={t('em.lists')}><Select value={cForm.listId} onChange={e => setCForm(f => ({ ...f, listId: e.target.value }))}>{lists.filter(l => !l.archivedAt).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label={t('em.campaignName')}><Input value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <div className="flex items-end"><Button disabled={busy === 'camp' || !cForm.name || !cForm.listId} onClick={createCampaign}>{t('common.save')}</Button></div>
          </div>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <Card title={`${t('em.campaigns')} (${campaigns.length})`}>
          {campaigns.length === 0 ? <Empty text={t('em.noCampaigns')} /> : (
            <ul className="space-y-1">
              {campaigns.map(c => (
                <li key={c.id}>
                  <button onClick={() => openCampaign(c.id)} className={`w-full rounded-lg border p-2 text-left text-sm ${sel?.id === c.id ? 'border-sky-500 bg-sky-500/5' : 'border-slate-800 hover:bg-slate-800/60'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.subject ?? c.name}</span><Pill tone={tone(c.status)}>{t(`ecs.${c.status}` as MessageKey)}</Pill></div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{c.list.name} · {fmt(c.sentAt ?? c.scheduledAt ?? c.updatedAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {sel && (
          <div className="space-y-3">
            <Card title={sel.subject ?? sel.name} actions={<Pill tone={tone(sel.status)}>{t(`ecs.${sel.status}` as MessageKey)}</Pill>}>
              <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>{sel.list.name}</span><span>·</span><span>{sel.list.fromName} &lt;{sel.list.fromEmail}&gt;</span>{sel.aiModel && <><span>·</span><span>{sel.aiModel}</span></>}</div>
              {sel.lastError && <p className="mt-2 text-sm text-rose-400">{sel.lastError}</p>}
              {sel.reviewResult && sel.reviewResult.result !== 'PASS' && (
                <div className="mt-2 rounded-lg border border-amber-900 bg-amber-950/40 p-2 text-sm text-amber-200">
                  <div>{sel.reviewResult.summary}</div>
                  <ul className="mt-1 list-disc pl-5 text-xs">{sel.reviewResult.issues.map((i, n) => <li key={n}>[{i.severity}] {i.detail}</li>)}</ul>
                </div>
              )}
              {(sel.aiNotes?.missingInfo?.length ?? 0) > 0 && <div className="mt-2 text-sm"><span className="text-amber-400">{t('wc.missingInfo')}:</span> <span className="text-xs text-slate-300">{sel.aiNotes!.missingInfo!.join(' · ')}</span></div>}
              {(sel.aiNotes?.subjectAlternatives?.length ?? 0) > 0 && <div className="mt-1 text-xs text-slate-500">{t('em.subject')}: {sel.aiNotes!.subjectAlternatives!.join(' | ')}</div>}

              <div className="mt-3 flex flex-wrap items-end gap-2">
                {manage && ['DRAFT', 'NEEDS_REVISION'].includes(sel.status) && <>
                  <Field label={t('em.goal')}><Input className="w-56" value={goal} onChange={e => setGoal(e.target.value)} /></Field>
                  <Button variant="ghost" disabled={busy === 'gen'} onClick={() => generate(sel.id)}>{busy === 'gen' ? t('common.loading') : t('em.generate')}</Button>
                </>}
                {manage && ['DRAFT', 'NEEDS_REVISION'].includes(sel.status) && sel.bodyHtml && <Button onClick={() => act(sel.id, 'submit', t('wc.submit'))}>{t('wc.submit')}</Button>}
                {approve && sel.status === 'READY_FOR_APPROVAL' && <>
                  <Button onClick={() => act(sel.id, 'approve', t('wc.approve'))}>{t('wc.approve')}</Button>
                  <Button variant="ghost" onClick={() => act(sel.id, 'request-changes', t('wc.requestChanges'))}>{t('wc.requestChanges')}</Button>
                  <Button variant="danger" onClick={() => act(sel.id, 'reject', t('wc.reject'))}>{t('wc.reject')}</Button>
                </>}
                {manage && sel.bodyHtml && !['SENDING'].includes(sel.status) && <Button variant="ghost" disabled={busy === 'test-send'} onClick={() => act(sel.id, 'test-send', `${t('em.testSend')} → ${me.user.email}`, { to: me.user.email })}>{t('em.testSend')}</Button>}
                {sendPerm && ['APPROVED', 'SEND_FAILED', 'SCHEDULED'].includes(sel.status) && <>
                  <Button disabled={busy === 'send'} onClick={() => send(sel.id)}>{busy === 'send' ? t('common.loading') : t('em.send')}</Button>
                  <Input type="datetime-local" className="w-52" value={when} onChange={e => setWhen(e.target.value)} />
                  <Button variant="ghost" disabled={!when || busy === 'sch'} onClick={() => schedule(sel.id)}>{t('em.schedule')}</Button>
                </>}
                {manage && !['SENT', 'SENDING', 'CANCELLED'].includes(sel.status) && <Button variant="ghost" onClick={() => act(sel.id, 'reopen', t('wc.reopen'))}>{t('wc.reopen')}</Button>}
              </div>
              {sel.scheduledAt && <p className="mt-2 text-xs text-slate-500">{t('em.schedule')}: {fmt(sel.scheduledAt)} ({sel.scheduledTz})</p>}
            </Card>

            <Card title={t('em.stats')}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {([['em.recipients', sel.recipientCount], ['em.sent', sel.sentCount], ['em.delivered', sel.deliveredCount], ['em.opened', sel.openedCount], ['em.clicked', sel.clickedCount], ['em.bounces', sel.bouncedCount]] as [MessageKey, number | null][]).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-800 p-2"><div className="text-lg font-bold tabular-nums">{num(v)}</div><div className="text-[11px] text-slate-400">{t(k)}</div></div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">{t('em.statsHint')}</p>
              {stats && stats.events.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs text-slate-400">{stats.events.slice(0, 30).map((e, i) => <li key={i}>{fmt(e.occurredAt)} · {e.type} · {e.email ?? '—'}</li>)}</ul>
              )}
            </Card>

            {sel.bodyHtml && (
              <Card title={t('em.bodyHtml')} actions={manage && !['SENT', 'SENDING', 'CANCELLED'].includes(sel.status) ? (
                edit ? <span className="flex gap-2"><Button disabled={busy === 'save'} onClick={() => saveCampaign(sel.id)}>{t('common.save')}</Button><Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button></span>
                  : <Button variant="ghost" onClick={() => setEdit({ subject: sel.subject ?? '', preheader: sel.preheader ?? '', bodyHtml: sel.bodyHtml ?? '' })}>{t('common.edit')}</Button>
              ) : undefined}>
                {edit ? (
                  <div className="space-y-2">
                    <Field label={t('em.subject')}><Input value={edit.subject} onChange={e => setEdit({ ...edit, subject: e.target.value })} /></Field>
                    <Field label={t('em.preheader')}><Input value={edit.preheader} onChange={e => setEdit({ ...edit, preheader: e.target.value })} /></Field>
                    <Field label={t('em.bodyHtml')}><Textarea className="min-h-64 font-mono text-xs" value={edit.bodyHtml} onChange={e => setEdit({ ...edit, bodyHtml: e.target.value })} /></Field>
                  </div>
                ) : <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm leading-7" dangerouslySetInnerHTML={{ __html: sel.bodyHtml }} />}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
