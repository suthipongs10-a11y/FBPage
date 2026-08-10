import Link from "next/link";

/**
 * ป้ายบอกว่า "ที่เห็นอยู่นี้เป็นข้อมูลตัวอย่าง"
 *
 * ─── ทำไมต้องมี ───
 *
 * หน้าจอฝั่งปฏิบัติการทุกหน้ายังอ่านจาก `demoSource` ซึ่งเป็นข้อมูลสมมติ
 * ที่ทำไว้ตอนพัฒนา UI — และมันดู "จริง" เกินไปจนแยกไม่ออก: มีชื่อเพจ
 * มียอดผู้ติดตาม มีปัญหาสีแดงเรียงกันเป็นรายการ
 *
 * คนที่เพิ่งติดตั้งเสร็จเปิดหน้าแรกแล้วเห็น "มี 3 เรื่องที่พังอยู่ตอนนี้"
 * ทั้งที่ยังไม่ได้เชื่อมเพจอะไรเลยสักเพจ — เกิดขึ้นจริงมาแล้ว
 *
 * ป้ายนี้จึงไม่ใช่ของประดับ แต่เป็นเส้นแบ่งระหว่าง "ของจริง" กับ "ของโชว์"
 * เอาออกได้เมื่อหน้าจอต่อกับ Prisma ครบทุกหน้าแล้วเท่านั้น
 */
export function DemoBanner(): React.ReactElement {
  return (
    <div
      // ไม่ใส่ margin — ทุกหน้าที่ใช้ป้ายนี้ห่อด้วย `flex flex-col gap-6` อยู่แล้ว
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3.5 py-2.5 text-[0.8rem]"
      style={{ background: "var(--warn-bg)", color: "var(--text)" }}
    >
      <span className="font-semibold" style={{ color: "var(--warn)" }}>
        ข้อมูลตัวอย่าง
      </span>
      <span style={{ color: "var(--text-muted)" }}>
        ตัวเลข ชื่อเพจ และรายการปัญหาในหน้านี้เป็นของสมมติทั้งหมด ยังไม่ได้ต่อกับเพจจริง
      </span>
      <Link
        href="/settings"
        className="underline underline-offset-2"
        style={{ color: "var(--accent)" }}
      >
        ไปเชื่อมเพจแรกที่หน้าตั้งค่า
      </Link>
    </div>
  );
}
