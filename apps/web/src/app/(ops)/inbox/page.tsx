import { PLAN_SLA_MINUTES } from "@page-os/inbox";
import { Badge, Card, ClientDot, ClientStripe, EmptyState, SectionHeader, StatTile } from "@/components/ui";
import { durationTh, numTh, relativeTh } from "@/lib/format";
import { WorkspaceNotice } from "@/components/workspace-notice";
import { loadWorkspace } from "@/lib/server/workspace";
import { buildTodayView } from "@/lib/today";
import { PLAN_LABEL_TH } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const nowMs = Date.now();
  const { ws, errorTh, empty } = await loadWorkspace(nowMs);
  const today = buildTodayView(ws);
  const { tasks, summary } = today.inbox;

  const botHandled = ws.conversations.filter((c) => c.handledByBot).length;
  const containment =
    ws.conversations.length === 0
      ? 0
      : Math.round((botHandled / ws.conversations.length) * 100);

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceNotice errorTh={errorTh} empty={empty} />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">กล่องข้อความ</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {summary.th}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="เลยเวลาที่สัญญาไว้"
          value={numTh(summary.breached)}
          sub="ต้องตอบเดี๋ยวนี้"
          tone={summary.breached > 0 ? "red" : "green"}
        />
        <StatTile
          label="ใกล้ครบเวลา"
          value={numTh(summary.warning)}
          sub="ใช้เวลาไปเกิน 75% ของ SLA"
          tone={summary.warning > 0 ? "amber" : "green"}
        />
        <StatTile
          label="ยังมีเวลาเหลือ"
          value={numTh(summary.ok)}
          tone="gray"
        />
        <StatTile
          label="บอทตอบเองได้"
          value={`${containment}%`}
          sub={`${botHandled} จาก ${ws.conversations.length} บทสนทนา`}
          tone="blue"
        />
      </div>

      <Card>
        <SectionHeader
          title="คิวที่ต้องตอบ"
          count={tasks.length}
          hint="เรียงตามเวลาที่เหลือ ไม่ใช่ตามลำดับที่เข้ามา"
        />
        {tasks.length === 0 ? (
          <EmptyState kind="done">ตอบครบทุกข้อความแล้ว</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((t) => {
              const page = ws.pages.find((p) => p.pageId === t.pageId);
              const plan = page?.plan ?? "STARTER";
              return (
                <li
                  key={t.conversationId}
                  className="relative overflow-hidden rounded-[var(--radius-card)] border py-3 pr-3 pl-4"
                  style={{
                    background: "var(--bg-sunken)",
                    borderColor: "var(--border)",
                  }}
                >
                  <ClientStripe colorIndex={t.colorIndex} />
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium">
                          {t.contactName}
                        </span>
                        <span
                          className="flex items-center gap-1.5 text-xs"
                          style={{ color: "var(--text-faint)" }}
                        >
                          <ClientDot colorIndex={t.colorIndex} size={6} />
                          {t.pageName}
                        </span>
                      </div>
                      <p
                        className="mt-0.5 text-sm"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {t.preview}
                      </p>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-x-2 text-xs"
                        style={{ color: "var(--text-faint)" }}
                      >
                        <span>
                          แพ็กเกจ{PLAN_LABEL_TH[plan]} · สัญญาตอบใน{" "}
                          {durationTh(PLAN_SLA_MINUTES[plan]! * 60_000)}
                        </span>
                        {t.awaitingSinceMs !== null && (
                          <>
                            <span aria-hidden>·</span>
                            <span>
                              ทักมา{relativeTh(t.awaitingSinceMs, nowMs)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge
                        tone={
                          t.sla.tone === "red"
                            ? "red"
                            : t.sla.tone === "amber"
                              ? "amber"
                              : "green"
                        }
                      >
                        {t.sla.remainingMs < 0
                          ? `เลยมา ${durationTh(t.sla.remainingMs)}`
                          : `เหลือ ${durationTh(t.sla.remainingMs)}`}
                      </Badge>
                      {t.unread > 1 && (
                        <div
                          className="tabular mt-1 text-xs"
                          style={{ color: "var(--text-faint)" }}
                        >
                          ยังไม่อ่าน {t.unread}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="บอทดูแลอยู่"
          count={botHandled}
          hint="ไม่ต้องแตะ — ขึ้นคิวคนเมื่อบอทส่งต่อเท่านั้น"
        />
        {botHandled === 0 ? (
          <EmptyState>ตอนนี้ไม่มีบทสนทนาที่บอทดูแลอยู่</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {ws.conversations
              .filter((c) => c.handledByBot)
              .map((c, i) => {
                const page = ws.pages.find((p) => p.pageId === c.pageId);
                return (
                  <li
                    key={c.conversationId}
                    className="flex items-center gap-3 py-2"
                    style={{
                      borderTop: i === 0 ? "none" : "1px solid var(--border)",
                    }}
                  >
                    <ClientDot colorIndex={page?.colorIndex ?? 0} />
                    <span className="shrink-0 text-sm">{c.contactName}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {c.preview}
                    </span>
                    <span
                      className="shrink-0 text-xs"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {page?.pageName}
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>
    </div>
  );
}
