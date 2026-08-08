import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { dbHealth, type DbHealth } from '@/lib/db';
import { readLastProbe, watchLastProbe } from '@/lib/diagnostics';
import { formatAgo, formatInt } from '@/lib/format';
import { log } from '@/lib/log';
import type { ProbeRecord } from '@/lib/messages';
import { StatusRow } from '@/lib/ui/StatusRow';

const PLATFORM_LABEL = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
} as const;

export function SidePanel() {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeRecord | null>(null);

  useEffect(() => {
    let alive = true;

    void dbHealth().then((result) => {
      if (!alive) return;
      if (result.ok) {
        setHealth(result.value);
        setDbError(null);
      } else {
        setDbError(result.error.message);
        log.error(result.error.code, result.error.cause);
      }
    });

    void readLastProbe().then((result) => {
      if (alive && result.ok) setProbe(result.value);
    });

    const stop = watchLastProbe((next) => {
      if (alive) setProbe(next);
    });

    return () => {
      alive = false;
      stop();
    };
  }, []);

  const isEmpty = health !== null && health.videos === 0;

  return (
    <div className="flex min-h-screen flex-col bg-ink text-text">
      <header className="border-b border-line px-4 py-3">
        <h1 className="text-base font-semibold">Hook Insight</h1>
        <p className="mt-0.5 text-xs text-muted">
          คลิปนี้ทำได้ดีกว่าค่าเฉลี่ยของบัญชีตัวเองแค่ไหน
        </p>
      </header>

      <main className="flex-1">
        {isEmpty ? (
          <section className="px-4 py-8">
            <p className="text-sm leading-relaxed">
              ยังไม่มีคลิปในคลัง — เปิด TikTok แล้วกดปุ่มเก็บที่มุมคลิป
            </p>
            <p className="mt-2 text-xs text-muted">
              ปุ่มเก็บจะมาในขั้น M1 ตอนนี้แผงข้างใช้ดูสถานะระบบก่อน
            </p>
          </section>
        ) : (
          <section className="px-4 py-8">
            <p className="text-sm">
              มีคลิปในคลัง{' '}
              <span className="num">{formatInt(health?.videos ?? 0)}</span> คลิป
            </p>
          </section>
        )}

        <section aria-label="สถานะระบบ" className="border-t border-line">
          <h2 className="px-4 pt-3 pb-1 text-xs tracking-wide text-muted">
            สถานะระบบ
          </h2>

          <StatusRow
            label="คลังในเครื่อง (IndexedDB)"
            tone={dbError ? 'bad' : health ? 'ok' : 'wait'}
            hint={dbError ?? 'ข้อมูลทั้งหมดอยู่ในเครื่องนี้ ไม่ส่งขึ้นเซิร์ฟเวอร์'}
            value={
              dbError
                ? 'ต่อไม่ได้'
                : health
                  ? `${formatInt(health.videos)} คลิป`
                  : '…'
            }
          />

          <StatusRow
            label="สะพานข้อมูลบนหน้าเว็บ"
            tone={bridgeTone(probe)}
            hint={
              probe
                ? `${PLATFORM_LABEL[probe.platform]} · ${formatAgo(probe.at)}`
                : 'เปิดหน้า TikTok หรือ Instagram ค้างไว้ แล้วกลับมาดูอีกครั้ง'
            }
            value={
              probe ? (probe.bridgeReady ? 'ต่อครบ' : 'ต่อบางส่วน') : 'ยังไม่เชื่อม'
            }
          />
        </section>
      </main>

      <footer className="border-t border-line px-4 py-2 text-xs text-muted">
        <span className="num">v{browser.runtime.getManifest().version}</span> ·
        M0 โครงร่าง
      </footer>
    </div>
  );
}

function bridgeTone(probe: ProbeRecord | null): 'ok' | 'wait' | 'bad' {
  if (!probe) return 'wait';
  return probe.bridgeReady ? 'ok' : 'bad';
}
