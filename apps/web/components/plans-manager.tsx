'use client';
/** จัดการแพ็กเกจบริการ (ราคา/เดือน/เพจ + โควต้าโพสต์ + บริการที่รวม) — สิทธิ์ client.manage */
import { useState, type FormEvent } from 'react';
import { PLAN_FEATURES } from '@fbpm/shared';
import { api } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { baht, type ServicePlan } from '@/lib/plans';
import { Button, Card, Empty, ErrorBox, Field, Input, Pill, Textarea } from '@/components/ui';

interface Form { name: string; priceMonthly: string; postsPerMonth: string; reelsPerMonth: string; description: string; features: string[] }
const EMPTY: Form = { name: '', priceMonthly: '', postsPerMonth: '', reelsPerMonth: '', description: '', features: ['posts'] };
/** ตัวอย่างสำหรับเริ่มต้น — กดแล้วแค่เติมฟอร์ม ผู้ใช้แก้ราคา/จำนวนเองก่อนบันทึก */
const TEMPLATES: Form[] = [
  { name: 'เริ่มต้น', priceMonthly: '590', postsPerMonth: '8', reelsPerMonth: '', description: 'โพสต์ภาพ + แคปชัน สัปดาห์ละ 2 โพสต์ ตอบคอมเมนต์ในเวลาทำการ', features: ['posts', 'design', 'comments', 'report'] },
  { name: 'มาตรฐาน', priceMonthly: '990', postsPerMonth: '12', reelsPerMonth: '2', description: 'โพสต์ 3 ครั้ง/สัปดาห์ รวม Reels 2 คลิป ดูแลคอมเมนต์ + แชท ส่งรายงานรายเดือน', features: ['posts', 'reels', 'design', 'comments', 'messenger', 'leads', 'report', 'portal'] },
  { name: 'โปร', priceMonthly: '1990', postsPerMonth: '20', reelsPerMonth: '4', description: 'โพสต์เกือบทุกวัน Reels 4 คลิป ดูแลแชท/ลีดใกล้ชิด แจ้งเตือน LINE รายงาน + พอร์ทัลลูกค้า', features: ['posts', 'reels', 'design', 'comments', 'messenger', 'leads', 'report', 'portal', 'line'] },
];
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const toForm = (p: ServicePlan): Form => ({ name: p.name, priceMonthly: p.priceMonthly?.toString() ?? '', postsPerMonth: p.postsPerMonth?.toString() ?? '', reelsPerMonth: p.reelsPerMonth?.toString() ?? '', description: p.description ?? '', features: p.features });

export function PlansManager({ wsId, plans, canManage, onChange }: { wsId: string; plans: ServicePlan[]; canManage: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null); const [f, setF] = useState<Form>(EMPTY);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); setEditing(null); onChange(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = { name: f.name, priceMonthly: num(f.priceMonthly), postsPerMonth: num(f.postsPerMonth), reelsPerMonth: num(f.reelsPerMonth), description: f.description.trim() || null, features: f.features };
    void run(() => (editing === 'new' ? api(`/workspaces/${wsId}/plans`, { method: 'POST', body }) : api(`/workspaces/${wsId}/plans/${editing}`, { method: 'PATCH', body })));
  };
  const form = (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-4">
      <div className="sm:col-span-2"><Field label={t('plans.name')}><Input required value={f.name} onChange={e => setF(v => ({ ...v, name: e.target.value }))} /></Field></div>
      <Field label={t('plans.price')} hint={t('plans.priceHint')}><Input inputMode="numeric" value={f.priceMonthly} onChange={e => setF(v => ({ ...v, priceMonthly: e.target.value.replace(/\D/g, '') }))} placeholder="590" /></Field>
      <Field label={t('plans.posts')} hint={t('plans.blankUnlimited')}><Input inputMode="numeric" value={f.postsPerMonth} onChange={e => setF(v => ({ ...v, postsPerMonth: e.target.value.replace(/\D/g, '') }))} placeholder="12" /></Field>
      <Field label={t('plans.reels')} hint={t('plans.reelsHint')}><Input inputMode="numeric" value={f.reelsPerMonth} onChange={e => setF(v => ({ ...v, reelsPerMonth: e.target.value.replace(/\D/g, '') }))} /></Field>
      <div className="sm:col-span-3"><Field label={t('plans.description')} hint={t('common.optional')}><Textarea className="min-h-16" value={f.description} onChange={e => setF(v => ({ ...v, description: e.target.value }))} /></Field></div>
      <fieldset className="sm:col-span-4"><legend className="mb-1 text-sm text-slate-400">{t('plans.features')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{PLAN_FEATURES.map(k => <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.features.includes(k)} onChange={e => setF(v => ({ ...v, features: e.target.checked ? [...v.features, k] : v.features.filter(x => x !== k) }))} />{t(`plans.f.${k}` as MessageKey)}</label>)}</div>
      </fieldset>
      <div className="flex flex-wrap gap-2 sm:col-span-4"><Button type="submit" disabled={busy}>{t('common.save')}</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button></div>
    </form>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">{t('plans.intro')}</p>
      {canManage && editing === null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => { setF(EMPTY); setEditing('new'); }}>+ {t('plans.new')}</Button>
          <span className="text-xs text-slate-500">{t('plans.templates')}:</span>
          {TEMPLATES.map(tp => <Button key={tp.name} variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setF(tp); setEditing('new'); }}>{tp.name} {baht(Number(tp.priceMonthly))}</Button>)}
        </div>
      )}
      {editing === 'new' && <Card title={t('plans.new')}>{form}</Card>}
      <ErrorBox error={error} />
      {plans.length === 0 && editing !== 'new' ? <Empty text={t('plans.empty')} /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {plans.map(p => editing === p.id ? <Card key={p.id} title={p.name} className="md:col-span-2">{form}</Card> : (
            <Card key={p.id} title={p.name} actions={<div className="flex items-center gap-2">{!p.active && <Pill>{t('plans.inactive')}</Pill>}<Pill tone="ok">{p.pages} {t('plans.pagesUnit')}</Pill></div>}>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {p.priceMonthly !== undefined && <div className="text-2xl font-bold tabular-nums">{p.priceMonthly === null ? '—' : baht(p.priceMonthly)}<span className="text-xs font-normal text-slate-500"> {t('plans.perPageMonth')}</span></div>}
                <div className="text-sm">{p.postsPerMonth === null ? t('quota.unlimited') : `${p.postsPerMonth} ${t('plans.postsUnit')}`}{p.reelsPerMonth ? ` · Reels ${p.reelsPerMonth}` : ''}</div>
              </div>
              {p.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{p.description}</p>}
              <div className="mt-2 flex flex-wrap gap-1">{p.features.map(k => <Pill key={k}>{t(`plans.f.${k}` as MessageKey)}</Pill>)}</div>
              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setF(toForm(p)); setEditing(p.id); }}>{t('common.edit')}</Button>
                  <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => void run(() => api(`/workspaces/${wsId}/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } }))}>{p.active ? t('plans.deactivate') : t('plans.activate')}</Button>
                  {p.pages === 0 && <Button variant="danger" className="px-2 py-1 text-xs" disabled={busy} onClick={() => { if (confirm(t('common.confirmDelete'))) void run(() => api(`/workspaces/${wsId}/plans/${p.id}`, { method: 'DELETE' })); }}>{t('common.delete')}</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
