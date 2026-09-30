'use client';
/** พอร์ทัลลูกค้า (เจ้าของธุรกิจ) — กล่องข้อความ / ลีด / อนุมัติโพสต์ / รายงาน / LINE · ออกแบบให้ใช้บนมือถือได้ */
import { useCallback, useEffect, useState } from 'react';
import { LEAD_STATUSES } from '@fbpm/shared';
import { api } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { fullDate, timeAgo } from '@/lib/yt-comment';
import { inMessengerWindow, type LineLinkCode, type LineRecipientRow, type PortalApproval, type PortalComment, type PortalConversation, type PortalLead, type PortalOverview, type PortalReport, type PortalThread } from '@/lib/portal';
import { Button, Card, Empty, ErrorBox, Input, Loading, Pill, Select, Textarea } from '@/components/ui';
import { QuotaBar } from '@/components/quota-bar';
import { cycleLabel } from '@/lib/plans';

export type PortalTab = 'inbox' | 'leads' | 'approvals' | 'reports' | 'line';
export const PORTAL_TABS: PortalTab[] = ['inbox', 'leads', 'approvals', 'reports', 'line'];
const CLIENT_LINE_TYPES = ['hot_lead', 'inbox_digest', 'approval_required', 'report_ready', 'publish_failed'] as const;

function Ago({ at }: { at: string }) { return <span title={fullDate(at)}>{timeAgo(at)}</span>; }

