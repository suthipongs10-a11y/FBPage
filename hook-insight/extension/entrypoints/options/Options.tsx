import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { dbHealth, type DbHealth } from '@/lib/db';
import { formatInt } from '@/lib/format';
import { log } from '@/lib/log';
import { StatusRow } from '@/lib/ui/StatusRow';

/** ข้อความต้องตรงกับ CLAUDE.md ข้อ 9 และตรงกับ privacy policy ที่จะขึ้นเว็บ */
const PRIVACY_POINTS = [
  'คลิปทั้งหมดที่เก็บอยู่ในเครื่องนี้เท่านั้น ไม่ sync ขึ้นเซิร์ฟเวอร์',
  'ส่วนขยายทำงานเฉพาะบน tiktok.com และ instagram.com ไม่ดูหน้าอื่น',
  'ไม่เก็บประวัติการท่องเว็บ และไม่มี analytics ของบุคคลที่สาม',
  'ข้อความจะออกจากเครื่องก็ต่อเมื่อคุณกดปุ่มส่งให้ AI ช่วยเดาฮุกเองเท่านั้น',
];

export function Options() {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void dbHealth().then((result) => {
      if (!alive) return;
      if (result.ok) {
        setHealth(result.value);
      } else {
        setDbError(result.error.message);
        log.error(result.error.code, result.error.cause);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const manifest = browser.runtime.getManifest();

  return (
    <div className="min-h-screen bg-ink px-6 py-8 text-text">
      <div className="mx-auto max-w-2xl">
        <header>
          <h1 className="text-lg font-semibold">ตั้งค่า · Hook Insight</h1>
          <p className="mt-1 text-sm text-muted">
            เวอร์ชัน <span className="num">{manifest.version}</span> · ขั้น M0
            (โครงร่าง)
          </p>
        </header>

        <section
          aria-labelledby="data-heading"
          className="mt-8 rounded border border-line bg-surface"
        >
          <h2
            id="data-heading"
            className="border-b border-line px-4 py-3 text-sm font-semibold"
          >
            ข้อมูลในเครื่อง
          </h2>
          <StatusRow
            label="คลิปในคลัง"
            tone={dbError ? 'bad' : 'ok'}
            hint={dbError ?? undefined}
            value={health ? formatInt(health.videos) : '…'}
          />
          <StatusRow
            label="บัญชีที่รู้จัก"
            tone={dbError ? 'bad' : 'ok'}
            value={health ? formatInt(health.authors) : '…'}
          />
          <StatusRow
            label="snapshot การเติบโต"
            tone={dbError ? 'bad' : 'ok'}
            value={health ? formatInt(health.snapshots) : '…'}
          />
        </section>

        <section aria-labelledby="privacy-heading" className="mt-6">
          <h2 id="privacy-heading" className="text-sm font-semibold">
            ข้อมูลของคุณไปไหนบ้าง
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            {PRIVACY_POINTS.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden="true" className="text-gauge-base">
                  —
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="next-heading" className="mt-6">
          <h2 id="next-heading" className="text-sm font-semibold">
            ยังไม่มีในเวอร์ชันนี้
          </h2>
          <p className="mt-2 text-sm text-muted">
            ช่องกรอก license key จะมาในขั้น M6 ส่วนการส่งออก/นำเข้าข้อมูลมาในขั้น
            M3 ตอนนี้ยังไม่มีอะไรให้ตั้งค่า
          </p>
        </section>
      </div>
    </div>
  );
}
