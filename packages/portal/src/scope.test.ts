import { describe, expect, it } from "vitest";
import { expectThaiThrow } from "@page-os/core/testing";
import {
  DEFAULT_PERMISSIONS,
  PortalLeakError,
  assertCan,
  assertNoLeak,
  assertPageInScope,
  findLeaks,
  inScope,
  onlyInScope,
  type PortalScope,
} from "./scope.js";

function scope(over: Partial<PortalScope> = {}): PortalScope {
  return {
    workspaceId: "ws-a",
    clientName: "ครัวคุณยาย",
    pageIds: ["p1", "p2"],
    permissions: DEFAULT_PERMISSIONS,
    email: "owner@krua.example",
    ...over,
  };
}

describe("assertPageInScope", () => {
  it("เพจของตัวเอง → ผ่าน", () => {
    expect(() => assertPageInScope(scope(), "p1")).not.toThrow();
  });

  it("เพจของลูกค้ารายอื่น → ปฏิเสธ", () => {
    expect(() => assertPageInScope(scope(), "other")).toThrow();
  });

  it("ตอบเหมือนกันทั้งเพจที่ไม่มีจริงและเพจของคนอื่น", () => {
    // ถ้าตอบต่างกัน คนไล่เดา id จะรู้ว่าเพจไหนมีอยู่จริงในระบบ
    const notExist = expectThaiThrow(() =>
      assertPageInScope(scope(), "ไม่มีเพจนี้เลย"),
    );
    const someoneElse = expectThaiThrow(() =>
      assertPageInScope(scope(), "p-ของลูกค้ารายอื่น"),
    );
    expect(notExist.th).toBe(someoneElse.th);
    expect(notExist.th).not.toMatch(/รายอื่น|ไม่ใช่ของคุณ/);
  });
});

describe("assertCan", () => {
  it("ไม่มีสิทธิ์ → ปฏิเสธพร้อมบอกทางออก", () => {
    const err = expectThaiThrow(() =>
      assertCan(
        scope({ permissions: { ...DEFAULT_PERMISSIONS, viewLeads: false } }),
        "viewLeads",
      ),
    );
    expect(err.th).toMatch(/ติดต่อทีมงาน/);
  });

  it("มีสิทธิ์ → ผ่าน", () => {
    expect(() => assertCan(scope(), "approve")).not.toThrow();
  });
});

describe("onlyInScope", () => {
  it("กรองแถวของลูกค้ารายอื่นออก", () => {
    const rows = [
      { pageId: "p1", v: 1 },
      { pageId: "อื่น", v: 2 },
      { pageId: "p2", v: 3 },
    ];
    expect(onlyInScope(scope(), rows).map((r) => r.v)).toEqual([1, 3]);
  });

  it("ขอบเขตว่าง → ไม่เหลืออะไรเลย (fail-closed)", () => {
    const rows = [{ pageId: "p1" }];
    expect(onlyInScope(scope({ pageIds: [] }), rows)).toEqual([]);
  });
});

describe("findLeaks — รหัสเพจนอกขอบเขต", () => {
  it("จับ pageId ที่ไม่ใช่ของลูกค้ารายนี้ ไม่ว่าจะซ่อนลึกแค่ไหน", () => {
    const payload = {
      posts: [{ ok: { pageId: "p1" } }, { deep: [{ pageId: "ของคนอื่น" }] }],
    };
    const f = findLeaks(payload, scope());
    expect(f).toHaveLength(1);
    expect(f[0]!.path).toBe("posts[1].deep[0].pageId");
  });

  it("จับ pageIds ที่เป็นรายการ", () => {
    const f = findLeaks({ pageIds: ["p1", "แอบมา"] }, scope());
    expect(f).toHaveLength(1);
  });

  it("รับชื่อฟิลด์แบบ snake_case ด้วย", () => {
    expect(findLeaks({ page_id: "คนอื่น" }, scope())).toHaveLength(1);
    expect(findLeaks({ fb_page_id: "คนอื่น" }, scope())).toHaveLength(1);
  });

  it("workspaceId ของบัญชีอื่น → จับได้", () => {
    const f = findLeaks({ workspaceId: "ws-b" }, scope());
    expect(f[0]!.th).toMatch(/บัญชีอื่น/);
  });

  it("workspaceId ของตัวเอง → ผ่าน", () => {
    expect(findLeaks({ workspaceId: "ws-a" }, scope())).toEqual([]);
  });
});

