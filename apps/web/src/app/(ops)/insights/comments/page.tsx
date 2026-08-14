import Link from "next/link";
import { Badge, Card, EmptyState, SectionHeader } from "@/components/ui";
import { compactTh, dateTimeTh, numTh, truncate } from "@/lib/format";
import { COMMENTS_PAGE_SIZE, loadComments } from "@/lib/server/comments";

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

  /** สร้างลิงก์โดยคงตัวกรองอื่นไว้ — เปลี่ยนทีละอย่างเท่านั้น */
  const linkTo = (over: Record<string, string | undefined>): string => {
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
    return qs === "" ? "/insights/comments" : `/insights/comments?${qs}`;
  };

  const lastPage = Math.max(1, Math.ceil(view.total / COMMENTS_PAGE_SIZE));

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
                  ทุกเพจ
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
                      {p.name}
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
              <ul className="flex flex-col gap-2.5">
                {view.rows.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-[var(--radius-card)] px-4 py-3"
                    style={{ background: "var(--bg-sunken)" }}
                  >
                    <div
                      className="flex flex-wrap items-baseline gap-x-2 text-xs"
                      style={{ color: "var(--text-faint)" }}
                    >
                      <b style={{ color: "var(--text-muted)" }}>
                        {r.authorName ?? "ไม่ทราบชื่อ"}
                      </b>
                      <span>· ใต้โพสต์ของ {r.pageName}</span>
                      <span>· {dateTimeTh(r.createdAtMs, TZ)}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed">
                      {r.message === null || r.message.trim() === "" ? (
                        <i style={{ color: "var(--text-faint)" }}>(ไม่มีข้อความ — อาจเป็นรูปหรือสติกเกอร์)</i>
                      ) : (
                        truncate(r.message, 500)
                      )}
                    </p>
                    {r.postPermalink !== null && (
                      <a
                        href={r.postPermalink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-block text-xs underline underline-offset-2"
                        style={{ color: "var(--accent)" }}
                      >
                        เปิดโพสต์บน Facebook ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
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
