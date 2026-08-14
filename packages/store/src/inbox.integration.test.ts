/**
 * เทสต์ที่เก็บของ inbox กับ Postgres จริง
 *
 * ข้ามทั้งไฟล์ถ้าไม่ได้ตั้ง `DATABASE_URL` — ดูวิธีตั้งใน `store.integration.test.ts`
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { FakeClock } from "@page-os/core";
import { STANDARD_WINDOW_MS, WebhookProcessor } from "@page-os/inbox";
import type { InboxEvent } from "@page-os/inbox";
import { PrismaInboxStore } from "./inbox-repository.js";

const HAS_DB = Boolean(process.env["DATABASE_URL"]);

/** ชื่อ workspace ประจำไฟล์นี้ — ดูเหตุผลใน `store.integration.test.ts` */
const WORKSPACE_NAME = "vitest-inbox";
const NOW = Date.UTC(2026, 7, 8, 3, 0, 0);
const FB_PAGE = "fb-inbox-a";

const prisma = HAS_DB ? new PrismaClient() : (null as unknown as PrismaClient);

async function seedPage(botEnabled = true): Promise<void> {
  const ws = await prisma.workspace.create({
    data: { name: WORKSPACE_NAME, clientName: "ครัวคุณยาย", slaMinutes: 60 },
  });
  await prisma.page.create({
    data: { workspaceId: ws.id, fbPageId: FB_PAGE, name: "ครัวคุณยาย", botEnabled },
  });
}

const incoming = (mid: string, atMs = NOW): InboxEvent => ({
  type: "message",
  channel: "messenger",
  pageId: FB_PAGE,
  timestampMs: atMs,
  mid,
  senderId: "cust_1",
  recipientId: FB_PAGE,
  contactId: "cust_1",
  text: "สนใจเมนูใหม่ค่ะ",
  attachments: [],
  isEcho: false,
});

