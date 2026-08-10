#!/usr/bin/env node
/**
 * เปิดทั้งระบบด้วยคำสั่งเดียว
 *
 *   pnpm dev
 *
 * รันสามตัวพร้อมกันแล้วรวม log มาไว้ที่เดียว โดยติดชื่อบริการไว้หน้าบรรทัด
 *
 * ─── ทำไมเขียนเองแทนที่จะลง `concurrently` ───
 *
 * 1. log ของโปรเจ็คนี้เป็น JSON บรรทัดเดียว — ตัวช่วยทั่วไปจะพ่นออกมาดิบๆ
 *    อ่านไม่ไหว ที่นี่แปลงเป็นบรรทัดที่คนอ่านได้ แล้วเก็บ JSON เต็มไว้ในไฟล์
 * 2. ปิดให้ครบ: กด Ctrl+C ครั้งเดียวต้องส่ง SIGTERM ให้ทุกตัวแล้ว **รอ** ให้
 *    graceful shutdown ทำงานจบ ไม่ใช่ฆ่าทิ้งทันที — ไม่งั้นงานที่กำลังทำค้าง
 *    เป็น active ใน Redis แล้วต้องรอ stalled timeout ทุกครั้งที่รีสตาร์ท
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { parseEnvFile } from "./env-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = join(ROOT, ".logs");

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

const IS_WINDOWS = process.platform === "win32";

/**
 * สีประจำบริการ ให้กวาดตาแล้วแยกออกทันที
 *
 * ─── ทำไมเรียก node ใส่ไฟล์ .js ของ next ตรงๆ ───
 *
 * 1. ไม่ผ่าน `pnpm --filter` เพราะ pnpm แทรกโปรเซสห่อไว้อีกชั้น แล้วตอนกด Ctrl+C
 *    มันจะพ่น "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL / Command failed" ออกมา
 *    ทั้งที่เป็นการปิดตามปกติ — คนเห็นแล้วนึกว่าพัง
 * 2. ไม่เรียก `node_modules/.bin/next` เพราะไฟล์นั้นเป็นสคริปต์เชลล์ (`#!/bin/sh`)
 *    `spawn()` บน Windows รันไฟล์แบบนั้นไม่ได้ — ต้องเป็น `next.CMD` แทน
 *    เรียก `node <ไฟล์ .js จริง>` จึงใช้ได้เหมือนกันทุกระบบปฏิบัติการ
 *    โดยไม่ต้องแยกเคส
 */
const SERVICES = [
  {
    name: "web    ",
    color: "\x1b[36m",
    cmd: process.execPath,
    args: ["node_modules/next/dist/bin/next", "dev"],
    cwd: "apps/web",
  },
  {
    name: "webhook",
    color: "\x1b[35m",
    cmd: process.execPath,
    args: ["apps/webhook/dist/server.js"],
  },
  {
    name: "worker ",
    color: "\x1b[32m",
    cmd: process.execPath,
    args: ["apps/worker/dist/main.js"],
  },
];

const LEVEL_COLOR = { error: C.red, warn: C.yellow, info: "", debug: C.dim };

/**
 * แปลง log JSON หนึ่งบรรทัดเป็นบรรทัดที่คนอ่านได้
 * บรรทัดที่ไม่ใช่ JSON (เช่นของ Next.js) ปล่อยผ่านตามเดิม
 */
function pretty(line) {
  if (!line.startsWith("{")) return line;
  try {
    const r = JSON.parse(line);
    if (typeof r.msg !== "string") return line;
    const time = typeof r.ts === "string" ? r.ts.slice(11, 19) : "";
    const color = LEVEL_COLOR[r.level] ?? "";
    const skip = new Set(["ts", "level", "msg", "service"]);
    const extra = Object.entries(r)
      .filter(([k, v]) => !skip.has(k) && v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" ");
    return `${C.dim}${time}${C.reset} ${color}${r.msg}${C.reset}${extra ? ` ${C.dim}${extra}${C.reset}` : ""}`;
  } catch {
    return line;
  }
}

