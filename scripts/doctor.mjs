#!/usr/bin/env node
/**
 * ตรวจความพร้อมก่อนเปิดระบบ
 *
 *   pnpm preflight
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

/**
 * ที่อยู่ของ Prisma Client ที่ generate แล้ว — `null` ถ้ายังไม่ได้ generate
 *
 * resolve ด้วยวิธีเดียวกับที่ `@prisma/client` ใช้หาตัวเองตอนรัน แทนที่จะเดา
 * จากโครงสร้างโฟลเดอร์ (pnpm ซ่อนไว้ใน `.pnpm/<ชื่อ>@<เวอร์ชัน>_<hash>/`)
 */
function generatedPrismaClient() {
  try {
    const shell = createRequire(join(ROOT, "packages/store/package.json")).resolve(
      "@prisma/client/package.json",
    );
    return createRequire(shell).resolve(".prisma/client");
  } catch {
    return null;
  }
}

/**
 * Docker อยู่ในสถานะไหน — "ยังไม่ติดตั้ง" กับ "ติดตั้งแล้วแต่ยังไม่เปิด"
 * ต้องแยกกัน เพราะวิธีแก้คนละเรื่องกันคนละโลก และบน Windows อาการที่เจอบ่อยที่สุด
 * คือติดตั้ง Docker Desktop ไว้แล้วแต่ลืมเปิดโปรแกรม
 *
 * @returns {"missing"|"stopped"|"ok"}
 */
function dockerState() {
  try {
    execFileSync("docker", ["--version"], { stdio: "pipe" });
  } catch {
    return "missing"; // ไม่มีคำสั่ง docker บนเครื่องเลย
  }
  try {
    // ถามอะไรก็ได้ที่ต้องคุยกับ daemon จริงๆ — `--version` ตอบได้โดยไม่ต้องมี daemon
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "pipe" });
    return "ok";
  } catch {
    return "stopped";
  }
}

const DOCKER_INSTALL_TH =
  "ยังไม่มี Docker บนเครื่องนี้ — โหลด Docker Desktop จาก\n" +
  "     https://www.docker.com/products/docker-desktop/ ติดตั้งแล้วเปิดโปรแกรมค้างไว้\n" +
  "     แล้วค่อยสั่ง docker compose up -d\n" +
  "     (ไม่อยากใช้ Docker ก็ได้ — ติดตั้ง Postgres 16 + Redis เองแล้วแก้ DATABASE_URL/REDIS_URL ใน .env)";

const DOCKER_STOPPED_TH =
  "ติดตั้ง Docker ไว้แล้วแต่ยังไม่ได้เปิด — เปิดโปรแกรม Docker Desktop\n" +
  "     รอจนไอคอนขึ้นว่า running แล้วสั่ง docker compose up -d";

