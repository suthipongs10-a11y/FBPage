import type { Route } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { CommentModeration } from "@/components/comment-moderation";
import { Badge, Card, EmptyState, PlatformTag, SectionHeader } from "@/components/ui";
import { compactTh, dateTimeTh, numTh, truncate } from "@/lib/format";
import { COMMENTS_PAGE_SIZE, loadComments } from "@/lib/server/comments";
import { parseAction } from "@/lib/moderation-guard";
import { moderateComments } from "@/lib/server/moderate-comments";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const TZ = "Asia/Bangkok";

/**
 * อ่านคอมเมนต์จริงใต้โพสต์ของเพจที่เฝ้าดู
 *
 * ทุกตัวกรอง (เพจ / คำค้น / หน้า) อยู่ใน query string ไม่ใช่ state ฝั่ง client
 * — ผลการค้นที่เจอของดีต้องส่งลิงก์ให้คนอื่นดูได้ และปุ่มย้อนกลับต้องทำงานจริง
 */
export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const view = await loadComments({
    nowMs: Date.now(),
    days: WINDOW_DAYS,
    trackedPageId: one("page"),
    keyword: one("q"),
    page: Number(one("n") ?? "1") || 1,
  });

  /**
   * สั่งซ่อน/ปล่อย/ลบ — ตรวจสิทธิ์จริงที่ฝั่งเซิร์ฟเวอร์เสมอ
   *
   * checkbox ที่ปิดไว้ในหน้าเว็บกันคนกดผิดได้ แต่กันคนที่ยิงคำขอเองไม่ได้
   * ด่านจริงอยู่ใน `moderateComments()` ซึ่งอ่านเจ้าของช่องจากฐานข้อมูลเราเอง
   */
  async function moderate(formData: FormData) {
    "use server";
    const result = await moderateComments({
      commentIds: formData.getAll("ids").map(String),
      action: parseAction(formData.get("action")),
      nowMs: Date.now(),
    });
    if (result.ok) revalidatePath("/insights/comments");
    return { ok: result.ok, th: result.th };
  }

  /**
   * สั่งได้เฉพาะคอมเมนต์บนช่อง YouTube ของเราเอง
   * — Facebook ยังไม่ได้ต่อเข้าหน้านี้ และช่องคนอื่นเราไม่มีสิทธิ์
   */
  const moderatable = view.rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    canModerate: r.platform === "YOUTUBE" && r.kind === "OWNED",
    authorName: r.authorName,
    pageName: r.pageName,
    createdAtMs: r.createdAtMs,
    message: r.message,
    postPermalink: r.postPermalink,
    moderatedStatus: r.moderatedStatus,
  }));

  /**
   * สร้างลิงก์โดยคงตัวกรองอื่นไว้ — เปลี่ยนทีละอย่างเท่านั้น
   *
   * คืน `Route` ไม่ใช่ `string` เพราะเปิด `typedRoutes` ไว้ใน next.config
   * — Next ตรวจว่าเส้นทางที่ส่งให้ `<Link>` มีอยู่จริง ซึ่งจับลิงก์ตายได้
   * ตั้งแต่ตอน build แต่แลกมาด้วยว่าสตริงที่ประกอบเองต้องบอกชนิดให้ชัด
   */
  const linkTo = (over: Record<string, string | undefined>): Route => {
    const next = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      page: view.selectedPageId ?? undefined,
      q: view.keyword === "" ? undefined : view.keyword,
      n: view.page === 1 ? undefined : String(view.page),
      ...over,
    };
    for (const [k, v] of Object.entries(current)) {
      if (v !== undefined && v !== "") next.set(k, v);
    }
    const qs = next.toString();
    return (qs === "" ? "/insights/comments" : `/insights/comments?${qs}`) as Route;
  };

  const lastPage = Math.max(1, Math.ceil(view.total / COMMENTS_PAGE_SIZE));

  /** ลิงก์ดาวน์โหลด — ใช้ตัวกรองเดียวกับที่เห็นบนหน้า แต่ไม่เอาเลขหน้า */
  const exportParams = new URLSearchParams();
  if (view.selectedPageId !== null) exportParams.set("page", view.selectedPageId);
  if (view.keyword !== "") exportParams.set("q", view.keyword);
  const exportHref =
    exportParams.toString() === ""
      ? "/insights/comments/export"
      : `/insights/comments/export?${exportParams.toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/insights"
          className="text-xs underline underline-offset-2"
          style={{ color: "var(--text-faint)" }}
        >
          ← กลับไปหน้าฟังเสียง
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">อ่านคอมเมนต์</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          คอมเมนต์จริงใต้โพสต์ของเพจที่เฝ้าดู — ค้นคำที่อยากรู้ เช่น “ส่งช้า” “แพง”
          หรือชื่อสินค้า
        </p>
      </header>

      {view.errorTh !== null ? (
        <Card>
          <EmptyState>{view.errorTh}</EmptyState>
        </Card>
      ) : (
        <>
          {/* ── ตัวกรอง ─────────────────────────────────────────────── */}
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={linkTo({ page: undefined, n: undefined })}
                  className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs"
                  style={{
                    borderColor:
                      view.selectedPageId === null ? "var(--accent)" : "var(--border)",
                    background:
                      view.selectedPageId === null ? "var(--accent-bg)" : "transparent",
                  }}
                >
                  ทุกเพจ / ช่อง
                </Link>
                {view.pages.map((p) => {
                  const on = p.id === view.selectedPageId;
                  return (
                    <Link
                      key={p.id}
                      href={linkTo({ page: p.id, n: undefined })}
                      className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs"
                      style={{
                        borderColor: on ? "var(--accent)" : "var(--border)",
                        background: on ? "var(--accent-bg)" : "transparent",
                        fontWeight: on ? 600 : 400,
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {p.name}
                        <PlatformTag platform={p.platform} />
                      </span>
                    </Link>
                  );
                })}
              </div>

              {/* ฟอร์ม GET ธรรมดา — ค่าจึงไปอยู่ใน URL เอง ไม่ต้องมี JS */}
              <form method="get" action="/insights/comments" className="flex gap-2">
                {view.selectedPageId !== null && (
                  <input type="hidden" name="page" value={view.selectedPageId} />
                )}
                <input
                  name="q"
                  defaultValue={view.keyword}
                  placeholder="คำที่อยากค้น เช่น ส่งช้า, แพง, ปลาร้า"
                  className="flex-1 rounded-[var(--radius-card)] border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--bg-sunken)",
                    borderColor: "var(--border)",
                    color: "var(--text)",
                  }}
                />
                <button
                  type="submit"
                  className="rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium"
                  style={{ background: "var(--accent)", color: "white" }}
                >
                  ค้นหา
                </button>
                {view.keyword !== "" && (
                  <Link
                    href={linkTo({ q: undefined, n: undefined })}
                    className="flex items-center px-2 text-sm underline underline-offset-2"
                    style={{ color: "var(--text-faint)" }}
                  >
                    ล้างคำค้น
                  </Link>
                )}
              </form>

              {/**
                * ดาวน์โหลดได้ทั้งชุดที่ตรงเงื่อนไข ไม่ใช่แค่ 25 อันที่เห็นบนหน้า
                * — คนกดดาวน์โหลดต้องการข้อมูลไปทำงานต่อ ไม่ใช่หน้าจอที่เห็นอยู่
                */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <a
                  href={exportHref}
                  className="underline underline-offset-2"
                  style={{ color: "var(--accent)" }}
                >
                  ↓ ดาวน์โหลด CSV ({numTh(view.total)} แถว)
                </a>
                <span style={{ color: "var(--text-faint)" }}>
                  เปิดใน Excel ได้เลย ภาษาไทยไม่เพี้ยน
                </span>
              </div>
            </div>
          </Card>

          {/* ── คนพูดถึงอะไรบ้าง ─────────────────────────────────────── */}
          <Card>
            <SectionHeader
              title="คนพูดถึงอะไรบ้าง"
              hint={`${WINDOW_DAYS} วันล่าสุด · ${numTh(view.topics.total)} คอมเมนต์`}
            />
            {view.topics.total === 0 ? (
              <EmptyState>
                ยังไม่มีคอมเมนต์ในช่วงนี้ — รอรอบดึงข้อมูลถัดไป หรือลองล้างคำค้น
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {view.topics.topics.map((t) => (
                    <span
                      key={t.key}
                      className="rounded-[var(--radius-pill)] px-3 py-1.5 text-xs"
                      style={{ background: "var(--bg-sunken)" }}
                    >
                      {t.labelTh}{" "}
                      <b className="tabular">{numTh(t.count)}</b>
                    </span>
                  ))}
                  <span
                    className="rounded-[var(--radius-pill)] px-3 py-1.5 text-xs"
                    style={{ background: "var(--accent-bg)" }}
                  >
                    เป็นคำถาม <b className="tabular">{numTh(view.topics.questions)}</b>{" "}
                    <span style={{ color: "var(--text-muted)" }}>
                      ({view.topics.questionPct.toFixed(0)}%)
                    </span>
                  </span>
                </div>

                <p className="text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
                  คอมเมนต์หนึ่งอันอยู่ได้หลายหัวข้อ และ{" "}
                  <b className="tabular">{numTh(view.topics.uncategorized)}</b> อัน
                  ไม่เข้าหัวข้อไหนเลย (ส่วนใหญ่เป็นอิโมจิหรือคำทักทาย)
                  ผลรวมของหัวข้อจึงไม่เท่ากับจำนวนคอมเมนต์ทั้งหมด
                  {view.topicsFromSample && (
                    <>
                      {" "}
                      <b style={{ color: "var(--warn)" }}>
                        ตัวเลขนี้คิดจากคอมเมนต์ล่าสุดบางส่วน ไม่ใช่ทั้งหมด
                      </b>{" "}
                      เพราะช่วงนี้มีคอมเมนต์เกินเพดานที่คิดไหวในครั้งเดียว
                    </>
                  )}
                </p>
              </div>
            )}
          </Card>

          {/* ── รายการคอมเมนต์ ───────────────────────────────────────── */}
          <Card>
            <SectionHeader
              title={view.keyword === "" ? "คอมเมนต์ล่าสุด" : `ผลค้น “${view.keyword}”`}
              count={view.total}
            />
            {view.rows.length === 0 ? (
              <EmptyState>
                {view.keyword === ""
                  ? "ยังไม่มีคอมเมนต์ในช่วงนี้"
                  : `ไม่เจอคอมเมนต์ที่มีคำว่า “${view.keyword}”`}
              </EmptyState>
            ) : (
              <CommentModeration
                comments={moderatable}
                action={moderate}
                timeZone={TZ}
              />
            )}

            {lastPage > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                {view.page > 1 ? (
                  <Link
                    href={linkTo({ n: String(view.page - 1) })}
                    className="underline underline-offset-2"
                    style={{ color: "var(--accent)" }}
                  >
                    ← ก่อนหน้า
                  </Link>
                ) : (
                  <span />
                )}
                <span className="tabular text-xs" style={{ color: "var(--text-faint)" }}>
                  หน้า {view.page} จาก {lastPage}
                </span>
                {view.page < lastPage ? (
                  <Link
                    href={linkTo({ n: String(view.page + 1) })}
                    className="underline underline-offset-2"
                    style={{ color: "var(--accent)" }}
                  >
                    ถัดไป →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </Card>

          {/* ── แฟนตัวยง ─────────────────────────────────────────────── */}
          <Card>
            <SectionHeader
              title="แฟนตัวยงของแต่ละเพจ"
              hint="ใครคอมเมนต์เยอะสุด — ไม่ขึ้นกับคำค้น"
            />
            {view.fans.length === 0 ? (
              <EmptyState>ยังไม่มีคอมเมนต์ที่รู้ว่าใครพูด</EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {view.fans.map((b) => (
                  <div
                    key={b.trackedPageId}
                    className="rounded-[var(--radius-card)] border px-4 py-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="mb-2 text-sm font-semibold">{b.pageName}</div>
                    <ul className="flex flex-col gap-1">
                      {b.fans.map((f) => (
                        <li
                          key={f.name}
                          className="flex items-baseline justify-between gap-3 text-xs"
                        >
                          <span className="min-w-0 truncate">{f.name}</span>
                          <span
                            className="tabular shrink-0"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {compactTh(f.comments)} คอมเมนต์
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ── สัญญาณผิดปกติ ────────────────────────────────────────── */}
          <Card>
            <SectionHeader
              title="บัญชีจริง vs สัญญาณผิดปกติ"
              hint={`สแกน ${numTh(view.suspicion.accountsScanned)} บัญชี จาก ${numTh(view.suspicion.commentsScanned)} คอมเมนต์`}
            />
            {view.suspicion.accountsScanned === 0 ? (
              <EmptyState>ยังไม่มีบัญชีที่รู้ชื่อให้สแกน</EmptyState>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span
                    className="tabular text-3xl leading-none font-bold"
                    style={{
                      color:
                        view.suspicion.flagged.length === 0 ? "var(--ok)" : "var(--warn)",
                    }}
                  >
                    {view.suspicion.flaggedPct.toFixed(1)}%
                  </span>
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {numTh(view.suspicion.flagged.length)} จาก{" "}
                    {numTh(view.suspicion.accountsScanned)} บัญชี พบสัญญาณผิดปกติ
                  </span>
                </div>

                {view.suspicion.flagged.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {view.suspicion.flagged.slice(0, 20).map((f) => (
                      <li
                        key={f.name}
                        className="rounded-[var(--radius-card)] px-4 py-3"
                        style={{ background: "var(--bg-sunken)" }}
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <b className="text-sm">{f.name}</b>
                          <Badge tone={f.level === "high" ? "red" : "amber"}>
                            {f.level === "high" ? "เข้าข่ายชัด" : "น่าดูต่อ"}
                          </Badge>
                          <span className="tabular text-xs" style={{ color: "var(--text-faint)" }}>
                            {numTh(f.comments)} คอมเมนต์
                          </span>
                        </div>
                        {/* บอกว่า "เห็นอะไร" ไม่ใช่แค่ "ติดธง" — คนต้องตรวจสอบเองได้ */}
                        <ul className="mt-1.5 flex flex-col gap-0.5">
                          {f.signals.map((sig) => (
                            <li
                              key={sig.key}
                              className="text-xs leading-relaxed"
                              style={{ color: "var(--text-muted)" }}
                            >
                              • <b>{sig.labelTh}</b> — {sig.detailTh}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}

                {/**
                  * คำเตือนนี้ไม่ใช่ของประดับ — ฟีเจอร์นี้ชี้นิ้วไปที่คนจริง
                  * ถ้าคนอ่านว่าเป็นคำตัดสิน จะเกิดการกล่าวหาลูกค้าตัวจริง
                  */}
                <p
                  className="rounded-[var(--radius-card)] px-3 py-2 text-xs leading-relaxed"
                  style={{ background: "var(--warn-bg)", color: "var(--text-muted)" }}
                >
                  ⚠️ {view.suspicion.caveatTh}
                </p>
              </div>
            )}
          </Card>

          {/* ── ผู้ชมที่ทับซ้อนกัน ────────────────────────────────────── */}
          <Card>
            <SectionHeader
              title="คนที่คอมเมนต์หลายเพจ"
              count={view.overlap.people.length}
            />
            {view.overlap.people.length === 0 ? (
              <EmptyState>ยังไม่เจอคนที่คอมเมนต์ข้ามเพจ</EmptyState>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {view.overlap.people.map((p) => (
                  <li
                    key={p.name}
                    className="rounded-[var(--radius-pill)] px-3 py-1.5 text-xs"
                    style={{ background: "var(--bg-sunken)" }}
                  >
                    {p.name}{" "}
                    <Badge tone="amber">{p.pages} เพจ</Badge>{" "}
                    <span className="tabular" style={{ color: "var(--text-faint)" }}>
                      {p.comments} คอมเมนต์
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/**
             * คำเตือนนี้ไม่ใช่ของประดับ — Meta ออกรหัสผู้ใช้คนละตัวให้แต่ละเพจ
             * โดยตั้งใจ การจับคู่ข้ามเพจจึงทำได้ด้วยชื่อเท่านั้น
             */}
            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
              ⚠️ {view.overlap.caveatTh}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