export function PortalView({ clientId, tab, onTab }: { clientId: string; tab: PortalTab; onTab: (t: PortalTab) => void }) {
  const base = `/portal/clients/${clientId}`;
  const [ov, setOv] = useState<PortalOverview | null>(null); const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => api<PortalOverview>(base).then(setOv).catch(setError), [base]);
  useEffect(() => { void reload(); }, [reload]);
  if (!ov) return <div className="space-y-3"><ErrorBox error={error} />{!error && <Loading />}</div>;
  const badge: Partial<Record<PortalTab, number>> = { inbox: ov.counts.pendingComments + ov.counts.needsAttention, leads: ov.counts.newLeads, approvals: ov.counts.approvals };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{ov.client.name}</h1>
        <p className="text-xs text-slate-500">{t('pt.managedBy')} {ov.agencyName} · {ov.pages.map(p => p.name).join(' · ') || t('pt.noPages')}</p>
      </div>
      {ov.pages.some(p => p.plan) && (
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
          {ov.pages.filter(p => p.plan).map(p => (
            <div key={p.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-slate-400"><span><b className="text-sm text-slate-200">{p.name}</b> · {t('pt.package')} {p.plan!.name}</span><span>{t('portfolio.cycle')} {cycleLabel(p.cycle)}</span></div>
              <div className="mt-1"><QuotaBar q={{ ...p.quota, expectedByNow: null, pace: p.quota.limit === null ? 'UNLIMITED' : 'ON_TRACK' }} /></div>
              {p.reels.limit !== null && <p className="mt-0.5 text-[11px] text-slate-500">Reels {p.reels.planned}/{p.reels.limit}</p>}
            </div>
          ))}
        </div>
      )}
      {ov.preview && <p className="rounded-lg border border-amber-800 bg-amber-950/50 p-3 text-sm text-amber-200">👀 {t('pt.previewNote')}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('pt.kpi.pending')} value={ov.counts.pendingComments} tone={ov.counts.pendingComments ? 'warn' : undefined} />
        <Stat label={t('pt.kpi.chats')} value={ov.counts.needsAttention} tone={ov.counts.needsAttention ? 'warn' : undefined} />
        <Stat label={t('pt.kpi.leads')} value={ov.counts.newLeads} tone={ov.counts.newLeads ? 'ok' : undefined} sub={`${t('pt.kpi.week')} ${ov.counts.leadsWeek}`} />
        <Stat label={t('pt.kpi.approvals')} value={ov.counts.approvals} tone={ov.counts.approvals ? 'warn' : undefined} />
      </div>
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1" role="tablist">
        {PORTAL_TABS.map(k => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => onTab(k)} className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold ${tab === k ? 'bg-sky-500 text-white' : 'border border-slate-700 text-slate-300'}`}>
            {t(`pt.tab.${k}` as MessageKey)}{badge[k] ? <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-[11px] text-white">{badge[k]}</span> : null}
          </button>
        ))}
      </nav>
      {tab === 'inbox' && <InboxTab base={base} ov={ov} onChange={reload} />}
      {tab === 'leads' && <LeadsTab base={base} ov={ov} onChange={reload} />}
      {tab === 'approvals' && <ApprovalsTab base={base} ov={ov} onChange={reload} />}
      {tab === 'reports' && <ReportsTab base={base} />}
      {tab === 'line' && <LineTab base={base} ov={ov} />}
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone?: 'ok' | 'warn'; sub?: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className={`text-2xl font-bold tabular-nums ${tone === 'warn' ? 'text-amber-400' : tone === 'ok' ? 'text-emerald-400' : 'text-slate-100'}`}>{value}</div><div className="text-xs text-slate-400">{label}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}</div>;
}

// ---------- กล่องข้อความ: คอมเมนต์ + แชท ----------
function InboxTab({ base, ov, onChange }: { base: string; ov: PortalOverview; onChange: () => void }) {
  const [mode, setMode] = useState<'comments' | 'chats'>('comments');
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant={mode === 'comments' ? 'primary' : 'ghost'} onClick={() => setMode('comments')}>💬 {t('pt.comments')}</Button>
        <Button variant={mode === 'chats' ? 'primary' : 'ghost'} onClick={() => setMode('chats')}>✉️ {t('pt.chats')}</Button>
      </div>
      {mode === 'comments' ? <CommentsList base={base} ov={ov} onChange={onChange} /> : <Chats base={base} ov={ov} onChange={onChange} />}
    </div>
  );
}

function CommentsList({ base, ov, onChange }: { base: string; ov: PortalOverview; onChange: () => void }) {
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<PortalComment[] | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<PortalComment[]>(`${base}/comments?view=${view}`).then(setRows).catch(setError), [base, view]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  const done = () => { void load(); onChange(); };
  return (
    <div className="space-y-3">
      <Select className="w-auto" value={view} onChange={e => setView(e.target.value as 'pending' | 'all')} aria-label={t('pt.filter')}><option value="pending">{t('pt.view.pending')}</option><option value="all">{t('pt.view.all')}</option></Select>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text={view === 'pending' ? t('pt.noPending') : t('common.empty')} /> : rows.map(c => <CommentCard key={c.id} base={base} c={c} canReply={ov.canReply && !ov.preview} onDone={done} />)}
    </div>
  );
}

function CommentCard({ base, c, canReply, onDone }: { base: string; c: PortalComment; canReply: boolean; onDone: () => void }) {
  const [text, setText] = useState(c.draftReply ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); onDone(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const sent = c.replyStatus === 'SENT';
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <b className="text-sm text-slate-200">{c.fromName ?? t('pt.someone')}</b><Ago at={c.createdTime} /><span>· {c.page.name}</span>
        {c.parentCommentId && <Pill>{t('pt.isReply')}</Pill>}
        {c.lead && <Pill tone="ok">🔥 {t('pt.lead')} {c.lead.leadScore}</Pill>}
        {c.riskFlag && <Pill tone="bad">⚠ {t('pt.risk')}</Pill>}
        {sent && <Pill tone="ok">✓ {t('pt.replied')}</Pill>}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{c.message ?? '—'}</p>
      {c.post?.message && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{t('pt.onPost')}: {c.post.message}</p>}
      {c.permalink && <a href={c.permalink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-400 hover:underline">{t('pt.openFacebook')} ↗</a>}
      {canReply && !sent && (
        <div className="mt-3 space-y-2">
          <Textarea className="min-h-20" value={text} onChange={e => setText(e.target.value)} placeholder={t('pt.replyPh')} aria-label={t('pt.reply')} />
          {c.draftReply && <p className="text-[11px] text-slate-500">✨ {t('pt.aiDraftNote')}</p>}
          <ErrorBox error={error} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !text.trim()} onClick={() => void run(() => api(`${base}/comments/${c.id}/reply`, { method: 'POST', body: { message: text } }))}>{t('pt.sendReply')}</Button>
            {!c.resolvedAt && <Button variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/comments/${c.id}/resolve`, { method: 'POST', body: { resolved: true } }))}>{t('pt.noNeed')}</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function Chats({ base, ov, onChange }: { base: string; ov: PortalOverview; onChange: () => void }) {
  const [rows, setRows] = useState<PortalConversation[] | null>(null); const [open, setOpen] = useState<string | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<PortalConversation[]>(`${base}/conversations`).then(setRows).catch(setError), [base]);
  useEffect(() => { void load(); }, [load]);
  if (open) return <Thread base={base} id={open} canReply={ov.canReply && !ov.preview} onBack={() => { setOpen(null); void load(); onChange(); }} />;
  return (
    <div className="space-y-2">
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text={t('pt.noChats')} /> : rows.map(r => (
        <button key={r.id} onClick={() => setOpen(r.id)} className="block w-full rounded-xl border border-slate-800 bg-slate-900 p-3 text-left hover:border-sky-600">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <b className="text-sm text-slate-200">{t('pt.customer')} · {r.page.name}</b>{r.last && <Ago at={r.last.occurredAt} />}
            {r.needsAttention && <Pill tone="warn">{t('pt.needsYou')}</Pill>}
            {r.mode === 'AUTO' ? <Pill>🤖 {t('pt.aiAnswering')}</Pill> : <Pill>🙋 {t('pt.humanAnswering')}</Pill>}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-300">{r.last ? `${r.last.direction === 'IN' ? '' : `${t('pt.you')}: `}${r.last.text}` : '—'}</p>
        </button>
      ))}
    </div>
  );
}

