import { describe, expect, it } from "vitest";
import { compareGap, compareWithStrongest, type GapSide } from "./gap.js";

const side = (over: Partial<GapSide> & { pageId: string }): GapSide => ({
  pageName: over.pageId,
  posts: 10,
  followers: 1_000_000,
  engagement: 100_000,
  ...over,
});

/** ดึงค่าออกมาโดยยืนยันว่าเทียบสำเร็จ — ให้เทสต์พังตรงจุดถ้าไม่สำเร็จ */
function breakdown(result: ReturnType<typeof compareGap>) {
  if (!result.ok) throw new Error(`คาดว่าเทียบได้ แต่ได้: ${result.reasonTh}`);
  return result;
}

describe("ช่องว่างเทียบคู่แข่ง", () => {
  it("เท่ากันทุกอย่าง → ช่องว่าง 0 และไม่มีปัจจัยไหนฉุด", () => {
    const r = breakdown(
      compareGap({ ours: side({ pageId: "a" }), theirs: side({ pageId: "b" }) }),
    );
    expect(r.gapPct).toBeCloseTo(0, 10);
    for (const f of r.factors) expect(f.contributionPct).toBeCloseTo(0, 8);
    expect(r.biggestDrag).toBeNull();
  });

  it("engagement เป็นครึ่งเดียวของเขา → ตามหลัง 50%", () => {
    const r = breakdown(
      compareGap({
        ours: side({ pageId: "a", engagement: 50_000 }),
        theirs: side({ pageId: "b", engagement: 100_000 }),
      }),
    );
    expect(r.gapPct).toBeCloseTo(-50, 10);
  });

  it("engagement เป็นสองเท่าของเขา → นำ 100%", () => {
    const r = breakdown(
      compareGap({
        ours: side({ pageId: "a", engagement: 200_000 }),
        theirs: side({ pageId: "b", engagement: 100_000 }),
      }),
    );
    expect(r.gapPct).toBeCloseTo(100, 10);
  });

  /**
   * ข้อตกลงที่หน้าจอเขียนไว้ตรงๆ ว่า "ตัวเลขแต่ละบรรทัดรวมกันได้เท่ากับช่องว่างรวมพอดี"
   * ถ้าข้อนี้พังเมื่อไหร่ คนจะจับผิดได้ทันทีและเลิกเชื่อทั้งหน้า
   */
  it("สามบรรทัดรวมกันเท่ากับช่องว่างรวมเสมอ", () => {
    const cases: Array<[GapSide, GapSide]> = [
      [
        side({ pageId: "a", posts: 50, followers: 16_000_000, engagement: 2_552_599 }),
        side({ pageId: "b", posts: 43, followers: 2_700_000, engagement: 4_281_108 }),
      ],
      [
        side({ pageId: "a", posts: 3, followers: 900, engagement: 12 }),
        side({ pageId: "b", posts: 91, followers: 4_000_000, engagement: 999_999 }),
      ],
      [
        side({ pageId: "a", posts: 120, followers: 55, engagement: 7 }),
        side({ pageId: "b", posts: 1, followers: 1, engagement: 1 }),
      ],
      [
        side({ pageId: "a", posts: 7, followers: 1_234, engagement: 5_678 }),
        side({ pageId: "b", posts: 7, followers: 1_234, engagement: 5_679 }),
      ],
    ];

    for (const [ours, theirs] of cases) {
      const r = breakdown(compareGap({ ours, theirs }));
      const sum = r.factors.reduce((s, f) => s + f.contributionPct, 0);
      expect(sum, `ours=${JSON.stringify(ours)}`).toBeCloseTo(r.gapPct, 6);
    }
  });

  /**
   * ตัวเลขชุดนี้อ่านมาจากหน้าจอของเครื่องมือที่เอามาเป็นต้นแบบ
   * ใช้ล็อกว่าเราคิดด้วยสูตรเดียวกัน ไม่ใช่สูตรที่ "ดูคล้าย"
   */
  it("ให้ผลตรงกับตัวเลขอ้างอิงจากเครื่องมือต้นแบบ", () => {
    const r = breakdown(
      compareGap({
        ours: side({
          pageId: "pimrypie",
          pageName: "Pimrypie",
          posts: 50,
          followers: 16_000_000,
          engagement: 2_552_599,
        }),
        theirs: side({
          pageId: "sokad",
          pageName: "ซ้อก้าด",
          posts: 43,
          followers: 2_700_000,
          engagement: 4_281_108,
        }),
      }),
    );

    expect(r.gapPct).toBeCloseTo(-40.4, 1);

    const by = (k: string) => r.factors.find((f) => f.key === k)?.contributionPct ?? NaN;
    expect(by("postCount")).toBeCloseTo(11.8, 1);
    expect(by("followers")).toBeCloseTo(138.9, 1);
    expect(by("contentQuality")).toBeCloseTo(-191.1, 1);
  });

  it("โพสต์ถี่กว่าแต่ตามหลัง → ป้ายบอกทิศทางถูกทีละปัจจัย", () => {
    const r = breakdown(
      compareGap({
        ours: side({ pageId: "a", posts: 20, followers: 500_000, engagement: 50_000 }),
        theirs: side({ pageId: "b", posts: 10, followers: 1_000_000, engagement: 100_000 }),
      }),
    );
    const by = (k: string) => r.factors.find((f) => f.key === k);
    expect(by("postCount")?.labelTh).toBe("โพสต์ถี่กว่า");
    expect(by("followers")?.labelTh).toBe("ผู้ติดตามน้อยกว่า");
  });

  /**
   * เหตุผลที่ต้องมี `fastestWin` แยกจาก `biggestDrag`:
   * ตัวที่ฉุดหนักสุดมักเป็น "ผู้ติดตามน้อยกว่า" ซึ่งบอกไปก็ทำอะไรไม่ได้เดือนนี้
   */
  it("แยก 'ตัวที่ฉุดหนักสุด' กับ 'ตัวที่แก้ได้เร็วสุด' ออกจากกัน", () => {
    const r = breakdown(
      compareGap({
        ours: side({ pageId: "a", posts: 5, followers: 10_000, engagement: 4_000 }),
        theirs: side({ pageId: "b", posts: 10, followers: 5_000_000, engagement: 100_000 }),
      }),
    );
    expect(r.biggestDrag?.key).toBe("followers");
    expect(r.fastestWin?.effortToFix).not.toBe("slow");
    expect(r.fastestWin?.key).toBe("postCount");
  });

  it("ไม่มีปัจจัยไหนติดลบ → ไม่มีทั้งตัวฉุดและตัวที่ต้องแก้", () => {
    const r = breakdown(
      compareGap({
        ours: side({ pageId: "a", posts: 20, followers: 2_000_000, engagement: 400_000 }),
        theirs: side({ pageId: "b", posts: 10, followers: 1_000_000, engagement: 100_000 }),
      }),
    );
    expect(r.biggestDrag).toBeNull();
    expect(r.fastestWin).toBeNull();
  });

  /**
   * เจอจากการยิงข้อมูลสุ่ม 500,000 เคสตอน audit — ไม่ได้ผิด แต่หลอกตาโหด
   *
   * `contributionPct` เป็นหน่วยลอการิทึมที่ปรับสเกลแล้ว ไม่ใช่ "มากกว่ากี่ %"
   * ต่างกัน 474 เท่าออกมาเป็น -616% ซึ่งคนอ่านจะแปลว่า "น้อยกว่า 616%"
   * แล้วงงว่ามันแปลว่าอะไร — หน้าจอจึงต้องโชว์ `ratio` ควบคู่เสมอ
   *
   * เทสต์นี้ล็อกไว้ว่า `ratio` ต้องมีให้ใช้และตรงกับความจริงเสมอ
   * ไม่ใช่เพื่อยืนยันตัวเลข -616% ว่าสวย
   */
  it("อัตราส่วนห่างมาก → contributionPct ทะลุ ±100% ได้ และต้องมี ratio ให้ UI เสมอ", () => {
    const r = breakdown(
      compareGap({
        ours: side({ pageId: "a", posts: 1, followers: 27_233, engagement: 1_000 }),
        theirs: side({ pageId: "b", posts: 457, followers: 12_926_414, engagement: 1_000 }),
      }),
    );

    expect(r.gapPct).toBeCloseTo(0, 10);
    expect(Math.max(...r.factors.map((f) => Math.abs(f.contributionPct)))).toBeGreaterThan(100);

    const followers = r.factors.find((f) => f.key === "followers");
    // 27,233 / 12,926,414 ≈ 0.0021 → น้อยกว่าราว 475 เท่า ซึ่งเป็นตัวเลขที่คนอ่านรู้เรื่อง
    expect(followers?.ratio).toBeCloseTo(27_233 / 12_926_414, 12);
    expect(1 / (followers?.ratio ?? 1)).toBeCloseTo(474.7, 0);

    // ถึงตัวเลขจะดูสุดขั้ว ข้อตกลง "รวมกันเท่าพาดหัว" ต้องยังจริง
    const sum = r.factors.reduce((s, f) => s + f.contributionPct, 0);
    expect(sum).toBeCloseTo(r.gapPct, 9);
  });

  /**
   * พาดหัวคิดจาก "เราเป็นกี่ % ของเขา" จึงไม่สมมาตรโดยตั้งใจ:
   * ครึ่งหนึ่งของเขา = ตามหลัง 50% แต่สองเท่าของเขา = นำ 100%
   */
  it("สลับข้างแล้วไม่ได้ค่าติดลบของกันตรงๆ — พาดหัวเป็นสัดส่วนของอีกฝ่าย", () => {
    const a = side({ pageId: "a", posts: 10, followers: 100_000, engagement: 50_000 });
    const b = side({ pageId: "b", posts: 10, followers: 100_000, engagement: 100_000 });

    expect(breakdown(compareGap({ ours: a, theirs: b })).gapPct).toBeCloseTo(-50, 9);
    expect(breakdown(compareGap({ ours: b, theirs: a })).gapPct).toBeCloseTo(100, 9);
  });

  it("คุณภาพคอนเทนต์คือเศษที่เหลือจริง — ตรงกับ E/(P×F) ที่คิดตรงๆ", () => {
    const ours = side({ pageId: "a", posts: 25, followers: 300_000, engagement: 90_000 });
    const theirs = side({ pageId: "b", posts: 40, followers: 1_500_000, engagement: 600_000 });
    const r = breakdown(compareGap({ ours, theirs }));

    const qOurs = ours.engagement / (ours.posts * ours.followers);
    const qTheirs = theirs.engagement / (theirs.posts * theirs.followers);
    const quality = r.factors.find((f) => f.key === "contentQuality");

    expect(quality?.ratio).toBeCloseTo(qOurs / qTheirs, 9);
  });
});

