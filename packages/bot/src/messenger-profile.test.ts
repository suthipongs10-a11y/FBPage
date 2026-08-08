import { describe, expect, it } from "vitest";
import { FakeClock } from "@page-os/core";
import { expectThaiThrow } from "@page-os/core/testing";
import { MetaGateway } from "@page-os/meta";
import { FakeFetch, FakeTokenStore } from "@page-os/meta/test-helpers";
import {
  MAX_ICE_BREAKERS,
  MessengerProfileService,
  ProfileConfigError,
  buildProfilePayload,
  suggestIceBreakers,
} from "./messenger-profile.js";
import { defaultConfig } from "./tone.js";

const CONFIG = defaultConfig("p1", "ร้านกาแฟดีดี", {
  welcomeMessage: "ยินดีต้อนรับสู่{ชื่อร้าน}{ค่ะ}",
  iceBreakers: [
    { question: "ร้านเปิดกี่โมง", payload: "RULE:hours" },
    { question: "ค่าส่งเท่าไหร่", payload: "RULE:delivery" },
  ],
});

function setup() {
  const clock = new FakeClock(1_700_000_000_000);
  const fetchImpl = new FakeFetch();
  const gateway = new MetaGateway(
    {
      appId: "APP",
      appSecret: "SECRET",
      graphVersion: "v25.0",
      rateLimit: { burst: 100, refillPerSec: 100 },
    },
    {
      tokenStore: new FakeTokenStore({ p1: "T1" }),
      clock,
      fetchImpl: fetchImpl.fn,
      random: () => 0,
    },
  );
  return { fetch: fetchImpl, svc: new MessengerProfileService(gateway) };
}

describe("buildProfilePayload", () => {
  it("ประกอบ greeting และ ice breakers พร้อมโทนของเพจ", () => {
    const p = buildProfilePayload(CONFIG);
    expect(p.greeting![0]!.text).toBe("ยินดีต้อนรับสู่ร้านกาแฟดีดีค่ะ");
    expect(p.ice_breakers).toHaveLength(2);
    expect(p.ice_breakers![0]!.payload).toBe("RULE:hours");
  });

  it("ไม่มีอะไรตั้งไว้ → payload ว่าง", () => {
    expect(buildProfilePayload(defaultConfig("p1", "ร้าน"))).toEqual({});
  });

  it("เกิน 4 ข้อ → error ภาษาไทยบอกเพดานของ Meta", () => {
    const cfg = defaultConfig("p1", "ร้าน", {
      iceBreakers: Array.from({ length: 5 }, (_, i) => ({
        question: `คำถาม ${i}`,
        payload: `P${i}`,
      })),
    });
    const err = expectThaiThrow(() => buildProfilePayload(cfg));
    expect(err.th).toContain(String(MAX_ICE_BREAKERS));
  });

  it("คำถามยาวเกินถูกปฏิเสธก่อนยิง", () => {
    const cfg = defaultConfig("p1", "ร้าน", {
      iceBreakers: [{ question: "ก".repeat(100), payload: "P" }],
    });
    expect(() => buildProfilePayload(cfg)).toThrow(ProfileConfigError);
  });

  it("ลืมตั้ง payload → บอกว่าลืมอะไร", () => {
    const cfg = defaultConfig("p1", "ร้าน", {
      iceBreakers: [{ question: "ราคาเท่าไหร่", payload: "  " }],
    });
    const err = expectThaiThrow(() => buildProfilePayload(cfg));
    expect(err.th).toContain("payload");
  });

  it("เมนูถาวรรองรับทั้งปุ่ม postback และลิงก์", () => {
    const p = buildProfilePayload(CONFIG, [
      { title: "ดูสินค้า", payload: "SHOW" },
      { title: "เว็บไซต์", url: "https://example.com" },
    ]);
    const actions = p.persistent_menu![0]!.call_to_actions;
    expect(actions[0]).toEqual({
      type: "postback",
      title: "ดูสินค้า",
      payload: "SHOW",
    });
    expect(actions[1]).toEqual({
      type: "web_url",
      title: "เว็บไซต์",
      url: "https://example.com",
    });
  });

  it("ไม่ปิดช่องพิมพ์ (ลูกค้าที่อยากถามอย่างอื่นต้องพิมพ์ได้)", () => {
    const p = buildProfilePayload(CONFIG, [{ title: "ดูสินค้า", payload: "X" }]);
    expect(p.persistent_menu![0]!.composer_input_disabled).toBe(false);
  });

  it("ปุ่มเมนูที่ไม่มีทั้ง payload และ url → error", () => {
    expect(() => buildProfilePayload(CONFIG, [{ title: "ปุ่มลอย" }])).toThrow(
      ProfileConfigError,
    );
  });

  it("เมนูเกิน 3 ปุ่ม → error", () => {
    const menu = Array.from({ length: 4 }, (_, i) => ({
      title: `ปุ่ม ${i}`,
      payload: `P${i}`,
    }));
    expect(() => buildProfilePayload(CONFIG, menu)).toThrow(ProfileConfigError);
  });
});

