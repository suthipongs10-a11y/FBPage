/**
 * เทสต์ที่รันกับ Postgres จริง
 *
 * ข้ามทั้งไฟล์ถ้าไม่ได้ตั้ง `DATABASE_URL` — เครื่องที่ไม่มีฐานข้อมูลยังรัน
 * `pnpm check` ผ่านได้ ส่วนเครื่องที่มีจะได้ตรวจของจริง
 *
 * ตั้งฐานข้อมูลสำหรับเทสต์:
 *   createdb pageos_test
 *   DATABASE_URL=postgresql://.../pageos_test pnpm --filter @page-os/db db:push
 *   DATABASE_URL=postgresql://.../pageos_test pnpm test
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AlertCenter, AuditLog, type Actor } from "@page-os/ops";
import { FakeClock } from "@page-os/core";
import { PrismaPageTokenRepository } from "./token-repository.js";
import { PrismaAlertStore, PrismaAuditStore } from "./ops-repository.js";
import { PrismaMagicLinkStore } from "./portal-repository.js";
import { PrismaCallLog } from "./call-log.js";

const HAS_DB = Boolean(process.env["DATABASE_URL"]);

/**
 * ชื่อ workspace ประจำไฟล์นี้
 *
 * vitest รันแต่ละไฟล์พร้อมกัน และไฟล์เทสต์ที่ต่อ DB มีมากกว่าหนึ่งไฟล์
 * ถ้าล้างตารางแบบเหมารวม (`workspace.deleteMany()` เปล่าๆ) ไฟล์หนึ่งจะลบ
 * ข้อมูลของอีกไฟล์กลางคัน แล้วเทสต์จะล้มแบบสุ่ม — ซึ่งหาสาเหตุยากมาก
 * เพราะรันซ้ำทีละไฟล์แล้วผ่านทุกครั้ง
 *
 * แต่ละไฟล์จึงล้างเฉพาะ workspace ของตัวเอง (ที่เหลือถูกลบต่อแบบ cascade)
 */
const WORKSPACE_NAME = "vitest-store";
const START = Date.UTC(2026, 7, 8, 3, 0, 0);
const HOUR = 3_600_000;

const prisma = HAS_DB ? new PrismaClient() : (null as unknown as PrismaClient);

/** สร้าง workspace + เพจสองใบ คืนรหัส Facebook ของทั้งคู่ */
async function seedPages(): Promise<{ fbA: string; fbB: string }> {
  const ws = await prisma.workspace.create({
    data: { name: WORKSPACE_NAME, clientName: "ครัวคุณยาย" },
  });
  const fbA = `fb-${Math.abs(START)}-a`;
  const fbB = `fb-${Math.abs(START)}-b`;
  await prisma.page.create({
    data: { workspaceId: ws.id, fbPageId: fbA, name: "เพจ ก" },
  });
  await prisma.page.create({
    data: { workspaceId: ws.id, fbPageId: fbB, name: "เพจ ข" },
  });
  return { fbA, fbB };
}

