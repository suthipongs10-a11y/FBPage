import { describe, expect, it } from "vitest";
import {
  OAUTH_STATE_TTL_MS,
  OAuthStateError,
  createOAuthState,
  verifyOAuthState,
} from "./oauth-state.js";

const SECRET = "APPSECRET";
const NOW = 1_700_000_000_000;

/**
 * เช็คข้อความไทยที่ลูกค้าจะเห็นจริง (ฟิลด์ `th`)
 * `toThrow(/…/)` เทียบกับ `.message` ซึ่งเป็นอังกฤษไว้ debug จึงใช้ตรงนี้ไม่ได้
 */
function expectThaiError(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(OAuthStateError);
    expect((err as OAuthStateError).th).toMatch(pattern);
    return;
  }
  expect.unreachable("ควรจะโยน OAuthStateError");
}

describe("createOAuthState / verifyOAuthState", () => {
  it("สร้างแล้วตรวจกลับได้ workspace เดิม", () => {
    const state = createOAuthState({ workspaceId: "ws-1", nowMs: NOW }, SECRET);
    expect(verifyOAuthState(state, SECRET, NOW).workspaceId).toBe("ws-1");
  });

  it("สร้างสองครั้งได้ค่าต่างกัน (มี nonce กัน replay)", () => {
    const a = createOAuthState({ workspaceId: "ws-1", nowMs: NOW }, SECRET);
    const b = createOAuthState({ workspaceId: "ws-1", nowMs: NOW }, SECRET);
    expect(a).not.toBe(b);
  });

  it("ปฏิเสธ state ที่เซ็นด้วย secret อื่น (คนนอกปลอมไม่ได้)", () => {
    const state = createOAuthState({ workspaceId: "ws-1", nowMs: NOW }, SECRET);
    expect(() => verifyOAuthState(state, "SECRET_อื่น", NOW)).toThrow(
      OAuthStateError,
    );
  });

  it("ปฏิเสธเมื่อ payload ถูกแก้ (เปลี่ยน workspace ไม่ได้)", () => {
    const state = createOAuthState({ workspaceId: "ws-1", nowMs: NOW }, SECRET);
    const [b64, sig] = state.split(".") as [string, string];
    const payload = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    payload["workspaceId"] = "ws-ของคนอื่น";
    const tampered =
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") +
      "." +
      sig;
    expectThaiError(
      () => verifyOAuthState(tampered, SECRET, NOW),
      /ถูกแก้ไข/,
    );
  });

  it("ปฏิเสธ state ที่หมดอายุ", () => {
    const state = createOAuthState({ workspaceId: "ws-1", nowMs: NOW }, SECRET);
    expectThaiError(
      () => verifyOAuthState(state, SECRET, NOW + OAUTH_STATE_TTL_MS + 1),
      /หมดอายุ/,
    );
  });

  it("ยังใช้ได้ตอนใกล้หมดอายุพอดี", () => {
    const state = createOAuthState({ workspaceId: "ws-1", nowMs: NOW }, SECRET);
    expect(
      verifyOAuthState(state, SECRET, NOW + OAUTH_STATE_TTL_MS - 1).workspaceId,
    ).toBe("ws-1");
  });

  it("ปฏิเสธ state ที่อ้างว่าออกจากอนาคต", () => {
    const state = createOAuthState(
      { workspaceId: "ws-1", nowMs: NOW + 600_000 },
      SECRET,
    );
    expect(() => verifyOAuthState(state, SECRET, NOW)).toThrow(OAuthStateError);
  });

  it("เผื่อนาฬิกาคลาดเล็กน้อยได้", () => {
    const state = createOAuthState(
      { workspaceId: "ws-1", nowMs: NOW + 5_000 },
      SECRET,
    );
    expect(verifyOAuthState(state, SECRET, NOW).workspaceId).toBe("ws-1");
  });

  it("ปฏิเสธ state ที่ไม่มี / รูปแบบผิด", () => {
    for (const bad of [undefined, null, "", "ไม่มีจุด", ".", "a.b.c"]) {
      expect(() => verifyOAuthState(bad, SECRET, NOW), String(bad)).toThrow(
        OAuthStateError,
      );
    }
  });

  it("ทุก error มีข้อความไทยบอกลูกค้าว่าต้องทำอะไร", () => {
    try {
      verifyOAuthState("ขยะ", SECRET, NOW);
      expect.unreachable("ควรจะโยน error");
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError);
      expect((err as OAuthStateError).th).toMatch(/[ก-๙]/);
    }
  });

  it("payload ที่ decode ได้แต่ไม่มีฟิลด์ที่ต้องการ ถูกปฏิเสธ", () => {
    const b64 = Buffer.from(JSON.stringify({ foo: 1 }), "utf8").toString(
      "base64url",
    );
    // เซ็นให้ถูกต้อง เพื่อทดสอบด่านตรวจ payload โดยเฉพาะ
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");
    expect(() => verifyOAuthState(`${b64}.${sig}`, SECRET, NOW)).toThrow(
      OAuthStateError,
    );
  });
});
