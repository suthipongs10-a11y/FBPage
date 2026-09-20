'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select, Textarea } from '@/components/ui';
import { messengerErrorText, messengerText as mt, type Conversation, type ConversationDetail, type MessengerPage, type MessengerSettingsView } from '@/lib/messenger';

export default function MessengerRoute() {
  const { ws, can } = useWorkspace();
  return can('messenger.read') ? <MessengerWorkspace key={ws.id} workspaceId={ws.id} can={can} /> : <Empty text={mt.noAccess} />;
}
function MessengerWorkspace({ workspaceId, can }: { workspaceId: string; can: (p: string) => boolean }) {
  const base = `/workspaces/${workspaceId}/messenger`;
  const [view, setView] = useState<MessengerSettingsView | null>(null);
  const [pages, setPages] = useState<MessengerPage[]>([]); const [pageId, setPageId] = useState('');
  const [error, setError] = useState<unknown>(null); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reload = useCallback(async () => {
    const [v, p] = await Promise.all([api<MessengerSettingsView>(`${base}/settings`), api<MessengerPage[]>(`${base}/pages`)]);
    if (alive.current) { setView(v); setPages(p); }
  }, [base]);
  useEffect(() => { void reload().catch(e => { if (alive.current) setError(e); }); }, [reload]);
  const page = pages.find(p => p.id === pageId);
  return <div className="space-y-5"><div><h1 className="text-2xl font-bold">{mt.title}</h1><p className="mt-1 text-sm text-slate-400">{mt.subtitle}</p></div><ErrorBox error={error} />
    {!view ? <Loading /> : <>
      <p className="rounded-lg bg-amber-950 p-3 text-amber-200">{view.automaticSendEnabled ? 'โหมดส่งอัตโนมัติ: เพจที่เปิดใช้งานสามารถส่งคำตอบเองได้' : 'โหมดร่างรอตรวจ: ระบบเก็บคำตอบไว้ให้ตรวจและรับช่วง ยังไม่ส่งหาลูกค้า กรุณาตรวจร่างแล้วตอบผ่าน Meta Business Suite'}</p>
      <div className="grid gap-3 sm:grid-cols-3"><Kpi label={mt.enabledPages} value={pages.filter(p => p.messengerConfig?.enabled).length} /><Kpi label={mt.used} value={`${view.requestsToday} / ${view.settings?.dailyLimit ?? '—'}`} /><Kpi label={mt.ai} value={view.settings ? (view.settings.validatedAt ? mt.validated : mt.notValidated) : mt.noKey} /></div>
      {view.automationPaused && <p className="rounded-lg bg-amber-950 p-3 text-amber-200">{mt.paused}</p>}
      {can('ai.configure') && can('messenger.manage') && <AiSettings key={`${view.settings?.keyHint ?? ''}:${view.settings?.model ?? ''}`} view={view} base={base} reload={reload} />}
      <Field label={mt.page}><Select value={pageId} onChange={e => setPageId(e.target.value)}><option value="">{mt.choosePage}</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name} · {p.brand.name} · {p.messengerConfig?.enabled ? mt.on : mt.off}</option>)}</Select></Field>
      {!pages.length && <Empty text={mt.noPages} />}
      {page && <PageChat key={page.id} page={page} base={base} view={view} can={can} reload={reload} />}
    </>}
  </div>;
}
function AiSettings({ view, base, reload }: { view: MessengerSettingsView; base: string; reload: () => Promise<void> }) {
  const [key, setKey] = useState(''); const [model, setModel] = useState(view.settings?.model ?? 'gpt-5-mini'); const [limit, setLimit] = useState(view.settings?.dailyLimit ?? 500);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  async function save(remove = false) { setBusy(true); setError(null); setSaved(false); try { if (remove) await api(`${base}/settings/key`, { method: 'DELETE' }); else await api(`${base}/settings`, { method: 'PATCH', body: { model, dailyLimit: limit, ...(key.trim() && { apiKey: key.trim() }) } }); setKey(''); await reload(); setSaved(true); } catch (e) { setError(e); } finally { setBusy(false); } }
  return <Card title={mt.ai}><p className="mb-3 text-sm text-slate-400">{mt.dedicated}</p><div className="grid gap-3 md:grid-cols-3">
    <Field label={mt.key} hint={view.settings ? `${mt.keyHint} · …${view.settings.keyHint}` : undefined}><Input type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} maxLength={1000} /></Field>
    <Field label={mt.model}><Input value={model} onChange={e => setModel(e.target.value)} maxLength={120} /></Field>
    <Field label={mt.dailyLimit}><Input type="number" min={1} max={10000} value={limit} onChange={e => setLimit(Number(e.target.value))} /></Field>
  </div><p className="my-3 text-xs text-slate-400">{mt.limitHint}</p><div className="flex flex-wrap items-center gap-3"><Button disabled={busy || !model.trim() || !Number.isInteger(limit) || limit < 1 || limit > 10000 || (!view.settings && !key.trim())} onClick={() => void save()}>{mt.save}</Button>{view.settings && <Button variant="danger" disabled={busy} onClick={() => void save(true)}>{mt.removeKey}</Button>}{saved && <span role="status" className="text-sm text-emerald-400">{mt.saved}</span>}</div><ErrorBox error={error} /></Card>;
}
function PageChat({ page, base, view, can, reload }: { page: MessengerPage; base: string; view: MessengerSettingsView; can: (p: string) => boolean; reload: () => Promise<void> }) {
  const [instructions, setInstructions] = useState(page.messengerConfig?.instructions ?? ''); const [fallback, setFallback] = useState(page.messengerConfig?.fallbackMessage ?? mt.fallbackDefault);
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState<{ text: string; action: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]); const [conversationId, setConversationId] = useState(''); const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const alive = useRef(true); const request = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const loadInbox = useCallback(async () => { const seq = ++request.current; const rows = await api<Conversation[]>(`${base}/conversations?pageId=${encodeURIComponent(page.id)}`); const c = conversationId ? await api<ConversationDetail>(`${base}/conversations/${conversationId}`) : null; if (alive.current && seq === request.current) { setConversations(rows); setDetail(c); } }, [base, page.id, conversationId]);
  useEffect(() => { setDetail(null); void loadInbox().catch(e => { if (alive.current) setError(e); }); const timer = setInterval(() => { void loadInbox().catch(e => { if (alive.current) setError(e); }); }, 5000); return () => { clearInterval(timer); request.current++; }; }, [loadInbox]);
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(null); setNotice(''); try { await action(); if (!alive.current) return; await reload(); await loadInbox(); if (alive.current) setNotice(mt.saved); } catch (e) { if (alive.current) setError(e); } finally { if (alive.current) setBusy(false); } }
  const enabled = page.messengerConfig?.enabled ?? false;
  const unavailable = !!page.disconnectedAt || page.tokenStatus !== 'VALID';
  const savePage = (on: boolean) => api(`${base}/pages/${page.id}`, { method: 'PATCH', body: { enabled: on, instructions, fallbackMessage: fallback } });
  return <><ErrorBox error={error} />{notice && <p role="status" className="text-sm text-emerald-400">{notice}</p>}
    <Card title={`${mt.pageSetup} · ${page.name}`} actions={<Pill tone={enabled ? 'ok' : 'muted'}>{enabled ? mt.on : mt.off}</Pill>}>
      <p className="mb-3 text-sm text-slate-400">{mt.knowledge}: <strong>{page.brand.name}</strong> · <a className="text-sky-500" href="/clients">{mt.knowledgeLink}</a></p>
      {can('messenger.manage') && <div className="space-y-3"><Field label={mt.instructions} hint={mt.instructionsHint}><Textarea value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={5000} /></Field><Field label={mt.fallback}><Textarea value={fallback} onChange={e => setFallback(e.target.value)} maxLength={1800} /></Field>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !fallback.trim()} onClick={() => void run(() => savePage(enabled))}>{mt.save}</Button>
          {can('page.connect') && <><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { const r = await api<{ url: string }>(`${base.replace(/\/messenger$/, '')}/facebook/oauth/start?messenger=true`); window.location.assign(r.url); })}>{mt.connectPermission}</Button><Button variant="ghost" disabled={busy || unavailable || !view.webhookConfigured} onClick={() => void run(() => api(`${base}/pages/${page.id}/subscribe`, { method: 'POST' }))}>{page.messengerConfig?.subscribedAt ? mt.subscribed : mt.subscribe}</Button></>}
          <Button variant={enabled ? 'danger' : 'primary'} disabled={busy || (!enabled && (!page.messengerConfig?.subscribedAt || !view.settings?.validatedAt || unavailable || !fallback.trim()))} onClick={() => void run(() => savePage(!enabled))}>{enabled ? mt.off : mt.on}</Button>
        </div><p className="text-sm text-slate-400">{mt.enabledHint}</p></div>}
      {!view.webhookConfigured && <p className="mt-3 text-sm text-amber-500">{mt.missingMeta}</p>}{unavailable && <p className="mt-3 text-sm text-amber-500">{mt.pageUnavailable}</p>}
    </Card>
    {can('messenger.manage') && can('ai.use') && <Card title={mt.preview}><p className="mb-3 text-sm text-slate-400">{mt.previewHint}</p><Field label={mt.question}><Textarea placeholder={mt.questionPlaceholder} value={question} maxLength={6000} onChange={e => { setQuestion(e.target.value); setAnswer(null); }} /></Field><Button className="mt-3" disabled={busy || !question.trim() || !view.settings} onClick={() => void run(async () => { const r = await api<{ text: string; action: string }>(`${base}/pages/${page.id}/preview`, { method: 'POST', body: { text: question } }); if (alive.current) setAnswer(r); })}>{mt.test}</Button>{answer && <div className="mt-3 rounded-lg border border-emerald-800 p-4"><p className="mb-2 text-sm text-emerald-500">{mt.answer} · {mt.actions[answer.action]}</p><p className="whitespace-pre-wrap break-words">{answer.text}</p></div>}</Card>}
    <Card title={mt.inbox} actions={<Button variant="ghost" disabled={busy} onClick={() => void run(loadInbox)}>{mt.refresh}</Button>}>
      <p className="mb-3 text-xs text-slate-400">{mt.textOnly}</p>
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"><div className="max-h-[540px] space-y-2 overflow-auto">{!conversations.length && <Empty text={mt.emptyInbox} />}{conversations.map(c => <button key={c.id} onClick={() => { setDetail(null); setConversationId(c.id); }} className={`w-full rounded-lg border p-3 text-left ${conversationId === c.id ? 'border-sky-500' : 'border-slate-700'}`}><span className="block truncate text-sm">{mt.customer} · {c.psid.slice(-8)}</span><span className="text-xs text-slate-400">{c.mode === 'AUTO' ? mt.auto : mt.human}</span>{c.needsAttention && <span className="ml-2 text-xs text-amber-500">{mt.attention}</span>}</button>)}</div>
        <div className="min-w-0">{!detail ? <Empty text={mt.pickConversation} /> : <><div className="mb-3 flex flex-wrap gap-2"><Pill>{detail.mode === 'AUTO' ? mt.auto : mt.human}</Pill>{can('messenger.reply') && <Button variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/conversations/${detail.id}/mode`, { method: 'PATCH', body: { mode: detail.mode === 'AUTO' ? 'HUMAN' : 'AUTO' } }))}>{detail.mode === 'AUTO' ? mt.takeOver : mt.resume}</Button>}<a href="https://business.facebook.com/latest/inbox" target="_blank" rel="noopener noreferrer" className="self-center text-sm text-sky-500">{mt.facebookInbox}</a></div><p className="mb-3 text-xs text-slate-400">{mt.takeoverHint}</p>{detail.lastError && <p className="mb-3 text-sm text-amber-500">{messengerErrorText(detail.lastError)}</p>}
          <div className="max-h-[540px] space-y-3 overflow-y-auto" aria-live="polite">{detail.messages.map(m => <div key={m.id} className="space-y-2"><div className="rounded-lg bg-slate-950 p-3"><p className="mb-1 text-xs text-slate-400">{m.direction === 'IN' ? mt.customer : mt.human} · {new Date(m.occurredAt).toLocaleString('th-TH')}</p><p className="whitespace-pre-wrap break-words text-sm">{m.text || mt.attachment}</p></div>{m.replyText && <div className="ml-4 rounded-lg border border-sky-800 p-3"><p className="mb-1 text-xs text-sky-500">AI · {mt.actions[m.replyAction ?? 'reply']}</p><p className="whitespace-pre-wrap break-words text-sm">{m.replyText}</p></div>}<p className="text-xs text-slate-400">{mt.statuses[m.status] ?? m.status}{m.error ? ` · ${messengerErrorText(m.error)}` : ''}</p></div>)}</div>
        </>}</div></div>
    </Card>
  </>;
}
