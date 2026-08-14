import type { Route } from "next";
import Link from "next/link";
import { Nav, type Item } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClientDot } from "@/components/ui";
import { loadWorkspace } from "@/lib/server/workspace";
import { buildTodayView } from "@/lib/today";
import { compactTh } from "@/lib/format";

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ws } = await loadWorkspace(Date.now());
  const today = buildTodayView(ws);
  const clients = [...new Set(ws.pages.map((p) => p.clientName))];

  /**
   * ตัวเลขข้างเมนู "วันนี้" นับเฉพาะของที่ต้องทิ้งทุกอย่างมาทำ
   *
   * เคยใส่ยอดรวมทุกอย่าง (`actionCount`) แล้วได้เลข 38 ซึ่งไม่ได้บอกอะไรเลย —
   * เห็นทุกวันจนชิน แล้วก็เลิกมอง badge ที่คนเลิกมองคือ badge ที่ไร้ประโยชน์
   */
  const urgentCount =
    today.problems.filter((p) => p.severity === "critical").length +
    today.inbox.summary.breached +
    today.approvals.filter((a) => a.remainingMs < 0).length;

  const items: Item[] = [
    {
      href: "/",
      label: "วันนี้",
      icon: "today",
      badge: urgentCount,
      urgent: urgentCount > 0,
    },
    {
      href: "/inbox",
      label: "กล่องข้อความ",
      icon: "inbox",
      badge: today.inbox.summary.total,
      urgent: today.inbox.summary.breached > 0,
    },
    { href: "/calendar", label: "ปฏิทินคอนเทนต์", icon: "calendar" },
    // ไม่มี badge — หน้านี้ไม่มี "งานค้าง" ให้นับ เป็นหน้าไว้ดู ไม่ใช่หน้าไว้เคลียร์
    { href: "/insights", label: "ฟังเสียง", icon: "listening" },
    { href: "/ops", label: "ศูนย์ปฏิบัติการ", icon: "ops" },
    {
      href: "/pages",
      label: "เพจทั้งหมด",
      icon: "pages",
      badge: today.problems.filter((p) => p.kind === "token").length,
      urgent: today.problems.some(
        (p) => p.kind === "token" && p.severity === "critical",
      ),
    },
    // ท้ายสุดเพราะเป็นของที่แตะตอนติดตั้ง ไม่ใช่ของที่เปิดทุกวัน
    { href: "/settings", label: "ตั้งค่า", icon: "settings" },
  ];

  return (
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 hidden h-screen w-[15.5rem] shrink-0 flex-col justify-between border-r px-3 py-5 lg:flex"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border)",
        }}
      >
        {/* min-h-0 + overflow-y-auto — รายชื่อลูกค้ายาวเกินจอแล้วต้องเลื่อนได้
            ไม่ใช่ดันตัวสลับธีมหลุดออกนอกหน้าจอ */}
        <div className="min-h-0 overflow-y-auto">
          <Link
            href="/"
            className="mb-6 flex items-center gap-2.5 px-2 py-1"
          >
            <BrandMark />
            <span className="min-w-0">
              <span className="block text-[0.95rem] leading-tight font-bold tracking-tight">
                PAGE OS
              </span>
              <span
                className="block text-[0.7rem] leading-tight"
                style={{ color: "var(--text-faint)" }}
              >
                {ws.pages.length} เพจ · {clients.length} ลูกค้า
              </span>
            </span>
          </Link>

          <Nav items={items} />

          {clients.length > 0 && (
            <div className="mt-7">
              <div
                className="mb-2 px-3 text-[0.65rem] font-semibold tracking-[0.08em] uppercase"
                style={{ color: "var(--text-faint)" }}
              >
                ลูกค้า
              </div>
              <ul className="flex flex-col">
                {clients.map((name) => {
                  const pages = ws.pages.filter((p) => p.clientName === name);
                  const colorIndex = pages[0]?.colorIndex ?? 0;
                  const followers = pages.reduce((s, p) => s + p.followers, 0);
                  return (
                    <li
                      key={name}
                      className="interactive flex items-center gap-2 rounded-[var(--radius-row)] px-3 py-1.5 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <ClientDot colorIndex={colorIndex} size={7} />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span
                        className="tabular shrink-0"
                        style={{ color: "var(--text-faint)" }}
                      >
                        {compactTh(followers)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="shrink-0 pt-4">
          <ThemeToggle />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * เครื่องหมายประจำระบบ
 *
 * สี่เหลี่ยมสี่ช่อง = "หลายเพจในที่เดียว" ซึ่งเป็นสิ่งที่โปรแกรมนี้ทำ
 * ช่องหนึ่งสว่างกว่าเพื่อน = เพจที่กำลังต้องดูแล — เล่าเรื่องเดียวกับ Today View
 */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem]"
      style={{
        background: "var(--accent-bg)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="2" width="7" height="7" rx="2" fill="var(--accent)" />
        <rect
          x="11"
          y="2"
          width="7"
          height="7"
          rx="2"
          fill="var(--accent)"
          opacity="0.45"
        />
        <rect
          x="2"
          y="11"
          width="7"
          height="7"
          rx="2"
          fill="var(--accent)"
          opacity="0.45"
        />
        <rect
          x="11"
          y="11"
          width="7"
          height="7"
          rx="2"
          fill="var(--accent)"
          opacity="0.7"
        />
      </svg>
    </span>
  );
}
