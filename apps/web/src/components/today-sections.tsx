import { Badge, Card, ClientDot, ClientStripe, EmptyState, SectionHeader, type Tone } from "@/components/ui";
import { dateTimeTh, durationTh, timeTh, truncate } from "@/lib/format";
import type { ApprovalTask, InboxTask, Problem, Severity } from "@/lib/today";
import type { ScheduledPostRow, Workspace } from "@/lib/workspace";

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "red",
  warning: "amber",
  info: "blue",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "พังอยู่",
  warning: "ต้องดู",
  info: "รับทราบ",
};

/**
 * รายการสิ่งที่พัง
 *
 * ขึ้นบนสุดของหน้าเสมอ แม้จะว่าง — เพราะการเห็น "ไม่มีอะไรพัง" ทุกเช้า
 * คือสิ่งที่ทำให้เชื่อระบบ ถ้าซ่อนตอนว่าง คนจะไม่รู้ว่าระบบตรวจอยู่จริงไหม
 */
export function ProblemList({
  problems,
  limit = 8,
}: {
  problems: Problem[];
  limit?: number;
}) {
  // ยาวเกินหน้าจอเมื่อไหร่ คนจะเลิกอ่านตั้งแต่บรรทัดที่ห้า
  // ตัดให้พอดีจอแล้วบอกจำนวนที่เหลือ ดีกว่าโชว์ทั้งหมดแล้วไม่มีใครอ่าน
  const shown = problems.slice(0, limit);

  return (
    <Card>
      <SectionHeader
        title="สิ่งที่ต้องแก้"
        count={problems.length}
        hint={problems.length > 0 ? "เรียงจากแรงที่สุด" : undefined}
      />
      {problems.length === 0 ? (
        <EmptyState>ทุกเพจเชื่อมต่อปกติ ไม่มีอะไรพัง</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((p) => (
            <li
              key={p.id}
              className="relative overflow-hidden rounded-[var(--radius-card)] border py-3 pr-3 pl-4"
              style={{
                background: "var(--bg-sunken)",
                borderColor: "var(--border)",
              }}
            >
              <ClientStripe colorIndex={p.colorIndex} />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[p.severity]}>
                  {SEVERITY_LABEL[p.severity]}
                </Badge>
                <span className="text-sm font-medium">{p.pageName}</span>
                <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                  {p.clientName}
                </span>
              </div>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                {p.th}
              </p>
            </li>
          ))}
          {problems.length > shown.length && (
            <li className="pt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              และอีก {problems.length - shown.length} เรื่องที่ไม่รุนแรงเท่านี้
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/**
 * คิวข้อความ
 *
 * แสดงเวลาที่เหลือเป็นตัวเลขใหญ่ทางขวา ไม่ใช่ป้ายสีอย่างเดียว —
 * "เหลือ 6 นาที" ทำให้ตัดสินใจได้ทันทีว่าจะตอบก่อนหรือหลัง
 * ในขณะที่ป้ายสีแดงบอกได้แค่ว่า "ด่วน" ซึ่งด่วนเท่ากันหมด
 */
export function InboxQueue({
  tasks,
  limit = 8,
}: {
  tasks: InboxTask[];
  limit?: number;
}) {
  const shown = tasks.slice(0, limit);

  return (
    <Card>
      <SectionHeader
        title="รอตอบ"
        count={tasks.length}
        hint={tasks.length > 0 ? "เหลือเวลาน้อยสุดขึ้นก่อน" : undefined}
      />
      {tasks.length === 0 ? (
        <EmptyState>ตอบครบทุกข้อความแล้ว</EmptyState>
      ) : (
        <>
          <ul className="flex flex-col">
            {shown.map((t, i) => (
              <li
                key={t.conversationId}
                className="flex items-start gap-3 py-2.5"
                style={{
                  borderTop:
                    i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <span className="mt-2">
                  <ClientDot colorIndex={t.colorIndex} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                      {t.contactName}
                    </span>
                    <span
                      className="truncate text-xs"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {t.pageName}
                    </span>
                  </div>
                  <p
                    className="truncate text-sm"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {truncate(t.preview, 70)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className="tabular text-sm font-semibold"
                    style={{
                      color:
                        t.sla.tone === "red"
                          ? "var(--danger)"
                          : t.sla.tone === "amber"
                            ? "var(--warn)"
                            : "var(--text-muted)",
                    }}
                  >
                    {t.sla.remainingMs < 0 ? "เลย " : "เหลือ "}
                    {durationTh(t.sla.remainingMs)}
                  </div>
                  {t.unread > 1 && (
                    <div
                      className="tabular text-xs"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {t.unread} ข้อความ
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {tasks.length > shown.length && (
            <p
              className="mt-3 text-xs"
              style={{ color: "var(--text-faint)" }}
            >
              และอีก {tasks.length - shown.length} บทสนทนา
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** โพสต์ที่รอลูกค้ากดอนุมัติ */
export function ApprovalList({
  approvals,
  timeZone,
  limit = 6,
}: {
  approvals: ApprovalTask[];
  timeZone: string;
  limit?: number;
}) {
  const shown = approvals.slice(0, limit);

  return (
    <Card>
      <SectionHeader
        title="รอลูกค้าอนุมัติ"
        count={approvals.length}
        hint={
          approvals.some((a) => a.remainingMs < 0)
            ? "มีบางอันเลยเวลาไปแล้ว"
            : undefined
        }
      />
      {approvals.length === 0 ? (
        <EmptyState>ไม่มีโพสต์ค้างรออนุมัติ</EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {shown.map((a) => (
              <li
                key={a.postId}
                className="relative overflow-hidden rounded-[var(--radius-card)] border py-2.5 pr-3 pl-4"
                style={{
                  background: "var(--bg-sunken)",
                  borderColor: "var(--border)",
                }}
              >
                <ClientStripe colorIndex={a.colorIndex} />
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="truncate text-xs"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {a.pageName}
                  </span>
                  <Badge
                    tone={
                      a.remainingMs < 0
                        ? "red"
                        : a.urgent
                          ? "amber"
                          : "gray"
                    }
                  >
                    {a.remainingMs < 0
                      ? "เลยเวลาแล้ว"
                      : `อีก ${durationTh(a.remainingMs)}`}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-sm">
                  {truncate(a.preview, 60)}
                </p>
                <div
                  className="mt-1 flex items-center gap-2 text-xs"
                  style={{ color: "var(--text-faint)" }}
                >
                  <span>{a.pillarLabelTh}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular">
                    {dateTimeTh(a.scheduledAtMs, timeZone)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {approvals.length > shown.length && (
            <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
              และอีก {approvals.length - shown.length} โพสต์
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** โพสต์ที่จะขึ้นเองภายใน 24 ชม. — ของที่ไม่ต้องทำอะไร แต่ควรรู้ว่ากำลังจะเกิด */
export function GoingOut({
  posts,
  ws,
  limit = 8,
}: {
  posts: ScheduledPostRow[];
  ws: Workspace;
  limit?: number;
}) {
  const shown = posts.slice(0, limit);

  return (
    <Card>
      <SectionHeader
        title="จะขึ้นเองใน 24 ชม."
        count={posts.length}
        hint={posts.length > 0 ? "อนุมัติแล้ว ไม่ต้องทำอะไร" : undefined}
      />
      {posts.length === 0 ? (
        <EmptyState>ไม่มีโพสต์ที่ตั้งเวลาไว้ในช่วงนี้</EmptyState>
      ) : (
        <ul className="flex flex-col">
          {shown.map((p, i) => {
            const page = ws.pages.find((x) => x.pageId === p.pageId);
            return (
              <li
                key={p.postId}
                className="flex items-center gap-3 py-2"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <span
                  className="tabular w-11 shrink-0 text-sm font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  {timeTh(p.scheduledAtMs, page?.timeZone ?? "Asia/Bangkok")}
                </span>
                <ClientDot colorIndex={page?.colorIndex ?? 0} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {truncate(p.preview, 52)}
                </span>
                <span
                  className="shrink-0 text-xs"
                  style={{ color: "var(--text-faint)" }}
                >
                  {p.pillarLabelTh}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
