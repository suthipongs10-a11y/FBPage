import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import { expectThaiRejection } from "@page-os/core/testing";
import {
  InMemoryMagicLinkStore,
  InMemoryThrottle,
  MAGIC_LINK_TTL_MS,
  MAX_REQUESTS_PER_WINDOW,
  PortalAuth,
  SESSION_TTL_MS,
  looksLikeEmail,
  normalizeEmail,
  type PortalAccount,
  type PortalDirectory,
} from "./magic-link.js";

const SECRET = "test-secret-ที่ยาวพอสมควร";
const START = Date.UTC(2026, 7, 8, 3, 0, 0);

/** directory ปลอมที่คุมได้ทั้งบัญชี เพจ และ epoch */
class FakeDirectory implements PortalDirectory {
  accounts = new Map<string, PortalAccount>([
    ["owner@krua.example", { workspaceId: "ws-a", clientName: "ครัวคุณยาย" }],
    ["boss@pladang.example", { workspaceId: "ws-b", clientName: "บ้านขนมป้าแดง" }],
  ]);
  pages = new Map<string, string[]>([
    ["ws-a", ["p1", "p2"]],
    ["ws-b", ["p9"]],
  ]);
  epochs = new Map<string, number>();
  lookups: string[] = [];

  async findByEmail(email: string): Promise<PortalAccount | null> {
    this.lookups.push(email);
    return this.accounts.get(email) ?? null;
  }
  async pageIdsOf(workspaceId: string): Promise<string[]> {
    return this.pages.get(workspaceId) ?? [];
  }
  async sessionEpochOf(workspaceId: string): Promise<number> {
    return this.epochs.get(workspaceId) ?? 1;
  }
}

function build(dir = new FakeDirectory()): {
  auth: PortalAuth;
  dir: FakeDirectory;
  clock: FakeClock;
  store: InMemoryMagicLinkStore;
} {
  const clock = new FakeClock(START);
  const store = new InMemoryMagicLinkStore();
  let n = 0;
  const auth = new PortalAuth({
    directory: dir,
    store,
    secret: SECRET,
    loginBaseUrl: "https://client.pageos.app/enter/",
    clock,
    newId: () => `jti-${++n}`,
  });
  return { auth, dir, clock, store };
}

/** ดึง token ออกจาก URL ที่ requestLink คืนมา */
function tokenOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("t")!);
}

describe("normalizeEmail / looksLikeEmail", () => {
  it("ตัดช่องว่างและแปลงเป็นตัวพิมพ์เล็ก", () => {
    expect(normalizeEmail("  Owner@Krua.Example ")).toBe("owner@krua.example");
  });

  it("รูปแบบที่ใช้ไม่ได้", () => {
    for (const bad of ["", "ไม่มีแอท", "a@b", "a b@c.com", "@x.com", "a@.com"]) {
      expect(looksLikeEmail(bad), bad).toBe(false);
    }
  });

  it("รูปแบบที่ใช้ได้", () => {
    expect(looksLikeEmail("owner@krua.example")).toBe(true);
    expect(looksLikeEmail("a.b+tag@sub.domain.co.th")).toBe(true);
  });
});