function Thread({ base, id, canReply, onBack }: { base: string; id: string; canReply: boolean; onBack: () => void }) {
  const [th, setTh] = useState<PortalThread | null>(null); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<PortalThread>(`${base}/conversations/${id}`).then(setTh).catch(setError), [base, id]);
  useEffect(() => { void load(); }, [load]);
  const send = async (messageId?: string, body = text) => { setBusy(true); setError(null); try { await api(`${base}/conversations/${id}/send`, { method: 'POST', body: { text: body, ...(messageId && { messageId }) } }); setText(''); await load(); } catch (e) { setError(e); } finally { setBusy(false); } };
  if (!th) return <div><ErrorBox error={error} /><Loading /></div>;
  const open = inMessengerWindow(th.lastCustomerAt);
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-sky-400">← {t('pt.backToChats')}</button>
      <p className="text-xs text-slate-500">{th.pageName}</p>
      <div className="space-y-2">
        {th.messages.map(m => {
          const draft = m.direction === 'IN' && m.status === 'DRAFT' && m.replyText;
          return (
            <div key={m.id} className={`flex ${m.direction === 'IN' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'IN' ? 'bg-slate-800 text-slate-100' : 'bg-sky-500 text-white'}`}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                <p className="mt-1 text-[10px] opacity-70"><Ago at={m.occurredAt} /></p>
                {draft && canReply && open && (
                  <div className="mt-2 rounded-lg bg-slate-900/70 p-2 text-xs text-slate-300">✨ {t('pt.aiDraft')}: {m.replyText}
                    <div className="mt-1"><Button className="px-2 py-1 text-xs" disabled={busy} onClick={() => void send(m.id, m.replyText!)}>{t('pt.sendDraft')}</Button></div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ErrorBox error={error} />
      {canReply && (open ? (
        <div className="sticky bottom-0 space-y-2 bg-slate-950 pb-2 pt-1">
          <Textarea className="min-h-16" value={text} onChange={e => setText(e.target.value)} placeholder={t('pt.typeMessage')} aria-label={t('pt.typeMessage')} />
          <Button disabled={busy || !text.trim()} onClick={() => void send()}>{t('pt.send')}</Button>
        </div>
      ) : <p className="rounded-lg border border-slate-800 p-3 text-xs text-slate-400">⏰ {t('pt.windowClosed')}</p>)}
    </div>
  );
}

// ---------- ลีด ----------
function LeadsTab({ base, ov, onChange }: { base: string; ov: PortalOverview; onChange: () => void }) {
  const [rows, setRows] = useState<PortalLead[] | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<PortalLead[]>(`${base}/leads`).then(setRows).catch(setError), [base]);
  useEffect(() => { void load(); }, [load]);
  const patch = async (id: string, body: { status?: string; notes?: string }) => { try { await api(`${base}/leads/${id}`, { method: 'PATCH', body }); await load(); onChange(); } catch (e) { setError(e); } };
  const edit = ov.canReply && !ov.preview;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{t('pt.leadsHint')}</p>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text={t('pt.noLeads')} /> : rows.map(l => (
        <Card key={l.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><b>{l.name ?? l.comment?.fromName ?? t('pt.someone')}</b><Pill tone={l.leadScore >= 70 ? 'ok' : 'muted'}>🔥 {l.leadScore}</Pill><span className="text-xs text-slate-500"><Ago at={l.createdAt} /> · {l.page?.name ?? ''}</span></div>
            {edit ? <Select className="w-36" value={l.status} onChange={e => void patch(l.id, { status: e.target.value })} aria-label={t('leads.status')}>{LEAD_STATUSES.map(s => <option key={s} value={s}>{t(`ls.${s}` as MessageKey)}</option>)}</Select> : <Pill>{t(`ls.${l.status}` as MessageKey)}</Pill>}
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {([['pt.l.want', l.intent ?? l.service ?? l.product], ['pt.l.qty', l.quantity], ['pt.l.date', l.requestedDate], ['pt.l.place', l.location], ['pt.l.budget', l.budget], ['pt.l.urgency', l.urgency]] as [MessageKey, string | null][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="inline text-slate-500">{t(k)}: </dt><dd className="inline">{v}</dd></div>)}
          </dl>
          {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} className="mt-2 inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">📞 {l.phone}</a>}
          {l.comment?.message && <p className="mt-2 text-xs text-slate-500">“{l.comment.message}” {l.comment.permalink && <a href={l.comment.permalink} target="_blank" rel="noreferrer" className="text-sky-400">↗</a>}</p>}
          {edit && <LeadNote initial={l.notes ?? ''} onSave={notes => void patch(l.id, { notes })} />}
        </Card>
      ))}
    </div>
  );
}
function LeadNote({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return <div className="mt-2 flex gap-2"><Input value={v} onChange={e => setV(e.target.value)} placeholder={t('pt.notePh')} aria-label={t('leads.notes')} />{v !== initial && <Button variant="ghost" onClick={() => onSave(v)}>{t('common.save')}</Button>}</div>;
}

// ---------- อนุมัติโพสต์ ----------
function ApprovalsTab({ base, ov, onChange }: { base: string; ov: PortalOverview; onChange: () => void }) {
  const [rows, setRows] = useState<PortalApproval[] | null>(null); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(() => api<PortalApproval[]>(`${base}/approvals`).then(setRows).catch(setError), [base]);
  useEffect(() => { void load(); }, [load]);
  const decided = (msg: string) => { setNotice(msg); void load(); onChange(); };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{t('pt.approvalsHint')}</p>
      {notice && <p className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-200">{notice}</p>}
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text={t('pt.noApprovals')} /> : rows.map(c => <ApprovalCard key={c.id} base={base} c={c} canApprove={ov.canApprove && !ov.preview} onDone={decided} />)}
    </div>
  );
}
function ApprovalCard({ base, c, canApprove, onDone }: { base: string; c: PortalApproval; canApprove: boolean; onDone: (msg: string) => void }) {
  const [asking, setAsking] = useState(false); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const decide = async (kind: 'approve' | 'request-changes') => { setBusy(true); setError(null); try { await api(`${base}/approvals/${c.id}/${kind}`, { method: 'POST', body: comment.trim() ? { comment } : {} }); onDone(kind === 'approve' ? t('pt.approvedMsg') : t('pt.changesMsg')); } catch (e) { setError(e); } finally { setBusy(false); } };
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">{c.page?.name}{c.contentType === 'reel' && <Pill>🎬 Reels</Pill>}{c.scheduledLocal && <span>· {t('pt.plannedFor')} {c.scheduledLocal.replace('T', ' ')}</span>}</div>
      {c.title && <h3 className="mt-1 font-semibold">{c.title}</h3>}
      {c.media.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {c.media.map(m => m.mimeType.startsWith('video/')
            ? <video key={m.id} src={`/api${base}/media/${m.id}`} controls playsInline preload="metadata" className="h-64 w-36 shrink-0 rounded-lg bg-black object-cover" />
            : <img key={m.id} src={`/api${base}/media/${m.id}`} alt="" className="h-40 w-40 shrink-0 rounded-lg object-cover sm:h-48 sm:w-48" />)}
        </div>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm">{c.caption}</p>
      {c.hashtags.length > 0 && <p className="mt-1 text-xs text-sky-400">{c.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')}</p>}
      <ErrorBox error={error} />
      {canApprove && (
        <div className="mt-3 space-y-2">
          {asking && <Textarea className="min-h-16" value={comment} onChange={e => setComment(e.target.value)} placeholder={t('pt.changesPh')} aria-label={t('pt.changesPh')} />}
          <div className="flex flex-wrap gap-2">
            {!asking && <Button disabled={busy} onClick={() => void decide('approve')}>✅ {t('pt.approve')}</Button>}
            {asking ? <><Button disabled={busy || !comment.trim()} onClick={() => void decide('request-changes')}>{t('pt.sendChanges')}</Button><Button variant="ghost" onClick={() => setAsking(false)}>{t('common.cancel')}</Button></>
              : <Button variant="ghost" disabled={busy} onClick={() => setAsking(true)}>✏️ {t('pt.requestChanges')}</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- รายงาน ----------
function ReportsTab({ base }: { base: string }) {
  const [rows, setRows] = useState<PortalReport[] | null>(null); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState('');
  useEffect(() => { api<PortalReport[]>(`${base}/reports`).then(setRows).catch(setError); }, [base]);
  const open = async (id: string) => {
    const w = window.open('', '_blank'); setBusy(id);
    try { const r = await api<{ url: string }>(`${base}/reports/${id}/link`, { method: 'POST' }); if (w) w.location.href = r.url; else window.location.href = r.url; } catch (e) { w?.close(); setError(e); } finally { setBusy(''); }
  };
  const d = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  return (
    <div className="space-y-2">
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text={t('pt.noReports')} /> : rows.map(r => (
        <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div><div className="text-sm font-semibold">{r.page.name}</div><div className="text-xs text-slate-500">{d(r.periodStart)} – {d(r.periodEnd)}</div></div>
          <Button variant="ghost" disabled={busy === r.id} onClick={() => void open(r.id)}>{t('pt.openReport')} ↗</Button>
        </div>
      ))}
    </div>
  );
}

// ---------- LINE ----------
function LineTab({ base, ov }: { base: string; ov: PortalOverview }) {
  const [st, setSt] = useState<{ available: boolean; recipients: LineRecipientRow[] } | null>(null); const [code, setCode] = useState<LineLinkCode | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<{ available: boolean; recipients: LineRecipientRow[] }>(`${base}/line`).then(setSt).catch(setError), [base]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); } catch (e) { setError(e); } };
  if (!st) return <div><ErrorBox error={error} /><Loading /></div>;
  if (!st.available) return <Empty text={t('pt.lineUnavailable')} />;
  return (
    <div className="space-y-3">
      <Card title={`🔔 ${t('pt.lineTitle')}`}>
        <p className="text-sm text-slate-400">{t('pt.lineHint')}</p>
        {ov.preview ? <p className="mt-2 text-xs text-amber-300">{t('pt.previewNote')}</p> : (
          <div className="mt-3 space-y-2">
            <Button onClick={() => void run(async () => setCode(await api<LineLinkCode>(`${base}/line/link-code`, { method: 'POST' })))}>{t('line.getCode')}</Button>
            {code && <LinkCodeBox code={code} />}
          </div>
        )}
        <ErrorBox error={error} />
      </Card>
      {st.recipients.map(r => (
        <Card key={r.id} title={`LINE · ${r.displayName ?? ''}`} actions={<Button variant="ghost" onClick={() => void run(() => api(`${base}/line/recipients/${r.id}`, { method: 'DELETE' }))}>{t('line.unlink')}</Button>}>
          <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={r.active} onChange={e => void run(() => api(`${base}/line/recipients/${r.id}`, { method: 'PATCH', body: { active: e.target.checked } }))} /> {t('line.active')}</label>
          <TypePicker types={CLIENT_LINE_TYPES} current={r.types.length ? r.types : ['hot_lead', 'inbox_digest', 'approval_required', 'report_ready']} onChange={types => void run(() => api(`${base}/line/recipients/${r.id}`, { method: 'PATCH', body: { types } }))} />
        </Card>
      ))}
    </div>
  );
}

export function LinkCodeBox({ code }: { code: LineLinkCode }) {
  return (
    <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t('line.step1')} {code.addFriendUrl ? <a href={code.addFriendUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-400 underline">{code.botBasicId ?? 'LINE OA'} ↗</a> : code.botBasicId}</li>
        <li>{t('line.step2')} <b className="select-all font-mono text-2xl tracking-widest text-emerald-300">{code.code}</b></li>
        <li>{t('line.step3')}</li>
      </ol>
      <p className="mt-1 text-xs text-slate-500">{t('line.codeExpires')} {new Date(code.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>
    </div>
  );
}

export function TypePicker({ types, current, onChange }: { types: readonly string[]; current: string[]; onChange: (types: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {types.map(ty => (
        <label key={ty} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={current.includes(ty)} onChange={e => onChange(e.target.checked ? [...current, ty] : current.filter(x => x !== ty))} />
          {t(`line.type.${ty}` as MessageKey)}
        </label>
      ))}
    </div>
  );
}
