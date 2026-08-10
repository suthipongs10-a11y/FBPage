#!/usr/bin/env node
/**
 * ตรวจความพร้อมก่อนเปิดระบบ
 *
 *   pnpm doctor
 *
 * เป้าหมายไม่ใช่แค่บอกว่า "พังหรือไม่พัง" แต่บอกว่า **ต้องพิมพ์อะไรต่อ**
 * ทุกข้อที่ไม่ผ่านจึงมีคำสั่งที่ก๊อปไปวางได้เลยติดมาด้วย
 *
 * ตรวจจากล่างขึ้นบน: มีเครื่องมือครบไหม → ตั้งค่าครบไหม → ต่อของจริงได้ไหม →
 * ตารางมีหรือยัง — เพราะข้อล่างพังแล้วข้อบนจะพังตามโดยไม่มีความหมาย
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { checkEnv, parseEnvFile, REQUIRED_KEYS } from "./env-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};
const say = (s = "") => process.stdout.write(s + "\n");

/** @type {Array<{ok:boolean, skip?:boolean, th:string, fixTh?:string}>} */
const results = [];
let hardFail = false;

function check(ok, th, fixTh) {
  results.push({ ok, th, ...(fixTh !== undefined ? { fixTh } : {}) });
  if (!ok) hardFail = true;
  return ok;
}
function warn(th, fixTh) {
  results.push({ ok: true, skip: true, th, ...(fixTh !== undefined ? { fixTh } : {}) });
}