describe("ข้อมูลไม่พอ", () => {
  it("ฝั่งเราไม่มี engagement → บอกว่าเทียบไม่ได้ ไม่ใช่คืนเลขมั่ว", () => {
    const r = compareGap({
      ours: side({ pageId: "a", engagement: 0 }),
      theirs: side({ pageId: "b" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonTh).toContain("ยังไม่มี engagement");
  });

  it("ไม่รู้จำนวนผู้ติดตามของคู่แข่ง → บอกว่าแยกปัจจัยไม่ได้", () => {
    const r = compareGap({
      ours: side({ pageId: "a" }),
      theirs: side({ pageId: "b", followers: 0 }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonTh).toContain("ผู้ติดตาม");
  });

  it("คู่แข่งไม่มีโพสต์ในช่วงนี้ → แนะให้ขยายช่วงเวลา", () => {
    const r = compareGap({
      ours: side({ pageId: "a" }),
      theirs: side({ pageId: "b", posts: 0 }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonTh).toContain("ขยายช่วงเวลา");
  });
});

describe("เลือกคู่แข่งที่แรงที่สุดมาเทียบ", () => {
  it("เลือกจาก engagement สูงสุด ไม่ใช่ผู้ติดตามสูงสุด", () => {
    const r = breakdown(
      compareWithStrongest({
        ours: side({ pageId: "me", engagement: 100_000 }),
        others: [
          side({ pageId: "ใหญ่แต่เงียบ", followers: 90_000_000, engagement: 1_000 }),
          side({ pageId: "เล็กแต่แรง", followers: 50_000, engagement: 900_000 }),
        ],
      }),
    );
    expect(r.theirs.pageId).toBe("เล็กแต่แรง");
  });

  it("ไม่นับตัวเองเป็นคู่แข่ง", () => {
    const r = compareWithStrongest({
      ours: side({ pageId: "me" }),
      others: [side({ pageId: "me", engagement: 999_999 })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonTh).toContain("ยังไม่มีเพจอื่น");
  });

  it("ยังไม่ได้เพิ่มคู่แข่ง → บอกให้ไปเพิ่มก่อน", () => {
    const r = compareWithStrongest({ ours: side({ pageId: "me" }), others: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonTh).toContain("เพิ่มเพจคู่แข่ง");
  });
});
