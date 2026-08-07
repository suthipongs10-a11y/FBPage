import { describe, expect, it } from "vitest";
import {
  REQUIRED_WEBHOOK_FIELDS,
  SubscriptionService,
} from "./subscriptions.js";
import { graphError, makeGateway } from "./test-helpers.js";

function setup() {
  const h = makeGateway();
  return { ...h, svc: new SubscriptionService(h.gateway) };
}

const ALL_FIELDS = [...REQUIRED_WEBHOOK_FIELDS];

describe("REQUIRED_WEBHOOK_FIELDS", () => {
  it("ครบตามที่สเปกข้อ M1 ระบุ", () => {
    expect(ALL_FIELDS).toEqual([
      "messages",
      "messaging_postbacks",
      "message_reactions",
      "feed",
      "ratings",
    ]);
  });
});

describe("SubscriptionService.check", () => {
  it("subscribe ครบ → ok", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: { data: [{ id: "APP", subscribed_fields: ALL_FIELDS }] },
    });
    const st = await svc.check("p1");
    expect(st.ok).toBe(true);
    expect(st.subscribed).toBe(true);
    expect(st.missingFields).toEqual([]);
  });

  it("ยังไม่ subscribe → บอกชัดว่าข้อความจะไม่เข้าระบบ", async () => {
    const { svc, fetch } = setup();
    fetch.push({ json: { data: [] } });
    const st = await svc.check("p1");
    expect(st.subscribed).toBe(false);
    expect(st.ok).toBe(false);
    expect(st.th).toContain("ไม่เข้าระบบ");
    expect(st.missingFields).toEqual(ALL_FIELDS);
  });

  it("subscribe แล้วแต่ขาด field → ระบุตัวที่ขาด", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: { data: [{ id: "APP", subscribed_fields: ["messages", "feed"] }] },
    });
    const st = await svc.check("p1");
    expect(st.subscribed).toBe(true);
    expect(st.ok).toBe(false);
    expect(st.missingFields).toEqual([
      "messaging_postbacks",
      "message_reactions",
      "ratings",
    ]);
    expect(st.th).toContain("messaging_postbacks");
  });

  it("รวม field จากหลาย app entry และตัดตัวซ้ำ", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: {
        data: [
          { id: "A", subscribed_fields: ["messages", "feed"] },
          { id: "B", subscribed_fields: ["feed", "ratings"] },
        ],
      },
    });
    const st = await svc.check("p1");
    expect(st.fields).toEqual(["feed", "messages", "ratings"]);
  });

  it("ยิงไม่ผ่าน → ไม่พัง แต่รายงานว่าตรวจไม่ได้พร้อมเหตุผลไทย", async () => {
    const { svc, fetch } = setup();
    fetch.setFallback({ status: 403, json: graphError(200, "no permission") });
    const st = await svc.check("p1");
    expect(st.ok).toBe(false);
    expect(st.subscribed).toBe(false);
    expect(st.th).toContain("ตรวจ webhook ไม่สำเร็จ");
    expect(st.th).toMatch(/[ก-๙]/);
  });

  it("เทียบกับชุด field ที่กำหนดเองได้", async () => {
    const { svc, fetch } = setup();
    fetch.push({
      json: { data: [{ id: "APP", subscribed_fields: ["feed"] }] },
    });
    expect((await svc.check("p1", ["feed"])).ok).toBe(true);
  });
});

describe("SubscriptionService.subscribe / unsubscribe", () => {
  it("subscribe ส่ง subscribed_fields ครบใน body", async () => {
    const { svc, fetch } = setup();
    await svc.subscribe("p1");
    const call = fetch.lastCall!;
    expect(call.method).toBe("POST");
    expect(call.url).toContain("p1/subscribed_apps");
    expect(new URLSearchParams(call.body!).get("subscribed_fields")).toBe(
      ALL_FIELDS.join(","),
    );
  });

  it("unsubscribe ใช้ DELETE", async () => {
    const { svc, fetch } = setup();
    await svc.unsubscribe("p1");
    expect(fetch.lastCall!.method).toBe("DELETE");
    expect(fetch.lastCall!.url).toContain("p1/subscribed_apps");
  });

  it("subscribe ที่ล้มเหลวโยน error ออกมาให้เห็น ไม่กลืนเงียบ", async () => {
    const { svc, fetch } = setup();
    fetch.setFallback({ status: 403, json: graphError(200) });
    await expect(svc.subscribe("p1")).rejects.toMatchObject({
      action: "permission",
    });
  });
});
