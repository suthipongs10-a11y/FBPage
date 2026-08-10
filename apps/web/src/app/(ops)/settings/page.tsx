import { revalidatePath } from "next/cache";
import { Badge, Card, EmptyState, SectionHeader } from "@/components/ui";
import { ConnectPageForm } from "@/components/connect-page-form";
import { readEnvStatus } from "@/lib/server/env-status";
import { connectPageWithToken, disconnectPage } from "@/lib/server/connect-page";
import { prisma } from "@/lib/server/deps";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function expiryLabel(expiresAt: Date | null, nowMs: number) {
  if (expiresAt === null) {
    return { text: "ไม่หมดอายุ", tone: "green" as const };
  }
  const left = expiresAt.getTime() - nowMs;
  if (left <= 0) return { text: "หมดอายุแล้ว", tone: "red" as const };
  if (left < 2 * 3_600_000) {
    return { text: `เหลือ ${Math.floor(left / 60_000)} นาที`, tone: "red" as const };
  }
  if (left < 7 * DAY) {
    return { text: `เหลือ ${Math.floor(left / 3_600_000)} ชม.`, tone: "amber" as const };
  }
  return { text: `เหลือ ${Math.floor(left / DAY)} วัน`, tone: "green" as const };
}

/**
 * แปล error ของฐานข้อมูลเป็นสิ่งที่ทำต่อได้
 *
 * หน้านี้คือหน้าที่คน "กำลังติดตั้ง" เปิด ซึ่งแปลว่าโอกาสที่ฐานข้อมูลยังไม่พร้อม
 * สูงกว่าหน้าอื่นทั้งหมด — ถ้าปล่อยให้ throw ขึ้นไปจะได้หน้า error ของ Next
 * ที่เขียนว่า `PrismaClientInitializationError` ซึ่งไม่ได้บอกว่าต้องทำอะไรเลย
 */
function describeDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("Can't reach database server")) {
    return (
      "ต่อฐานข้อมูลไม่ได้ — ฐานข้อมูลยังไม่ขึ้น หรือที่อยู่ใน DATABASE_URL ไม่ตรง " +
      "ลองสั่ง docker compose up -d แล้วรีเฟรชหน้านี้"
    );
  }
  if (msg.includes("does not exist") || msg.includes("P2021")) {
    return "ยังไม่ได้สร้างตารางในฐานข้อมูล — สั่ง pnpm db:push แล้วรีเฟรชหน้านี้";
  }
  if (msg.includes("Authentication failed")) {
    return "ฐานข้อมูลปฏิเสธรหัสผ่าน — เช็ค DATABASE_URL ใน .env ว่าตรงกับที่ตั้งไว้จริง";
  }
  // ที่เหลือ: เอาบรรทัดแรกมาให้ดู ดีกว่าซ่อนแล้วบอกว่า "เกิดข้อผิดพลาด"
  return `ถามฐานข้อมูลไม่สำเร็จ: ${msg.split("\n")[0]} — ลองรัน pnpm preflight เพื่อไล่ทีละข้อ`;
}