describe("MessengerProfileService", () => {
  it("ยิงไปที่ /messenger_profile", async () => {
    const { svc, fetch } = setup();
    await svc.apply(CONFIG);
    expect(fetch.lastCall!.method).toBe("POST");
    expect(fetch.lastCall!.url).toContain("p1/messenger_profile");
  });

  it("ไม่มีอะไรตั้งไว้ → ไม่ยิง API เปล่า", async () => {
    const { svc, fetch } = setup();
    await svc.apply(defaultConfig("p1", "ร้าน"));
    expect(fetch.callCount).toBe(0);
  });

  it("อ่านค่าที่ตั้งไว้ได้", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: { data: [{ ice_breakers: [{ question: "x", payload: "P" }] }] },
    });
    const p = await svc.read("p1");
    expect(p.ice_breakers).toHaveLength(1);
  });

  it("ยังไม่เคยตั้งค่า → คืน object ว่าง ไม่พัง", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: { data: [] } });
    expect(await svc.read("p1")).toEqual({});
  });

  it("ลบค่าที่ตั้งไว้ใช้ DELETE", async () => {
    const { svc, fetch } = setup();
    await svc.clear("p1");
    expect(fetch.lastCall!.method).toBe("DELETE");
  });
});

describe("suggestIceBreakers", () => {
  it("เสนอจากกฎชั้น 1 ที่บอทตอบได้แน่นอน", () => {
    const r = suggestIceBreakers([
      { id: "hours", keywords: ["ร้านเปิดกี่โมง", "เวลาเปิด"], priority: 10 },
      { id: "delivery", keywords: ["ค่าส่ง"], priority: 20 },
    ]);
    expect(r).toEqual([
      { question: "ร้านเปิดกี่โมง", payload: "RULE:hours" },
      { question: "ค่าส่ง", payload: "RULE:delivery" },
    ]);
  });

  it("ข้ามกฎที่ไม่มีคีย์เวิร์ด (regex อย่างเดียวเอามาแสดงไม่ได้)", () => {
    const r = suggestIceBreakers([
      { id: "re", priority: 5 },
      { id: "kw", keywords: ["ราคา"], priority: 10 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.payload).toBe("RULE:kw");
  });

  it("จำกัดไม่เกินเพดานของ Meta", () => {
    const rules = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      keywords: [`คำ ${i}`],
      priority: i,
    }));
    expect(suggestIceBreakers(rules)).toHaveLength(MAX_ICE_BREAKERS);
  });

  it("เรียงตาม priority ของกฎ", () => {
    const r = suggestIceBreakers([
      { id: "late", keywords: ["ทีหลัง"], priority: 99 },
      { id: "early", keywords: ["ก่อน"], priority: 1 },
    ]);
    expect(r[0]!.payload).toBe("RULE:early");
  });
});
