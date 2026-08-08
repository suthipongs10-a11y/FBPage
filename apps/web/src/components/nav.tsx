"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

interface Item {
  href: Route;
  label: string;
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
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-muted)",
              fontWeight: active ? 600 : 400,
            }}
          >
            <span className="truncate">{item.label}</span>
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