describe("requestLink", () => {
  it("อีเมลที่มีในระบบ → ได้ลิงก์", async () => {
    const { auth } = build();
    const r = await auth.requestLink("owner@krua.example");
    expect(r.url).toBeDefined();
    expect(r.url!.startsWith("https://client.pageos.app/enter?t=")).toBe(true);
  });

  it("อีเมลที่ไม่มีในระบบ → ไม่ได้ลิงก์ แต่ข้อความตอบเหมือนกันเป๊ะ", async () => {
    // ถ้าตอบต่างกัน หน้านี้กลายเป็นเครื่องมือให้คู่แข่งไล่เช็คว่าใครเป็นลูกค้าเรา
    const { auth } = build();
    const yes = await auth.requestLink("owner@krua.example");
    const no = await auth.requestLink("ไม่รู้จัก@example.com");
    expect(no.url).toBeUndefined();
    expect(no.th).toBe(yes.th);
  });

  it("อีเมลผิดรูปแบบ → error ไทย", async () => {
    const { auth } = build();
    const err = await expectThaiRejection(auth.requestLink("ไม่ใช่อีเมล"));
    expect(err.th).toMatch(/รูปแบบอีเมล/);
  });

  it("ขอถี่เกินไป → ถูกจำกัด", async () => {
    const { auth } = build();
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
      await auth.requestLink("owner@krua.example");
    }
    const err = await expectThaiRejection(auth.requestLink("owner@krua.example"));
    expect(err.th).toMatch(/ถี่เกินไป/);
  });

  it("การจำกัดแยกตามอีเมล ไม่กระทบคนอื่น", async () => {
    const { auth } = build();
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW + 1; i++) {
      await auth.requestLink("owner@krua.example").catch(() => undefined);
    }
    await expect(auth.requestLink("boss@pladang.example")).resolves.toBeDefined();
  });

  it("นับรวมอีเมลที่ไม่มีในระบบด้วย — ไม่งั้นยิงสแปมใส่คนนอกได้ไม่จำกัด", async () => {
    const { auth } = build();
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
      await auth.requestLink("คนนอก@example.com");
    }
    const err = await expectThaiRejection(auth.requestLink("คนนอก@example.com"));
    expect(err.th).toMatch(/ถี่เกินไป/);
  });

  it("พ้นหน้าต่างเวลาแล้วขอได้ใหม่", async () => {
    const { auth, clock } = build();
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
      await auth.requestLink("owner@krua.example");
    }
    await clock.advance(16 * 60_000);
    await expect(auth.requestLink("owner@krua.example")).resolves.toBeDefined();
  });
});

