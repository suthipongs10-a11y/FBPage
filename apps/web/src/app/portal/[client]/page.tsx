import { notFound } from "next/navigation";
import { PortalPostCard, type PortalPostView } from "@/components/portal-post";
import { dateTimeTh } from "@/lib/format";
import { decideDemo, findTenant } from "@/lib/demo-portal";
import { portalCalendarOf } from "@/lib/demo-portal";

export const dynamic = "force-dynamic";

const TZ = "Asia/Bangkok";

export default async function PortalPage({
  params,
}: {
  params: Promise<{ client: string }>;
}) {
  const { client } = await params;
  const tenant = findTenant(client);
  if (!tenant) notFound();

  const nowMs = Date.now();
  const calendar = portalCalendarOf(tenant, nowMs);

  const posts: PortalPostView[] = calendar.posts.map((p) => ({
    ...p,
    whenTh: dateTimeTh(p.scheduledAtMs, TZ),
  }));
  const waiting = posts.filter((p) => p.canDecide);
  const rest = posts.filter((p) => !p.canDecide);

  /**
   * Server action ที่ลูกค้ากดจากเบราว์เซอร์
   *
   * รับแค่ `postId` จากฝั่งผู้ใช้ ส่วนขอบเขตคำนวณใหม่ที่ฝั่งเซิร์ฟเวอร์เสมอ —
   * ห้ามให้ฝั่งเบราว์เซอร์ส่ง scope มาเอง ไม่งั้นเปลี่ยนค่าแล้วดูข้อมูลคนอื่นได้
   */
  async function decide(
    postId: string,
    decision: "approve" | "request_changes",
    note?: string,
  ): Promise<{ th: string }> {
    "use server";
    const t = findTenant(client);
    if (!t) throw new Error("ไม่พบบัญชีนี้");
    try {
      return await decideDemo(t, postId, decision, Date.now(), note);
    } catch (err) {
      // ส่งเฉพาะข้อความไทยกลับไป ไม่ส่งรายละเอียดภายใน
      throw new Error(
        err !== null && typeof err === "object" && "th" in err
          ? String((err as { th: unknown }).th)
          : "ทำรายการไม่สำเร็จ กรุณาลองใหม่",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          {waiting.length > 0
            ? `มี ${waiting.length} โพสต์รอให้คุณดู`
            : "ไม่มีอะไรรอคุณอนุมัติ"}
        </h1>
        {tenant.brand.config.welcomeTh && (
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {tenant.brand.config.welcomeTh}
          </p>
        )}
      </header>

      {waiting.length > 0 && (
        <section className="flex flex-col gap-3">
          {waiting.map((p) => (
            <PortalPostCard key={p.postId} post={p} onDecide={decide} />
          ))}
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            คอนเทนต์อื่นในเดือนนี้ ({rest.length})
          </h2>
          <div className="flex flex-col gap-3">
            {rest.map((p) => (
              <PortalPostCard key={p.postId} post={p} onDecide={decide} />
            ))}
          </div>
        </section>
      )}

      {posts.length === 0 && (
        <p
          className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm"
          style={{ color: "var(--text-faint)", borderColor: "var(--border)" }}
        >
          ยังไม่มีคอนเทนต์ในช่วงนี้ ทีมงานกำลังเตรียมให้อยู่
        </p>
      )}
    </div>
  );
}
