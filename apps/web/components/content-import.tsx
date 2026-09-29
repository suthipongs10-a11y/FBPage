'use client';
/** นำเข้าแพ็กเกจคอนเทนต์ (fbpm-content-v1) จาก ChatGPT / Claude / Gemini — วาง/อัปโหลด · URL รับไฟล์ · Google Drive · ประวัติ */
import { useCallback, useEffect, useState } from 'react';
import { api, apiUpload, type ContentImportRow, type ContentInboxView, type ImportPostReport, type ImportReport, type PageRow } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { Button, Card, Empty, ErrorBox, Field, Input, Pill, Select } from '@/components/ui';
import { useWorkspace } from '@/components/workspace-context';
import { ChatGptBatch } from '@/components/chatgpt-batch';

const TABS = ['gpt', 'paste', 'api', 'drive', 'history'] as const;
const FALLBACKS = ['stock', 'ai', 'none'] as const;
const THEMES = ['dark', 'warm', 'ocean', 'gold', 'forest', 'default'];
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const tone = (s: string) => (s === 'PASS' || s === 'DRAFTED' ? 'ok' : s === 'FAIL' || s === 'FAILED' ? 'bad' : 'warn') as 'ok' | 'bad' | 'warn';

export function ContentImport({ base, brandId, pages, canWrite, canConfigure, onDrafted }: { base: string; brandId: string; pages: PageRow[]; canWrite: boolean; canConfigure: boolean; onDrafted: () => void }) {
  const { can } = useWorkspace();
  const [tab, setTab] = useState<(typeof TABS)[number]>('gpt');
  const [tpl, setTpl] = useState<{ example: unknown; instructions: string } | null>(null);
  const [inbox, setInbox] = useState<ContentInboxView | null>(null);
  const [history, setHistory] = useState<ContentImportRow[] | null>(null);
  const [text, setText] = useState(''); const [files, setFiles] = useState<Record<string, string>>({});
  const [pageId, setPageId] = useState(''); const [fallback, setFallback] = useState<(typeof FALLBACKS)[number]>('stock');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [newKey, setNewKey] = useState(''); const [drive, setDrive] = useState({ folder: '', key: '' });
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const load = useCallback(async () => {
    const [tp, ib, h] = await Promise.all([api<{ example: unknown; instructions: string }>(`${base}/brands/${brandId}/news/import/template`), api<ContentInboxView>(`${base}/brands/${brandId}/news/inbox`), api<ContentImportRow[]>(`${base}/brands/${brandId}/news/imports`)]);
    setTpl(tp); setInbox(ib); setHistory(h);
    setPageId(p => p || ib.pageId || ''); setDrive(d => ({ ...d, folder: d.folder || (ib.driveFolderId ? `https://drive.google.com/drive/folders/${ib.driveFolderId}` : '') }));
  }, [base, brandId]);
  useEffect(() => { setReport(null); setNewKey(''); void load().catch(setError); }, [load]);
  const run = async (k: string, fn: () => Promise<string | void>) => { setBusy(k); setError(null); setNotice(''); try { const n = await fn(); if (n) setNotice(n); await load(); } catch (e) { setError(e); } finally { setBusy(''); } };

  const copyPrompt = () => run('copy', async () => { if (!tpl) return; await navigator.clipboard.writeText(tpl.instructions); return t('imp.copied'); });
  const pickJson = async (f: File | undefined) => { if (f) setText(await f.text()); };
  const pickImages = (list: FileList | null) => run('up', async () => {
    const out: Record<string, string> = { ...files };
    for (const f of Array.from(list ?? [])) out[f.name] = (await apiUpload<{ id: string }>(`${base}/news/import/files?name=${encodeURIComponent(f.name)}`, f)).id;
    setFiles(out);
  });
  const body = () => ({ text, ...(pageId && { pageId }), ...(Object.keys(files).length && { files }) });
  const check = () => run('check', async () => { setReport(await api<ImportReport>(`${base}/brands/${brandId}/news/import/check`, { method: 'POST', body: body() })); });
  const doImport = () => run('import', async () => {
    const r = await api<ContentImportRow>(`${base}/brands/${brandId}/news/import`, { method: 'POST', body: { ...body(), imageFallback: fallback } });
    setReport(r.report);
    if (r.draftCount > 0) { setText(''); setFiles({}); onDrafted(); return `${t('imp.drafted')} (${r.draftCount}/${r.postCount})`; }
  });
  const rotate = () => run('key', async () => { setNewKey((await api<{ key: string }>(`${base}/brands/${brandId}/news/inbox/key`, { method: 'POST' })).key); });
  const revoke = () => run('revoke', async () => { await api(`${base}/brands/${brandId}/news/inbox/key`, { method: 'DELETE' }); setNewKey(''); });
  const saveInbox = (patch: Record<string, unknown>) => run('inbox', async () => { setInbox(await api<ContentInboxView>(`${base}/brands/${brandId}/news/inbox`, { method: 'PUT', body: patch })); return t('common.save'); });
  const saveDrive = () => saveInbox({ driveFolder: drive.folder || null, ...(drive.key.trim() && { driveCredentials: drive.key.trim() }), driveEnabled: true }).then(() => setDrive(d => ({ ...d, key: '' })));
  const poll = () => run('poll', async () => { const r = await api<{ files: number; imported: number; results: { file: string; status: string; drafted: number }[] }>(`${base}/brands/${brandId}/news/inbox/drive/poll`, { method: 'POST' }); if (r.results.some(x => x.drafted)) onDrafted(); return `${r.files} ไฟล์ในโฟลเดอร์ · นำเข้าใหม่ ${r.imported}${r.results.length ? ` · ${r.results.map(x => `${x.file}: ${x.status}`).join(' · ')}` : ''}`; });
  const draftFrom = (h: ContentImportRow) => run(`d:${h.id}`, async () => { const r = await api<ContentImportRow>(`${base}/news/imports/${h.id}/draft`, { method: 'POST' }); if (r.draftCount) onDrafted(); return `${t('imp.drafted')} (${r.draftCount}/${r.postCount})`; });
  const hide = (h: ContentImportRow) => run(`h:${h.id}`, async () => { await api(`${base}/news/imports/${h.id}`, { method: 'DELETE' }); });

  return (
    <Card title={t('imp.title')} actions={tpl && tab !== 'gpt' && <Button variant="ghost" disabled={!!busy} onClick={copyPrompt}>📋 {t('imp.copyPrompt')}</Button>}>
      <p className="text-xs text-slate-400">{t('imp.help')}</p>
      {tpl && <details className="mt-1 text-xs"><summary className="cursor-pointer text-sky-400">{t('imp.showExample')}</summary><pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-300">{tpl.instructions}</pre></details>}
      {notice && <p className="mt-2 text-sm text-emerald-400">✔ {notice}</p>}
      <ErrorBox error={error} />
      <div className="mt-3 flex flex-wrap gap-2">{TABS.map(x => <Button key={x} variant={tab === x ? 'primary' : 'ghost'} onClick={() => setTab(x)}>{t(`imp.tab.${x}` as MessageKey)}{x === 'history' && history?.length ? ` (${history.length})` : ''}</Button>)}</div>

      {tab === 'gpt' && <ChatGptBatch base={base} brandId={brandId} pages={pages} canWrite={canWrite} canSchedule={can('content.approve') && can('content.publish')} onDone={() => { onDrafted(); void load().catch(setError); }} />}

      {tab === 'paste' && (
        <div className="mt-3 space-y-2">
          <textarea className="h-40 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-xs" placeholder={t('imp.pasteHere')} value={text} onChange={e => setText(e.target.value)} />
          <div className="grid gap-2 md:grid-cols-4">
            <Field label={t('imp.jsonFile')}><input type="file" accept=".json,.txt,application/json,text/plain" className="text-xs" onChange={e => void pickJson(e.target.files?.[0])} /></Field>
            <Field label={t('imp.images')}><input type="file" accept="image/jpeg,image/png,image/webp" multiple className="text-xs" disabled={!canWrite || !!busy} onChange={e => pickImages(e.target.files)} />{Object.keys(files).length > 0 && <div className="mt-1 text-xs text-slate-400">{Object.keys(files).join(', ')}</div>}</Field>
            <Field label={t('imp.defaultPage')}><Select value={pageId} onChange={e => setPageId(e.target.value)}><option value="">—</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label={t('imp.fallback')}><Select value={fallback} onChange={e => setFallback(e.target.value as (typeof FALLBACKS)[number])}>{FALLBACKS.map(x => <option key={x} value={x}>{t(`news.img.${x}` as MessageKey)}</option>)}</Select></Field>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!text.trim() || !!busy} onClick={check}>{busy === 'check' ? '…' : t('imp.check')}</Button>
            {canWrite && <Button disabled={!text.trim() || !!busy} onClick={doImport}>{busy === 'import' ? '…' : t('imp.import')}</Button>}
          </div>
          {report && <ReportView report={report} />}
        </div>
      )}

      {tab === 'api' && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-xs text-slate-400">{t('imp.apiHelp')}</p>
          <div><span className="text-slate-400">{t('imp.endpoint')}:</span> <code className="break-all text-xs">POST {origin}/api/inbox/content</code></div>
          <div><span className="text-slate-400">{t('imp.openapi')}:</span> <code className="break-all text-xs">{origin}/api/inbox/openapi.json</code></div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-slate-400">{t('imp.key')}:</span> {inbox?.hasKey ? <Pill tone="ok">{inbox.keyHint}</Pill> : <span className="text-slate-500">{t('imp.noKey')}</span>}
            {canConfigure && <><Button variant="ghost" disabled={!!busy} onClick={rotate}>{t('imp.newKey')}</Button>{inbox?.hasKey && <Button variant="danger" disabled={!!busy} onClick={revoke}>{t('imp.revoke')}</Button>}</>}</div>
          {newKey && <div className="rounded border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200"><code className="break-all">{newKey}</code><div className="mt-1">{t('imp.keyOnce')}</div></div>}
          <pre className="overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-300">{`curl -X POST ${origin}/api/inbox/content \\\n  -H "Authorization: Bearer fbin_…" -H "content-type: application/json" \\\n  --data @posts.json`}</pre>
          {canConfigure && inbox && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inbox.autoDraft} onChange={e => saveInbox({ autoDraft: e.target.checked })} /> {t('imp.autoDraft')}</label>}
        </div>
      )}

      {tab === 'drive' && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="whitespace-pre-line text-xs text-slate-400">{t('imp.driveHelp')}</p>
          {inbox?.driveClientEmail && <p className="text-xs">{t('imp.shareWith')}: <code className="select-all text-sky-300">{inbox.driveClientEmail}</code></p>}
          {canConfigure && <>
            <Field label={t('imp.driveFolder')}><Input value={drive.folder} placeholder="https://drive.google.com/drive/folders/…" onChange={e => setDrive({ ...drive, folder: e.target.value })} /></Field>
            <Field label={`${t('imp.driveKey')}${inbox?.driveConfigured ? ` · ${t('imp.keySaved')}` : ''}`}><textarea className="h-20 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-xs" autoComplete="off" spellCheck={false} placeholder='{ "type": "service_account", … }' value={drive.key} onChange={e => setDrive({ ...drive, key: e.target.value })} /></Field>
            <div className="grid gap-2 md:grid-cols-3">
              <Field label={t('imp.defaultPage')}><Select value={inbox?.pageId ?? ''} onChange={e => saveInbox({ pageId: e.target.value || null })}><option value="">—</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <Field label={t('imp.fallback')}><Select value={inbox?.imageFallback ?? 'stock'} onChange={e => saveInbox({ imageFallback: e.target.value })}>{FALLBACKS.map(x => <option key={x} value={x}>{t(`news.img.${x}` as MessageKey)}</option>)}</Select></Field>
              <Field label={t('news.theme')}><Select value={inbox?.theme ?? 'dark'} onChange={e => saveInbox({ theme: e.target.value })}>{THEMES.map(x => <option key={x} value={x}>{x}</option>)}</Select></Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!!busy || !drive.folder} onClick={saveDrive}>{busy === 'inbox' ? '…' : t('common.save')}</Button>
              {inbox?.driveConfigured && <label className="flex items-center gap-2"><input type="checkbox" checked={inbox.driveEnabled} onChange={e => saveInbox({ driveEnabled: e.target.checked })} /> {t('imp.driveOn')}</label>}
              {inbox && <label className="flex items-center gap-2"><input type="checkbox" checked={inbox.autoDraft} onChange={e => saveInbox({ autoDraft: e.target.checked })} /> {t('imp.autoDraft')}</label>}
            </div>
          </>}
          {inbox?.driveConfigured && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">{t('imp.lastPolled')} {fmt(inbox.driveLastPolledAt)}{canWrite && <Button variant="ghost" disabled={!!busy} onClick={poll}>{busy === 'poll' ? '…' : t('imp.pollNow')}</Button>}</div>}
          {inbox?.driveLastError && <p className="text-xs text-rose-400">{inbox.driveLastError}</p>}
        </div>
      )}

      {tab === 'history' && (
        <div className="mt-3">{!history?.length ? <Empty text={t('imp.noHistory')} /> : (
          <ul className="divide-y divide-slate-800 text-sm">{history.map(h => (
            <li key={h.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={tone(h.status)}>{h.status}</Pill><Pill>{t(`imp.channel.${h.channel}` as MessageKey)}</Pill>
                <span className="font-medium">{h.fileName ?? '—'}</span>
                <span className="text-xs text-slate-400">{fmt(h.createdAt)} · {h.draftCount}/{h.postCount}</span>
                {canWrite && h.status !== 'DRAFTED' && !h.report.parseError && h.report.posts.some(p => p.status !== 'FAIL' && !p.result?.contentId) && <Button variant="ghost" disabled={!!busy} onClick={() => draftFrom(h)}>{busy === `d:${h.id}` ? '…' : t('imp.draftNow')}</Button>}
                {canWrite && <Button variant="ghost" disabled={!!busy} onClick={() => hide(h)}>{t('imp.hide')}</Button>}
              </div>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-sky-400">{t('imp.result')}</summary><ReportView report={h.report} /></details>
            </li>))}</ul>
        )}</div>
      )}
    </Card>
  );
}

export function ReportView({ report }: { report: ImportReport }) {
  if (report.parseError) return <p className="mt-2 rounded border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{report.parseError}</p>;
  return (
    <ul className="mt-2 space-y-2">{report.posts.map((p: ImportPostReport) => (
      <li key={p.index} className="rounded border border-slate-800 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2"><Pill tone={tone(p.status)}>{t(`imp.status.${p.status}` as MessageKey)}</Pill><span className="font-medium text-slate-200">{p.index + 1}. {p.title}</span>{p.result?.contentId && <Pill tone="ok">✔ {t('imp.drafted').split(' — ')[0]}</Pill>}</div>
        {p.checks.filter(c => c.level !== 'info').map((c, i) => <div key={i} className={c.level === 'error' ? 'text-rose-300' : 'text-amber-300'}>{c.level === 'error' ? '✖' : '⚠'} {c.message}</div>)}
        {p.result?.error && <div className="text-rose-300">✖ {p.result.error}</div>}
        {p.result?.imageErrors?.map((e, i) => <div key={i} className="text-amber-300">⚠ {e}</div>)}
        {p.result?.cardError && <div className="text-amber-300">⚠ {t('news.cardError')}: {p.result.cardError}</div>}
      </li>))}</ul>
  );
}