describe("findLeaks — ฟิลด์ที่สเปกห้ามให้ลูกค้าเห็น", () => {
  it("ต้นทุนและกำไร", () => {
    // สเปก M9: "ไม่ให้เห็น: ต้นทุน, ลูกค้ารายอื่น, ค่า config บอท"
    for (const key of ["cost", "unitCost", "costPerPost", "margin", "ต้นทุน", "กำไร"]) {
      expect(findLeaks({ [key]: 1 }, scope()), key).not.toEqual([]);
    }
  });

  it("ค่า config บอท", () => {
    for (const key of ["botConfig", "systemPrompt", "knowledgeBase", "toneProfile", "flow", "tone", "prompt"]) {
      expect(findLeaks({ [key]: "x" }, scope()), key).not.toEqual([]);
    }
  });

  it("โทเคนและความลับ", () => {
    for (const key of ["accessToken", "pageToken", "secret", "apiKey", "encryptedToken"]) {
      expect(findLeaks({ [key]: "x" }, scope()), key).not.toEqual([]);
    }
  });

  it("สถานะโทเคนไม่ใช่ตัวโทเคน — ต้องแสดงได้ ลูกค้าต้องรู้ว่าต้องกดเชื่อมใหม่", () => {
    expect(findLeaks({ tokenState: "expired" }, scope())).toEqual([]);
    expect(findLeaks({ needsReconnect: true }, scope())).toEqual([]);
  });

  it("ฟิลด์ปกติของรายงานไม่โดนจับผิด", () => {
    // ถ้าจับผิดบ่อย คนจะปิดการตรวจแทนที่จะแก้ข้อมูล
    const report = {
      pageId: "p1",
      month: "2026-08",
      executiveSummary: ["ยอดเข้าถึงเพิ่ม 12%"],
      inbox: { botContainmentRate: 0.62, avgResponseSeconds: 480 },
      topPosts: [{ excerpt: "เมนูใหม่", engagement: 320, permalink: "https://x" }],
      highlights: [{ labelTh: "ผู้ติดตาม", currentText: "1,204", improved: true }],
    };
    expect(findLeaks(report, scope())).toEqual([]);
  });

  it("บอกตำแหน่งที่เจอ จะได้ตามไปแก้ถูก", () => {
    const f = findLeaks({ a: { b: [{ cost: 5 }] } }, scope());
    expect(f[0]!.path).toBe("a.b[0].cost");
  });
});

describe("findLeaks — ความทนทาน", () => {
  it("วัตถุที่อ้างถึงตัวเอง ไม่ทำให้วนไม่รู้จบ", () => {
    const a: Record<string, unknown> = { pageId: "p1" };
    a.self = a;
    expect(() => findLeaks(a, scope())).not.toThrow();
  });

  it("ค่า null และชนิดพื้นฐาน ไม่ทำให้พัง", () => {
    expect(findLeaks(null, scope())).toEqual([]);
    expect(findLeaks("ข้อความ", scope())).toEqual([]);
    expect(findLeaks({ a: null, b: 1, c: undefined }, scope())).toEqual([]);
  });
});

describe("assertNoLeak", () => {
  it("เจอข้อมูลรั่ว → ไม่ส่งอะไรออกไปเลย", () => {
    const err = expectThaiThrow(() =>
      assertNoLeak({ pageId: "ของคนอื่น" }, scope()),
    );
    expect(err).toBeInstanceOf(PortalLeakError);
    expect(err.th).toMatch(/หยุดไว้ก่อน/);
  });

  it("ข้อความที่ผู้ใช้เห็นไม่บอกรายละเอียดว่ารั่วอะไร", () => {
    // รายละเอียดอยู่ใน findings สำหรับ log ภายใน ไม่ใช่ในข้อความที่แสดง
    const err = expectThaiThrow(() =>
      assertNoLeak({ cost: 100 }, scope()),
    ) as PortalLeakError;
    expect(err.th).not.toMatch(/cost/);
    expect(err.findings[0]!.path).toBe("cost");
  });

  it("ข้อมูลที่สะอาด → ผ่านเงียบๆ", () => {
    expect(() =>
      assertNoLeak({ posts: [{ pageId: "p1", body: "สวัสดี" }] }, scope()),
    ).not.toThrow();
  });
});

describe("inScope", () => {
  it("ตอบตรงตามรายการเพจของ session", () => {
    expect(inScope(scope(), "p1")).toBe(true);
    expect(inScope(scope(), "p9")).toBe(false);
  });
});
