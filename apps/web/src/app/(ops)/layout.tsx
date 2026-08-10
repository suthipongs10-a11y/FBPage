import type { Route } from "next";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClientDot } from "@/components/ui";
import { demoSource } from "@/lib/demo-workspace";
import { buildTodayView } from "@/lib/today";
import { compactTh } from "@/lib/format";

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ws = await demoSource.load(Date.now());
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

  const items: Array<{
    href: Route;
    label: string;
    badge?: number;
    urgent?: boolean;
  }> = [
    {
      href: "/",
      label: "วันนี้",
      badge: urgentCount,
      urgent: urgentCount > 0,
    },
    {
      href: "/inbox",
      label: "กล่องข้อความ",
      badge: today.inbox.summary.total,
      urgent: today.inbox.summary.breached > 0,
    },
    { href: "/calendar", label: "ปฏิทินคอนเทนต์" },
    { href: "/ops", label: "ศูนย์ปฏิบัติการ" },
    {
      href: "/pages",
      label: "เพจทั้งหมด",
      badge: today.problems.filter((p) => p.kind === "token").length,
      urgent: today.problems.some(
        (p) => p.kind === "token" && p.severity === "critical",
      ),
    },
    // ท้ายสุดเพราะเป็นของที่แตะตอนติดตั้ง ไม่ใช่ของที่เปิดทุกวัน
    { href: "/settings", label: "ตั้งค่า" },
  ];

  return (
    <div className="flex min-h-screen">
          <aside
            className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r px-3 py-5 lg:flex"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
          >
            <div className="min-h-0">
              <Link href="/" className="mb-6 block px-3">
                <div className="text-[0.95rem] leading-tight font-bold tracking-tight">
                  PAGE OS
                </div>
                <div className="text-xs" style={{ color: "var(--text-faint)" }}>
                  {/* บอกว่าเป็นของสมมติตั้งแต่ตรงนี้ด้วย — คนดูตัวเลขนี้ก่อนอย่างอื่น */}
                  {ws.pages.length} เพจ · {clients.length} ลูกค้า{" "}
                  <span style={{ color: "var(--warn)" }}>(ตัวอย่าง)</span>
                </div>
              </Link>

              <Nav items={items} />

              <div className="mt-7 px-3">
                <div
                  className="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                  style={{ color: "var(--text-faint)" }}
                >
                  ลูกค้า
                </div>
                <ul className="flex flex-col gap-1.5">
                  {clients.map((name) => {
                    const pages = ws.pages.filter((p) => p.clientName === name);
                    const colorIndex = pages[0]?.colorIndex ?? 0;
                    const followers = pages.reduce(
                      (s, p) => s + p.followers,
                      0,
                    );
                    return (
                      <li
                        key={name}
                        className="flex items-center gap-2 text-xs"
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
            </div>

            <div className="px-1 pt-4">
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