export default async function SettingsPage() {
  const env = readEnvStatus();
  const nowMs = Date.now();

  const query = () =>
    prisma().page.findMany({
      include: {
        workspace: { select: { clientName: true } },
        tokens: { orderBy: { updatedAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    });

  let pages: Awaited<ReturnType<typeof query>> = [];
  let dbErrorTh: string | null = null;
  try {
    pages = await query();
  } catch (err) {
    dbErrorTh = describeDbError(err);
  }

  /** เชื่อมเพจ — ทำงานฝั่งเซิร์ฟเวอร์เท่านั้น token ไม่เคยผ่านมือ client component */
  async function connect(_prev: unknown, formData: FormData) {
    "use server";
    const result = await connectPageWithToken({
      accessToken: String(formData.get("token") ?? ""),
      clientName: String(formData.get("clientName") ?? ""),
    });
    if (result.ok) revalidatePath("/settings");
    return result;
  }

  async function remove(formData: FormData) {
    "use server";
    await disconnectPage(String(formData.get("fbPageId") ?? ""));
    revalidatePath("/settings");
  }

  const groups = [...new Set(env.vars.map((v) => v.group))];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">ตั้งค่าระบบ</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          ที่เดียวสำหรับดูว่าตั้งค่าครบหรือยัง และเชื่อมเพจเข้าระบบ
        </p>
      </header>

      {/* ── เชื่อมเพจ ─────────────────────────────────────────────────── */}
      <Card>
        <SectionHeader
          title="เชื่อมเพจ"
          hint="วาง Page Access Token จาก Graph API Explorer"
        />

        {env.missingRequired.length > 0 ? (
          <div
            className="rounded-[var(--radius-card)] p-4 text-sm"
            style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
          >
            ยังตั้งค่าไม่ครบ ({env.missingRequired.join(", ")}) — เชื่อมเพจไม่ได้จนกว่า
            จะรัน <code className="font-mono">pnpm configure</code> ให้ครบก่อน
          </div>
        ) : (
          <ConnectPageForm action={connect} />
        )}

        <details className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
          <summary className="cursor-pointer select-none">
            เอา Page Access Token มาจากไหน
          </summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-relaxed">
            <li>
              เปิด{" "}
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noreferrer"
                className="underline"
                style={{ color: "var(--accent)" }}
              >
                Graph API Explorer
              </a>
            </li>
            <li>
              ช่อง <b>Meta App</b> เลือกแอปเดียวกับที่ใส่ <code>META_APP_ID</code> ไว้
            </li>
            <li>
              ช่อง <b>User or Page</b> เลือกเพจที่ต้องการใต้หัวข้อ{" "}
              <b>Page Access Token</b> (ไม่ใช่ User Token)
            </li>
            <li>
              กด <b>Add a Permission</b> ใส่สิทธิ์ที่ต้องใช้ เช่น{" "}
              <code>pages_manage_posts</code>, <code>pages_messaging</code>,{" "}
              <code>pages_read_engagement</code>
            </li>
            <li>
              กด <b>Generate Access Token</b> แล้วก๊อปมาวางในช่องข้างบน
            </li>
          </ol>
          <p className="mt-3 leading-relaxed">
            ⚠️ token จาก Explorer อายุสั้น (1–2 ชม.) เหมาะกับทดสอบเท่านั้น
            ถ้าจะใช้ยาวต้องต่อ OAuth หลังผ่าน App Review หรือใช้ System User Token
            จาก Business Manager ที่ไม่หมดอายุ
          </p>
        </details>
      </Card>

      {/* ── เพจที่เชื่อมแล้ว ──────────────────────────────────────────── */}
      <Card>
        <SectionHeader title="เพจในระบบ" count={dbErrorTh === null ? pages.length : undefined} />
        {dbErrorTh !== null ? (
          <div
            className="rounded-[var(--radius-card)] px-4 py-3 text-sm leading-relaxed"
            style={{ background: "var(--danger-bg)" }}
          >
            <div className="font-semibold" style={{ color: "var(--danger)" }}>
              ต่อฐานข้อมูลไม่ได้
            </div>
            <p className="mt-1" style={{ color: "var(--text-muted)" }}>
              {dbErrorTh}
            </p>
          </div>
        ) : pages.length === 0 ? (
          <EmptyState>ยังไม่มีเพจ — เชื่อมเพจแรกจากช่องข้างบน</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {pages.map((p) => {
              const token = p.tokens[0];
              const exp = expiryLabel(token?.expiresAt ?? null, nowMs);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] px-4 py-3"
                  style={{ background: "var(--bg-sunken)" }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div
                      className="tabular truncate text-xs"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {p.workspace.clientName} · {p.fbPageId}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {token === undefined ? (
                      <Badge tone="red">ยังไม่มี token</Badge>
                    ) : (
                      <Badge tone={exp.tone}>{exp.text}</Badge>
                    )}
                    <form action={remove}>
                      <input type="hidden" name="fbPageId" value={p.fbPageId} />
                      <button
                        type="submit"
                        className="rounded-[var(--radius-pill)] px-3 py-1 text-xs transition-colors"
                        style={{ color: "var(--danger)" }}
                      >
                        เอาออก
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── ค่าใน .env ───────────────────────────────────────────────── */}
      <Card>
        <SectionHeader
          title="ค่าตั้งค่าในไฟล์ .env"
          hint="ดูอย่างเดียว — แก้ด้วย pnpm configure แล้วรีสตาร์ท"
        />

        <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          ค่าพวกนี้ถูกอ่านตอนโปรเซสสตาร์ท ไม่ใช่ตอนเปิดหน้าเว็บ จึงแก้จากที่นี่ไม่ได้
          โดยตั้งใจ — โดยเฉพาะ <code className="font-mono">TOKEN_ENC_KEYS</code>{" "}
          ที่ถ้าเปลี่ยนแล้ว token ของทุกเพจจะถอดรหัสไม่ได้อีกเลย
        </p>

        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g}>
              <h3
                className="mb-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-faint)" }}
              >
                {g}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {env.vars
                  .filter((v) => v.group === g)
                  .map((v) => (
                    <li
                      key={v.key}
                      className="flex items-start justify-between gap-4 rounded-lg px-3 py-2 text-sm"
                      style={{ background: "var(--bg-sunken)" }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs">{v.key}</code>
                          {v.required && !v.isSet && (
                            <Badge tone="red">จำเป็น แต่ยังไม่ตั้ง</Badge>
                          )}
                          {!v.required && !v.isSet && (
                            <Badge tone="gray">ไม่ได้ตั้ง</Badge>
                          )}
                        </div>
                        <div
                          className="mt-0.5 text-xs leading-relaxed"
                          style={{ color: "var(--text-faint)" }}
                        >
                          {v.labelTh}
                          {!v.isSet && ` — ${v.whereTh}`}
                        </div>
                      </div>
                      {v.isSet && (
                        <code
                          className="tabular shrink-0 font-mono text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {v.display}
                        </code>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
