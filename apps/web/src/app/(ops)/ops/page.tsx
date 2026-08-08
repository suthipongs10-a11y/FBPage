import { revalidatePath } from "next/cache";
import { ACTOR_KIND_TH, describeChanges } from "@page-os/ops";
import {
  BulkPanel,
  type BulkPageOption,
  type PreviewResult,
} from "@/components/bulk-panel";
import { Badge, Card, ClientDot, SectionHeader, type Tone } from "@/components/ui";
import { relativeTh } from "@/lib/format";
import {
  bulkTargets,
  morningDigest,
  previewBulk,
  recentAudit,
  runBulk,
} from "@/lib/demo-ops";
import { demoSource } from "@/lib/demo-workspace";

export const dynamic = "force-dynamic";

const ACTOR_TONE: Record<string, Tone> = {
  human: "accent",
  client: "blue",
  system: "gray",
  bot: "green",
};

export default async function OpsPage() {
  const nowMs = Date.now();
  const ws = await demoSource.load(nowMs);
  const digest = morningDigest(nowMs);
  const audit = await recentAudit(nowMs);

  const targets = bulkTargets(nowMs);
  const pages: BulkPageOption[] = targets.map((t) => {
    const page = ws.pages.find((p) => p.pageId === t.pageId);
    return {
      pageId: t.pageId,
      pageName: t.pageName,
      clientName: t.clientName,
      colorIndex: page?.colorIndex ?? 0,
      currentSlaMinutes: Number(t.settings.slaMinutes ?? 0),
    };
  });

  /**
   * ดูตัวอย่าง — ไม่แตะข้อมูลเลย
   *
   * คำนวณที่ฝั่งเซิร์ฟเวอร์ด้วย `planBulkChange()` ตัวจริง ไม่ใช่จำลองในเบราว์เซอร์
   * สิ่งที่คนเห็นจึงเป็นผลลัพธ์เดียวกับที่จะเกิดขึ้นตอนกดจริง
   */
  async function preview(
    pageIds: string[],
    slaMinutes: number,
  ): Promise<PreviewResult> {
    "use server";
    const plan = previewBulk(Date.now(), pageIds, { slaMinutes });
    return {
      rows: plan.pages.map((p) => ({
        pageId: p.pageId,
        pageName: p.pageName,
        skipped: p.skippedTh !== undefined,
        changeTh: p.skippedTh ?? describeChanges(p.changes),
        ...(p.warningTh !== undefined ? { warningTh: p.warningTh } : {}),
      })),
      willChange: plan.willChange,
      willSkip: plan.willSkip,
      affectedClients: plan.affectedClients,
      needsConfirmation: plan.needsConfirmation,
      th: plan.th,
    };
  }

  async function apply(
    pageIds: string[],
    slaMinutes: number,
    confirmed: boolean,
  ): Promise<{ th: string }> {
    "use server";
    try {
      const r = await runBulk(Date.now(), pageIds, { slaMinutes }, confirmed);
      // ต้องสั่งให้หน้าโหลดใหม่ ไม่งั้นประวัติการทำงานด้านล่างจะยังเป็นของเก่า
      // แล้วคนจะคิดว่า audit ไม่ได้บันทึก ทั้งที่บันทึกไปแล้ว
      revalidatePath("/ops");
      return { th: r.th };
    } catch (err) {
      throw new Error(
        err !== null && typeof err === "object" && "th" in err
          ? String((err as { th: unknown }).th)
          : "ทำรายการไม่สำเร็จ",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">ศูนย์ปฏิบัติการ</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          สรุปงานเช้า · ประวัติการทำงาน · แก้ค่าหลายเพจพร้อมกัน
        </p>
      </header>

      <Card>
        <SectionHeader
          title="สรุปงานเช้า"
          hint="ข้อความเดียวกับที่ส่งเข้า LINE ทุกเช้า"
        />
        <pre
          className="overflow-x-auto rounded-[var(--radius-card)] px-4 py-3 text-sm whitespace-pre-wrap"
          style={{
            background: "var(--bg-sunken)",
            fontFamily: "inherit",
            lineHeight: 1.8,
          }}
        >
          {digest.th}
        </pre>
        {digest.hasWork && (
          <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
            มีงานต้องแตะ {digest.taskCount} รายการ
          </p>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="แก้ค่าหลายเพจพร้อมกัน"
          hint="ต้องดูตัวอย่างก่อนเสมอ"
        />
        <BulkPanel pages={pages} onPreview={preview} onApply={apply} />
      </Card>

      <Card>
        <SectionHeader
          title="ประวัติการทำงาน"
          count={audit.length}
          hint="ใครทำอะไร เมื่อไหร่ กับเพจไหน — แก้ย้อนหลังไม่ได้"
        />
        <ul className="flex flex-col">
          {audit.map((e, i) => {
            const page = ws.pages.find((p) => p.pageId === e.pageId);
            return (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <Badge tone={ACTOR_TONE[e.actor.kind] ?? "gray"}>
                  {ACTOR_KIND_TH[e.actor.kind]}
                </Badge>
                <span className="text-sm">{e.th}</span>
                {page && (
                  <span
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: "var(--text-faint)" }}
                  >
                    <ClientDot colorIndex={page.colorIndex} size={6} />
                    {page.pageName}
                  </span>
                )}
                <span
                  className="ml-auto shrink-0 text-xs"
                  style={{ color: "var(--text-faint)" }}
                >
                  {e.actor.id} · {relativeTh(e.atMs, nowMs)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
