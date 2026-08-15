import Link from "next/link";
import { revalidatePath } from "next/cache";
import {
  Badge,
  Card,
  EmptyState,
  PlatformTag,
  SectionHeader,
  StatTile,
} from "@/components/ui";
import { TrackPageForm } from "@/components/track-page-form";
import { VoiceBar } from "@/components/voice-bar";
import { compactTh, numTh, relativeTh } from "@/lib/format";
import {
  gapAgainstStrongest,
  hasMixedPlatforms,
  loadInsights,
} from "@/lib/server/insights";
import { addTrackedPage, removeTrackedPage } from "@/lib/server/tracked-pages";

export const dynamic = "force-dynamic";

/** ช่วงที่หน้านี้มอง — ตรงกับรอบดึงข้อมูลที่เก็บย้อนหลัง 30 วัน */
const WINDOW_DAYS = 30;

export default async function InsightsPage() {
  const nowMs = Date.now();
  const view = await loadInsights({ nowMs, days: WINDOW_DAYS });
  const { ours, result: gap } = gapAgainstStrongest({ pages: view.pages });

  async function add(_prev: unknown, formData: FormData) {
    "use server";
    const result = await addTrackedPage({
      externalId: String(formData.get("externalId") ?? ""),
      name: String(formData.get("name") ?? ""),
      kind: formData.get("kind") === "OWNED" ? "OWNED" : "COMPETITOR",
      platform: formData.get("platform") === "YOUTUBE" ? "YOUTUBE" : "FACEBOOK",
    });
    if (result.ok) revalidatePath("/insights");
    return result;
  }

  async function remove(formData: FormData) {
    "use server";
    await removeTrackedPage(String(formData.get("id") ?? ""));
    revalidatePath("/insights");
  }

  if (view.errorTh !== null) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">ฟังเสียง</h1>
        </header>
        <Card>
          <div
            className="rounded-[var(--radius-card)] px-4 py-3 text-sm"
            style={{ background: "var(--danger-bg)" }}
          >
            <div className="font-semibold" style={{ color: "var(--danger)" }}>
              อ่านข้อมูลไม่ได้
            </div>
            <p className="mt-1" style={{ color: "var(--text-muted)" }}>
              {view.errorTh}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const leader = view.voice.leader;
  const owned = view.pages.filter((p) => p.kind === "OWNED").length;
  const mixed = hasMixedPlatforms(view.pages);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-xs tracking-wide" style={{ color: "var(--text-faint)" }}>
          {WINDOW_DAYS} วันล่าสุด ·{" "}
          {view.lastFetchedAtMs === null
            ? "ยังไม่เคยดึงข้อมูล"
            : `ดึงข้อมูลล่าสุด ${relativeTh(view.lastFetchedAtMs, nowMs)}`}
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">ฟังเสียง</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          ใครครองบทสนทนาอยู่ และเราห่างเขาแค่ไหน — นับจากโพสต์ที่เผยแพร่ในช่วงนี้
        </p>
      </header>

      {/* ── ตัวเลขรวม ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="เพจที่เฝ้าดู"
          value={numTh(view.pages.length)}
          sub={owned === 0 ? "ยังไม่มีเพจของเราเอง" : `เป็นเพจของเรา ${owned} เพจ`}
        />
        <StatTile
          label={`ENGAGEMENT ${WINDOW_DAYS} วัน`}
          value={compactTh(view.voice.totalEngagement)}
          sub="รีแอ็กชัน + แชร์ + คอมเมนต์"
        />
        <StatTile
          label="เพจที่ครองเสียงมากสุด"
          value={leader === null ? "—" : leader.pageName}
          sub={
            leader === null
              ? "ยังไม่มี engagement ในช่วงนี้"
              : `${leader.sharePct.toFixed(1)}% ของ engagement ทั้งชุด`
          }
          tone={leader === null ? "gray" : "green"}
        />
        <StatTile
          label="ช่องว่างเทียบคู่แข่ง"
          value={gap.ok ? `${gap.gapPct >= 0 ? "นำ" : "ตามหลัง"} ${Math.abs(gap.gapPct).toFixed(1)}%` : "—"}
          sub={gap.ok ? `เทียบกับ ${gap.theirs.pageName}` : "ยังเทียบไม่ได้"}
          tone={gap.ok ? (gap.gapPct >= 0 ? "green" : "red") : "gray"}
        />
      </div>

      {/* ── ส่วนแบ่งเสียง ─────────────────────────────────────────────── */}
      <Card>
        <SectionHeader
          title={`ส่วนแบ่งเสียง ${WINDOW_DAYS} วันล่าสุด`}
          hint={mixed ? "รวมทั้ง Facebook และ YouTube" : undefined}
        />
        {view.voice.totalEngagement === 0 ? (
          <EmptyState>
            ยังไม่มี engagement ในช่วงนี้ — รอรอบดึงข้อมูลถัดไป หรือเช็คว่าเพจที่เพิ่มไว้ดึงได้จริงไหม
          </EmptyState>
        ) : (
          <>
            <VoiceBar
              segments={view.voice.shares.map((s) => {
                const page = view.pages.find((p) => p.id === s.pageId);
                return {
                  label: s.pageName,
                  sharePct: s.sharePct,
                  colorIndex: page?.colorIndex ?? 0,
                };
              })}
            />
            {/*
              เตือนเมื่อรวมสองแพลตฟอร์มไว้ในแถบเดียว — engagement ของสองฝั่ง
              ประกอบขึ้นจากคนละอย่าง (YouTube ไม่มีการแชร์, Facebook ไม่มียอดวิว)
              แถบนี้ยังมีประโยชน์ในฐานะ "อะไรได้ความสนใจมากที่สุดในสิ่งที่เราดูอยู่"
              แต่ต้องไม่ถูกอ่านว่า "ช่องนี้สู้เพจนี้ไม่ได้"
            */}
            {mixed && (
              <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
                ⚠️ แถบนี้รวมเพจ Facebook กับช่อง YouTube ไว้ด้วยกัน —
                อ่านได้ว่า “อะไรได้ความสนใจมากที่สุดในบรรดาที่เราเฝ้าดู”
                แต่<b>เอามาตัดสินว่าฝั่งไหนทำได้ดีกว่าไม่ได้</b> เพราะ YouTube
                ไม่มีตัวเลขการแชร์ ส่วน Facebook ไม่มียอดวิว
              </p>
            )}
          </>
        )}
      </Card>

      {/* ── ช่องว่างมาจากอะไร ─────────────────────────────────────────── */}
      <Card>
        <SectionHeader
          title="ช่องว่างเทียบคู่แข่งที่แรงที่สุด"
          hint={
            ours === null
              ? undefined
              : `${ours.platform === "YOUTUBE" ? "ช่อง" : "เพจ"}ของเรา: ${ours.name}` +
                (mixed ? " · เทียบเฉพาะในแพลตฟอร์มเดียวกัน" : "")
          }
        />
        {!gap.ok ? (
          <EmptyState>{gap.reasonTh}</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className="tabular text-3xl leading-none font-bold"
                style={{ color: gap.gapPct >= 0 ? "var(--ok)" : "var(--danger)" }}
              >
                {gap.gapPct >= 0 ? "นำ" : "ตามหลัง"} {Math.abs(gap.gapPct).toFixed(1)}%
              </span>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                เทียบกับ <b>{gap.theirs.pageName}</b> — เพจที่ engagement สูงสุดในชุดนี้
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              {gap.factors.map((f) => (
                <GapRow key={f.key} factor={f} />
              ))}
            </div>

            <p className="text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
              ตัวเลขแต่ละบรรทัดรวมกันได้เท่ากับช่องว่างรวมพอดี — ดูว่าบรรทัดไหนติดลบมากที่สุด
              นั่นคือจุดที่ควรแก้ก่อน
              {gap.fastestWin !== null && (
                <>
                  {" "}ส่วนตัวที่<b>แก้ได้เร็วที่สุด</b>ตอนนี้คือ “{gap.fastestWin.labelTh}”
                </>
              )}
            </p>
          </div>
        )}
      </Card>

      {/* ── ตารางเพจ ──────────────────────────────────────────────────── */}
      <Card>
        <SectionHeader
          title="เพจและช่องที่คุณเฝ้าดู"
          count={view.pages.length}
          hint="ตัวเลขทั้งหมดนับจากโพสต์ที่เผยแพร่ในช่วงที่เลือก"
        />
        {view.pages.length === 0 ? (
          <EmptyState>ยังไม่มีเพจในรายการ — เพิ่มเพจแรกจากช่องด้านล่าง</EmptyState>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-xs" style={{ color: "var(--text-faint)" }}>
                  <th className="px-1 pb-2 text-left font-medium">เพจ / ช่อง</th>
                  <th className="px-1 pb-2 text-right font-medium">ผู้ติดตาม</th>
                  <th className="px-1 pb-2 text-right font-medium">โพสต์</th>
                  <th className="px-1 pb-2 text-right font-medium">ENGAGEMENT</th>
                  <th className="px-1 pb-2 text-right font-medium">ต่อโพสต์</th>
                  <th className="px-1 pb-2 text-right font-medium">คนคอมเมนต์</th>
                  <th className="px-1 pb-2 text-right font-medium">แหล่งข้อมูล</th>
                  <th className="px-1 pb-2" />
                </tr>
              </thead>
              <tbody>
                {view.pages.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-1 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="client-dot inline-block size-2 shrink-0 rounded-full"
                          style={{ ["--client-color" as string]: `var(--client-${p.colorIndex})` }}
                        />
                        <span className="font-medium">{p.name}</span>
                        <PlatformTag platform={p.platform} />
                        {p.kind === "OWNED" && <Badge tone="green">ของเรา</Badge>}
                      </div>
                    </td>
                    <td className="tabular px-1 py-2.5 text-right">
                      {p.followers === null ? "—" : compactTh(p.followers)}
                    </td>
                    <td className="tabular px-1 py-2.5 text-right">{numTh(p.posts)}</td>
                    <td className="tabular px-1 py-2.5 text-right font-semibold">
                      {compactTh(p.engagement)}
                    </td>
                    <td className="tabular px-1 py-2.5 text-right">
                      {compactTh(Math.round(p.perPost))}
                    </td>
                    <td className="tabular px-1 py-2.5 text-right">
                      {numTh(p.uniqueCommenters)}
                    </td>
                    <td className="px-1 py-2.5 text-right">
                      {p.lastFetchedAtMs === null ? (
                        <Badge tone="amber">ยังไม่เคยดึง</Badge>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                          {relativeTh(p.lastFetchedAtMs, nowMs)}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-2.5 text-right">
                      <form action={remove}>
                        <input type="hidden" name="id" value={p.id} />
                        <button
                          type="submit"
                          className="rounded-[var(--radius-pill)] px-2 py-1 text-xs"
                          style={{ color: "var(--danger)" }}
                        >
                          เอาออก
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link
            href="/insights/comments"
            className="underline underline-offset-2"
            style={{ color: "var(--accent)" }}
          >
            อ่านคอมเมนต์จริง →
          </Link>
          {view.pages.length >= 2 && (
            <Link
              href="/insights/compare"
              className="underline underline-offset-2"
              style={{ color: "var(--accent)" }}
            >
              เทียบเพจแบบเลือกเอง →
            </Link>
          )}
        </div>
      </Card>

      {/* ── เพิ่มเพจ ──────────────────────────────────────────────────── */}
      <Card>
        <SectionHeader
          title="เพิ่มเพจ / ช่องที่จะเฝ้าดู"
          hint="เลือกแพลตฟอร์มก่อน — เงื่อนไขของสองฝั่งไม่เหมือนกัน"
        />
        <TrackPageForm action={add} />
      </Card>
    </div>
  );
}

/**
 * หนึ่งบรรทัดของการแยกช่องว่าง
 *
 * ⚠️ ต้องแสดง "กี่เท่า" คู่กับเปอร์เซ็นต์เสมอ — `contributionPct` เป็นหน่วย
 * ลอการิทึมที่ปรับสเกลแล้ว ไม่ใช่ "มากกว่ากี่เปอร์เซ็นต์" ผู้ติดตามมากกว่า 5.9 เท่า
 * ออกมาเป็น +138.9% ซึ่งคนอ่านจะแปลเป็น 2.4 เท่า (ผิด) ถ้าไม่มีตัวเลขจริงกำกับ
 * — ข้อบังคับนี้มาจากรายงานตรวจงาน `docs/audit/M-K-phase1.md`
 */
function GapRow({
  factor,
}: {
  factor: {
    key: string;
    labelTh: string;
    hintTh: string;
    ratio: number;
    contributionPct: number;
  };
}) {
  const helps = factor.contributionPct >= 0;
  // 1.0 = เท่ากันพอดี → ไม่ต้องบอกว่ากี่เท่า
  const times = factor.ratio >= 1 ? factor.ratio : 1 / factor.ratio;
  const timesTh =
    Math.abs(factor.ratio - 1) < 0.005
      ? "เท่ากัน"
      : `${times.toFixed(times >= 10 ? 0 : 1)} เท่า`;

  // ความยาวแถบเทียบกับ 200% เพื่อให้ค่าที่ทะลุ ±100% ยังอยู่ในกรอบ
  const width = Math.min(100, (Math.abs(factor.contributionPct) / 200) * 100);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm">
          <span style={{ color: "var(--text-faint)" }}>↳ </span>
          {factor.labelTh}{" "}
          <span className="tabular text-xs" style={{ color: "var(--text-muted)" }}>
            ({timesTh})
          </span>
        </span>
        <span
          className="tabular text-sm font-semibold"
          style={{ color: helps ? "var(--ok)" : "var(--danger)" }}
        >
          {helps ? "+" : ""}
          {factor.contributionPct.toFixed(1)}%
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-[var(--radius-pill)]"
        style={{ background: "var(--bg-sunken)" }}
      >
        <span
          className="block h-full"
          style={{
            width: `${width}%`,
            background: helps ? "var(--ok)" : "var(--danger)",
          }}
        />
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
        {factor.hintTh}
      </div>
    </div>
  );
}
