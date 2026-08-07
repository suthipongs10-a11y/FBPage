import { describe, expect, it } from "vitest";
import { FakeClock, Keyring, createLogger, type LogRecord } from "@page-os/core";
import {
  EncryptedTokenStore,
  InMemoryPageTokenRepository,
} from "./token-store.js";

const ring = new Keyring([{ keyId: "k1", key: Buffer.alloc(32, 7) }]);
const NOW = 1_700_000_000_000;
const PLAIN = "EAAGm0PX4ZCpsBAxxxxxxxxxxxxxxxxxxxxxZDZD";

function setup(opts: { cacheTtlMs?: number } = {}) {
  const repo = new InMemoryPageTokenRepository();
  const clock = new FakeClock(NOW);
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    clock,
    sink: (r) => records.push(r),
  });
  const store = new EncryptedTokenStore({
    repo,
    keyring: ring,
    clock,
    logger,
    ...(opts.cacheTtlMs !== undefined ? { cacheTtlMs: opts.cacheTtlMs } : {}),
  });
  return { repo, store, clock, records };
}

describe("EncryptedTokenStore — เก็บแบบเข้ารหัส (กฎข้อ 3)", () => {
  it("บันทึกแล้วอ่านกลับได้ token เดิม", async () => {
    const { store } = setup();
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "page",
      scopes: ["pages_show_list"],
    });
    const t = await store.getPageToken("p1");
    expect(t?.accessToken).toBe(PLAIN);
    expect(t?.scopes).toEqual(["pages_show_list"]);
    expect(t?.tokenType).toBe("page");
  });

  it("สิ่งที่เก็บใน repo ต้องเป็น ciphertext ไม่ใช่ plaintext", async () => {
    const { store, repo } = setup();
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "page",
      scopes: [],
    });
    const row = repo.raw("p1")!;
    expect(row.encryptedToken).not.toContain(PLAIN);
    expect(row.encryptedToken).not.toContain(PLAIN.slice(0, 10));
    expect(row.encryptedToken.startsWith("v1.k1.")).toBe(true);
    // ทั้งแถวไม่ควรมี plaintext อยู่เลย
    expect(JSON.stringify(row)).not.toContain(PLAIN);
  });

  it("ก๊อป ciphertext ของเพจอื่นมาแปะใน DB แล้วใช้ไม่ได้ (AAD ผูกกับ pageId)", async () => {
    const { store, repo, records } = setup();
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "page",
      scopes: [],
    });
    const stolen = repo.raw("p1")!.encryptedToken;

    await repo.upsert({
      pageId: "p2",
      encryptedToken: stolen,
      tokenType: "page",
      scopes: [],
      expiresAtMs: null,
      status: "active",
    });

    expect(await store.getPageToken("p2")).toBeNull();
    expect(records.some((r) => r.msg.includes("ถอดรหัส"))).toBe(true);
  });

  it("ไม่มีแถว → null", async () => {
    const { store } = setup();
    expect(await store.getPageToken("ไม่มี")).toBeNull();
  });

  it("ถอดรหัสไม่ได้ (key หาย/ข้อมูลถูกแก้) → null พร้อม log ระดับ error", async () => {
    const { store, repo, records } = setup();
    await repo.upsert({
      pageId: "p1",
      encryptedToken: "v1.k1.aaa.bbb.ccc",
      tokenType: "page",
      scopes: [],
      expiresAtMs: null,
      status: "active",
    });
    expect(await store.getPageToken("p1")).toBeNull();
    expect(records.some((r) => r.level === "error")).toBe(true);
  });
});

describe("EncryptedTokenStore — สถานะและวันหมดอายุ", () => {
  it("ไม่คืน token ที่สถานะ revoked / expired", async () => {
    for (const status of ["revoked", "expired"] as const) {
      const { store, repo } = setup();
      await store.save({
        pageId: "p1",
        accessToken: PLAIN,
        tokenType: "page",
        scopes: [],
      });
      await repo.updateStatus("p1", status, "เหตุผล", NOW);
      store.clearCache();
      expect(await store.getPageToken("p1"), status).toBeNull();
    }
  });

  it("ยังคืน token ที่ใกล้หมดอายุ (ยังใช้ได้อยู่)", async () => {
    const { store, repo } = setup();
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "page",
      scopes: [],
      expiresAtMs: NOW + 86_400_000,
    });
    await repo.updateStatus("p1", "expiring_soon", "ใกล้หมด", NOW);
    store.clearCache();
    expect((await store.getPageToken("p1"))?.accessToken).toBe(PLAIN);
  });

  it("ไม่คืน token ที่เลยเวลาหมดอายุ แม้ status จะยังไม่อัปเดต", async () => {
    const { store, repo } = setup();
    await repo.upsert({
      pageId: "p1",
      encryptedToken: "x",
      tokenType: "page",
      scopes: [],
      expiresAtMs: NOW - 1000,
      status: "active", // status ค้างอยู่ที่ active
    });
    expect(await store.getPageToken("p1")).toBeNull();
  });

  it("expiresAtMs = null → ไม่หมดอายุ (System User Token)", async () => {
    const { store } = setup();
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "system_user",
      scopes: [],
      expiresAtMs: null,
    });
    const t = await store.getPageToken("p1");
    expect(t?.accessToken).toBe(PLAIN);
    expect(t?.expiresAtMs).toBeUndefined();
  });

  it("markInvalid เปลี่ยนสถานะเป็น revoked และหยุดคืน token ทันที", async () => {
    const { store, repo } = setup();
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "page",
      scopes: [],
    });
    expect(await store.getPageToken("p1")).not.toBeNull();

    await store.markInvalid("p1", "token ถูกเพิกถอน");

    expect(repo.raw("p1")!.status).toBe("revoked");
    expect(repo.raw("p1")!.statusReason).toBe("token ถูกเพิกถอน");
    // ต้องล้าง cache ด้วย ไม่งั้นจะยังยิงด้วย token ที่ตายแล้วต่ออีกเป็นนาที
    expect(await store.getPageToken("p1")).toBeNull();
  });
});

