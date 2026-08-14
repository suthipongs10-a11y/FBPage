import {
  ApprovalList,
  GoingOut,
  InboxQueue,
  ProblemList,
} from "@/components/today-sections";
import { StatTile } from "@/components/ui";
import { dateTimeTh, numTh } from "@/lib/format";
import { WorkspaceNotice } from "@/components/workspace-notice";
import { loadWorkspace } from "@/lib/server/workspace";
import { buildTodayView } from "@/lib/today";
import { totalsOf } from "@/lib/workspace";

/** ข้อมูลเปลี่ยนตลอดเวลา — ห้าม cache ไม่งั้นเปิดหน้าตอนบ่ายเห็นสถานะเมื่อเช้า */
export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const nowMs = Date.now();
  const { ws, errorTh, empty } = await loadWorkspace(nowMs);
  const today = buildTodayView(ws);
  const totals = totalsOf(ws);
  const tz = ws.pages[0]?.timeZone ?? "Asia/Bangkok";

  const critical = today.problems.filter((p) => p.severity === "critical").length;

  return (
    <div className="flex flex-col gap-5">
      <WorkspaceNotice errorTh={errorTh} empty={empty} />
      <header>
        <div
          className="flex items-center gap-2 text-xs tracking-wide"
          style={{ color: "var(--text-faint)" }}
        >
          {/* จุดเขียวเต้น = หน้านี้คิดจากข้อมูล ณ วินาทีที่โหลด ไม่ใช่ของเมื่อวาน */}
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
              style={{ background: "var(--ok)" }}
            />
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--ok)" }}
            />
          </span>
          {dateTimeTh(nowMs, tz)} · เวลาไทย
        </div>
        <h1 className="mt-1.5 text-[1.75rem] leading-tight font-bold tracking-tight sm:text-[2rem]">
          {today.headlineTh}
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          ดูแล {totals.pages} เพจของ {totals.clients} ลูกค้า ·{" "}
          {numTh(totals.followers)} ผู้ติดตามรวม · ตั้งเวลาไว้{" "}
          {totals.scheduledThisWeek} โพสต์ในอีก 7 วัน
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatTile
          label="รอตอบ"
          value={numTh(today.inbox.summary.total)}
          sub={today.inbox.summary.th}
          tone={
            today.inbox.summary.breached > 0
              ? "red"
              : today.inbox.summary.warning > 0
                ? "amber"
                : "green"
          }
        />
        <StatTile
          label="รออนุมัติ"
          value={numTh(today.approvals.length)}
          sub={
            today.approvals.filter((a) => a.remainingMs < 0).length > 0
              ? `${today.approvals.filter((a) => a.remainingMs < 0).length} อันเลยเวลาแล้ว`
              : "ยังอยู่ในกำหนดทั้งหมด"
          }
          tone={
            today.approvals.some((a) => a.remainingMs < 0)
              ? "red"
              : today.approvals.some((a) => a.urgent)
                ? "amber"
                : "gray"
          }
        />
        <StatTile
          label="ปัญหาที่ค้าง"
          value={numTh(today.problems.length)}
          sub={
            critical > 0 ? `${critical} เรื่องพังอยู่ตอนนี้` : "ไม่มีเรื่องรุนแรง"
          }
          tone={critical > 0 ? "red" : today.problems.length > 0 ? "amber" : "green"}
        />
        <StatTile
          label="จะขึ้นใน 24 ชม."
          value={numTh(today.goingOut.length)}
          sub="อนุมัติแล้ว ไม่ต้องทำอะไร"
          tone="blue"
        />
      </div>

      {/*
       * สองคอลัมน์ที่ไหลอิสระจากกัน — ไม่ใช่ "แถว" ที่ต้องสูงเท่ากัน
       *
       * ของเดิมวางเป็นแถว: ปัญหาเต็มความกว้าง แล้วตามด้วยสองคอลัมน์
       * ผลคือทุกแถวสูงตามการ์ดที่สูงที่สุดในแถวนั้น การ์ดที่เตี้ยกว่าจึงทิ้ง
       * ช่องว่างไว้ข้างล่างตัวเอง — รวมกันแล้วเกือบหนึ่งในสามของหน้าจอ
       *
       * แบบนี้แต่ละคอลัมน์เป็นกองของตัวเอง การ์ดถัดไปขยับขึ้นมาชิดทันที
       * ที่การ์ดก่อนหน้าจบ ไม่ต้องรอคอลัมน์ข้างๆ
       *
       * ซ้ายกว้างกว่าเพราะใส่ของที่ต้อง**อ่านข้อความยาว** (ปัญหา + คิวตอบ)
       * ขวาเป็นของที่กวาดตาผ่าน (เวลา + ป้ายสถานะ)
       */}
      <div className="grid items-start gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-5">
          <ProblemList problems={today.problems} />
          <InboxQueue tasks={today.inbox.tasks} />
        </div>
        <div className="flex flex-col gap-5">
          <ApprovalList approvals={today.approvals} timeZone={tz} />
          <GoingOut posts={today.goingOut} ws={ws} />
        </div>
      </div>
    </div>
  );
}
