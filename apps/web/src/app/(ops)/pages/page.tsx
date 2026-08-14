import { STATE_LABEL_TH, STATE_TONE } from "@page-os/db";
import { Badge, Card, Row, SectionHeader, StatTile } from "@/components/ui";
import { compactTh, durationTh, numTh } from "@/lib/format";
import { WorkspaceNotice } from "@/components/workspace-notice";
import { loadWorkspace } from "@/lib/server/workspace";
import { WEBHOOK_SILENT_MS } from "@/lib/today";
import { PLAN_LABEL_TH } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function PagesPage() {
  const nowMs = Date.now();
  const { ws, errorTh, empty } = await loadWorkspace(nowMs);

  const byClient = new Map<string, typeof ws.pages>();
  for (const p of ws.pages) {
    const list = byClient.get(p.clientName) ?? [];
    list.push(p);
    byClient.set(p.clientName, list);
  }

  const healthy = ws.pages.filter((p) => p.connection.state === "ok").length;
  const broken = ws.pages.filter(
    (p) =>
      p.connection.state === "expired" || p.connection.state === "revoked",
  ).length;
  const silent = ws.pages.filter(
    (p) =>
      p.lastWebhookAtMs === null || nowMs - p.lastWebhookAtMs > WEBHOOK_SILENT_MS,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceNotice errorTh={errorTh} empty={empty} />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">เพจทั้งหมด</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          สถานะการเชื่อมต่อและ webhook ของทุกเพจ · จัดกลุ่มตามลูกค้า
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatTile
          label="เชื่อมต่อปกติ"
          value={`${healthy}/${ws.pages.length}`}
          tone={healthy === ws.pages.length ? "green" : "amber"}
        />
        <StatTile
          label="ใช้งานไม่ได้"
          value={numTh(broken)}
          sub={broken > 0 ? "ต้องให้ลูกค้าเชื่อมใหม่" : "ไม่มี"}
          tone={broken > 0 ? "red" : "green"}
        />
        <StatTile
          label="webhook เงียบ"
          value={numTh(silent)}
          sub={`เกิน ${WEBHOOK_SILENT_MS / 60_000} นาที`}
          tone={silent > 0 ? "amber" : "green"}
        />
        <StatTile
          label="ผู้ติดตามรวม"
          value={compactTh(ws.pages.reduce((s, p) => s + p.followers, 0))}
          tone="blue"
        />
      </div>

      {[...byClient.entries()].map(([clientName, pages]) => {
        // ลูกค้าหนึ่งรายอาจซื้อคนละแพ็กเกจต่อเพจ (เพจหลักเต็มรูปแบบ เพจรองเริ่มต้น)
        // โชว์แพ็กเกจของเพจแรกอย่างเดียวจะทำให้เข้าใจผิดเรื่องระดับบริการที่สัญญาไว้
        const plans = [...new Set(pages.map((p) => p.plan))];
        const planLabel = plans.map((p) => PLAN_LABEL_TH[p]).join(" + ");
        return (
        <Card key={clientName}>
          <SectionHeader
            title={clientName}
            count={pages.length}
            hint={`${planLabel} · ${compactTh(
              pages.reduce((s, p) => s + p.followers, 0),
            )} ผู้ติดตาม`}
          />
          <ul className="divide-rows -mx-2.5 flex flex-col">
            {pages.map((p) => {
              const silentFor =
                p.lastWebhookAtMs === null ? null : nowMs - p.lastWebhookAtMs;
              const webhookBad =
                silentFor === null || silentFor > WEBHOOK_SILENT_MS;
              return (
                <Row key={p.pageId} colorIndex={p.colorIndex}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {p.pageName}
                    </div>
                    <div
                      className="tabular truncate text-xs"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {p.fbPageId} · {compactTh(p.followers)} ผู้ติดตาม ·{" "}
                      {p.timeZone}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <Badge tone={STATE_TONE[p.connection.state]}>
                      {STATE_LABEL_TH[p.connection.state]}
                      {p.connection.hoursUntilExpiry !== undefined &&
                        ` · เหลือ ${Math.floor(p.connection.hoursUntilExpiry / 24)} วัน`}
                    </Badge>
                    <Badge tone={webhookBad ? "amber" : "green"}>
                      {silentFor === null
                        ? "ยังไม่เคยรับ webhook"
                        : `webhook ${durationTh(silentFor)}ที่แล้ว`}
                    </Badge>
                  </div>
                </Row>
              );
            })}
          </ul>
        </Card>
        );
      })}
    </div>
  );
}
