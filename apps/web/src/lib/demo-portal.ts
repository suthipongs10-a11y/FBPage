/**
 * ข้อมูลตัวอย่างสำหรับหน้า portal ของลูกค้า
 *
 * ต่อกับ `@page-os/portal` ของจริงทุกจุด — ขอบเขต การกรอง การตรวจข้อมูลรั่ว
 * และการกดอนุมัติ ล้วนวิ่งผ่านฟังก์ชันเดียวกับที่จะใช้ตอนต่อฐานข้อมูลจริง
 * สิ่งเดียวที่เป็นของปลอมคือ "ที่เก็บข้อมูล"
 */
import {
  DEFAULT_PERMISSIONS,
  buildPortalCalendar,
  decideFromPortal,
  prepareBranding,
  type BrandCheckResult,
  type CalendarSourceRow,
  type PortalCalendar,
  type PortalScope,
} from "@page-os/portal";
import type { ApprovalDecision, ApprovalStatus } from "@page-os/publish";
import { buildDemoWorkspace } from "@/lib/demo-workspace";

export interface PortalTenant {
  subdomain: string;
  clientName: string;
  workspaceId: string;
  email: string;
  brand: BrandCheckResult;
}

const TENANTS: Array<{
  subdomain: string;
  clientName: string;
  workspaceId: string;
  email: string;
  displayName: string;
  primaryColor: string;
  welcomeTh: string;
}> = [
  {
    subdomain: "kruakhunyai",
    clientName: "ครัวคุณยาย",
    workspaceId: "ws-krua",
    email: "owner@kruakhunyai.example",
    displayName: "ครัวคุณยาย",
    primaryColor: "#b3261e",
    welcomeTh: "ปฏิทินคอนเทนต์เดือนนี้ของร้านเราค่ะ กดดูแล้วอนุมัติได้เลย",
  },
  {
    subdomain: "pladang",
    clientName: "บ้านขนมป้าแดง",
    workspaceId: "ws-pladang",
    email: "boss@pladang.example",
    displayName: "บ้านขนมป้าแดง",
    primaryColor: "#8a5a00",
    welcomeTh: "คอนเทนต์ที่เตรียมไว้ให้ร้านค่ะ",
  },
  {
    subdomain: "ratchadadental",
    clientName: "รัชดาเดนทัล",
    workspaceId: "ws-dental",
    email: "admin@ratchadadental.example",
    displayName: "รัชดาเดนทัล",
    primaryColor: "#0b5cab",
    welcomeTh: "แผนคอนเทนต์คลินิกเดือนนี้",
  },
];

export function listTenants(): string[] {
  return TENANTS.map((t) => t.subdomain);
}

export function findTenant(subdomain: string): PortalTenant | null {
  const t = TENANTS.find((x) => x.subdomain === subdomain);
  if (!t) return null;
  return {
    subdomain: t.subdomain,
    clientName: t.clientName,
    workspaceId: t.workspaceId,
    email: t.email,
    brand: prepareBranding({
      workspaceId: t.workspaceId,
      displayName: t.displayName,
      primaryColor: t.primaryColor,
      subdomain: t.subdomain,
      welcomeTh: t.welcomeTh,
    }),
  };
}

/**
 * ผลการกดอนุมัติที่ยังไม่มีที่เก็บจริง
 *
 * อยู่ในหน่วยความจำของ process — รีสตาร์ทแล้วหาย แต่พอให้เห็นว่าเส้นทาง
 * ทั้งเส้นทำงานจริง: กดปุ่ม → ตรวจสิทธิ์ → ตรวจความเป็นเจ้าของ → บันทึก
 */
const decisions = new Map<string, ApprovalStatus>();
const notes = new Map<string, string>();

/** ขอบเขตของ session ลูกค้ารายนี้ — ในของจริงมาจาก `PortalAuth.verifySession()` */
export function scopeOf(tenant: PortalTenant, nowMs: number): PortalScope {
  const ws = buildDemoWorkspace(nowMs);
  return {
    workspaceId: tenant.workspaceId,
    clientName: tenant.clientName,
    pageIds: ws.pages
      .filter((p) => p.clientName === tenant.clientName)
      .map((p) => p.pageId),
    permissions: DEFAULT_PERMISSIONS,
    email: tenant.email,
  };
}

function sourceRows(nowMs: number): CalendarSourceRow[] {
  const ws = buildDemoWorkspace(nowMs);
  return ws.scheduled.map((s) => {
    const page = ws.pages.find((p) => p.pageId === s.pageId);
    return {
      postId: s.postId,
      pageId: s.pageId,
      pageName: page?.pageName ?? s.pageId,
      scheduledAtMs: s.scheduledAtMs,
      body: s.preview,
      pillarLabelTh: s.pillarLabelTh,
      approval: decisions.get(s.postId) ?? s.approval,
    };
  });
}

export function portalCalendarOf(
  tenant: PortalTenant,
  nowMs: number,
  days = 30,
): PortalCalendar {
  return buildPortalCalendar(scopeOf(tenant, nowMs), sourceRows(nowMs), {
    fromMs: nowMs,
    toMs: nowMs + days * 86_400_000,
  });
}

/**
 * ลูกค้ากดปุ่ม
 *
 * เรียก `decideFromPortal()` ตัวจริง — ซึ่งแปลว่าด่านกัน IDOR ทำงานอยู่จริง
 * ในหน้านี้ ลอง `postId` ของลูกค้ารายอื่นดูก็จะถูกปฏิเสธ
 */
export async function decideDemo(
  tenant: PortalTenant,
  postId: string,
  decision: ApprovalDecision,
  nowMs: number,
  note?: string,
): Promise<{ th: string }> {
  const rows = sourceRows(nowMs);
  const result = await decideFromPortal(
    scopeOf(tenant, nowMs),
    {
      async findPost(id) {
        const r = rows.find((x) => x.postId === id);
        return r ? { postId: r.postId, pageId: r.pageId } : null;
      },
      async decide(args) {
        const next: ApprovalStatus =
          args.decision === "approve" ? "approved" : "changes_requested";
        decisions.set(args.postId, next);
        // ข้อความที่ลูกค้าพิมพ์คือของสำคัญที่สุดของการ "ขอแก้ไข" —
        // ในของจริงจะถูกเก็บลง DB พร้อมสถานะ ที่นี่เก็บไว้ให้อ่านย้อนหลังได้
        if (args.note !== undefined) notes.set(args.postId, args.note);
        return {
          status: next,
          th:
            next === "approved"
              ? "อนุมัติเรียบร้อย โพสต์จะขึ้นตามเวลาที่ตั้งไว้"
              : "รับเรื่องขอแก้ไขแล้ว ทีมงานจะแก้แล้วส่งให้ดูใหม่",
        };
      },
    },
    { postId, decision, nowMs, ...(note !== undefined ? { note } : {}) },
  );

  return { th: result.th };
}

/** ข้อความขอแก้ไขที่ลูกค้าพิมพ์ไว้ — ใช้แสดงฝั่งทีมงาน */
export function noteOf(postId: string): string | undefined {
  return notes.get(postId);
}
