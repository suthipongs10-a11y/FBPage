/**
 * ตรวจชนิดของ `apps/web` รวมไฟล์ .tsx
 *
 * ─── ทำไมต้องมีสคริปต์แยก แทนที่จะใส่ใน tsconfig รวม ───
 *
 * `tsconfig.test.json` ตรวจได้แค่ `apps/web/src/lib/**\/*.ts` เพราะไฟล์ .tsx
 * ต้องใช้ตัวเลือก `jsx` คนละชุดกับแพ็กเกจอื่น — แปลว่า **ทุกไฟล์ในโฟลเดอร์
 * app/ และ components/ ไม่เคยถูก `pnpm check` ตรวจเลย**
 *
 * ช่องโหว่นี้ปล่อยของพังผ่านมาแล้วจริง: เปลี่ยนชื่อพารามิเตอร์ของ server action
 * จาก `fbPageId` เป็น `externalId` แล้ว `pnpm check` ผ่านหมดทั้ง 1,878 ข้อ
 * ทั้งที่หน้า /insights เรียกด้วยชื่อเก่าอยู่ — กว่าจะรู้คือตอนเปิดหน้าเว็บจริง
 * และตอนนั้นข้อความที่เห็นคือ "ยังไม่ได้ใส่รหัสเพจ" ทั้งที่กรอกไปแล้ว
 *
 * ─── ทำไมต้อง `next typegen` ก่อน ───
 *
 * เปิด `typedRoutes` ไว้ (ดู next.config.ts) ซึ่งให้ Next ตรวจว่าเส้นทางที่ส่งให้
 * `<Link>` มีอยู่จริง — จับลิงก์ตายได้ตั้งแต่ตอน build แต่ชนิดของเส้นทางเป็นไฟล์
 * ที่ Next สร้างขึ้นมาเอง ถ้ายังไม่เคยสร้าง tsc จะฟ้องทุกบรรทัดที่ใช้ `<Link>`
 *
 * `next typegen` สร้างเฉพาะไฟล์ชนิด ไม่ได้ build ทั้งแอป จึงเร็วพอจะใส่ใน
 * `pnpm check` ได้ (ไม่กี่วินาที เทียบกับ `next build` ที่เป็นนาที)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps", "web");

if (!existsSync(join(web, "node_modules"))) {
  console.error("✗ ยังไม่ได้ลง dependency ของ apps/web — สั่ง pnpm install ก่อน");
  process.exit(1);
}

/** รันคำสั่งใน apps/web แล้วคืน exit code */
const run = (cmd, args) =>
  spawnSync(cmd, args, { cwd: web, stdio: "inherit", shell: process.platform === "win32" })
    .status ?? 1;

const typegen = run("npx", ["--no-install", "next", "typegen"]);
if (typegen !== 0) {
  console.error(
    "\n✗ สร้างชนิดของเส้นทางไม่สำเร็จ — ถ้าเพิ่งแก้ next.config.ts ให้ดูว่าไฟล์นั้นอ่านได้ไหม",
  );
  process.exit(typegen);
}

const tsc = run("npx", ["--no-install", "tsc", "-p", "tsconfig.json", "--noEmit"]);
if (tsc !== 0) {
  console.error("\n✗ apps/web ตรวจชนิดไม่ผ่าน — ดูรายการข้างบน");
  process.exit(tsc);
}

console.log("✓ apps/web ตรวจชนิดผ่าน (รวมไฟล์ .tsx)");