describe.skipIf(!HAS_DB)("ที่เก็บของ inbox", () => {
  beforeEach(async () => {
    await prisma.webhookSeen.deleteMany();
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
      await prisma.webhookSeen.deleteMany();
      await prisma.workspace.deleteMany({ where: { name: WORKSPACE_NAME } });
      await prisma.$disconnect();
    }
  });

  describe("กันซ้ำ (กฎข้อ 6)", () => {
    it("จดแล้วจำได้", async () => {
      const store = new PrismaInboxStore({ prisma });
      expect(await store.hasSeen("msg:m_1")).toBe(false);
      await store.markSeen("msg:m_1", NOW);
      expect(await store.hasSeen("msg:m_1")).toBe(true);
    });

    /**
     * worker สองตัวอาจหยิบ event เดิมไปทำพร้อมกัน ตัวที่มาทีหลังต้องไม่พังทั้งงาน
     * เพราะจดซ้ำ — ด่านที่กันซ้ำจริงคือ `hasSeen()` ที่ตรวจก่อนหน้านั้น
     */
    it("จดซ้ำไม่พัง", async () => {
      const store = new PrismaInboxStore({ prisma });
      await store.markSeen("msg:m_1", NOW);
      await expect(store.markSeen("msg:m_1", NOW + 1000)).resolves.toBeUndefined();
    });

    it("จด 8 ครั้งพร้อมกันไม่พัง", async () => {
      const store = new PrismaInboxStore({ prisma });
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => store.markSeen("msg:m_race", NOW)),
      );
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
      expect(await store.hasSeen("msg:m_race")).toBe(true);
    });

    it("ล้างของเก่าได้", async () => {
      const store = new PrismaInboxStore({ prisma });
      await store.markSeen("เก่า", NOW - 40 * 86_400_000);
      await store.markSeen("ใหม่", NOW);
      expect(await store.purgeSeenBefore(NOW - 30 * 86_400_000)).toBe(1);
      expect(await store.hasSeen("เก่า")).toBe(false);
      expect(await store.hasSeen("ใหม่")).toBe(true);
    });
  });

  describe("บทสนทนา", () => {
    it("ทักครั้งแรกสร้างผู้ติดต่อและบทสนทนาให้", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const conv = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });
      expect(conv.pageId).toBe(FB_PAGE);
      expect(conv.contactId).toBe("cust_1");
      expect(conv.unread).toBe(0);
      expect(await prisma.contact.count()).toBe(1);
    });

    it("ทักซ้ำได้บทสนทนาเดิม ไม่สร้างใหม่", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const a = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });
      const b = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });
      expect(b.conversationId).toBe(a.conversationId);
      expect(await prisma.conversation.count()).toBe(1);
    });

    /**
     * คนเดียวกันทักทั้ง Messenger และ IG = คนละบทสนทนา เพราะหน้าต่าง 24 ชม.
     * กับกติกาการส่งของสองช่องทางนี้แยกกันคนละชุด
     */
    it("ช่องทางต่างกัน = คนละบทสนทนา", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const m = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });
      const i = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "ig_1",
        channel: "instagram",
      });
      expect(i.conversationId).not.toBe(m.conversationId);
    });

    /**
     * ได้ webhook ของเพจที่ยังไม่ได้เชื่อม = ตั้งค่าผิดที่ไหนสักแห่ง
     * ต้องดังทันที ไม่ใช่สร้างเพจผีขึ้นมาแล้วเก็บข้อความไว้ในที่ที่ไม่มีใครเปิดดู
     */
    it("เพจที่ไม่มีในระบบ → โยน error พร้อมบอกว่าต้องไปเช็คอะไร", async () => {
      const store = new PrismaInboxStore({ prisma });
      await expect(
        store.upsertConversation({
          pageId: "ไม่มีเพจนี้",
          contactId: "cust_1",
          channel: "messenger",
        }),
      ).rejects.toThrow(/ยังไม่ได้เชื่อม/);
    });

    /**
     * `windowExpiresAt` ไม่ใช่ข้อเท็จจริงแต่เป็นค่าที่คำนวณจาก
     * `lastCustomerMessageAt` ทั้งคู่ต้องถูกเขียนพร้อมกันเสมอ ไม่งั้น badge
     * นับถอยหลังจะบอกว่ายังส่งได้ทั้งที่หมดเวลาไปแล้ว
     */
    it("อัปเดตเวลาลูกค้าทัก → เวลาหมดหน้าต่าง 24 ชม. ขยับตาม", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const conv = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });

      await store.updateConversation(conv.conversationId, {
        lastCustomerMessageAtMs: NOW,
      });
      const row = await prisma.conversation.findUnique({
        where: { id: conv.conversationId },
      });
      expect(row?.lastCustomerMessageAt?.getTime()).toBe(NOW);
      expect(row?.windowExpiresAt?.getTime()).toBe(NOW + STANDARD_WINDOW_MS);
    });

    it("SLA คำนวณจากแพ็กเกจของลูกค้า ไม่ใช่ค่าคงที่", async () => {
      await seedPage(); // slaMinutes = 60
      const store = new PrismaInboxStore({ prisma });
      const conv = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });

      await store.updateConversation(conv.conversationId, { awaitingSinceMs: NOW });
      const row = await prisma.conversation.findUnique({
        where: { id: conv.conversationId },
      });
      expect(row?.slaDueAt?.getTime()).toBe(NOW + 60 * 60_000);
    });

    it("ตอบครบแล้ว → ล้างทั้งเวลาเริ่มรอและกำหนดส่ง", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const conv = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });

      await store.updateConversation(conv.conversationId, { awaitingSinceMs: NOW });
      await store.updateConversation(conv.conversationId, { awaitingSinceMs: null });
      const row = await prisma.conversation.findUnique({
        where: { id: conv.conversationId },
      });
      expect(row?.awaitingSince).toBeNull();
      expect(row?.slaDueAt).toBeNull();
    });

    it("อ่านบทสนทนากลับมาได้ค่าที่เพิ่งเขียนไป", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const conv = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });
      await store.updateConversation(conv.conversationId, {
        lastCustomerMessageAtMs: NOW,
        awaitingSinceMs: NOW,
        botPausedUntilMs: NOW + 600_000,
        unread: 3,
      });

      const again = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });
      expect(again.lastCustomerMessageAtMs).toBe(NOW);
      expect(again.awaitingSinceMs).toBe(NOW);
      expect(again.botPausedUntilMs).toBe(NOW + 600_000);
      expect(again.unread).toBe(3);
    });
  });

  describe("ข้อความ", () => {
    it("บันทึกแล้วอ่านกลับได้", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const conv = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });

      await store.appendMessage({
        conversationId: conv.conversationId,
        mid: "m_1",
        direction: "inbound",
        sentBy: "human",
        body: "สนใจเมนูใหม่ค่ะ",
        attachments: [{ type: "image", url: "https://x/1.jpg" }],
        createdAtMs: NOW,
      });

      const row = await prisma.message.findUnique({ where: { mid: "m_1" } });
      expect(row?.body).toBe("สนใจเมนูใหม่ค่ะ");
      expect(row?.createdAt.getTime()).toBe(NOW);
      expect(row?.attachments).toEqual([{ type: "image", url: "https://x/1.jpg" }]);
    });

    /** Meta ส่งข้อความเดิมซ้ำได้ — ต้องไม่เกิดสองแถวและต้องไม่พัง (กฎข้อ 6) */
    it("บันทึก mid เดิมซ้ำ → ไม่พัง และไม่เกิดแถวที่สอง", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const conv = await store.upsertConversation({
        pageId: FB_PAGE,
        contactId: "cust_1",
        channel: "messenger",
      });
      const args = {
        conversationId: conv.conversationId,
        mid: "m_dup",
        direction: "inbound" as const,
        sentBy: "human" as const,
        body: "ทักซ้ำ",
        createdAtMs: NOW,
      };

      await store.appendMessage(args);
      await expect(store.appendMessage(args)).resolves.toBeUndefined();
      expect(await prisma.message.count({ where: { mid: "m_dup" } })).toBe(1);
    });
  });

  describe("Kill Switch", () => {
    it("อ่านสถานะบอทของเพจได้", async () => {
      await seedPage(false);
      expect(await new PrismaInboxStore({ prisma }).isBotEnabled(FB_PAGE)).toBe(false);
    });

    /**
     * เพจที่ไม่รู้จักต้องปิดไว้ก่อน — ถ้าคืน true บอทจะไปตอบแทนเพจที่เราไม่รู้จัก
     * ซึ่งเป็นสิ่งที่อธิบายกับลูกค้ายากที่สุด
     */
    it("เพจที่ไม่มีในระบบ → ถือว่าปิด", async () => {
      expect(
        await new PrismaInboxStore({ prisma }).isBotEnabled("ไม่มีเพจนี้"),
      ).toBe(false);
    });
  });

  /**
   * เส้นทางเต็มของ event หนึ่งใบ ผ่าน `WebhookProcessor` ตัวจริงลงฐานข้อมูลจริง
   * — ส่วนที่เทสต์ในหน่วยความจำพิสูจน์ไม่ได้คือรอยต่อระหว่างสองชั้นนี้
   */
  describe("ต่อกับ WebhookProcessor ตัวจริง", () => {
    it("ข้อความจากลูกค้า → มีบทสนทนา มีข้อความ และหน้าต่าง 24 ชม. เดิน", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const processor = new WebhookProcessor({ store, clock: new FakeClock(NOW) });

      const [result] = await processor.processAll([incoming("m_1")]);
      expect(result?.skipped).toBeUndefined();

      const conv = await prisma.conversation.findFirst();
      expect(conv?.lastCustomerMessageAt?.getTime()).toBe(NOW);
      expect(conv?.windowExpiresAt?.getTime()).toBe(NOW + STANDARD_WINDOW_MS);
      expect(await prisma.message.count()).toBe(1);
    });

    /** Meta ส่ง event เดิมซ้ำ — ด่านสุดท้ายอยู่ที่ `hasSeen()` ใน DB */
    it("event เดิมส่งมาซ้ำ → ประมวลผลครั้งเดียว", async () => {
      await seedPage();
      const store = new PrismaInboxStore({ prisma });
      const processor = new WebhookProcessor({ store, clock: new FakeClock(NOW) });

      await processor.processAll([incoming("m_1")]);
      const [second] = await processor.processAll([incoming("m_1")]);

      expect(second?.skipped).toBeDefined();
      expect(await prisma.message.count()).toBe(1);
    });
  });
});