/** ลองต่อ TCP — ใช้ตรวจว่า Postgres/Redis ขึ้นแล้วจริงไหม โดยไม่ต้องมี client */
function canConnect(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

function hostPortOf(url, fallbackPort) {
  try {
    const u = new URL(url);
    return { host: u.hostname || "localhost", port: Number(u.port) || fallbackPort };
  } catch {
    return null;
  }
}

async function main() {
  say(`${c.bold}PAGE OS — ตรวจความพร้อม${c.reset}\n`);

  // ── 1. เครื่องมือ ───────────────────────────────────────────────────
  const major = Number(process.versions.node.split(".")[0]);
  check(
    major >= 22,
    `Node ${process.versions.node}`,
    "โปรเจ็คนี้ต้องใช้ Node 22 ขึ้นไป — ติดตั้งจาก nodejs.org หรือ `nvm install 22`",
  );

  check(
    existsSync(join(ROOT, "node_modules")),
    "ติดตั้ง dependency แล้ว",
    "pnpm install",
  );

  // ── 2. ไฟล์ตั้งค่า ──────────────────────────────────────────────────
  const envPath = join(ROOT, ".env");
  const hasEnv = check(existsSync(envPath), "มีไฟล์ .env", "pnpm setup");

  /** @type {Record<string,string>} */
  const env = hasEnv ? parseEnvFile(readFileSync(envPath, "utf8")) : {};

  if (hasEnv) {
    const problems = checkEnv(env);
    const missing = problems.filter((p) => REQUIRED_KEYS.includes(p.key));
    check(
      missing.length === 0,
      missing.length === 0
        ? `ค่าที่จำเป็นครบทั้ง ${REQUIRED_KEYS.length} ตัว`
        : `ยังขาด/ผิดรูปแบบ ${missing.length} ตัว`,
      missing.length === 0
        ? undefined
        : missing.map((p) => `• ${p.th}`).join("\n     ") + "\n     แก้ด้วย: pnpm setup",
    );
  }

  // ── 3. ของจริงที่ต้องต่อได้ ─────────────────────────────────────────
  const pg = hostPortOf(env["DATABASE_URL"] ?? "", 5432);
  if (pg === null) {
    check(false, "ที่อยู่ Postgres", "DATABASE_URL อ่านไม่ออก — รันใหม่: pnpm setup");
  } else {
    check(
      await canConnect(pg.host, pg.port),
      `ต่อ Postgres ได้ (${pg.host}:${pg.port})`,
      "docker compose up -d\n     (ถ้าใช้ Postgres ที่ติดตั้งเองอยู่แล้ว เช็คว่ามันรันอยู่และพอร์ตตรงกับใน .env)",
    );
  }

  const redis = hostPortOf(env["REDIS_URL"] ?? "", 6379);
  if (redis === null) {
    check(false, "ที่อยู่ Redis", "REDIS_URL อ่านไม่ออก — รันใหม่: pnpm setup");
  } else {
    check(
      await canConnect(redis.host, redis.port),
      `ต่อ Redis ได้ (${redis.host}:${redis.port})`,
      "docker compose up -d",
    );
  }

  // ── 4. ตารางในฐานข้อมูล ─────────────────────────────────────────────
  // ใช้ Prisma ถามตรงๆ แทนที่จะเดาจากไฟล์ migration เพราะสิ่งที่อยากรู้คือ
  // "ตารางมีอยู่จริงไหม" ไม่ใช่ "เคยสั่งสร้างหรือยัง"
  // ต้องหาผ่าน packages/store ไม่ใช่จาก root — pnpm ไม่ยกของขึ้นมาไว้ที่ root
  // ให้ ต้องถามจากแพ็กเกจที่ประกาศ dependency ตัวนี้ไว้จริง
  let prismaEntry = null;
  try {
    prismaEntry = createRequire(join(ROOT, "packages/store/package.json")).resolve(
      "@prisma/client",
    );
  } catch {
    prismaEntry = null;
  }

  if (prismaEntry !== null) {
    try {
      const { PrismaClient } = await import(pathToFileURL(prismaEntry).href);
      const prisma = new PrismaClient({
        datasources: { db: { url: env["DATABASE_URL"] } },
      });
      try {
        await prisma.page.count();
        check(true, "ตารางในฐานข้อมูลพร้อมแล้ว");

        const pages = await prisma.page.count();
        const tokens = await prisma.pageToken.count();
        if (pages === 0) {
          warn(
            "ยังไม่มีเพจในระบบ",
            "เปิด http://localhost:3000/settings แล้วเชื่อมเพจแรก",
          );
        } else {
          warn(`มี ${pages} เพจ / ${tokens} token ในระบบ`);
        }
      } catch (err) {
        const msg = String(err?.message ?? err);
        // ตารางยังไม่ถูกสร้าง เป็นคนละเรื่องกับต่อฐานข้อมูลไม่ได้
        check(
          false,
          "ตารางในฐานข้อมูล",
          msg.includes("does not exist") || msg.includes("P2021")
            ? "pnpm db:push"
            : `ถามฐานข้อมูลไม่สำเร็จ: ${msg.split("\n")[0]}`,
        );
      } finally {
        await prisma.$disconnect();
      }
    } catch {
      check(false, "Prisma client", "pnpm db:generate");
    }
  } else {
    check(false, "Prisma client ถูกสร้างแล้ว", "pnpm db:generate");
  }

  // ── 5. build ────────────────────────────────────────────────────────
  const built =
    existsSync(join(ROOT, "apps/worker/dist/main.js")) &&
    existsSync(join(ROOT, "apps/webhook/dist/server.js"));
  if (!built) {
    warn(
      "ยังไม่ได้ build (จำเป็นเฉพาะตอนรันแบบ production)",
      "pnpm build — ส่วน `pnpm dev` build ให้เองอยู่แล้ว",
    );
  } else {
    warn("build ไว้แล้ว");
  }

  // ── 6. docker (แค่บอกให้รู้ ไม่บังคับ) ──────────────────────────────
  try {
    execFileSync("docker", ["compose", "ps", "--quiet"], {
      cwd: ROOT,
      stdio: "pipe",
    });
  } catch {
    warn(
      "ไม่ได้ใช้ docker compose (ไม่เป็นไรถ้าติดตั้ง Postgres/Redis เองแล้ว)",
    );
  }

  // ── สรุป ────────────────────────────────────────────────────────────
  say("");
  for (const r of results) {
    const mark = r.skip
      ? `${c.dim}•${c.reset}`
      : r.ok
        ? `${c.green}✓${c.reset}`
        : `${c.red}✗${c.reset}`;
    say(`  ${mark} ${r.skip ? c.dim + r.th + c.reset : r.th}`);
    if (!r.ok && r.fixTh !== undefined) {
      say(`     ${c.yellow}→ ${r.fixTh}${c.reset}`);
    } else if (r.skip && r.fixTh !== undefined) {
      say(`     ${c.dim}→ ${r.fixTh}${c.reset}`);
    }
  }

  say("");
  if (hardFail) {
    say(`${c.red}${c.bold}ยังเปิดระบบไม่ได้${c.reset} — แก้ข้อที่ ✗ ข้างบนก่อน แล้วรัน pnpm doctor ใหม่`);
    process.exit(1);
  }
  say(`${c.green}${c.bold}พร้อมแล้ว${c.reset} — เปิดระบบด้วย ${c.bold}pnpm dev${c.reset}`);
}

main().catch((err) => {
  say(`${c.red}ตรวจไม่สำเร็จ: ${err?.message ?? String(err)}${c.reset}`);
  process.exit(1);
});
