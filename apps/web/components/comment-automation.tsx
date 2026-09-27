'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type CommentAutomation } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBox, Input, Pill } from '@/components/ui';

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
type Counts = { liked?: number; replied?: number; privateReplied?: number; errors?: string[] };

/** ตั้งค่าดูแลคอมเมนต์อัตโนมัติของเพจเดียว — ทำเฉพาะคอมเมนต์ที่เข้ามาหลังเปิดสวิตช์ (docs/COMMENT_AUTOMATION.md) */
export function CommentAutomationCard({ workspaceId, pageId, canEdit, onRan }: { workspaceId: string; pageId: string; canEdit: boolean; onRan: () => void }) {
  const base = `/workspaces/${workspaceId}/pages/${pageId}/comment-automation`;
  const [cfg, setCfg] = useState<CommentAutomation | null>(null);
  const [ack, setAck] = useState(''); const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => { try { const c = await api<CommentAutomation>(base); setCfg(c); setAck(c.publicAckText); } catch (e) { setError(e); } }, [base]);
  useEffect(() => { void load(); }, [load]);
  const save = async (patch: Partial<CommentAutomation>) => {
    const prev = cfg; setBusy('save'); setError(null); setNotice('');
    setCfg(v => (v ? { ...v, ...patch } : v)); // สวิตช์ขยับทันที ถ้าบันทึกไม่ผ่านค่อยย้อนกลับ
    try { const c = await api<CommentAutomation>(base, { method: 'PUT', body: patch }); setCfg(v => ({ ...v!, ...c })); setAck(c.publicAckText); setNotice(t('common.saved')); } catch (e) { setCfg(prev); setError(e); } finally { setBusy(''); }
  };
  const runNow = async () => {
    setBusy('run'); setError(null); setNotice('');
    try {
      const r = await api<{ classified?: number; auto?: Counts; leftover?: Counts | null }>(`${base}/run`, { method: 'POST', body: {} });
      const sum = (k: keyof Omit<Counts, 'errors'>) => (r.auto?.[k] ?? 0) + (r.leftover?.[k] ?? 0);
      setNotice(t('ca.ranResult').replace('{c}', String(r.classified ?? 0)).replace('{l}', String(sum('liked'))).replace('{r}', String(sum('replied'))).replace('{d}', String(sum('privateReplied'))));
      await load(); onRan();
    } catch (e) { setError(e); await load(); } finally { setBusy(''); }
  };
  if (!cfg) return error ? <ErrorBox error={error} /> : null;
  const last = cfg.lastResult as { auto?: Counts; leftover?: Counts | null } | null;
  const toggle = (key: 'autoLike' | 'autoReply' | 'autoPrivateReply', label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!canEdit || busy !== ''} checked={cfg[key]} onChange={e => void save({ [key]: e.target.checked })} /><span><span className="font-medium">{label}</span><span className="block text-xs text-slate-400">{hint}</span></span></label>
  );
  return (
    <Card title={t('ca.title')} actions={<Pill tone={cfg.enabled ? 'ok' : 'muted'}>{cfg.enabled ? t('ca.on') : t('ca.off')}</Pill>}>
      <p className="mb-3 text-xs text-slate-400">{t('ca.intro')}</p>
      {cfg.commentsStatus === 'NO_PERMISSION' && <p className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200">{t('comments.noPermission')}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {toggle('autoPrivateReply', t('ca.dm'), t('ca.dmHint'))}
        {toggle('autoReply', t('ca.reply'), t('ca.replyHint'))}
        {toggle('autoLike', t('ca.like'), t('ca.likeHint'))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div><div className="mb-1 text-xs text-slate-400">{t('ca.ack')}</div><Input value={ack} maxLength={300} disabled={!canEdit} onChange={e => setAck(e.target.value)} /></div>
        {canEdit && <Button variant="ghost" className="self-end" disabled={busy !== '' || !ack.trim() || ack === cfg.publicAckText} onClick={() => void save({ publicAckText: ack.trim() })}>{t('common.save')}</Button>}
      </div>
      <p className="mt-3 text-xs text-slate-400">{t('ca.safety')}</p>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant={cfg.enabled ? 'danger' : 'primary'} disabled={busy !== '' || cfg.commentsStatus === 'NO_PERMISSION'} onClick={() => void save({ enabled: !cfg.enabled })}>{cfg.enabled ? t('ca.turnOff') : t('ca.turnOn')}</Button>
          {cfg.enabled && <Button variant="ghost" disabled={busy !== ''} onClick={() => void runNow()}>{busy === 'run' ? t('ca.running') : t('ca.runNow')}</Button>}
        </div>
      )}
      <div className="mt-3 space-y-1 text-xs text-slate-400">
        {cfg.enabledAt && cfg.enabled && <p>{t('ca.since')}: {fmt(cfg.enabledAt)}</p>}
        {cfg.lastRunAt && <p>{t('ca.lastRun')}: {fmt(cfg.lastRunAt)}{last?.auto && ` · 💬 ${(last.auto.privateReplied ?? 0) + (last.leftover?.privateReplied ?? 0)} · ↩ ${(last.auto.replied ?? 0) + (last.leftover?.replied ?? 0)} · 👍 ${(last.auto.liked ?? 0) + (last.leftover?.liked ?? 0)}`}</p>}
        {cfg.lastError && <p className="text-amber-500">{cfg.lastError}</p>}
      </div>
      {notice && <p className="mt-2 text-sm text-emerald-500">✔ {notice}</p>}
      <ErrorBox error={error} />
    </Card>
  );
}