describe("EncryptedTokenStore — cache", () => {
  it("ไม่ยิง repo ซ้ำภายในอายุ cache", async () => {
    const { store, repo } = setup({ cacheTtlMs: 60_000 });
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "page",
      scopes: [],
    });

    let hits = 0;
    const orig = repo.findByPageId.bind(repo);
    repo.findByPageId = async (id: string) => {
      hits++;
      return orig(id);
    };

    await store.getPageToken("p1");
    await store.getPageToken("p1");
    await store.getPageToken("p1");
    expect(hits).toBe(1);
  });

  it("cache หมดอายุแล้วอ่านใหม่", async () => {
    const { store, repo, clock } = setup({ cacheTtlMs: 1000 });
    await store.save({
      pageId: "p1",
      accessToken: PLAIN,
      tokenType: "page",
      scopes: [],
    });
    let hits = 0;
    const orig = repo.findByPageId.bind(repo);
    repo.findByPageId = async (id: string) => {
      hits++;
      return orig(id);
    };

    await store.getPageToken("p1");
    await clock.advance(1001);
    await store.getPageToken("p1");
    expect(hits).toBe(2);
  });

  it("cache ผลลัพธ์ null ด้วย กันยิง DB รัวเวลาไม่มี token", async () => {
    const { store, repo } = setup({ cacheTtlMs: 60_000 });
    let hits = 0;
    const orig = repo.findByPageId.bind(repo);
    repo.findByPageId = async (id: string) => {
      hits++;
      return orig(id);
    };
    await store.getPageToken("ไม่มี");
    await store.getPageToken("ไม่มี");
    expect(hits).toBe(1);
  });

  it("save ล้าง cache ให้อ่านค่าใหม่ทันที", async () => {
    const { store } = setup({ cacheTtlMs: 600_000 });
    await store.save({
      pageId: "p1",
      accessToken: "OLD",
      tokenType: "page",
      scopes: [],
    });
    expect((await store.getPageToken("p1"))?.accessToken).toBe("OLD");

    await store.save({
      pageId: "p1",
      accessToken: "NEW",
      tokenType: "page",
      scopes: [],
    });
    expect((await store.getPageToken("p1"))?.accessToken).toBe("NEW");
  });
});

describe("EncryptedTokenStore — listForHealthCheck", () => {
  it("คืน token ที่ถอดรหัสแล้วทุกเพจ", async () => {
    const { store } = setup();
    await store.save({
      pageId: "p1",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
    });
    await store.save({
      pageId: "p2",
      accessToken: "T2",
      tokenType: "system_user",
      scopes: [],
    });

    const list = await store.listForHealthCheck();
    expect(list).toHaveLength(2);
    expect(list.map((x) => x.token).sort()).toEqual(["T1", "T2"]);
  });

  it("ข้ามเพจที่ถอดรหัสไม่ได้ แทนที่จะพังทั้งชุด", async () => {
    const { store, repo, records } = setup();
    await store.save({
      pageId: "ok",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
    });
    await repo.upsert({
      pageId: "พัง",
      encryptedToken: "ขยะ",
      tokenType: "page",
      scopes: [],
      expiresAtMs: null,
      status: "active",
    });

    const list = await store.listForHealthCheck();
    expect(list.map((x) => x.pageId)).toEqual(["ok"]);
    expect(records.some((r) => r.level === "error")).toBe(true);
  });

  it("รวมเพจที่ revoked ด้วย เพื่อให้ตรวจซ้ำได้ว่ากลับมาใช้ได้หรือยัง", async () => {
    const { store } = setup();
    await store.save({
      pageId: "p1",
      accessToken: "T1",
      tokenType: "page",
      scopes: [],
      status: "revoked",
    });
    expect(await store.listForHealthCheck()).toHaveLength(1);
  });
});
