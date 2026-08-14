import Link from "next/link";
import { Badge, Card, EmptyState, SectionHeader } from "@/components/ui";
import { VoiceBar } from "@/components/voice-bar";
import { compactTh, numTh } from "@/lib/format";
import { gapBetween, loadInsights, type PageInsight } from "@/lib/server/insights";
import { shareOfVoice } from "@page-os/listening";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * หน้าเทียบเพจ — เลือกเองว่าเพจไหนเป็น "ของเรา" และเทียบกับใคร
 *
 * เลือกผ่าน query string ไม่ใช่ state ฝั่ง client เพราะลิงก์ที่เลือกไว้แล้วต้อง
 * ส่งให้คนอื่นดูได้ และกดปุ่มย้อนกลับต้องกลับไปคู่ที่แล้วจริงๆ
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const view = await loadInsights({ nowMs: Date.now(), days: WINDOW_DAYS });

  if (view.errorTh !== null) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <EmptyState>{view.errorTh}</EmptyState>
        </Card>
      </div>
    );
  }

  if (view.pages.length < 2) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <EmptyState>
            ต้องมีอย่างน้อย 2 เพจถึงจะเทียบได้ — เพิ่มเพจที่หน้าฟังเสียงก่อน
          </EmptyState>
        </Card>
      </div>
    );
  }

  /** ค่าเริ่มต้น: เพจของเราตัวแรก เทียบกับเพจที่ engagement สูงสุดที่ไม่ใช่ตัวเอง */
  const defaultOurs =
    view.pages.find((p) => p.kind === "OWNED") ?? (view.pages[0] as PageInsight);
  const ours = view.pages.find((p) => p.id === pick("ours")) ?? defaultOurs;

  const rivals = view.pages.filter((p) => p.id !== ours.id);
  const defaultTheirs = [...rivals].sort((a, b) => b.engagement - a.engagement)[0];
  const theirs =
    view.pages.find((p) => p.id === pick("theirs") && p.id !== ours.id) ??
    (defaultTheirs as PageInsight);

  const gap = gapBetween({ pages: view.pages, ourId: ours.id, theirId: theirs.id });

  const pair = [ours, theirs];
  const voice = shareOfVoice(
    pair.map((p) => ({ pageId: p.id, pageName: p.name, engagement: p.engagement })),
  );

  return (
    <div className="flex flex-col gap-6">
      <Header />

      {/* ── เลือกเพจ ─────────────────────────────────────────────────── */}
      <Card>
        <SectionHeader title="เลือกเพจที่จะเทียบ" hint="กดเพื่อเปลี่ยน" />
        <div className="flex flex-col gap-3">
          <PickerRow
            label="เพจของเรา"
            pages={view.pages}
            selectedId={ours.id}
            /**
             * กดเพจที่กำลังอยู่ฝั่ง "เทียบกับ" = **สลับข้าง** ไม่ใช่เทียบกับตัวเอง
             *
             * ถ้าปล่อยให้ลิงก์เป็น `ours=X&theirs=X` หน้าจะแก้ให้เงียบๆ โดยเด้ง
             * `theirs` ไปเป็นคู่แข่งที่แรงที่สุดแทน — คนกดจะเห็นผลลัพธ์ที่ไม่ได้ขอ
             * โดยไม่รู้ว่าทำไม
             */
            hrefFor={(id) =>
              `/insights/compare?ours=${id}&theirs=${id === theirs.id ? ours.id : theirs.id}`
            }
          />
          <PickerRow
            label="เทียบกับ"
            pages={rivals}
            selectedId={theirs.id}
            hrefFor={(id) => `/insights/compare?ours=${ours.id}&theirs=${id}`}
          />
        </div>
      </Card>

      {/* ── ส่วนแบ่งเสียงเฉพาะคู่นี้ ───────────────────────────────────── */}
      <Card>
        <SectionHeader
          title="ส่วนแบ่งเสียงระหว่างสองเพจนี้"
          hint={`${WINDOW_DAYS} วันล่าสุด`}
        />
        {voice.totalEngagement === 0 ? (
          <EmptyState>ทั้งสองเพจยังไม่มี engagement ในช่วงนี้</EmptyState>
        ) : (
          <>
            <VoiceBar
              segments={voice.shares.map((s) => ({
                label: s.pageName,
                sharePct: s.sharePct,
                colorIndex: pair.find((p) => p.id === s.pageId)?.colorIndex ?? 0,
              }))}
            />
            <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
              engagement = รีแอ็กชัน + แชร์ + คอมเมนต์ บนโพสต์ที่เผยแพร่ในช่วงที่เลือก
            </p>
          </>
        )}
      </Card>

      {/* ── ช่องว่าง ─────────────────────────────────────────────────── */}
      <Card>
        <SectionHeader title="ช่องว่างนี้มาจากอะไร" />
        {!gap.ok ? (
          <EmptyState>{gap.reasonTh}</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            <div
              className="tabular text-3xl leading-none font-bold"
              style={{ color: gap.gapPct >= 0 ? "var(--ok)" : "var(--danger)" }}
            >
              {gap.gapPct >= 0 ? "นำ" : "ตามหลัง"} {Math.abs(gap.gapPct).toFixed(1)}%
            </div>

            <div className="flex flex-col gap-2.5">
              {gap.factors.map((f) => {
                const helps = f.contributionPct >= 0;
                const times = f.ratio >= 1 ? f.ratio : 1 / f.ratio;
                return (
                  <div key={f.key}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm">
                        <span style={{ color: "var(--text-faint)" }}>↳ </span>
                        {f.labelTh}{" "}
                        <span className="tabular text-xs" style={{ color: "var(--text-muted)" }}>
                          ({Math.abs(f.ratio - 1) < 0.005
                            ? "เท่ากัน"
                            : `${times.toFixed(times >= 10 ? 0 : 1)} เท่า`}
                          )
                        </span>
                      </span>
                      <span
                        className="tabular text-sm font-semibold"
                        style={{ color: helps ? "var(--ok)" : "var(--danger)" }}
                      >
                        {helps ? "+" : ""}
                        {f.contributionPct.toFixed(1)}%
                      </span>
                    </div>
                    <div
                      className="mt-1 h-1.5 overflow-hidden rounded-[var(--radius-pill)]"
                      style={{ background: "var(--bg-sunken)" }}
                    >
                      <span
                        className="block h-full"
                        style={{
                          width: `${Math.min(100, (Math.abs(f.contributionPct) / 200) * 100)}%`,
                          background: helps ? "var(--ok)" : "var(--danger)",
                        }}
                      />
                    </div>
                    <div className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                      {f.hintTh}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
              ตัวเลขแต่ละบรรทัดรวมกันได้เท่ากับช่องว่างรวมพอดี ส่วนตัวเลขในวงเล็บคือ
              <b> อัตราส่วนจริง</b> ซึ่งอ่านง่ายกว่า — เปอร์เซ็นต์ตรงนี้บอกว่า
              ปัจจัยนั้น<b>มีส่วนในช่องว่างเท่าไร</b> ไม่ใช่ "มากกว่ากี่เปอร์เซ็นต์"
            </p>
          </div>
        )}
      </Card>

      {/* ── ตัวเลขรายเพจ ─────────────────────────────────────────────── */}
      <Card>
        <SectionHeader title="ตัวเลขรายเพจ" />
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr className="text-xs" style={{ color: "var(--text-faint)" }}>
                <th className="px-1 pb-2 text-left font-medium">เพจ</th>
                <th className="px-1 pb-2 text-right font-medium">ผู้ติดตาม</th>
                <th className="px-1 pb-2 text-right font-medium">โพสต์</th>
                <th className="px-1 pb-2 text-right font-medium">รีแอ็กชัน</th>
                <th className="px-1 pb-2 text-right font-medium">แชร์</th>
                <th className="px-1 pb-2 text-right font-medium">คอมเมนต์</th>
                <th className="px-1 pb-2 text-right font-medium">ENGAGEMENT</th>
                <th className="px-1 pb-2 text-right font-medium">ต่อโพสต์</th>
              </tr>
            </thead>
            <tbody>
              {pair.map((p) => (
                <tr key={p.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-1 py-2.5">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{ background: `var(--client-${p.colorIndex})` }}
                      />
                      <span className="font-medium">{p.name}</span>
                      {p.id === ours.id && <Badge tone="green">เพจของเรา</Badge>}
                    </span>
                  </td>
                  <td className="tabular px-1 py-2.5 text-right">
                    {p.followers === null ? "—" : compactTh(p.followers)}
                  </td>
                  <td className="tabular px-1 py-2.5 text-right">{numTh(p.posts)}</td>
                  <td className="tabular px-1 py-2.5 text-right">{compactTh(p.reactions)}</td>
                  <td className="tabular px-1 py-2.5 text-right">{compactTh(p.shares)}</td>
                  <td className="tabular px-1 py-2.5 text-right">{compactTh(p.comments)}</td>
                  <td className="tabular px-1 py-2.5 text-right font-semibold">
                    {compactTh(p.engagement)}
                  </td>
                  <td className="tabular px-1 py-2.5 text-right">
                    {compactTh(Math.round(p.perPost))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Header() {
  return (
    <header>
      <Link
        href="/insights"
        className="text-xs underline underline-offset-2"
        style={{ color: "var(--text-faint)" }}
      >
        ← กลับไปหน้าฟังเสียง
      </Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">เทียบเพจ</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        เลือกสองเพจแล้วดูว่าช่องว่างระหว่างกันมาจากอะไร
      </p>
    </header>
  );
}

function PickerRow({
  label,
  pages,
  selectedId,
  hrefFor,
}: {
  label: string;
  pages: PageInsight[];
  selectedId: string;
  hrefFor: (id: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      {pages.map((p) => {
        const on = p.id === selectedId;
        return (
          <Link
            key={p.id}
            href={hrefFor(p.id)}
            className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs"
            style={{
              borderColor: on ? "var(--accent)" : "var(--border)",
              background: on ? "var(--accent-bg)" : "transparent",
              fontWeight: on ? 600 : 400,
            }}
          >
            {p.name}
          </Link>
        );
      })}
    </div>
  );
}
