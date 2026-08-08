import { describe, expect, it } from "vitest";
import {
  briefToPrompt,
  checkBrief,
  emptyBrief,
  type BrandBrief,
} from "./brand.js";

const FULL: BrandBrief = {
  pageId: "p1",
  brandName: "ครัวคุณยาย",
  business: "ร้านอาหารตามสั่งและข้าวกล่องส่งออฟฟิศ",
  audience: "พนักงานออฟฟิศวัย 25-40 ย่านรัชดา ที่ไม่มีเวลาทำกับข้าว",
  products: ["ข้าวกล่องรายวัน", "จัดเลี้ยงประชุม"],
  differentiators: ["ไม่ใส่ผงชูรส", "ส่งตรงเวลา 11:30 ทุกวัน"],
  ctas: ["ทักแชทสั่งเลย", "กดสั่งที่ลิงก์ในโพสต์"],
  bannedWords: ["ลดน้ำหนัก", "รักษาโรค"],
  samplePosts: ["วันนี้มีแกงส้มชะอมกุ้งค่ะ", "ข้าวกล่องพรุ่งนี้เปิดจองแล้ว"],
  avoidTopics: ["การเมือง"],
};

describe("checkBrief", () => {
  it("brief ที่ครบถ้วน → พร้อมสร้างคอนเทนต์", () => {
    const r = checkBrief(FULL);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.score).toBe(1);
    expect(r.th).toMatch(/ครบถ้วน/);
  });

  it("ขาดข้อมูลบังคับ → บอกว่าขาดอะไรและทำไมต้องกรอก", () => {
    const r = checkBrief({ ...FULL, products: [], ctas: [] });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("สินค้า/บริการ");
    expect(r.missing).toContain("CTA ประจำ");
    // ต้องบอก "แล้วจะเกิดอะไรขึ้น" ไม่ใช่แค่ "ขาด"
    expect(r.th).toMatch(/เพจไหนก็ได้/);
  });

  it("กลุ่มเป้าหมายกว้างเกินไป (สั้นกว่า 10 ตัวอักษร) ถือว่ายังไม่ได้กรอก", () => {
    // "ทุกคน" คือคำตอบที่คนกรอกเร็วๆ ชอบใส่ แล้วได้คอนเทนต์ที่ไม่ตรงใคร
    const r = checkBrief({ ...FULL, audience: "ทุกคน" });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("กลุ่มเป้าหมาย");
  });

  it("ครบของบังคับแต่ขาดของเสริม → ผ่าน แต่แนะนำให้เพิ่ม", () => {
    const brief = { ...FULL };
    delete brief.differentiators;
    delete brief.samplePosts;
    const r = checkBrief(brief);
    expect(r.ready).toBe(true);
    expect(r.th).toMatch(/จุดขาย/);
    expect(r.th).toMatch(/ตัวอย่างโพสต์/);
  });

  it("คะแนนลดลงตามจำนวนช่องที่ขาด", () => {
    const one = checkBrief({ ...FULL, ctas: [] });
    const two = checkBrief({ ...FULL, ctas: [], products: [] });
    expect(one.score).toBeGreaterThan(two.score);
  });

  it("brief เปล่า → คะแนน 0 และขาดครบทุกช่อง", () => {
    const r = checkBrief(emptyBrief("p9"));
    expect(r.score).toBe(0);
    expect(r.missing).toHaveLength(5);
  });

  it("ชื่อแบรนด์ที่เป็นช่องว่างล้วน ไม่นับว่ากรอกแล้ว", () => {
    const r = checkBrief({ ...FULL, brandName: "   " });
    expect(r.missing).toContain("ชื่อแบรนด์");
  });
});

describe("briefToPrompt", () => {
  it("ใส่ข้อมูลที่จำเป็นครบและเป็นภาษาไทย", () => {
    const p = briefToPrompt(FULL);
    expect(p).toContain("ครัวคุณยาย");
    expect(p).toContain("พนักงานออฟฟิศ");
    expect(p).toContain("ข้าวกล่องรายวัน");
    expect(p).toContain("ทักแชทสั่งเลย");
  });

  it("คำต้องห้ามต้องอยู่ใน prompt เสมอ — เป็นเรื่องกฎหมาย ไม่ใช่ความชอบ", () => {
    const p = briefToPrompt(FULL);
    expect(p).toMatch(/ห้ามใช้คำเหล่านี้เด็ดขาด/);
    expect(p).toContain("รักษาโรค");
  });

  it("ไม่มีคำต้องห้าม → ไม่ต้องมีบรรทัดนั้นให้รก", () => {
    const p = briefToPrompt({ ...FULL, bannedWords: [] });
    expect(p).not.toMatch(/ห้ามใช้คำเหล่านี้/);
  });

  it("ส่งตัวอย่างโพสต์ให้ไม่เกิน 3 อัน — เกินนั้นกิน context ฟรี", () => {
    const p = briefToPrompt({
      ...FULL,
      samplePosts: ["ก", "ข", "ค", "ง", "จ"],
    });
    expect(p).toContain("1. ก");
    expect(p).toContain("3. ค");
    expect(p).not.toContain("4. ง");
  });

  it("ไม่หลุด pageId ลง prompt — LLM ไม่ต้องรู้ และหลุดไปในคอนเทนต์ได้", () => {
    expect(briefToPrompt(FULL)).not.toContain("p1");
  });
});

describe("emptyBrief", () => {
  it("สร้าง brief เปล่าที่ผูกกับเพจแล้ว พร้อมให้กรอกต่อ", () => {
    const b = emptyBrief("p42", "ชื่อชั่วคราว");
    expect(b.pageId).toBe("p42");
    expect(b.brandName).toBe("ชื่อชั่วคราว");
    expect(b.products).toEqual([]);
  });
});
