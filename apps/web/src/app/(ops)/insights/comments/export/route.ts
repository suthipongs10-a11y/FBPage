import "server-only";

/**
 * ดาวน์โหลดคอมเมนต์เป็น CSV
 *
 * เป็น route handler ไม่ใช่ server action เพราะเบราว์เซอร์ต้องได้ไฟล์จริง
 * พร้อม `Content-Disposition` — server action คืนไฟล์ให้ดาวน์โหลดตรงๆ ไม่ได้
 *
 * ⚠️ ไฟล์นี้ **ไม่จำกัดจำนวนแถวเท่าหน้าจอ** — คนกดดาวน์โหลดต้องการทั้งชุด
 *    ไม่ใช่ 25 อันที่เห็นบนหน้า แต่ยังมีเพดานกันหน่วยความจำระเบิด
 */
import { commentsToCsv, exportFileName } from "@page-os/listening";
import { PrismaListeningQueries } from "@page-os/store";
import { prisma } from "@/lib/server/deps";

/** เพดานแถวต่อไฟล์ — 50,000 แถวราว 10 MB ซึ่งเปิดใน Excel ยังไหว */
const MAX_ROWS = 50_000;
const WINDOW_DAYS = 30;
const TZ = "Asia/Bangkok";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const keyword = url.searchParams.get("q")?.trim() ?? "";
  const trackedPageId = url.searchParams.get("page") ?? undefined;

  const toMs = Date.now();
  const fromMs = toMs - WINDOW_DAYS * 86_400_000;

  try {
    const found = await new PrismaListeningQueries(prisma()).searchComments({
      fromMs,
      toMs,
      limit: MAX_ROWS,
      ...(trackedPageId !== undefined ? { trackedPageId } : {}),
      ...(keyword === "" ? {} : { keyword }),
    });

    const csv = commentsToCsv({
      comments: found.rows.map((r) => ({
        createdAtMs: r.createdAtMs,
        pageName: r.pageName,
        authorName: r.authorName,
        message: r.message,
        postPermalink: r.postPermalink,
      })),
      timeZone: TZ,
    });

    const name = exportFileName({ prefix: "คอมเมนต์", atMs: toMs, keyword });

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        /**
         * ชื่อไฟล์เป็นภาษาไทยต้องส่งเป็น `filename*` แบบ RFC 5987
         * ส่วน `filename` ธรรมดาใส่ชื่อ ASCII สำรองไว้ให้เบราว์เซอร์เก่า
         */
        "content-disposition":
          `attachment; filename="comments.csv"; ` +
          `filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`ส่งออกไม่สำเร็จ: ${msg.split("\n")[0]}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
