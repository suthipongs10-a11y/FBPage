import { notFound } from "next/navigation";
import { findTenant } from "@/lib/demo-portal";

/**
 * โครงหน้า portal ของลูกค้า
 *
 * ตั้งใจให้หน้าตา **ไม่เหมือนหอบังคับการของเราเลย**:
 *   - พื้นสว่างเสมอ ไม่ตามธีมของเครื่องคนดู เพราะนี่คือแบรนด์ของลูกค้า
 *     ไม่ใช่เครื่องมือที่เขาเปิดค้างทั้งวัน
 *   - ไม่มีเมนูข้าง ไม่มีชื่อลูกค้ารายอื่น ไม่มีตัวเลขของเรา
 *   - สีเดียวที่เด่นคือสีแบรนด์ของลูกค้า
 *
 * `data-theme="light"` ตรึงไว้ที่นี่โดยเจตนา — ลูกค้าที่ตั้งเครื่องเป็นโหมดมืด
 * ไม่ควรเห็นแบรนด์ตัวเองกลายเป็นสีอื่น
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ client: string }>;
}) {
  const { client } = await params;
  const tenant = findTenant(client);
  if (!tenant) notFound();

  const { config, onPrimary } = tenant.brand;

  return (
    <div
      data-theme="light"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        // ส่งสีแบรนด์ลงไปให้ลูกๆ ใช้ ไม่ต้องส่งเป็น prop ทีละชั้น
        ["--brand" as string]: config.primaryColor,
        ["--on-brand" as string]: onPrimary,
      }}
    >
      <header
        className="border-b"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
          {config.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={config.logoUrl}
              alt={config.displayName}
              width={36}
              height={36}
              className="rounded-lg object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold"
              style={{ background: "var(--brand)", color: "var(--on-brand)" }}
            >
              {config.displayName.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {config.displayName}
            </div>
            <div className="text-xs" style={{ color: "var(--text-faint)" }}>
              ปฏิทินคอนเทนต์
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-7">{children}</main>

      <footer
        className="mx-auto max-w-3xl px-5 pb-10 text-xs"
        style={{ color: "var(--text-faint)" }}
      >
        หน้านี้เห็นเฉพาะคอนเทนต์ของ {config.displayName} เท่านั้น ·
        มีคำถามทักทีมงานได้ตลอด
      </footer>
    </div>
  );
}
