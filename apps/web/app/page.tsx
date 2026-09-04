import { t } from '@/lib/i18n';

interface HealthCheck { name: string; status: 'up' | 'down'; latencyMs: number; error?: string }
interface HealthReport { status: 'ok' | 'degraded'; version: string; uptimeSec: number; checks: HealthCheck[] }

export const dynamic = 'force-dynamic';

async function fetchHealth(): Promise<HealthReport | null> {
  const base = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as HealthReport;
  } catch {
    return null;
  }
}

function Dot({ up }: { up: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${up ? 'bg-emerald-400' : 'bg-rose-400'}`} aria-hidden />;
}

export default async function OverviewPage() {
  const health = await fetchHealth();
  const checks = [
    { key: 'health.api' as const, up: health !== null, detail: health ? `v${health.version} · ${health.uptimeSec}s` : t('health.unreachable') },
    ...(['postgres', 'redis'] as const).map(name => {
      const c = health?.checks.find(x => x.name === name);
      return { key: `health.${name}` as const, up: c?.status === 'up', detail: c ? (c.error ?? `${c.latencyMs} ms`) : '—' };
    }),
  ];
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('overview.title')}</h1>
      <p className="mt-1 text-sm text-slate-400">{t('overview.phase1')}</p>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        {checks.map(c => (
          <div key={c.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center gap-2 text-sm text-slate-400"><Dot up={c.up} />{t(c.key)}</div>
            <div className="mt-1 text-lg font-semibold">{c.up ? t('health.up') : t('health.down')}</div>
            <div className="mt-1 truncate text-xs text-slate-500" title={c.detail}>{c.detail}</div>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t('needsAttention.title')}</h2>
        <div className="mt-2 rounded-xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">{t('needsAttention.none')}</div>
      </section>
    </div>
  );
}
