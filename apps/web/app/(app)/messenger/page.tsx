'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Pill, Select, Textarea } from '@/components/ui';
import { messengerErrorText, messengerText as mt, type Conversation, type ConversationDetail, type MessengerPage, type MessengerReadiness, type MessengerSettingsView } from '@/lib/messenger';

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
      <p className="rounded-lg bg-amber-950 p-3 text-amber-200">{view.automaticSendEnabled ? 'โหมดส่งอัตโนมัติ: เพจที่เปิดใช้งานส่งคำตอบเองได้ (ยกเว้นเพจที่เลือก "ร่างรอคนกดส่ง")' : 'โหมดร่างรอตรวจ: AI ร่างคำตอบไว้ ยังไม่ส่งหาลูกค้า — เปิดบทสนทนาแล้วกด "ส่งคำตอบนี้" (แก้ก่อนได้)'}</p>
      <div className="grid gap-3 sm:grid-cols-3"><Kpi label={mt.enabledPages} value={pages.filter(p => p.messengerConfig?.enabled).length} /><Kpi label={mt.used} value={`${view.requestsToday} / ${view.settings?.dailyLimit ?? '—'}`} /><Kpi label={mt.ai} value={!view.ai ? mt.noAi : view.settings?.validatedAt ? mt.validated : mt.notValidated} /></div>
      {view.automationPaused && <p className="rounded-lg bg-amber-950 p-3 text-amber-200">{mt.paused}</p>}
      {can('ai.configure') && can('messenger.manage') && <AiSettings view={view} base={base} reload={reload} />}
      <Field label={mt.page}><Select value={pageId} onChange={e => setPageId(e.target.value)}><option value="">{mt.choosePage}</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name} · {p.brand.name} · {p.messengerConfig?.enabled ? mt.on : mt.off}</option>)}</Select></Field>
      {!pages.length && <Empty text={mt.noPages} />}
      {page && <PageChat key={page.id} page={page} base={base} view={view} can={can} reload={reload} />}
    </>}
  </div>;
}
function AiSettings({ view, base, reload }: { view: MessengerSettingsView; base: string; reload: () => Promise<void> }) {
  const [limit, setLimit] = useState(view.settings?.dailyLimit ?? 500);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  async function save() { setBusy(true); setError(null); setSaved(false); try { await api(`${base}/settings`, { method: 'PATCH', body: { dailyLimit: limit } }); await reload(); setSaved(true); } catch (e) { setError(e); } finally { setBusy(false); } }
  const source = view.ai?.source === 'auto' ? ` · ${mt.aiAuto}` : view.ai?.source === 'fallback' ? ` · ${mt.aiFallback}` : '';
  return <Card title={mt.ai}><p className="mb-3 text-sm text-slate-400">{mt.dedicated}</p><div className="grid gap-3 md:grid-cols-2">
    <Field label={mt.model} hint={view.ai ? `${view.ai.provider}${source}` : undefined}><p className="rounded-lg border border-slate-200 px-3 py-2 text-sm">{view.ai ? view.ai.model : mt.noAi}</p></Field>
    <Field label={mt.dailyLimit}><Input type="number" min={1} max={10000} value={limit} onChange={e => setLimit(Number(e.target.value))} /></Field>
  </div><p className="my-3 text-xs text-slate-400">{mt.limitHint}</p><div className="flex flex-wrap items-center gap-3"><Button disabled={busy || !Number.isInteger(limit) || limit < 1 || limit > 10000} onClick={() => void save()}>{mt.save}</Button><Link className="text-sm text-sky-600 underline" href="/ai-models">{mt.aiLink}</Link>{saved && <span role="status" className="text-sm text-emerald-400">{mt.saved}</span>}</div><ErrorBox error={error} /></Card>;
}
function PageChat({ page, base, view, can, reload }: { page: MessengerPage; base: string; view: MessengerSettingsView; can: (p: string) => boolean; reload: () => Promise<void> }) {
  const [instructions, setInstructions] = useState(page.messengerConfig?.instructions ?? ''); const [fallback, setFallback] = useState(page.messengerConfig?.fallbackMessage ?? mt.fallbackDefault);
  const [reviewDrafts, setReviewDrafts] = useState(page.messengerConfig?.reviewDrafts ?? false); const [ready, setReady] = useState<MessengerReadiness | null>(null);
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState<{ text: string; action: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]); const [conversationId, setConversationId] = useState(''); const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const alive = useRef(true); const request = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const loadInbox = useCallback(async () => { const seq = ++request.current; const rows = await api<Conversation[]>(`${base}/conversations?pageId=${encodeURIComponent(page.id)}`); const c = conversationId ? await api<ConversationDetail>(`${base}/conversations/${conversationId}`) : null; if (alive.current && seq === request.current) { setConversations(rows); setDetail(c); } }, [base, page.id, conversationId]);
  useEffect(() => { setDetail(null); void loadInbox().catch(e => { if (alive.current) setError(e); }); const timer = setInterval(() => { void loadInbox().catch(e => { if (alive.current) setError(e); }); }, 5000); return () => { clearInterval(timer); request.current++; }; }, [loadInbox]);
  const loadReady = useCallback(async () => { const r = await api<MessengerReadiness>(`${base}/pages/${page.id}/readiness`); if (alive.current) setReady(r); }, [base, page.id]);
  useEffect(() => { void loadReady().catch(() => undefined); }, [loadReady]);
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(null); setNotice(''); try { await action(); if (!alive.current) return; await reload(); await loadInbox(); await loadReady().catch(() => undefined); if (alive.current) setNotice(mt.saved); } catch (e) { if (alive.current) setError(e); } finally { if (alive.current) setBusy(false); } }
  const enabled = page.messengerConfig?.enabled ?? false;
  const unavailable = !!page.disconnectedAt || page.tokenStatus !== 'VALID';
  const savePage = (on: boolean) => api(`${base}/pages/${page.id}`, { method: 'PATCH', body: { enabled: on, instructions, fallbackMessage: fallback, reviewDrafts } });
  return <><ErrorBox error={error} />{notice && <p role="status" className="text-sm text-emerald-400">{notice}</p>}
    <Card title={`${mt.pageSetup} · ${page.name}`} actions={<Pill tone={enabled ? 'ok' : 'muted'}>{enabled ? mt.on : mt.off}</Pill>}>
      <p className="mb-3 text-sm text-slate-400">{mt.knowledge}: <strong>{page.brand.name}</strong> · <a className="text-sky-500" href="/clients">{mt.knowledgeLink}</a></p>
      {can('messenger.manage') && <div className="space-y-3"><Field label={mt.instructions} hint={mt.instructionsHint}><Textarea value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={5000} /></Field><Field label={mt.fallback}><Textarea value={fallback} onChange={e => setFallback(e.target.value)} maxLength={1800} /></Field><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={reviewDrafts} onChange={e => setReviewDrafts(e.target.checked)} /><span>{mt.reviewDrafts}<span className="block text-xs text-slate-400">{mt.reviewDraftsHint}</span></span></label>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !fallback.trim()} onClick={() => void run(() => savePage(enabled))}>{mt.save}</Button>
          {can('page.connect') && <><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { const r = await api<{ url: string }>(`${base.replace(/\/messenger$/, '')}/facebook/oauth/start?messenger=true`); window.location.assign(r.url); })}>{mt.connectPermission}</Button><Button variant="ghost" disabled={busy || unavailable || !view.webhookConfigured} onClick={() => void run(() => api(`${base}/pages/${page.id}/subscribe`, { method: 'POST' }))}>{page.messengerConfig?.subscribedAt ? mt.subscribed : mt.subscribe}</Button></>}
          <Button variant={enabled ? 'danger' : 'primary'} disabled={busy || (!enabled && (!page.messengerConfig?.subscribedAt || !view.settings?.validatedAt || unavailable || !fallback.trim()))} onClick={() => void run(() => savePage(!enabled))}>{enabled ? mt.off : mt.on}</Button>
        </div><p className="text-sm text-slate-400">{mt.enabledHint}</p></div>}
      {!view.webhookConfigured && <p className="mt-3 text-sm text-amber-500">{mt.missingMeta}</p>}{unavailable && <p className="mt-3 text-sm text-amber-500">{mt.pageUnavailable}</p>}
    </Card>
    {ready && <Card title={mt.readiness} actions={<Pill tone={ready.checks.every(c => c.ok) ? 'ok' : 'warn'}>{ready.checks.every(c => c.ok) ? mt.readyAll : mt.readyMissing}</Pill>}>
      <p className="mb-2 text-sm">{mt.modes[ready.mode]}</p>
      <ul className="space-y-1 text-sm">{ready.checks.map(c => <li key={c.key} className="flex gap-2"><span aria-hidden>{c.ok ? '✅' : '⬜'}</span><span>{mt.checks[c.key] ?? c.key}{!c.ok && <span className="block text-xs text-amber-500">{c.hint}</span>}</span></li>)}</ul>
    </Card>}
    {can('messenger.manage') && can('ai.use') && <Card title={mt.preview}><p className="mb-3 text-sm text-slate-400">{mt.previewHint}</p><Field label={mt.question}><Textarea placeholder={mt.questionPlaceholder} value={question} maxLength={6000} onChange={e => { setQuestion(e.target.value); setAnswer(null); }} /></Field><Button className="mt-3" disabled={busy || !question.trim() || !view.settings} onClick={() => void run(async () => { const r = await api<{ text: string; action: string }>(`${base}/pages/${page.id}/preview`, { method: 'POST', body: { text: question } }); if (alive.current) setAnswer(r); })}>{mt.test}</Button>{answer && <div className="mt-3 rounded-lg border border-emerald-800 p-4"><p className="mb-2 text-sm text-emerald-500">{mt.answer} · {mt.actions[answer.action]}</p><p className="whitespace-pre-wrap break-words">{answer.text}</p></div>}</Card>}
    <Card title={mt.inbox} actions={<Button variant="ghost" disabled={busy} onClick={() => void run(loadInbox)}>{mt.refresh}</Button>}>
      <p className="mb-3 text-xs text-slate-400">{mt.textOnly}</p>
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"><div className="max-h-[540px] space-y-2 overflow-auto">{!conversations.length && <Empty text={mt.emptyInbox} />}{conversations.map(c => <button key={c.id} onClick={() => { setDetail(null); setConversationId(c.id); }} className={`w-full rounded-lg border p-3 text-left ${conversationId === c.id ? 'border-sky-500' : 'border-slate-700'}`}><span className="block truncate text-sm">{mt.customer} · {c.psid.slice(-8)}</span><span className="text-xs text-slate-400">{c.mode === 'AUTO' ? mt.auto : mt.human}</span>{c.needsAttention && <span className="ml-2 text-xs text-amber-500">{mt.attention}</span>}</button>)}</div>
        <div className="min-w-0">{!detail ? <Empty text={mt.pickConversation} /> : <><div className="mb-3 flex flex-wrap gap-2"><Pill>{detail.mode === 'AUTO' ? mt.auto : mt.human}</Pill>{can('messenger.reply') && <Button variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/conversations/${detail.id}/mode`, { method: 'PATCH', body: { mode: detail.mode === 'AUTO' ? 'HUMAN' : 'AUTO' } }))}>{detail.mode === 'AUTO' ? mt.takeOver : mt.resume}</Button>}<a href="https://business.facebook.com/latest/inbox" target="_blank" rel="noopener noreferrer" className="self-center text-sm text-sky-500">{mt.facebookInbox}</a></div><p className="mb-3 text-xs text-slate-400">{mt.takeoverHint}</p>{detail.lastError && <p className="mb-3 text-sm text-amber-500">{messengerErrorText(detail.lastError)}</p>}
          <div className="max-h-[540px] space-y-3 overflow-y-auto" aria-live="polite">{detail.messages.map(m => <div key={m.id} className="space-y-2"><div className="rounded-lg bg-slate-950 p-3"><p className="mb-1 text-xs text-slate-400">{m.direction === 'IN' ? mt.customer : m.replyAction === 'manual' ? mt.admin : mt.human} · {new Date(m.occurredAt).toLocaleString('th-TH')}</p><p className="whitespace-pre-wrap break-words text-sm">{m.text || mt.attachment}</p></div>{m.replyText && m.direction === 'IN' && <div className="ml-4 rounded-lg border border-sky-800 p-3"><p className="mb-1 text-xs text-sky-500">{m.replyAction === 'manual' ? mt.admin : `AI · ${mt.actions[m.replyAction ?? 'reply']}`}</p><p className="whitespace-pre-wrap break-words text-sm">{m.replyText}</p></div>}<p className="text-xs text-slate-400">{mt.statuses[m.status] ?? m.status}{m.error ? ` · ${messengerErrorText(m.error)}` : ''}</p></div>)}</div>
          {can('messenger.reply') && <Composer key={detail.id} detail={detail} base={base} busy={busy} run={run} />}
        </>}</div></div>
    </Card>
  </>;
}
/** ส่งร่างของ AI (แก้ได้) หรือพิมพ์ตอบเอง — ส่งได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด (กฎ Messenger) */
function Composer({ detail, base, busy, run }: { detail: ConversationDetail; base: string; busy: boolean; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const draft = [...detail.messages].reverse().find(m => m.direction === 'IN' && m.status === 'DRAFT' && m.replyText);
  const [text, setText] = useState(draft?.replyText ?? ''); const [resumeAi, setResumeAi] = useState(true);
  const open = !!detail.lastCustomerAt && Date.now() - new Date(detail.lastCustomerAt).getTime() < 24 * 3600_000 - 60_000;
  const send = () => run(async () => { await api(`${base}/conversations/${detail.id}/send`, { method: 'POST', body: { text: text.trim(), resumeAi, ...(draft && { messageId: draft.id }) } }); setText(''); });
  return <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
    <p className="text-sm font-medium">{mt.composer}</p>
    {!open ? <p className="text-sm text-amber-500">{mt.windowClosed}</p> : <>
      {draft && <p className="text-xs text-sky-500">{mt.draftLoaded}</p>}
      <Textarea value={text} maxLength={1800} placeholder={mt.composerPlaceholder} onChange={e => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || !text.trim()} onClick={() => void send()}>{draft ? mt.sendDraft : mt.sendManual}</Button><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={resumeAi} onChange={e => setResumeAi(e.target.checked)} />{mt.resumeAi}</label></div>
    </>}
  </div>;
}
