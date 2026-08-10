#!/usr/bin/env node
/**
 * ตัวตั้งค่าแบบถาม-ตอบ — สร้างไฟล์ `.env` ให้
 *
 *   pnpm configure
 *
 * ─── เรื่องที่ระวังเป็นพิเศษ ───
 *
 * `TOKEN_ENC_KEYS` คือกุญแจที่ใช้ถอดรหัส token ของทุกเพจ ถ้าสร้างทับของเดิม
 * token ที่เก็บไว้จะถอดไม่ได้อีกเลย และไม่มีทางกู้ — ต้องไปเชื่อมเพจใหม่ทุกเพจ
 * สคริปต์นี้จึง **ไม่มีทาง**สร้างทับค่าที่มีอยู่แล้ว ต้องลบออกจาก .env เองก่อน
 * เท่านั้น (และถ้าทำ มันจะเตือนอีกรอบ)
 */
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { ENV_SPEC, parseEnvFile, maskSecret, checkEnv } from "./env-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

const say = (s = "") => stdout.write(s + "\n");
const head = (s) => say(`\n${c.bold}${c.cyan}${s}${c.reset}`);

function genKeyring() {
  return `k1:${randomBytes(32).toString("base64")}`;
}

function genVerifyToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * ตัวถาม ที่ทำงานได้ทั้งตอนคนพิมพ์เองและตอนป้อนค่าผ่าน pipe
 *
 * ─── ทำไมต้องแยกสองทาง ───
 *
 * `readline.question()` ดักบรรทัดแบบ "ครั้งเดียวต่อหนึ่งคำถาม" ตอนคนพิมพ์
 * บรรทัดมาทีละบรรทัดพอดีกับจังหวะที่มีคำถามค้างอยู่ จึงไม่มีปัญหา
 *
 * แต่ตอนป้อนผ่าน pipe (`pnpm configure < answers.txt`) ข้อมูลมาถึงพร้อมกันทั้งก้อน
 * readline ยิง event ออกมารวดเดียวทุกบรรทัด — คำถามแรกรับไปบรรทัดเดียว
 * **ที่เหลือหายหมด** แล้วคำถามที่สองจะรอตลอดกาลจนโปรเซสจบไปเฉยๆ (exit 0)
 * โดยไม่มี error อะไรเลย ซึ่งหลอกมาก
 *
 * ตอนไม่ใช่ terminal จึงอ่าน stdin มาเก็บไว้ให้ครบก่อน แล้วค่อยแจกทีละบรรทัด
 */
async function makeAsker() {
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    return {
      ask: (q) => rl.question(q),
      close: () => rl.close(),
      interactive: true,
    };
  }

  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  const lines = Buffer.concat(chunks).toString("utf8").split("\n");
  let i = 0;
  return {
    ask: async (q) => {
      stdout.write(q);
      const line = i < lines.length ? lines[i++] : "";
      stdout.write(line + "\n");
      return line;
    },
    close: () => {},
    interactive: false,
  };
}