function main() {
  if (!existsSync(join(ROOT, ".env"))) {
    console.error(
      `${C.red}ยังไม่มีไฟล์ .env${C.reset} — รัน ${C.bold}pnpm setup${C.reset} ก่อน`,
    );
    process.exit(1);
  }
  if (!existsSync(join(ROOT, "apps/worker/dist/main.js"))) {
    console.error(
      `${C.red}ยังไม่ได้ build${C.reset} — รัน ${C.bold}pnpm build${C.reset} ก่อน`,
    );
    process.exit(1);
  }

  // โหลด .env เข้ามาเองแล้วส่งต่อให้ลูกทุกตัว
  //
  // ไม่พึ่ง `--env-file` ของ Node เพราะ Next.js อ่าน .env จากโฟลเดอร์ของตัวเอง
  // (apps/web) ไม่ใช่จากรากของ monorepo — ถ้าไม่ส่งต่อให้ หน้าเว็บจะไม่เห็น
  // DATABASE_URL แล้วพังตอนเปิดหน้าแรก โดยที่อีกสองตัวทำงานปกติ
  const childEnv = { ...process.env, ...parseEnvFile(readFileSync(join(ROOT, ".env"), "utf8")) };

  mkdirSync(LOG_DIR, { recursive: true });

  // ประกาศก่อนสร้างลูก เพราะ handler ของ exit อ้างถึงตัวแปรนี้
  let shuttingDown = false;
  const children = [];

  /**
   * บอก URL ของหน้าเว็บ **หลังจาก** Next บอกมาแล้วว่าจับพอร์ตไหนได้จริง
   *
   * เดิมพิมพ์ "http://localhost:3000" ไว้ล่วงหน้าตายตัว แล้วเจอตอนทดสอบว่า
   * ถ้าพอร์ต 3000 ไม่ว่าง Next จะย้ายไปพอร์ตอื่นเงียบๆ (เช่น 3002) —
   * บรรทัดที่เราพิมพ์จึงชี้ไปที่ที่ไม่มีอะไรอยู่ คนกดตามแล้วเจอหน้าว่าง
   * แล้วเข้าใจว่าระบบพัง ทั้งที่มันทำงานอยู่แค่คนละพอร์ต
   */
  let announced = false;
  const announceWhenReady = (line) => {
    if (announced) return;
    const m = /-\s*Local:\s+(http:\/\/\S+)/.exec(line);
    if (m === null) return;
    announced = true;
    const url = m[1];
    const moved = !url.endsWith(":3000");
    process.stdout.write(
      `\n${C.bold}เปิดครบแล้ว${C.reset}\n` +
        `  หน้าเว็บ   ${url}${moved ? `  ${C.yellow}(พอร์ต 3000 ไม่ว่าง จึงย้ายมาพอร์ตนี้)${C.reset}` : ""}\n` +
        `  ตั้งค่า    ${url}/settings\n` +
        `  webhook   http://localhost:${childEnv.WEBHOOK_PORT ?? 3001}/healthz\n\n`,
    );
  };
  for (const svc of SERVICES) {
    const logFile = createWriteStream(join(LOG_DIR, `${svc.name.trim()}.log`), {
      flags: "a",
    });
    const child = spawn(svc.cmd, svc.args, {
      cwd: svc.cwd === undefined ? ROOT : join(ROOT, svc.cwd),
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      // ให้ลูกเป็นหัวหน้ากลุ่มโปรเซสของตัวเอง เพื่อให้ส่งสัญญาณถึง "หลานๆ" ได้ด้วย
      // ดูเหตุผลที่ `killTree()` — Windows ไม่มีกลุ่มโปรเซสแบบนี้
      detached: !IS_WINDOWS,
    });

    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", (line) => {
        // เก็บ JSON ดิบไว้ในไฟล์ — เวลาต้องไล่ปัญหาจริงต้องการฟิลด์ครบ
        logFile.write(line + "\n");
        process.stdout.write(`${svc.color}${svc.name}${C.reset} │ ${pretty(line)}\n`);
        announceWhenReady(line);
      });
    }

    child.on("error", (err) => {
      // เกิดตอนสั่งรันไม่ได้เลย (หาไฟล์ไม่เจอ / ไม่มีสิทธิ์) — คนละเรื่องกับ
      // "รันแล้วตาย" และถ้าไม่ดักไว้ Node จะถือเป็น unhandled แล้วปิดทั้งชุด
      process.stdout.write(
        `${svc.color}${svc.name}${C.reset} │ ${C.red}สั่งรันไม่ได้: ${err.message}${C.reset}\n`,
      );
    });

    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      process.stdout.write(
        `${svc.color}${svc.name}${C.reset} │ ${C.red}หยุดทำงาน (code=${code} signal=${signal})${C.reset}\n`,
      );
      /**
       * ตายก่อนที่หน้าเว็บจะพร้อม = สตาร์ทไม่ขึ้น ไม่ใช่ล้มระหว่างทาง
       *
       * ถ้าไม่บอกอะไรเลย คนจะนั่งรอบรรทัด "เปิดครบแล้ว" ที่ไม่มีวันมา
       * แล้วไปเปิด localhost:3000 เจอหน้าว่าง โดยไม่รู้ว่าต้องดู log ตรงไหน
       */
      if (!announced) {
        process.stdout.write(
          `\n${C.red}${C.bold}${svc.name.trim()} สตาร์ทไม่ขึ้น${C.reset} — ` +
            `ดูสาเหตุเต็มๆ ที่ ${C.bold}.logs/${svc.name.trim()}.log${C.reset}\n` +
            `${C.dim}ถ้ายังไม่แน่ใจ ลองรัน ${C.reset}${C.bold}pnpm doctor${C.reset}${C.dim} เพื่อไล่ทีละข้อ${C.reset}\n\n`,
        );
      }
    });

    children.push({ svc, child });
  }

  console.log(
    `${C.dim}log เต็มอยู่ที่ .logs/ · กด Ctrl+C เพื่อปิดทั้งหมด${C.reset}`,
  );

  /**
   * ส่งสัญญาณถึงทั้งกลุ่ม ไม่ใช่แค่ตัวลูก
   *
   * ─── ปัญหาที่เจอตอนทดสอบ ───
   *
   * `next dev` ไม่ได้เป็นเซิร์ฟเวอร์เอง แต่ fork โปรเซสลูกชื่อ `next-server`
   * ออกไปอีกที พอส่ง SIGTERM ให้ `next dev` ตัวแม่ตายแต่ **`next-server`
   * ยังอยู่** แล้วยังจับพอร์ต 3000 ไว้
   *
   * ผลคือรอบถัดไปที่ `pnpm dev` Next จะเห็นว่าพอร์ตไม่ว่างแล้วเลื่อนไปพอร์ตอื่น
   * ทุกครั้งที่เปิด-ปิด พอร์ตจะไต่ขึ้นเรื่อยๆ (3000 → 3002 → 3003 → …)
   * และมีโปรเซสค้างสะสมโดยไม่มีใครรู้
   *
   * แก้ด้วยการให้ลูกแต่ละตัวเป็นหัวหน้ากลุ่ม (`detached`) แล้วส่งสัญญาณไปที่
   * **กลุ่ม** ด้วย pid ติดลบ — หลานทุกตัวจึงได้รับสัญญาณด้วย
   */
  const killTree = (child, signal) => {
    if (child.pid === undefined || child.exitCode !== null) return;

    if (IS_WINDOWS) {
      // Windows ไม่มีกลุ่มโปรเซสแบบ POSIX — ใช้ taskkill ไล่ลบทั้งต้นไม้แทน
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } catch {
        child.kill();
      }
      return;
    }

    try {
      process.kill(-child.pid, signal);
    } catch {
      // กลุ่มหายไปแล้ว (ลูกตายไปก่อน) — ลองส่งตรงๆ เผื่อยังมีตัวลูกอยู่
      try {
        child.kill(signal);
      } catch {
        /* ตายไปแล้วจริงๆ */
      }
    }
  };

  const stop = () => {
    if (shuttingDown) {
      // กดครั้งที่สอง = ไม่รอแล้ว
      for (const { child } of children) killTree(child, "SIGKILL");
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`\n${C.dim}กำลังปิด... (กด Ctrl+C อีกครั้งเพื่อไม่รอ)${C.reset}`);
    for (const { child } of children) killTree(child, "SIGTERM");

    // รอให้ทุกตัวปิดเอง — worker ต้องใช้เวลาปิดคิวกับฐานข้อมูลให้เรียบร้อย
    const deadline = Date.now() + 25_000;
    const tick = setInterval(() => {
      const alive = children.filter(({ child }) => child.exitCode === null);
      if (alive.length === 0) {
        clearInterval(tick);
        process.exit(0);
      }
      if (Date.now() > deadline) {
        clearInterval(tick);
        console.log(`${C.yellow}บางตัวปิดไม่ลงในเวลาที่ให้ — บังคับปิด${C.reset}`);
        for (const { child } of alive) killTree(child, "SIGKILL");
        process.exit(1);
      }
    }, 200);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
