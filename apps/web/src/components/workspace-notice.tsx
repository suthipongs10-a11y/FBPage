import Link from "next/link";

/**
 * แถบบอกสถานะข้อมูลบนหัวหน้าจอฝั่งปฏิบัติการ
 *
 * ─── ทำไมต้องมี ───
 *
 * หน้าพวกนี้ออกแบบมาให้ดู "แน่น" — มีตัวเลข มีรายการปัญหา มีคิวงาน
 * เวลาไม่มีข้อมูลจริงมันจึงดูเหมือน**ระบบพัง** มากกว่า "ยังไม่ได้เริ่ม"
 * และเวลาต่อฐานข้อมูลไม่ได้ มันดูเหมือน "ทุกอย่างเรียบร้อยดี" (ศูนย์ทุกช่อง)
 * ซึ่งอันตรายกว่า เพราะคนจะเชื่อว่าไม่มีอะไรต้องทำ
 *
 * แถบนี้จึงตอบคำถามเดียว: **ตัวเลขที่เห็นอยู่นี้เชื่อได้ไหม**
 */

function Bar({
  toneVar,
  label,
  children,
}: {
  toneVar: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      // ไม่ใส่ margin — ทุกหน้าที่ใช้ห่อด้วย `flex flex-col gap-6` อยู่แล้ว
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3.5 py-2.5 text-[0.8rem]"
      style={{ background: `var(--${toneVar}-bg)`, color: "var(--text)" }}
    >
      <span className="font-semibold" style={{ color: `var(--${toneVar})` }}>
        {label}
      </span>
      <span style={{ color: "var(--text-muted)" }}>{children}</span>
    </div>
  );
}

export interface WorkspaceNoticeProps {
  /** ข้อความไทยเมื่ออ่านฐานข้อมูลไม่สำเร็จ — `null` = อ่านได้ปกติ */
  errorTh: string | null;
  /** อ่านได้ แต่ยังไม่มีเพจสักเพจ */
  empty: boolean;
}

export function WorkspaceNotice({
  errorTh,
  empty,
}: WorkspaceNoticeProps): React.ReactElement | null {
  /**
   * อ่านไม่ได้ต้องขึ้นก่อนเสมอ — ตอนต่อ DB ไม่ได้ `empty` จะเป็น true ด้วย
   * ถ้าเช็ค `empty` ก่อน คนจะได้คำแนะนำผิด ("ไปเชื่อมเพจ" ทั้งที่ปัญหาคือ DB ไม่ขึ้น)
   */
  if (errorTh !== null) {
    return (
      <Bar toneVar="danger" label="อ่านข้อมูลไม่ได้">
        {errorTh} — ตัวเลขทุกช่องในหน้านี้จึงเป็นศูนย์ ไม่ได้แปลว่าไม่มีงานค้าง
      </Bar>
    );
  }

  if (empty) {
    return (
      <Bar toneVar="accent" label="ยังไม่ได้เชื่อมเพจ">
        ระบบต่อฐานข้อมูลได้แล้ว แต่ยังไม่มีเพจในระบบ — หน้านี้จะมีข้อมูลทันทีที่เชื่อมเพจแรก
        <Link
          href="/settings"
          className="underline underline-offset-2"
          style={{ color: "var(--accent)" }}
        >
          ไปเชื่อมเพจที่หน้าตั้งค่า
        </Link>
      </Bar>
    );
  }

  return null;
}

/**
 * ป้ายสำหรับหน้าที่ยัง**ผสม**ของจริงกับของตัวอย่าง
 *
 * ตอนนี้เหลือแค่ `/ops` — ตัวเลขเพจกับปัญหาเป็นของจริงแล้ว แต่แผงคำสั่งหมู่
 * กับประวัติการดำเนินการยังวิ่งบนที่เก็บข้อมูลในหน่วยความจำ (หายทุกครั้งที่
 * รีสตาร์ท) เพราะมันเป็น**เส้นทางเขียน**ที่ไปแก้การตั้งค่าเพจจริง
 * ต้องต่อพร้อมกับด่านยืนยันตัวตน ไม่ใช่ต่อทิ้งไว้เฉยๆ
 *
 * ห้ามเอาป้ายนี้ออกจนกว่าส่วนนั้นจะต่อของจริง
 */
export function PartialDemoNotice({
  whatTh,
}: {
  whatTh: string;
}): React.ReactElement {
  return (
    <Bar toneVar="warn" label="บางส่วนเป็นตัวอย่าง">
      {whatTh}
    </Bar>
  );
}