describe.skipIf(!HAS_DB)("ที่เก็บข้อมูลจริง", () => {
  beforeEach(async () => {
    // ตารางที่ไม่ผูกกับ workspace — ไฟล์นี้เป็นไฟล์เดียวที่ใช้ จึงล้างเหมาได้
    await prisma.metaCallLog.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.alertState.deleteMany();
    await prisma.usedMagicLink.deleteMany();
    // ที่เหลือลบเฉพาะของไฟล์นี้ — เพจ/token ถูกลบต่อแบบ cascade
    await prisma.workspace.deleteMany({ where: { name: WORKSPACE_NAME } });
  });

  /**
   * ⚠️ ต้องล้างใน `afterAll` ด้วย ไม่ใช่แค่ `beforeEach`
   *
   * ล้างแค่ก่อนเทสต์แต่ละตัว = ข้อมูลของเทสต์**ตัวสุดท้าย**ค้างอยู่ในฐานข้อมูล
   * ตลอดไป ตอนที่หน้าจอยังอ่านข้อมูลตัวอย่างเรื่องนี้ไม่มีใครเห็น แต่ตอนนี้
   * `/`, `/pages`, `/inbox`, `/calendar` อ่านของจริงแล้ว — คนที่รัน
   * `pnpm check` บนเครื่องตัวเองจะเห็น "เพจ ก" "ครัวคุณยาย" โผล่บนหน้าแรก
   * พร้อมรายการปัญหาปลอม ทั้งที่ยังไม่ได้เชื่อมเพจอะไรเลย
   *
   * (นี่คืออาการเดียวกับที่เคยทำให้ต้องมีป้าย "ข้อมูลตัวอย่าง" — กลับมาทาง
   * ประตูอื่น)
   */
  afterAll(async () => {
    if (HAS_DB) {
      await prisma.metaCallLog.deleteMany();
      await prisma.auditLog.deleteMany();
      await prisma.alertState.deleteMany();
      await prisma.usedMagicLink.deleteMany();
      await prisma.workspace.deleteMany({ where: { name: WORKSPACE_NAME } });
      await prisma.$disconnect();
    }
  });

  describe("PrismaPageTokenRepository", () => {
    it("เก็บแล้วอ่านกลับได้ครบทุกฟิลด์", async () => {
      const { fbA } = await seedPages();
      const repo = new PrismaPageTokenRepository(prisma);

      await repo.upsert({
        pageId: fbA,
        encryptedToken: "v1.k1.iv.tag.ct",
        tokenType: "page",
        scopes: ["pages_manage_posts", "pages_messaging"],
        expiresAtMs: START + 60 * 86_400_000,
        status: "active",
        statusReason: "ตรวจล่าสุดผ่าน",
        lastCheckedAtMs: START,
      });

      const row = await repo.findByPageId(fbA);
      expect(row).not.toBeNull();
      expect(row!.encryptedToken).toBe("v1.k1.iv.tag.ct");
      expect(row!.scopes).toEqual(["pages_manage_posts", "pages_messaging"]);
      expect(row!.expiresAtMs).toBe(START + 60 * 86_400_000);
      expect(row!.lastCheckedAtMs).toBe(START);
    });

    it("คืนรหัสเพจของ Facebook ไม่ใช่ UUID ภายใน", async () => {
      // AAD ตอนถอดรหัสผูกกับรหัสของ Facebook — คืน UUID มาจะถอดรหัสไม่ออก
      const { fbA } = await seedPages();
      const repo = new PrismaPageTokenRepository(prisma);
      await repo.upsert({
        pageId: fbA,
        encryptedToken: "x",
        tokenType: "page",
        scopes: [],
        expiresAtMs: null,
        status: "active",
      });

      const row = await repo.findByPageId(fbA);
      expect(row!.pageId).toBe(fbA);
      expect(row!.pageId).not.toMatch(/^[0-9a-f]{8}-/);
    });

    it("token ของคนละเพจไม่ปนกัน", async () => {
      const { fbA, fbB } = await seedPages();
      const repo = new PrismaPageTokenRepository(prisma);
      const base = {
        tokenType: "page" as const,
        scopes: [],
        expiresAtMs: null,
        status: "active" as const,
      };
      await repo.upsert({ ...base, pageId: fbA, encryptedToken: "ของเพจ ก" });
      await repo.upsert({ ...base, pageId: fbB, encryptedToken: "ของเพจ ข" });

      expect((await repo.findByPageId(fbA))!.encryptedToken).toBe("ของเพจ ก");
      expect((await repo.findByPageId(fbB))!.encryptedToken).toBe("ของเพจ ข");
    });

    it("upsert ซ้ำ = แทนที่ ไม่ใช่เพิ่มแถวใหม่", async () => {
      const { fbA } = await seedPages();
      const repo = new PrismaPageTokenRepository(prisma);
      const base = {
        pageId: fbA,
        tokenType: "page" as const,
        scopes: [],
        expiresAtMs: null,
        status: "active" as const,
      };
      await repo.upsert({ ...base, encryptedToken: "เก่า" });
      await repo.upsert({ ...base, encryptedToken: "ใหม่" });

      expect(await prisma.pageToken.count()).toBe(1);
      expect((await repo.findByPageId(fbA))!.encryptedToken).toBe("ใหม่");
    });

    it("เพจที่ยังไม่มีในระบบ → error ไทยที่บอกว่าต้องทำอะไรก่อน", async () => {
      const repo = new PrismaPageTokenRepository(prisma);
      await expect(
        repo.upsert({
          pageId: "ไม่มีเพจนี้",
          encryptedToken: "x",
          tokenType: "page",
          scopes: [],
          expiresAtMs: null,
          status: "active",
        }),
      ).rejects.toThrow(/ต้องสร้างแถว Page ก่อน/);
    });

    it("เพจที่ยังไม่มี token → คืน null ไม่ใช่ error", async () => {
      const { fbA } = await seedPages();
      const repo = new PrismaPageTokenRepository(prisma);
      expect(await repo.findByPageId(fbA)).toBeNull();
    });

    it("updateStatus แก้เฉพาะเพจที่ระบุ", async () => {
      const { fbA, fbB } = await seedPages();
      const repo = new PrismaPageTokenRepository(prisma);
      const base = {
        tokenType: "page" as const,
        scopes: [],
        expiresAtMs: null,
        status: "active" as const,
        encryptedToken: "x",
      };
      await repo.upsert({ ...base, pageId: fbA });
      await repo.upsert({ ...base, pageId: fbB });

      await repo.updateStatus(fbA, "expired", "token หมดอายุแล้ว", START);

      expect((await repo.findByPageId(fbA))!.status).toBe("expired");
      expect((await repo.findByPageId(fbA))!.statusReason).toBe(
        "token หมดอายุแล้ว",
      );
      expect((await repo.findByPageId(fbB))!.status).toBe("active");
    });

    it("listAll คืนรหัสของ Facebook ทุกแถว", async () => {
      const { fbA, fbB } = await seedPages();
      const repo = new PrismaPageTokenRepository(prisma);
      const base = {
        tokenType: "page" as const,
        scopes: [],
        expiresAtMs: null,
        status: "active" as const,
        encryptedToken: "x",
      };
      await repo.upsert({ ...base, pageId: fbA });
      await repo.upsert({ ...base, pageId: fbB });

      const all = await repo.listAll();
      expect(all.map((r) => r.pageId).sort()).toEqual([fbA, fbB].sort());
    });
  });

  describe("PrismaAuditStore", () => {
    const ME: Actor = { kind: "human", id: "tanakon@example.com" };

    it("บันทึกแล้วอ่านกลับได้ พร้อมเวลาที่โดเมนกำหนด ไม่ใช่ now() ของ DB", async () => {
      const store = new PrismaAuditStore(prisma);
      const log = new AuditLog({ store, clock: new FakeClock(START) });
      await log.record({
        actor: ME,
        action: "post.publish",
        pageId: "fb-1",
        targetId: "post-9",
        th: "โพสต์ขึ้นเพจแล้ว",
      });

      const [e] = await log.query();
      expect(e!.atMs).toBe(START);
      expect(e!.actor).toEqual(ME);
      expect(e!.pageId).toBe("fb-1");
      expect(e!.targetId).toBe("post-9");
      expect(e!.th).toBe("โพสต์ขึ้นเพจแล้ว");
    });

    it("actor ที่มี : อยู่ใน id แปลงกลับได้ถูก", async () => {
      // "worker:publish" มี : อยู่แล้ว ถ้าตัดผิดจะกลายเป็น kind ผิด
      const store = new PrismaAuditStore(prisma);
      const log = new AuditLog({ store, clock: new FakeClock(START) });
      await log.record({
        actor: { kind: "system", id: "worker:publish" },
        action: "a",
        th: "x",
      });

      const [e] = await log.query();
      expect(e!.actor).toEqual({ kind: "system", id: "worker:publish" });
    });

    it("เก็บ changes ที่ scrub แล้วลงไปด้วย", async () => {
      const store = new PrismaAuditStore(prisma);
      const log = new AuditLog({ store, clock: new FakeClock(START) });
      await log.record({
        actor: ME,
        action: "settings.update",
        th: "แก้ค่า",
        changes: [{ field: "slaMinutes", before: 240, after: 60 }],
      });

      const [e] = await log.query();
      expect(e!.changes).toEqual([
        { field: "slaMinutes", before: 240, after: 60 },
      ]);
    });

    it("token ไม่หลุดลง DB แม้จะส่งเข้ามาในค่าที่เปลี่ยน (กฎข้อ 3)", async () => {
      const store = new PrismaAuditStore(prisma);
      const log = new AuditLog({ store, clock: new FakeClock(START) });
      await log.record({
        actor: ME,
        action: "settings.update",
        th: "แก้ค่า",
        changes: [
          {
            field: "accessToken",
            before: "EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            after: "EAAyyyyyyyyyyyyyyyyyyyyyyyyyy",
          },
        ],
      });

      const rows = await prisma.auditLog.findMany();
      const raw = JSON.stringify(rows);
      expect(raw).not.toContain("EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
      expect(raw).not.toContain("EAAyyyyyyyyyyyyyyyyyyyyyyyyyy");
    });

    it("กรองตามเพจ ตามคนทำ และตามช่วงเวลา", async () => {
      const store = new PrismaAuditStore(prisma);
      const clock = new FakeClock(START);
      const log = new AuditLog({ store, clock });
      await log.record({ actor: ME, action: "a", pageId: "fb-1", th: "หนึ่ง" });
      await clock.advance(HOUR);
      await log.record({
        actor: { kind: "client", id: "owner@example.com" },
        action: "b",
        pageId: "fb-2",
        th: "สอง",
      });

      expect((await log.query({ pageId: "fb-1" })).map((e) => e.th)).toEqual([
        "หนึ่ง",
      ]);
      expect(
        (await log.query({ actorId: "owner@example.com" })).map((e) => e.th),
      ).toEqual(["สอง"]);
      expect(
        (await log.query({ fromMs: START + 1 })).map((e) => e.th),
      ).toEqual(["สอง"]);
    });

    it("ใหม่สุดขึ้นก่อน", async () => {
      const store = new PrismaAuditStore(prisma);
      const clock = new FakeClock(START);
      const log = new AuditLog({ store, clock });
      await log.record({ actor: ME, action: "a", th: "เก่า" });
      await clock.advance(HOUR);
      await log.record({ actor: ME, action: "a", th: "ใหม่" });

      expect((await log.query()).map((e) => e.th)).toEqual(["ใหม่", "เก่า"]);
    });

    it("purge ลบของเก่าและบันทึกตัวเอง", async () => {
      const store = new PrismaAuditStore(prisma);
      const clock = new FakeClock(START);
      const log = new AuditLog({ store, clock });
      await log.record({ actor: ME, action: "old", th: "เก่า" });
      await clock.advance(100 * 86_400_000);

      const removed = await log.purge(90 * 86_400_000, ME);
      expect(removed).toBe(1);
      const left = await log.query();
      expect(left.map((e) => e.action)).toEqual(["audit.purge"]);
    });
  });

  describe("PrismaAlertStore", () => {
    it("Alert Center ทำงานได้บนที่เก็บจริง และไม่เตือนซ้ำหลังรีสตาร์ท", async () => {
      // นี่คือเหตุผลที่ alert state ต้องอยู่ใน DB: worker รีสตาร์ทแล้ว
      // ต้องไม่ยิงแจ้งเตือนทุกเรื่องซ้ำใหม่หมด
      const sent: string[] = [];
      const sink = {
        async send(m: { th: string }): Promise<void> {
          sent.push(m.th);
        },
      };
      const problem = {
        id: "token:fb-1",
        severity: "critical" as const,
        kind: "token" as const,
        pageId: "fb-1",
        pageName: "ครัวคุณยาย",
        clientName: "ครัวคุณยาย",
        colorIndex: 0,
        th: "หมดอายุแล้ว",
      };

      const first = new AlertCenter({
        store: new PrismaAlertStore(prisma),
        sink,
        clock: new FakeClock(START),
      });
      await first.run([problem]);
      expect(sent).toHaveLength(1);

      // จำลองการรีสตาร์ท: สร้างตัวใหม่ทั้งหมด อ่านสถานะจาก DB
      const afterRestart = new AlertCenter({
        store: new PrismaAlertStore(prisma),
        sink,
        clock: new FakeClock(START + 60_000),
      });
      await afterRestart.run([problem]);
      expect(sent).toHaveLength(1);
    });

    it("ลบสถานะที่ไม่มีอยู่ ไม่ throw", async () => {
      // worker สองตัวอาจรันทับกันแล้วต่างคนต่างลบเรื่องเดียวกัน
      const store = new PrismaAlertStore(prisma);
      await expect(store.remove("ไม่มีอยู่")).resolves.toBeUndefined();
    });

    it("เก็บ peakSeverity ไว้ข้ามรอบ", async () => {
      const store = new PrismaAlertStore(prisma);
      await store.put({
        problemId: "p1",
        firstSeenAtMs: START,
        lastSentAtMs: START,
        sendCount: 1,
        lastSeverity: "warning",
        peakSeverity: "critical",
        lastTh: "x",
        pageName: "เพจ",
      });
      const [s] = await store.listOpen();
      expect(s!.peakSeverity).toBe("critical");
      expect(s!.lastSeverity).toBe("warning");
    });
  });

  describe("PrismaMagicLinkStore", () => {
    it("ใช้ครั้งแรกได้ ครั้งที่สองไม่ได้", async () => {
      const store = new PrismaMagicLinkStore(prisma);
      expect(await store.consume("jti-1", START + HOUR)).toBe(true);
      expect(await store.consume("jti-1", START + HOUR)).toBe(false);
    });

    it("เปิดลิงก์เดียวกันพร้อมกันหลายแท็บ → ผ่านได้แค่หนึ่ง", async () => {
      // นี่คือข้อที่ที่เก็บในหน่วยความจำพิสูจน์ไม่ได้ — ต้องให้ฐานข้อมูล
      // เป็นคนตัดสินด้วย unique constraint ไม่ใช่ "อ่านก่อนแล้วค่อยเขียน"
      const store = new PrismaMagicLinkStore(prisma);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => store.consume("แข่งกัน", START + HOUR)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("ล้างลิงก์ที่หมดอายุแล้ว", async () => {
      const store = new PrismaMagicLinkStore(prisma);
      await store.consume("เก่า", START - HOUR);
      await store.consume("ใหม่", START + HOUR);

      expect(await store.purgeExpired(START)).toBe(1);
      expect(await prisma.usedMagicLink.count()).toBe(1);
    });
  });

  describe("PrismaCallLog", () => {
    const entry = {
      pageId: "fb-1",
      method: "POST" as const,
      path: "/{page-id}/feed",
      httpStatus: 200,
      ok: true,
      durationMs: 412.7,
      attempts: 1,
      priority: "normal" as const,
      startedAtMs: START,
    };

    it("บันทึกลง DB จริง", async () => {
      const log = new PrismaCallLog({ prisma });
      log.record(entry);
      await log.flush();

      const [row] = await prisma.metaCallLog.findMany();
      expect(row!.path).toBe("/{page-id}/feed");
      expect(row!.durationMs).toBe(413);
      expect(row!.createdAt.getTime()).toBe(START);
    });

    it("record ไม่คืน promise และไม่บล็อกผู้เรียก", () => {
      // สัญญาของ interface: ห้ามโยน ห้ามบล็อก — ถ้าโยน retry loop จะยิงซ้ำ
      const log = new PrismaCallLog({ prisma });
      expect(log.record(entry)).toBeUndefined();
    });

    it("เขียนไม่สำเร็จ → กลืน error แต่นับไว้", async () => {
      // ใช้ตัวเชื่อมปลอมที่ล้มเสมอ แทนที่จะพยายามทำให้ Postgres ปฏิเสธ —
      // คอลัมน์ในตารางนี้เป็น text ที่ไม่จำกัดความยาว การยัดค่าประหลาดจึงไม่ล้ม
      // และสิ่งที่ต้องพิสูจน์คือ "พฤติกรรมตอนที่เขียนล้ม" ไม่ใช่ "อะไรทำให้ล้ม"
      const broken = {
        metaCallLog: {
          create: async (): Promise<never> => {
            throw new Error("db down");
          },
        },
      } as unknown as typeof prisma;

      const log = new PrismaCallLog({ prisma: broken });
      expect(() => log.record(entry)).not.toThrow();
      await log.flush();
      expect(log.droppedCount).toBe(1);
    });

    it("flush รอให้งานที่ค้างเสร็จ — ไม่งั้น log ท้ายรอบหาย", async () => {
      // นับเฉพาะแถวของเทสต์นี้ ไม่ใช่ทั้งตาราง — เทสต์ก่อนหน้าจงใจ record()
      // แล้วไม่ flush เพื่อพิสูจน์ว่ามันไม่บล็อก แถวนั้นจึงลงมาถึงหลัง
      // beforeEach ล้างตารางไปแล้วได้ ทำให้นับรวมกันแล้วเกิน
      const path = "/{page-id}/flush-test";
      const log = new PrismaCallLog({ prisma });
      for (let i = 0; i < 5; i++) log.record({ ...entry, path, attempts: i + 1 });
      await log.flush();
      expect(await prisma.metaCallLog.count({ where: { path } })).toBe(5);
    });
  });
});
