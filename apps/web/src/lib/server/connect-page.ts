import "server-only";

/**
 * เชื่อมเพจเข้าระบบด้วย Page Access Token ที่วางมาเอง
 *
 * ─── ทำไมต้องมีทางนี้ ทั้งที่ทางที่ถูกต้องคือ OAuth ───
 *
 * OAuth ใช้ได้ก็ต่อเมื่อแอปผ่าน App Review ของ Meta แล้ว ซึ่งใช้เวลาเป็นสัปดาห์
 * และต้องมี Business Verification ก่อน — ระหว่างนั้นจะทดสอบระบบไม่ได้เลย
 *
 * ทางนี้ให้เอา token จาก Graph API Explorer มาวางตรงๆ ใช้ได้ทันทีกับเพจของ
 * ตัวเอง เหมาะกับช่วงทดสอบ พอ App Review ผ่านค่อยเปลี่ยนไปใช้ OAuth
 * (ปลายทางเดียวกันหมด — ทั้งสองทางจบที่ `tokens.save()` เหมือนกัน)
 *
 * ⚠️ token จาก Explorer มักเป็นแบบอายุสั้น (1–2 ชม.) ตัวนี้จึงบอกอายุที่เหลือ
 * กลับไปให้เห็นชัดๆ ไม่งั้นจะงงว่าทำไมเมื่อวานใช้ได้วันนี้ใช้ไม่ได้
 */
import { MetaApiError } from "@page-os/meta";
import { metaGateway, prisma, tokenService, WebConfigError } from "@/lib/server/deps";

export interface ConnectResult {
  ok: boolean;
  th: string;
  page?: {
    fbPageId: string;
    name: string;
    expiresAtMs: number | null;
    scopes: string[];
  };
}

/** ข้อมูลเพจที่ Meta ตอบกลับมาตอนถามด้วย token นั้น */
interface MeResponse {
  id?: string;
  name?: string;
  category?: string;
}

