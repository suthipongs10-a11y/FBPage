/**
 * ช่องว่างเทียบคู่แข่ง — และที่สำคัญกว่า: **ช่องว่างนั้นมาจากอะไร**
 *
 * ─── ปัญหาของการบอกแค่ "ตามหลัง 40%" ───
 *
 * มันจริงแต่ทำอะไรต่อไม่ได้ ตามหลังเพราะเขาโพสต์ถี่กว่า? เพราะเขามีคนตามเยอะกว่า?
 * หรือเพราะคอนเทนต์เราไม่โดน? สามข้อนี้แก้คนละวิธี ใช้เวลาคนละสเกล และบางข้อ
 * แก้ไม่ได้เลยในระยะสั้น
 *
 * ─── วิธีแยก ───
 *
 * engagement แยกเป็นผลคูณของสามอย่างได้พอดี:
 *
 *   E  =  P  ×  F  ×  q          โดย q = E / (P × F)
 *         ↑     ↑     ↑
 *      โพสต์  ผู้ติดตาม  คุณภาพคอนเทนต์ (engagement ต่อโพสต์ต่อผู้ติดตาม)
 *
 * `q` ไม่ใช่ตัวเลขที่เดามาลอยๆ — มันคือเศษที่เหลือหลังหักผลของ "โพสต์เยอะ"
 * กับ "คนตามเยอะ" ออกไปแล้ว เพจเล็กที่คอนเทนต์ดีจะมี q สูงกว่าเพจใหญ่ที่โพสต์มั่ว
 *
 * ผลคูณกลายเป็นผลบวกได้ด้วยลอการิทึม:
 *
 *   ln(E₁/E₂) = ln(P₁/P₂) + ln(F₁/F₂) + ln(q₁/q₂)
 *
 * นี่คือหัวใจ — สามบรรทัด**บวกกันได้พอดีเป๊ะ** ไม่ใช่ประมาณ
 *
 * ─── ทำไมต้องปรับสเกลอีกชั้น ───
 *
 * ตัวเลขพาดหัวที่คนอ่านคือ "ตามหลัง 40.4%" ซึ่งมาจาก `E₁/E₂ − 1` ไม่ใช่ `ln(E₁/E₂)`
 * (คนอ่าน "ตามหลัง 40%" เข้าใจทันที ส่วน "ตามหลัง 0.52 log" ไม่มีใครเข้าใจ)
 * แต่ถ้าปล่อยให้สามบรรทัดเป็นหน่วย log มันจะบวกกันได้ 51.7% ไม่ใช่ 40.4%
 * แล้วคนจะจับผิดทันทีว่า "เลขไม่ตรง"
 *
 * จึงคูณทั้งสามบรรทัดด้วยตัวเดียวกัน `gapPct / ln(E₁/E₂)` — สัดส่วนระหว่างกัน
 * ไม่เปลี่ยน (ยังบอกถูกว่าปัจจัยไหนหนักกว่ากันเท่าไร) แต่ผลรวมลงตัวกับพาดหัวพอดี
 */

/** ตัวเลขของเพจหนึ่งฝั่งในช่วงเวลาที่เทียบกัน */
export interface GapSide {
  pageId: string;
  pageName: string;
  /** จำนวนโพสต์ที่เผยแพร่ในช่วงที่เลือก */
  posts: number;
  followers: number;
  engagement: number;
}

export type GapFactorKey = "postCount" | "followers" | "contentQuality";

export interface GapFactor {
  key: GapFactorKey;
  /** ค่าฝั่งเรา ÷ ค่าฝั่งเขา — มากกว่า 1 แปลว่าเรานำในปัจจัยนี้ */
  ratio: number;
  /**
   * ปัจจัยนี้ดันช่องว่างรวมไปทางไหนเท่าไร (เปอร์เซ็นต์)
   * บวก = ช่วยเรา, ลบ = ฉุดเรา — รวมทุกตัวได้เท่ากับ `gapPct` พอดี
   *
   * ⚠️ **นี่ไม่ใช่ "มากกว่า/น้อยกว่ากี่เปอร์เซ็นต์"** — มันคือส่วนแบ่งของช่องว่าง
   * ในหน่วยลอการิทึมที่ปรับสเกลแล้ว ค่าเกิน ±100% ได้เป็นเรื่องปกติ:
   * ผู้ติดตามมากกว่า 5.9 เท่า ออกมาเป็น +138.9% ไม่ใช่ +490%
   *
   * เวลาเอาไปขึ้นจอ **ต้องแสดง `ratio` ควบคู่เสมอ** ("มากกว่า 5.9 เท่า")
   * ไม่งั้นคนอ่านจะแปล +138.9% เป็น "มากกว่า 2.4 เท่า" ซึ่งผิด
   * ยิ่งอัตราส่วนห่างมาก ตัวเลขนี้ยิ่งพุ่ง — เคยเจอถึง ±1,200% ตอนต่างกัน 474 เท่า
   */
  contributionPct: number;
  labelTh: string;
  hintTh: string;
  /** แก้ยากแค่ไหน — ใช้ตัดสินว่าควรลงแรงตรงไหนก่อน */
  effortToFix: "fast" | "medium" | "slow";
}

