"use client";

import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";

const LABEL: Record<Choice, string> = {
  system: "ตามระบบ",
  light: "สว่าง",
  dark: "มืด",
};

const KEY = "page-os-theme";

/**
 * สลับธีม
 *
 * ค่าเริ่มต้นเป็น "ตามระบบ" ไม่ใช่ "มืด" — คนที่ตั้งเครื่องเป็นสว่างไว้
 * มักมีเหตุผล (สายตา แสงในห้อง) การบังคับธีมทับความตั้งใจของเขาไม่สุภาพ
 *
 * ค่าอ่านจาก localStorage ใน effect ไม่ใช่ตอน render แรก
 * เพราะ server ไม่รู้ค่านี้ ถ้าอ่านตอน render จะได้ hydration mismatch
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      setChoice(saved);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    window.localStorage.setItem(KEY, choice);
  }, [choice, mounted]);

  const order: Choice[] = ["system", "light", "dark"];

  return (
    <div
      className="flex rounded-[var(--radius-pill)] border p-0.5"
      style={{ borderColor: "var(--border)", background: "var(--bg-sunken)" }}
      role="group"
      aria-label="ธีมสี"
    >
      {order.map((c) => {
        const active = mounted && choice === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => setChoice(c)}
            aria-pressed={active}
            className="rounded-[var(--radius-pill)] px-2.5 py-1 text-xs transition-colors"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-faint)",
              fontWeight: active ? 600 : 400,
            }}
          >
            {LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}