async function main() {
  const rl = await makeAsker();

  say(`${c.bold}PAGE OS — ตั้งค่าเพื่อรันบนเครื่องตัวเอง${c.reset}`);
  say(c.dim + "กด Enter เพื่อใช้ค่าที่แสดงในวงเล็บ / กด Ctrl+C เพื่อออก" + c.reset);

  const existing = existsSync(ENV_PATH)
    ? parseEnvFile(readFileSync(ENV_PATH, "utf8"))
    : {};

  if (existsSync(ENV_PATH)) {
    say(
      `\n${c.yellow}พบไฟล์ .env อยู่แล้ว${c.reset} — ค่าที่มีอยู่จะขึ้นเป็นค่าเริ่มต้นให้กด Enter ผ่านได้`,
    );
  }

  /** @type {Record<string,string>} */
  const answers = {};
  let lastGroup = "";

  for (const spec of ENV_SPEC) {
    if (spec.group !== lastGroup) {
      head(`── ${spec.group} ──`);
      lastGroup = spec.group;
    }

    const current = existing[spec.key];

    // ── กุญแจเข้ารหัส: ห้ามสร้างทับเด็ดขาด ──────────────────────────────
    if (spec.key === "TOKEN_ENC_KEYS") {
      if (current !== undefined && current.trim() !== "") {
        answers[spec.key] = current;
        say(`${c.green}✓${c.reset} ${spec.labelTh} — ใช้ของเดิมที่มีอยู่`);
        say(
          c.dim +
            "  (ไม่สร้างใหม่ให้โดยตั้งใจ — สร้างทับแล้ว token ของทุกเพจจะถอดรหัสไม่ได้อีกเลย)" +
            c.reset,
        );
      } else {
        answers[spec.key] = genKeyring();
        say(`${c.green}✓${c.reset} ${spec.labelTh} — สร้างใหม่ให้แล้ว`);
        say(
          `  ${c.yellow}⚠️  เก็บไฟล์ .env ไว้ให้ดี${c.reset} ถ้าหายแล้วเชื่อมเพจไปแล้ว ` +
            `จะถอด token เดิมไม่ได้ ต้องเชื่อมใหม่ทุกเพจ`,
        );
      }
      continue;
    }

    // ── ค่าอื่นๆ: ถาม ──────────────────────────────────────────────────
    say("");
    say(`${c.bold}${spec.labelTh}${c.reset} ${c.dim}(${spec.key})${c.reset}`);
    say(`${c.dim}  ${spec.whereTh}${c.reset}`);

    const shown =
      current !== undefined && current.trim() !== ""
        ? spec.secret
          ? maskSecret(current)
          : current
        : (spec.defaultValue ?? "");

    // จำกัดจำนวนครั้ง เพื่อไม่ให้วนไม่รู้จบเวลารันแบบป้อนค่าผ่าน pipe
    // แล้ว input หมดก่อน (question() จะคืนค่าว่างรัวๆ)
    for (let attempt = 1; ; attempt++) {
      if (attempt > 3) {
        throw new Error(
          `ใส่ค่า ${spec.key} ไม่ผ่านสามครั้งติด — หยุดไว้ก่อนเพื่อไม่ให้วนไม่รู้จบ ` +
            `ลองรัน pnpm configure ใหม่ หรือแก้ไฟล์ .env ตรงๆ`,
        );
      }
      const hint = shown === "" ? "" : ` [${shown}]`;
      const suffix = spec.need === "optional" ? c.dim + " (ไม่ใส่ก็ได้)" + c.reset : "";
      const typed = (await rl.ask(`  ค่า${suffix}${hint}: `)).trim();

      let value = typed;
      if (value === "") {
        // Enter เปล่า = ใช้ของเดิม ถ้าไม่มีของเดิมก็ใช้ค่าเริ่มต้น
        value = current ?? spec.defaultValue ?? "";
      }

      // verify token ปล่อยว่างได้ → สุ่มให้
      if (value === "" && spec.key === "META_WEBHOOK_VERIFY_TOKEN") {
        value = genVerifyToken();
        say(`  ${c.green}สุ่มให้แล้ว${c.reset} ${c.dim}(${maskSecret(value)})${c.reset}`);
      }

      if (value === "") {
        if (spec.need === "optional") break;
        say(`  ${c.red}ค่านี้จำเป็น — ระบบสตาร์ทไม่ขึ้นถ้าไม่มี${c.reset}`);
        continue;
      }

      const err = spec.validate?.(value);
      if (err !== null && err !== undefined) {
        say(`  ${c.red}✗ ${err}${c.reset}`);
        continue;
      }

      answers[spec.key] = value;
      break;
    }
  }

  rl.close();

  // ── เขียนไฟล์ ─────────────────────────────────────────────────────────
  if (existsSync(ENV_PATH)) {
    const backup = `${ENV_PATH}.bak`;
    copyFileSync(ENV_PATH, backup);
    say(`\n${c.dim}สำรองไฟล์เดิมไว้ที่ .env.bak แล้ว${c.reset}`);
  }

  const lines = [
    "# สร้างโดย `pnpm configure` — ห้าม commit ไฟล์นี้",
    "# แก้ค่าทีหลังได้โดยรัน `pnpm configure` ใหม่ หรือแก้ไฟล์นี้ตรงๆ",
    "",
  ];
  let group = "";
  for (const spec of ENV_SPEC) {
    const v = answers[spec.key];
    if (v === undefined || v === "") continue;
    if (spec.group !== group) {
      lines.push(`# ── ${spec.group} ──`);
      group = spec.group;
    }
    lines.push(`${spec.key}=${v}`);
  }
  lines.push("");

  writeFileSync(ENV_PATH, lines.join("\n"), { mode: 0o600 });
  // เผื่อไฟล์มีอยู่แล้วด้วยสิทธิ์กว้างกว่านี้ — writeFileSync ไม่เปลี่ยน mode ของไฟล์เดิม
  chmodSync(ENV_PATH, 0o600);

  const problems = checkEnv(answers);
  say("");
  if (problems.length === 0) {
    say(`${c.green}${c.bold}✓ เขียน .env เรียบร้อย${c.reset} (ตั้งสิทธิ์ไฟล์เป็น 600 ให้แล้ว)`);
  } else {
    say(`${c.yellow}เขียน .env แล้ว แต่ยังมีค่าที่ต้องแก้:${c.reset}`);
    for (const p of problems) say(`  ${c.red}✗${c.reset} ${p.th}`);
  }

  head("ขั้นต่อไป");
  say("  1. ยกฐานข้อมูลขึ้น        docker compose up -d");
  say("  2. สร้างตาราง            pnpm db:push");
  say("  3. ตรวจความพร้อม         pnpm preflight");
  say("  4. เปิดระบบ              pnpm dev");
  say("");
}

main().catch((err) => {
  say(`\n${c.red}ตั้งค่าไม่สำเร็จ: ${err?.message ?? String(err)}${c.reset}`);
  process.exit(1);
});