export interface GapBreakdown {
  ok: true;
  ours: GapSide;
  theirs: GapSide;
  /** ลบ = ตามหลัง, บวก = นำ (เปอร์เซ็นต์) */
  gapPct: number;
  /** เรียงจากตัวที่ฉุดหนักสุดไปหาตัวที่ช่วยมากสุด */
  factors: GapFactor[];
  /** ปัจจัยที่ฉุดหนักที่สุด — `null` ถ้าไม่มีปัจจัยไหนติดลบเลย */
  biggestDrag: GapFactor | null;
  /**
   * ปัจจัยที่ฉุดหนักที่สุด **ในบรรดาที่แก้ได้จริงในระยะสั้น**
   *
   * แยกจาก `biggestDrag` เพราะบ่อยครั้งตัวที่ฉุดหนักสุดคือ "ผู้ติดตามน้อยกว่า"
   * ซึ่งบอกไปก็ทำอะไรไม่ได้ในเดือนนี้ — ตัวนี้ตอบว่า "แล้วพรุ่งนี้ทำอะไรได้"
   */
  fastestWin: GapFactor | null;
}

export interface GapUnavailable {
  ok: false;
  reasonTh: string;
}

export type GapResult = GapBreakdown | GapUnavailable;

/** ต่ำกว่านี้ถือว่าเป็นศูนย์ — กันหารด้วยเลขที่เล็กจนผลลัพธ์ระเบิด */
const EPSILON = 1e-9;

const LABELS: Record<
  GapFactorKey,
  { ahead: string; behind: string; hintTh: string; effortToFix: GapFactor["effortToFix"] }
> = {
  postCount: {
    ahead: "โพสต์ถี่กว่า",
    behind: "โพสต์น้อยกว่า",
    hintTh: "จำนวนโพสต์ในช่วงที่เลือก — แก้ได้เร็วที่สุดด้วยแผนคอนเทนต์",
    effortToFix: "fast",
  },
  followers: {
    ahead: "ผู้ติดตามมากกว่า",
    behind: "ผู้ติดตามน้อยกว่า",
    hintTh: "ขนาดฐานผู้ติดตาม — แก้ช้าที่สุด ต้องใช้เวลาหรือโฆษณา",
    effortToFix: "slow",
  },
  contentQuality: {
    ahead: "คอนเทนต์โดนใจกว่า",
    behind: "คอนเทนต์โดนใจน้อยกว่า",
    hintTh: "engagement ต่อโพสต์ต่อผู้ติดตาม — วัดคุณภาพคอนเทนต์ล้วนๆ",
    effortToFix: "medium",
  },
};

/** ค่าที่ต้องเอาไปเข้าลอการิทึมต้องเป็นบวกล้วน ไม่งั้นได้ -Infinity หรือ NaN */
function missingFieldTh(side: GapSide, which: "ของเรา" | "ของคู่แข่ง"): string | null {
  if (side.engagement <= 0) {
    return `เพจ${which} "${side.pageName}" ยังไม่มี engagement ในช่วงนี้ — เทียบไม่ได้ ลองขยายช่วงเวลา`;
  }
  if (side.posts <= 0) {
    return `เพจ${which} "${side.pageName}" ไม่มีโพสต์ในช่วงนี้ — เทียบไม่ได้ ลองขยายช่วงเวลา`;
  }
  if (side.followers <= 0) {
    return `ยังไม่รู้จำนวนผู้ติดตามของเพจ${which} "${side.pageName}" — ต้องมีตัวเลขนี้ถึงจะแยกได้ว่าช่องว่างมาจากอะไร`;
  }
  return null;
}

