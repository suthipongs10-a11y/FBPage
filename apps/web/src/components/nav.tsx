"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { NAV_ICONS, type NavIconKey } from "@/components/nav-icons";

export interface Item {
  href: Route;
  label: string;
  /** ชื่อไอคอน (สตริง ไม่ใช่ component — ดูเหตุผลที่ `NavIconKey`) */
  icon: NavIconKey;
  /** ตัวเลขที่ต้องทำ — ขึ้นเป็น badge ข้างเมนู */
  badge?: number;
  /** badge นี้เป็นเรื่องด่วนไหม */
  urgent?: boolean;
}

/**
 * เมนูหลัก
 *
 * เรียงตามลำดับที่คนเปิดใช้จริงในหนึ่งวัน ไม่ใช่ตามโครงสร้างข้อมูล:
 * เช้าเปิด "วันนี้" → ตอบแชท → ดูปฏิทิน → ค่อยไปดูสุขภาพเพจตอนมีปัญหา
 */
export function Nav({ items }: { items: Item[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="interactive group relative flex items-center gap-2.5 rounded-[var(--radius-row)] py-2 pr-2.5 pl-3 text-sm"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-muted)",
              fontWeight: active ? 600 : 400,
              boxShadow: active ? "var(--shadow-card)" : "none",
            }}
          >
            {/*
             * แถบสีซ้ายบอกหน้าที่เปิดอยู่ — เพิ่มจากพื้นหลังที่เข้มขึ้น
             * เพราะลำพังพื้นหลังที่ต่างกันนิดเดียวมองไม่ออกในโหมดสว่าง
             */}
            {active && (
              <span
                aria-hidden
                className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-full"
                style={{ background: "var(--accent)" }}
              />
            )}
            <span style={{ color: active ? "var(--accent)" : "var(--text-faint)" }}>
              <Icon />
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className="tabular rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[11px] font-semibold"
                style={{
                  background: item.urgent ? "var(--danger-bg)" : "var(--bg-sunken)",
                  color: item.urgent ? "var(--danger)" : "var(--text-faint)",
                }}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