async function main() {
  say(`${c.bold}PAGE OS — ตรวจความพร้อม${c.reset}\n`);

  // รู้สถานะ Docker ตั้งแต่ต้น เพราะข้อ "ต่อ Postgres/Redis ไม่ได้" ข้างล่าง
  // ต้องบอกวิธีแก้ที่ทำได้จริงบนเครื่องนี้ ไม่ใช่บอก `docker compose up -d`
  // กับคนที่ยังไม่มี docker
  const docker = dockerState();
  const dockerFixTh =
    docker === "missing"
      ? DOCKER_INSTALL_TH
      : docker === "stopped"
        ? DOCKER_STOPPED_TH
        : "docker compose up -d\n     (ถ้าใช้ Postgres/Redis ที่ติดตั้งเองอยู่แล้ว เช็คว่ามันรันอยู่และพอร์ตตรงกับใน .env)";

  /**
   * Postgres กับ Redis มักล้มพร้อมกันและด้วยเหตุผลเดียวกัน — พิมพ์วิธีแก้ยาวๆ
   * ซ้ำสองรอบทำให้หน้าจอรก จนคนอ่านข้ามทั้งก้อน บอกเต็มครั้งเดียวก็พอ
   */
  let dockerFixShown = false;
  const dbFix = () => {
    if (dockerFixShown) return "เหตุผลเดียวกับข้อบน";
    dockerFixShown = true;
    return dockerFixTh;
  };

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

  /**
   * Prisma Client ต้องถูก generate ก่อน ไม่งั้น `tsc` จะพังด้วย TS7006 ในไฟล์
   * ที่ไม่ได้แก้อะไรเลย — ตรวจแยกเป็นข้อของตัวเองตรงนี้ เพราะถ้าไปโผล่ตอน build
   * จะไม่มีอะไรใบ้เลยว่าต้นเหตุคืออะไร
   */
  check(
    generatedPrismaClient() !== null,
    "สร้าง Prisma Client แล้ว",
    "pnpm db:generate",
  );

  // ── 2. ไฟล์ตั้งค่า ──────────────────────────────────────────────────
  const envPath = join(ROOT, ".env");
  const hasEnv = check(existsSync(envPath), "มีไฟล์ .env", "pnpm configure");

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
        : missing.map((p) => `• ${p.th}`).join("\n     ") + "\n     แก้ด้วย: pnpm configure",
    );
  }

  // ── 3. ของจริงที่ต้องต่อได้ ─────────────────────────────────────────
  const pg = hostPortOf(env["DATABASE_URL"] ?? "", 5432);
  let pgReachable = false;
  if (pg === null) {
    check(false, "ที่อยู่ Postgres", "DATABASE_URL อ่านไม่ออก — รันใหม่: pnpm configure");
  } else {
    // เรียก dbFix() ต่อเมื่อ**ล้มจริง** ไม่งั้นข้อที่ผ่านจะกินโควตา "บอกเต็มครั้งแรก"
    // ไปเปล่าๆ แล้วข้อที่ล้มทีหลังจะได้ข้อความ "เหมือนข้อบน" ที่ชี้ไปยังที่ว่าง
    const ok = await canConnect(pg.host, pg.port);
    pgReachable = check(
      ok,
      `ต่อ Postgres ได้ (${pg.host}:${pg.port})`,
      ok ? undefined : dbFix(),
    );
  }

  const redis = hostPortOf(env["REDIS_URL"] ?? "", 6379);
  if (redis === null) {
    check(false, "ที่อยู่ Redis", "REDIS_URL อ่านไม่ออก — รันใหม่: pnpm configure");
  } else {
    const ok = await canConnect(redis.host, redis.port);
    check(
      ok,
      `ต่อ Redis ได้ (${redis.host}:${redis.port})`,
      ok ? undefined : dbFix(),
    );
  }

  // ── 4. ตารางในฐานข้อมูล ─────────────────────────────────────────────
  // ใช้ Prisma ถามตรงๆ แทนที่จะเดาจากไฟล์ migration เพราะสิ่งที่อยากรู้คือ
  // "ตารางมีอยู่จริงไหม" ไม่ใช่ "เคยสั่งสร้างหรือยัง"
  // ต้องหาผ่าน packages/store ไม่ใช่จาก root — pnpm ไม่ยกของขึ้นมาไว้ที่ root
  // ให้ ต้องถามจากแพ็กเกจที่ประกาศ dependency ตัวนี้ไว้จริง
  //
  // ข้ามถ้าต่อ Postgres ไม่ได้อยู่แล้ว — ถามไปก็ได้แต่ error เดิมซ้ำอีกรอบ
  // แถมต้องรอ timeout ของ Prisma อีกหลายวินาทีโดยไม่ได้อะไรเพิ่ม
  if (!pgReachable) {
    warn("ยังไม่ได้ตรวจตารางในฐานข้อมูล (ต่อ Postgres ไม่ได้)");
  } else if (generatedPrismaClient() === null) {
    warn("ยังไม่ได้ตรวจตารางในฐานข้อมูล (ยังไม่ได้สร้าง Prisma Client)");
  } else {
    const prismaEntry = createRequire(join(ROOT, "packages/store/package.json")).resolve(
      "@prisma/client",
    );
    const { PrismaClient } = await import(pathToFileURL(prismaEntry).href);
    const prisma = new PrismaClient({
      datasources: { db: { url: env["DATABASE_URL"] } },
    });
    try {
      const pages = await prisma.page.count();
      const tokens = await prisma.pageToken.count();
      check(true, "ตารางในฐานข้อมูลพร้อมแล้ว");

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
  // ต่อ Postgres/Redis ได้แล้วก็จบ — จะยกด้วย Docker หรือติดตั้งเองไม่สำคัญ
  // ถ้าเพิ่งบอกวิธีแก้เรื่อง Docker ไปข้างบนแล้ว ไม่ต้องพูดซ้ำอีกที่นี่
  if (dockerFixShown) {
    // ไม่ต้องทำอะไร
  } else if (docker === "ok") {
    warn("Docker พร้อมใช้งาน");
  } else if (docker === "stopped") {
    warn("ติดตั้ง Docker ไว้แล้วแต่ยังไม่ได้เปิดโปรแกรม (ไม่เป็นไร — ต่อ Postgres/Redis ได้อยู่แล้ว)");
  } else {
    warn("ไม่มี Docker บนเครื่องนี้ (ไม่เป็นไร — ต่อ Postgres/Redis ได้อยู่แล้ว)");
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
    say(
      `${c.red}${c.bold}ยังเปิดระบบไม่ได้${c.reset} — แก้ข้อที่ ✗ ข้างบนก่อน ` +
        `แล้วรัน ${c.bold}pnpm preflight${c.reset} ใหม่`,
    );
    process.exit(1);
  }
  say(`${c.green}${c.bold}พร้อมแล้ว${c.reset} — เปิดระบบด้วย ${c.bold}pnpm dev${c.reset}`);
}

main().catch((err) => {
  say(`${c.red}ตรวจไม่สำเร็จ: ${err?.message ?? String(err)}${c.reset}`);
  process.exit(1);
});
