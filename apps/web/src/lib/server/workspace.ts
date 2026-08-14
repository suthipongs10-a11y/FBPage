import "server-only";

/**
 * ข้อมูลจริงสำหรับหน้าจอฝั่งปฏิบัติการ — แทนที่ `demo-workspace.ts`
 *
 * ก่อนมีไฟล์นี้ `/`, `/inbox`, `/calendar`, `/ops`, `/pages` อ่านข้อมูลสมมติ
 * ทั้งหมด คนที่เพิ่งติดตั้งเสร็จจึงเห็น "มี 3 เรื่องที่พังอยู่ตอนนี้" พร้อมชื่อ
 * เพจที่ไม่มีอยู่จริง
 *
 * ที่นี่ทำแค่สองอย่าง: **อ่านจากฐานข้อมูล** แล้ว**ส่งต่อให้ตัวแปลง**
 * ส่วนตรรกะว่าอะไรด่วนกว่าอะไรอยู่ที่ `today.ts` + `packages/ops`
 * และการแปลงแถวอยู่ที่ `workspace-mapping.ts` (เทสต์ได้โดยไม่ต้องมี Postgres)
 *
 * ─── ทำไมคืน error แทนที่จะโยน ───
 *
 * หน้าเหล่านี้คือหน้าแรกที่คนเปิดหลังติดตั้ง ถ้าฐานข้อมูลยังไม่พร้อมแล้วโยน
 * error ออกไป Next จะขึ้นหน้า 500 ที่ไม่บอกอะไรเลย — ซึ่งแย่กว่าการบอกตรงๆ
 * ว่า "สั่ง docker compose up -d แล้วรีเฟรช" (แนวเดียวกับ `comments.ts`)
 */
import { PrismaWorkspaceQueries } from "@page-os/store";
import { prisma } from "@/lib/server/deps";
import {
  assembleWorkspace,
  describeDbError,
  emptyWorkspace,
} from "@/lib/workspace-mapping";
import type { Workspace } from "@/lib/workspace";

export interface WorkspaceLoad {
  ws: Workspace;
  /** `null` = อ่านสำเร็จ ไม่ว่าจะมีข้อมูลหรือไม่ */
  errorTh: string | null;
  /** ยังไม่ได้เชื่อมเพจสักเพจ — หน้าจอควรชวนไปหน้าตั้งค่าแทนที่จะโชว์ศูนย์เปล่าๆ */
  empty: boolean;
}

/**
 * อ่านทั้งเวิร์กสเปซจากฐานข้อมูลจริง
 *
 * ทุกหน้าที่เรียกต้องส่ง `nowMs` เดียวกันตลอดทั้งหน้า เพื่อไม่ให้ตัวเลข
 * ในหน้าเดียวกันคิดจากคนละวินาที (กฎข้อ 4)
 */
export async function loadWorkspace(nowMs: number): Promise<WorkspaceLoad> {
  try {
    const queries = new PrismaWorkspaceQueries(prisma());
    const snapshot = await queries.snapshot(nowMs);
    return {
      ws: assembleWorkspace(snapshot, nowMs),
      errorTh: null,
      empty: snapshot.pages.length === 0,
    };
  } catch (err) {
    return {
      ws: emptyWorkspace(nowMs),
      errorTh: describeDbError(err),
      empty: true,
    };
  }
}