/**
 * เทียบเพจเรากับคู่แข่งหนึ่งเพจ แล้วแยกว่าช่องว่างมาจากปัจจัยไหนบ้าง
 *
 * คืน `ok: false` พร้อมเหตุผลภาษาไทยเมื่อข้อมูลไม่พอ แทนที่จะคืนเลขที่ดูเหมือนใช้ได้
 * — ตัวเลขที่ผิดในหน้าจอแบบนี้อันตรายกว่าไม่มีตัวเลข เพราะคนเอาไปตัดสินใจจริง
 */
export function compareGap(args: { ours: GapSide; theirs: GapSide }): GapResult {
  const { ours, theirs } = args;

  const oursProblem = missingFieldTh(ours, "ของเรา");
  if (oursProblem !== null) return { ok: false, reasonTh: oursProblem };
  const theirsProblem = missingFieldTh(theirs, "ของคู่แข่ง");
  if (theirsProblem !== null) return { ok: false, reasonTh: theirsProblem };

  const engagementRatio = ours.engagement / theirs.engagement;
  const gapPct = (engagementRatio - 1) * 100;

  const totalLog = Math.log(engagementRatio);
  const postLog = Math.log(ours.posts / theirs.posts);
  const followerLog = Math.log(ours.followers / theirs.followers);
  /**
   * คุณภาพคอนเทนต์คือ **เศษที่เหลือ** ไม่ใช่ค่าที่คำนวณแยก
   *
   * คิดจาก q = E/(P×F) ตรงๆ ก็ได้ค่าเท่ากัน แต่หักลบแบบนี้รับประกันว่า
   * สามบรรทัดบวกกันเท่ากับช่องว่างรวม **เสมอ** ไม่ว่าจะเจอ floating point แบบไหน
   */
  const qualityLog = totalLog - postLog - followerLog;

  /**
   * `|totalLog|` เล็กมาก = engagement สองฝั่งเกือบเท่ากัน ช่องว่างรวมจึงเกือบศูนย์
   * หารด้วยมันจะได้เลขระเบิด — กรณีนี้ใช้หน่วย log ตรงๆ ไปเลย (ต่างกันไม่ถึง 1e-7)
   */
  const scale = Math.abs(totalLog) < EPSILON ? 100 : gapPct / totalLog;

  const build = (key: GapFactorKey, ratio: number, logPart: number): GapFactor => {
    const meta = LABELS[key];
    return {
      key,
      ratio,
      contributionPct: logPart * scale,
      labelTh: logPart >= 0 ? meta.ahead : meta.behind,
      hintTh: meta.hintTh,
      effortToFix: meta.effortToFix,
    };
  };

  const factors = [
    build("postCount", ours.posts / theirs.posts, postLog),
    build("followers", ours.followers / theirs.followers, followerLog),
    build("contentQuality", Math.exp(qualityLog), qualityLog),
  ].sort((a, b) => a.contributionPct - b.contributionPct);

  const drags = factors.filter((f) => f.contributionPct < 0);

  return {
    ok: true,
    ours,
    theirs,
    gapPct,
    factors,
    biggestDrag: drags[0] ?? null,
    fastestWin: drags.find((f) => f.effortToFix !== "slow") ?? null,
  };
}

/**
 * หาคู่แข่งที่ "แรงที่สุด" ในชุด แล้วเทียบกับเพจเรา
 *
 * เลือกจาก engagement สูงสุด ไม่ใช่ผู้ติดตามสูงสุด — คนที่ครองบทสนทนาอยู่จริง
 * คือคนที่ต้องรู้ว่าเราห่างเขาแค่ไหน ไม่ใช่คนที่มีฐานแฟนใหญ่แต่เงียบ
 */
export function compareWithStrongest(args: {
  ours: GapSide;
  others: readonly GapSide[];
}): GapResult {
  const rivals = args.others.filter((o) => o.pageId !== args.ours.pageId);
  if (rivals.length === 0) {
    return { ok: false, reasonTh: "ยังไม่มีเพจอื่นให้เทียบ — เพิ่มเพจคู่แข่งเข้าระบบก่อน" };
  }

  let strongest = rivals[0] as GapSide;
  for (const rival of rivals) {
    if (rival.engagement > strongest.engagement) strongest = rival;
  }

  return compareGap({ ours: args.ours, theirs: strongest });
}