export async function connectPageWithToken(args: {
  accessToken: string;
  /** ชื่อลูกค้าที่จะใช้จัดกลุ่มเพจ — ปล่อยว่างได้ ระบบจะใช้ชื่อเพจแทน */
  clientName?: string;
}): Promise<ConnectResult> {
  const token = args.accessToken.trim();

  if (token === "") {
    return { ok: false, th: "ยังไม่ได้วาง token — ก๊อปมาจาก Graph API Explorer แล้ววางในช่อง" };
  }
  // ดักความผิดพลาดที่เกิดบ่อยที่สุด: ก๊อปทั้งบรรทัดรวมคำว่า Bearer หรือชื่อฟิลด์มาด้วย
  if (/\s/.test(token)) {
    return {
      ok: false,
      th: "token มีช่องว่างปนอยู่ — ก๊อปเฉพาะตัว token เท่านั้น อย่าเอาคำว่า Bearer หรือชื่อฟิลด์มาด้วย",
    };
  }

  let deps;
  try {
    deps = metaGateway();
  } catch (err) {
    if (err instanceof WebConfigError) return { ok: false, th: err.th };
    throw err;
  }
  const { gateway, tokens } = deps;

  try {
    // ── 1. token นี้ของจริงไหม และเป็นของแอปเราหรือเปล่า ────────────────
    const info = await tokenService(gateway).debugToken(token);

    if (!info.isValid) {
      return {
        ok: false,
        th: `Meta บอกว่า token นี้ใช้ไม่ได้${info.invalidReason ? ` — ${info.invalidReason}` : ""} ` +
          `ลองสร้างใหม่จาก Graph API Explorer`,
      };
    }

    /**
     * token ที่ออกโดยแอปอื่นใช้กับระบบเราไม่ได้ และอาการที่ได้จะหลอกมาก:
     * เชื่อมผ่าน แต่พอถึงเวลาโพสต์จริงจะโดนปฏิเสธด้วย error ที่ดูไม่เกี่ยวกัน
     */
    const ourAppId = process.env["META_APP_ID"]?.trim();
    if (ourAppId !== undefined && info.appId !== "" && info.appId !== ourAppId) {
      return {
        ok: false,
        th: `token นี้ออกโดยแอปรหัส ${info.appId} แต่ระบบตั้งค่าไว้เป็นแอป ${ourAppId} — ` +
          `เลือกแอปให้ตรงกันใน Graph API Explorer ก่อนสร้าง token`,
      };
    }

    // ── 2. token นี้เป็นของเพจไหน ───────────────────────────────────────
    const me = await gateway.call<MeResponse>({
      // ยังไม่รู้ว่าเป็นเพจไหน (นั่นคือสิ่งที่กำลังจะถาม) จึงยังผูกกับเลนของเพจ
      // ไม่ได้ ใช้เลนของแอปไปก่อน แล้วส่ง token ที่วางมาไปตรงๆ
      pageId: null,
      path: "/me",
      params: { fields: "id,name,category" },
      accessToken: token,
    });

    const fbPageId = me.data.id;
    const name = me.data.name;
    if (fbPageId === undefined || name === undefined) {
      return {
        ok: false,
        th: "ถาม Meta แล้วไม่ได้รหัสเพจกลับมา — token นี้อาจเป็นของผู้ใช้ ไม่ใช่ของเพจ " +
          'ใน Graph API Explorer ต้องเลือก "Page Access Token" ของเพจที่ต้องการ',
      };
    }

    /**
     * token ของ "ผู้ใช้" ก็ตอบ /me ได้เหมือนกัน แต่จะไม่มี category กลับมา
     * ปล่อยผ่านไปจะไปพังตอนโพสต์ ซึ่งไกลจากจุดที่ทำผิดมาก
     */
    if (info.type !== "PAGE" && me.data.category === undefined) {
      return {
        ok: false,
        th: "token นี้เป็นของผู้ใช้ ไม่ใช่ของเพจ — ใน Graph API Explorer ให้กด " +
          'dropdown แล้วเลือกเพจใต้หัวข้อ "Page Access Token"',
      };
    }

    // ── 3. เก็บ ────────────────────────────────────────────────────────
    const db = prisma();

    const clientName =
      args.clientName !== undefined && args.clientName.trim() !== ""
        ? args.clientName.trim()
        : name;

    // workspace = ลูกค้าหนึ่งราย; เพจของลูกค้าเดิมไปอยู่ workspace เดิม
    const workspace =
      (await db.workspace.findFirst({ where: { clientName } })) ??
      (await db.workspace.create({ data: { name: clientName, clientName } }));

    await db.page.upsert({
      where: { fbPageId },
      create: { workspaceId: workspace.id, fbPageId, name },
      // ชื่อเพจเปลี่ยนได้ — อัปเดตตาม แต่ไม่ย้าย workspace ให้เอง
      update: { name },
    });

    const expiresAtMs = info.expiresAtMs ?? null;
    await tokens.save({
      pageId: fbPageId,
      accessToken: token,
      tokenType: "page",
      scopes: info.scopes,
      expiresAtMs,
      status: "active",
    });

    return {
      ok: true,
      th: `เชื่อมเพจ "${name}" เรียบร้อย`,
      page: { fbPageId, name, expiresAtMs, scopes: info.scopes },
    };
  } catch (err) {
    if (err instanceof WebConfigError) return { ok: false, th: err.th };

    if (err instanceof MetaApiError) {
      /**
       * `err.code` ว่าง = ปลายทางตอบ HTTP error โดยไม่มีก้อน error ของ Meta
       * มาด้วย ซึ่งแปลว่า **ยังไปไม่ถึง Meta** — ติดพร็อกซี ไฟร์วอลล์ หรือ DNS
       *
       * ข้อความมาตรฐานตอนนั้นคือ "Facebook ตอบ error ที่ระบบยังไม่รู้จัก —
       * ดูรายละเอียดใน log แล้วเพิ่ม rule" ซึ่งเขียนไว้ให้นักพัฒนาอ่านตอนไล่ log
       * ไม่ใช่ให้คนที่กำลังติดตั้งอ่าน — ตรงนี้จึงเปลี่ยนเป็นสิ่งที่ทำต่อได้จริง
       */
      if (err.code === undefined) {
        return {
          ok: false,
          th:
            `ต่อไปที่ Facebook ไม่ได้ (HTTP ${err.httpStatus ?? "?"}) — ` +
            `ยังไปไม่ถึง Meta ด้วยซ้ำ ให้เช็คตามลำดับ: เครื่องนี้ออกเน็ตได้ไหม, ` +
            `มีพร็อกซีหรือไฟร์วอลล์กั้น graph.facebook.com อยู่หรือเปล่า`,
        };
      }
      // ที่เหลือ gateway แปลเป็นข้อความไทยพร้อมวิธีแก้ไว้แล้ว
      return { ok: false, th: err.th };
    }

    return {
      ok: false,
      th: `เชื่อมเพจไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** ตัดเพจออกจากระบบ — ลบ token ทิ้งด้วย (cascade) */
export async function disconnectPage(fbPageId: string): Promise<ConnectResult> {
  const db = prisma();
  const page = await db.page.findUnique({ where: { fbPageId } });
  if (page === null) return { ok: false, th: "ไม่พบเพจนี้ในระบบแล้ว" };

  await db.page.delete({ where: { fbPageId } });
  return { ok: true, th: `เอาเพจ "${page.name}" ออกจากระบบแล้ว` };
}