describe("redeem", () => {
  it("ลิงก์ที่ถูกต้อง → ได้ session พร้อมขอบเขตของลูกค้ารายนั้น", async () => {
    const { auth } = build();
    const link = await auth.requestLink("owner@krua.example");
    const r = await auth.redeem(tokenOf(link.url!));

    expect(r.scope.workspaceId).toBe("ws-a");
    expect(r.scope.pageIds).toEqual(["p1", "p2"]);
    expect(r.scope.email).toBe("owner@krua.example");
    expect(r.th).toMatch(/ครัวคุณยาย/);
  });

  it("ใช้ลิงก์ซ้ำครั้งที่สอง → ปฏิเสธ", async () => {
    // ลิงก์ค้างอยู่ใน history ของเบราว์เซอร์และในกล่องอีเมลตลอดไป
    const { auth } = build();
    const link = await auth.requestLink("owner@krua.example");
    const token = tokenOf(link.url!);
    await auth.redeem(token);
    const err = await expectThaiRejection(auth.redeem(token));
    expect(err.th).toMatch(/ใช้ได้ครั้งเดียว/);
  });

  it("ลิงก์หมดอายุ → ปฏิเสธ", async () => {
    const { auth, clock } = build();
    const link = await auth.requestLink("owner@krua.example");
    await clock.advance(MAGIC_LINK_TTL_MS + 1000);
    await expectThaiRejection(auth.redeem(tokenOf(link.url!)));
  });

  it("ลิงก์ที่ยังไม่หมดอายุพอดี → ยังใช้ได้", async () => {
    const { auth, clock } = build();
    const link = await auth.requestLink("owner@krua.example");
    await clock.advance(MAGIC_LINK_TTL_MS - 1000);
    await expect(auth.redeem(tokenOf(link.url!))).resolves.toBeDefined();
  });

  it("ลายเซ็นถูกแก้ → ปฏิเสธ", async () => {
    const { auth } = build();
    const link = await auth.requestLink("owner@krua.example");
    const token = tokenOf(link.url!);
    const tampered = `${token.slice(0, -3)}xyz`;
    await expectThaiRejection(auth.redeem(tampered));
  });

  it("เปลี่ยน workspace ใน payload แล้วเซ็นไม่ได้ → ปฏิเสธ", async () => {
    // คนที่ได้ลิงก์ของตัวเองจะพยายามแก้ payload ให้ชี้ไป workspace อื่น
    const { auth } = build();
    const link = await auth.requestLink("owner@krua.example");
    const [kind, b64, sig] = tokenOf(link.url!).split(".");
    const payload = JSON.parse(
      Buffer.from(b64!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    payload.workspaceId = "ws-b";
    const forged = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    await expectThaiRejection(auth.redeem(`${kind}.${forged}.${sig}`));
  });

  it("token ว่างหรือรูปแบบผิด → ปฏิเสธ ไม่ระเบิด", async () => {
    const { auth } = build();
    for (const bad of ["", "abc", "a.b", "a.b.c.d", null, undefined]) {
      await expectThaiRejection(auth.redeem(bad as string));
    }
  });

  it("ลิงก์ที่ประทับเวลาในอนาคต → ปฏิเสธ", async () => {
    const { auth, clock } = build();
    const link = await auth.requestLink("owner@krua.example");
    // ย้อนนาฬิกากลับ = ลิงก์กลายเป็นของอนาคต
    const past = new FakeClock(START - 10 * 60_000);
    const auth2 = new PortalAuth({
      directory: new FakeDirectory(),
      store: new InMemoryMagicLinkStore(),
      secret: SECRET,
      loginBaseUrl: "https://client.pageos.app/enter",
      clock: past,
    });
    void clock;
    await expectThaiRejection(auth2.redeem(tokenOf(link.url!)));
  });

  it("บัญชีถูกลบหลังส่งลิงก์ → ปฏิเสธ", async () => {
    const { auth, dir } = build();
    const link = await auth.requestLink("owner@krua.example");
    dir.accounts.delete("owner@krua.example");
    await expectThaiRejection(auth.redeem(tokenOf(link.url!)));
  });

  it("บัญชีย้าย workspace หลังส่งลิงก์ → ปฏิเสธ", async () => {
    const { auth, dir } = build();
    const link = await auth.requestLink("owner@krua.example");
    dir.accounts.set("owner@krua.example", {
      workspaceId: "ws-อื่น",
      clientName: "ครัวคุณยาย",
    });
    await expectThaiRejection(auth.redeem(tokenOf(link.url!)));
  });

  it("ข้อความปฏิเสธเหมือนกันทุกสาเหตุ — ไม่บอกว่าลิงก์หมดอายุหรือถูกใช้แล้ว", async () => {
    const { auth, clock } = build();
    const a = await auth.requestLink("owner@krua.example");
    const tokenA = tokenOf(a.url!);
    await auth.redeem(tokenA);
    const used = await expectThaiRejection(auth.redeem(tokenA));

    const b = await auth.requestLink("owner@krua.example");
    await clock.advance(MAGIC_LINK_TTL_MS + 1);
    const expired = await expectThaiRejection(auth.redeem(tokenOf(b.url!)));

    expect(used.th).toBe(expired.th);
  });
});

describe("verifySession", () => {
  async function loggedIn(): Promise<{
    auth: PortalAuth;
    dir: FakeDirectory;
    clock: FakeClock;
    sessionToken: string;
  }> {
    const { auth, dir, clock } = build();
    const link = await auth.requestLink("owner@krua.example");
    const r = await auth.redeem(tokenOf(link.url!));
    return { auth, dir, clock, sessionToken: r.sessionToken };
  }

  it("session ที่ถูกต้อง → ได้ขอบเขตกลับมา", async () => {
    const { auth, sessionToken } = await loggedIn();
    const scope = await auth.verifySession(sessionToken);
    expect(scope.workspaceId).toBe("ws-a");
    expect(scope.pageIds).toEqual(["p1", "p2"]);
  });

  it("อ่านรายการเพจใหม่ทุกครั้ง — ถอดเพจออกจากสัญญาแล้วมีผลทันที", async () => {
    // ถ้าเก็บรายการเพจไว้ใน token เพจที่ถอดออกจะยังเปิดดูได้อีก 7 วัน
    const { auth, dir, sessionToken } = await loggedIn();
    dir.pages.set("ws-a", ["p1"]);
    const scope = await auth.verifySession(sessionToken);
    expect(scope.pageIds).toEqual(["p1"]);
  });

  it("session หมดอายุ → ปฏิเสธ", async () => {
    const { auth, clock, sessionToken } = await loggedIn();
    await clock.advance(SESSION_TTL_MS + 1000);
    const err = await expectThaiRejection(auth.verifySession(sessionToken));
    expect(err.th).toMatch(/หมดอายุ/);
  });

  it("ขยับ epoch → เตะทุก session ออกทันที (ใช้ตอนจบสัญญา)", async () => {
    const { auth, dir, sessionToken } = await loggedIn();
    dir.epochs.set("ws-a", 2);
    await expectThaiRejection(auth.verifySession(sessionToken));
  });

  it("magic link เอามาใช้เป็น session token ไม่ได้ แม้ลายเซ็นจะถูก", async () => {
    // ทั้งสองเซ็นด้วยกุญแจเดียวกัน ถ้าไม่ตรวจชนิด ลิงก์ 15 นาทีจะกลายเป็น session 7 วัน
    const { auth } = build();
    const link = await auth.requestLink("owner@krua.example");
    await expectThaiRejection(auth.verifySession(tokenOf(link.url!)));
  });

  it("session token เอามาแลกเป็น session ใหม่ไม่ได้", async () => {
    const { auth, sessionToken } = await loggedIn();
    await expectThaiRejection(auth.redeem(sessionToken));
  });

  it("ลูกค้าคนละรายได้ขอบเขตคนละชุด", async () => {
    const { auth } = build();
    const a = await auth.redeem(
      tokenOf((await auth.requestLink("owner@krua.example")).url!),
    );
    const b = await auth.redeem(
      tokenOf((await auth.requestLink("boss@pladang.example")).url!),
    );
    expect(a.scope.pageIds).toEqual(["p1", "p2"]);
    expect(b.scope.pageIds).toEqual(["p9"]);
    // session ของ ข ต้องไม่เห็นเพจของ ก
    expect(b.scope.pageIds).not.toContain("p1");
  });
});

describe("InMemoryThrottle", () => {
  it("นับเฉพาะในหน้าต่างเวลา", async () => {
    const t = new InMemoryThrottle();
    expect(await t.hit("k", 1000, 0)).toBe(1);
    expect(await t.hit("k", 1000, 500)).toBe(2);
    expect(await t.hit("k", 1000, 2000)).toBe(1);
  });
});

describe("InMemoryMagicLinkStore", () => {
  it("consume ครั้งแรกได้ true ครั้งต่อไปได้ false", async () => {
    const s = new InMemoryMagicLinkStore();
    expect(await s.consume("a", START + 1000)).toBe(true);
    expect(await s.consume("a", START + 1000)).toBe(false);
  });
});

describe("ความทนทานของ redeem", () => {
  it("directory ล้มชั่วคราว → ลิงก์ไม่ถูกเผาทิ้ง ใช้ใหม่ได้", async () => {
    // DB สะดุดหนึ่งครั้งไม่ควรทำให้ลูกค้าต้องขอลิงก์ใหม่โดยไม่รู้ว่าทำอะไรผิด
    const dir = new FakeDirectory();
    const { auth } = build(dir);
    const link = await auth.requestLink("owner@krua.example");
    const token = tokenOf(link.url!);

    const original = dir.findByEmail.bind(dir);
    let failed = false;
    dir.findByEmail = async (email: string) => {
      if (!failed) {
        failed = true;
        throw new Error("db down");
      }
      return original(email);
    };

    await expect(auth.redeem(token)).rejects.toThrow("db down");
    // ลองใหม่ตอน DB กลับมา ต้องยังใช้ได้
    await expect(auth.redeem(token)).resolves.toBeDefined();
  });

  it("แต่ยังใช้ซ้ำหลังสำเร็จไม่ได้", async () => {
    const { auth } = build();
    const link = await auth.requestLink("owner@krua.example");
    const token = tokenOf(link.url!);
    await auth.redeem(token);
    await expectThaiRejection(auth.redeem(token));
  });
});
