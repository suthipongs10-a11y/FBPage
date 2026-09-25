'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AI_ROLES } from '@fbpm/shared';
import { api, ApiError, type AiChatMessage, type AiCommandResult, type AiStep, type BrandLite, type Client, type PageRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace-context';
import { Button, Card, ErrorBox, Field, Input, Loading, Pill, Select, Textarea } from '@/components/ui';

interface Turn { role: 'user' | 'assistant'; text: string; steps?: AiStep[]; meta?: { model: string; costUsd: number | null; usage: { input: number | null; output: number | null }; latencyMs: number } }

export default function AiCommandPage() {
  const { ws } = useWorkspace();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [brands, setBrands] = useState<(BrandLite & { clientId: string })[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [ctx, setCtx] = useState({ clientId: '', brandId: '', pageId: '', days: 30, role: 'strategy' });
  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([api<Client[]>(`/workspaces/${ws.id}/clients`), api<PageRow[]>(`/workspaces/${ws.id}/pages`)]);
      setClients(cs); setPages(ps.filter(p => !p.disconnectedAt));
      const bs = await Promise.all(cs.map(c => api<BrandLite[]>(`/workspaces/${ws.id}/clients/${c.id}/brands`).then(list => list.map(b => ({ ...b, clientId: c.id })))));
      setBrands(bs.flat());
    } catch (e) { setError(e); }
  }, [ws.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null); setInput('');
    setTurns(v => [...v, { role: 'user', text }]);
    try {
      const r = await api<AiCommandResult>(`/workspaces/${ws.id}/ai/command`, { method: 'POST', body: { message: text, history, role: ctx.role, context: { ...(ctx.pageId ? { pageId: ctx.pageId } : ctx.brandId ? { brandId: ctx.brandId } : ctx.clientId ? { clientId: ctx.clientId } : {}), days: ctx.days } } });
      setHistory(r.messages); setTurns(v => [...v, { role: 'assistant', text: r.text, steps: r.steps, meta: { model: r.model, costUsd: r.costUsd, usage: r.usage, latencyMs: r.latencyMs } }]);
    } catch (e) { setError(e); setTurns(v => v.slice(0, -1)); setInput(text); }
    finally { setBusy(false); }
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(input); };
  const reset = () => { setHistory([]); setTurns([]); setError(null); };
  const changeCtx = (patch: Partial<typeof ctx>) => { setCtx(v => ({ ...v, ...patch })); reset(); };

  if (!clients) return <div><ErrorBox error={error} /><Loading /></div>;
  const brandOpts = brands.filter(b => !ctx.clientId || b.clientId === ctx.clientId);
  const pageOpts = pages.filter(p => (!ctx.brandId || p.brandId === ctx.brandId) && (!ctx.clientId || p.brand.client.id === ctx.clientId));
  const notConfigured = error instanceof ApiError && error.status === 422 && /API key/.test(error.message);
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t('ai.title')}</h1><p className="text-sm text-slate-400">{t('ai.subtitle')}</p></div>
      <Card title={t('ai.context')}>
        <div className="grid gap-2 sm:grid-cols-5">
          <Field label={t('clients.title')}><Select value={ctx.clientId} onChange={e => changeCtx({ clientId: e.target.value, brandId: '', pageId: '' })}><option value="">{t('ai.allWorkspace')}</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label={t('brands.title')}><Select value={ctx.brandId} onChange={e => changeCtx({ brandId: e.target.value, pageId: '' })}><option value="">—</option>{brandOpts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label={t('nav.pages')}><Select value={ctx.pageId} onChange={e => changeCtx({ pageId: e.target.value })}><option value="">—</option>{pageOpts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label={t('ai.days')}><Input type="number" min={1} max={365} value={ctx.days} onChange={e => setCtx(v => ({ ...v, days: Number(e.target.value) || 30 }))} /></Field>
          <Field label={t('ai.role')}><Select value={ctx.role} onChange={e => setCtx(v => ({ ...v, role: e.target.value }))}>{AI_ROLES.map(r => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}</Select></Field>
        </div>
      </Card>

      <Card>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {turns.length === 0 && (
            <div className="text-sm text-slate-400">
              <p className="mb-2">{t('ai.examples')}:</p>
              <div className="flex flex-wrap gap-2">{(['ai.ex1', 'ai.ex2', 'ai.ex3', 'ai.ex4'] as MessageKey[]).map(k => <button key={k} onClick={() => void send(t(k))} className="rounded-full border border-slate-700 px-3 py-1 text-xs hover:bg-slate-800">{t(k)}</button>)}</div>
            </div>
          )}
          {turns.map((tn, i) => (
            <div key={i} className={`rounded-lg p-3 text-sm ${tn.role === 'user' ? 'ml-8 bg-sky-950/40' : 'mr-8 bg-slate-800/60'}`}>
              <div className="whitespace-pre-wrap">{tn.text}</div>
              {tn.steps && tn.steps.length > 0 && (
                <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">{t('ai.steps')} ({tn.steps.filter(s => s.type === 'tool').length})</summary>
                  <ul className="mt-1 space-y-1">{tn.steps.map((s, j) => <li key={j}>{s.type === 'tool' ? `▶ ${s.name}(${JSON.stringify(s.args ?? {})})` : `◀ ${s.preview}`}</li>)}</ul>
                </details>
              )}
              {tn.meta && <div className="mt-2 text-[11px] text-slate-500">{tn.meta.model} · {(tn.meta.usage.input ?? 0) + (tn.meta.usage.output ?? 0)} {t('ai.tokens')} · {t('ai.cost')} {tn.meta.costUsd == null ? '—' : `$${tn.meta.costUsd.toFixed(4)}`} · {tn.meta.latencyMs} ms</div>}
            </div>
          ))}
          {busy && <p className="text-sm text-slate-500">{t('ai.thinking')}</p>}
          <div ref={endRef} />
        </div>
        {notConfigured ? <p className="mt-3 text-sm text-amber-300">{t('ai.notConfigured')} <Link href="/ai-models" className="underline">→</Link></p> : <ErrorBox error={error} />}
        <form onSubmit={onSubmit} className="mt-3 flex gap-2">
          <Textarea value={input} onChange={e => setInput(e.target.value)} placeholder={t('ai.placeholder')} className="min-h-12" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
          <div className="flex flex-col gap-2"><Button type="submit" disabled={busy || !input.trim()}>{t('ai.send')}</Button><Button type="button" variant="ghost" onClick={reset} disabled={busy}>{t('ai.clear')}</Button></div>
        </form>
        {ctx.pageId && <p className="mt-2 text-xs text-slate-500"><Pill tone="ok">{pages.find(p => p.id === ctx.pageId)?.name}</Pill> · {ctx.days} วัน</p>}
      </Card>
    </div>
  );
}
