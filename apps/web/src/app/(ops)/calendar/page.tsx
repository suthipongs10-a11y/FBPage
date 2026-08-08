import { MIN_GAP_HOURS } from "@page-os/studio";
import { localTimeToUtcMs } from "@page-os/publish";
import {
  CalendarBoard,
  type BoardDay,
  type BoardItem,
} from "@/components/calendar-board";
import { Card, Meter, SectionHeader } from "@/components/ui";
import {
  dayKey,
  dayNameShortTh,
  numTh,
  partsIn,
  timeTh,
  truncate,
} from "@/lib/format";
import { demoSource } from "@/lib/demo-workspace";
import type { ScheduledPostRow } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * timezone ของตารางปฏิทิน
 *
 * ใช้ของเอเจนซี่ ไม่ใช่ของเพจ — เพราะจอนี้คือมุมมองของคนที่ดูแลทุกเพจพร้อมกัน
 * เขาต้องเห็น "วันจันทร์" เป็นวันจันทร์ของเขา ส่วนเวลาบนการ์ดแต่ละใบ
 * ยังแสดงตาม timezone ของเพจนั้นเอง (สำคัญตอนมีลูกค้าต่างประเทศ)
 */
const BOARD_TZ = "Asia/Bangkok";

const MONTH_TH_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

const APPROVAL_VIEW: Record<
  ScheduledPostRow["approval"],
  { label: string; tone: BoardItem["approvalTone"] }
> = {
  approved: { label: "อนุมัติแล้ว", tone: "green" },
  pending: { label: "รออนุมัติ", tone: "amber" },
  changes_requested: { label: "ขอแก้ไข", tone: "red" },
  none: { label: "ไม่ต้องอนุมัติ", tone: "gray" },
};

/** กี่สัปดาห์ที่แสดง — 4 สัปดาห์พอดีกับรอบปฏิทินคอนเทนต์ของ M-G */
const WEEKS = 4;

export default async function CalendarPage() {
  const nowMs = Date.now();
  const ws = await demoSource.load(nowMs);

  // เริ่มตารางที่วันอาทิตย์ของสัปดาห์นี้ ไม่ใช่วันนี้ —
  // ปฏิทินที่คอลัมน์แรกไม่ใช่วันอาทิตย์อ่านยากกว่าที่คิด
  const nowParts = partsIn(nowMs, BOARD_TZ);
  const gridStart = new Date(
    Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - nowParts.weekday),
  );

  const todayKey = dayKey(nowMs, BOARD_TZ);
  const days: BoardDay[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(gridStart.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const key = `${y}-${pad(m)}-${pad(day)}`;
    // แปลงเที่ยงคืนท้องถิ่น → UTC ทีละวัน ปลอดภัยกับโซนที่มี DST
    const startMs = localTimeToUtcMs(`${key}T00:00`, BOARD_TZ);
    days.push({
      key,
      startMs,
      dayNum: day,
      weekdayShort: dayNameShortTh(d.getUTCDay()),
      monthLabel: day === 1 || i === 0 ? MONTH_TH_SHORT[m - 1]! : null,
      isToday: key === todayKey,
      isPast: key < todayKey,
    });
  }

  const firstMs = days[0]!.startMs;
  const lastMs = days[days.length - 1]!.startMs + 86_400_000;

  const items: BoardItem[] = ws.scheduled
    .filter((s) => s.scheduledAtMs >= firstMs && s.scheduledAtMs < lastMs)
    .map((s) => {
      const page = ws.pages.find((p) => p.pageId === s.pageId);
      const tz = page?.timeZone ?? BOARD_TZ;
      const boardParts = partsIn(s.scheduledAtMs, BOARD_TZ);
      const view = APPROVAL_VIEW[s.approval];
      return {
        postId: s.postId,
        pageId: s.pageId,
        pageName: truncate(page?.pageName ?? s.pageId, 22),
        clientName: page?.clientName ?? "",
        colorIndex: page?.colorIndex ?? 0,
        dayKey: dayKey(s.scheduledAtMs, BOARD_TZ),
        minutesOfDay: boardParts.hour * 60 + boardParts.minute,
        timeLabel: timeTh(s.scheduledAtMs, tz),
        preview: truncate(s.preview, 34),
        pillarLabelTh: s.pillarLabelTh,
        approvalLabel: view.label,
        approvalTone: view.tone,
      };
    });

  const clients = [...new Set(ws.pages.map((p) => p.clientName))].map(
    (name) => ({
      name,
      colorIndex:
        ws.pages.find((p) => p.clientName === name)?.colorIndex ?? 0,
    }),
  );

  // สัดส่วนเสาหลักรวมทุกเพจ — บอกได้ทันทีว่าเดือนนี้ขายเยอะไปหรือเปล่า
  const pillarCounts = new Map<string, number>();
  for (const s of ws.scheduled) {
    pillarCounts.set(s.pillarLabelTh, (pillarCounts.get(s.pillarLabelTh) ?? 0) + 1);
  }
  const pillarSegments = [...pillarCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, colorIndex: i + 3 }));

  const pending = ws.scheduled.filter((s) => s.approval === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">ปฏิทินคอนเทนต์</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          ทุกเพจในจอเดียว สีแยกตามลูกค้า · {numTh(items.length)} โพสต์ใน{" "}
          {WEEKS} สัปดาห์ข้างหน้า
          {pending > 0 && ` · ${numTh(pending)} รออนุมัติ`}
        </p>
      </header>

      <Card>
        <CalendarBoard
          days={days}
          items={items}
          clients={clients}
          minGapHours={MIN_GAP_HOURS}
          nowMs={nowMs}
        />
      </Card>

      <Card>
        <SectionHeader
          title="สัดส่วนคอนเทนต์รวมทุกเพจ"
          hint="เทียบกับที่ตั้งไว้ในแต่ละเพจ"
        />
        {pillarSegments.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-faint)" }}>
            ยังไม่มีโพสต์ในปฏิทิน
          </p>
        ) : (
          <Meter segments={pillarSegments} />
        )}
      </Card>
    </div>
  );
}
