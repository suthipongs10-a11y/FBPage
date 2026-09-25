import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type WorkspaceRole } from '@fbpm/shared';

export const REQUIRE_PERMISSION_KEY = 'fbpm:requirePermission';
/** ใส่บน handler เพื่อให้ TenantGuard ตรวจ — ต้องมีครบทุกตัวที่ระบุ */
export const RequirePermission = (...perms: Permission[]) => SetMetadata(REQUIRE_PERMISSION_KEY, perms);

const isPermission = (p: string): p is Permission => (PERMISSIONS as readonly string[]).includes(p);

/** สิทธิ์จริงของสมาชิก = ค่าเริ่มต้นของบทบาท ∪ สิทธิ์เพิ่มรายคน (เฉพาะที่รู้จัก) (§58) */
export function effectivePermissions(role: WorkspaceRole, extra: readonly string[] = []): readonly Permission[] {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const p of extra) if (isPermission(p)) set.add(p);
  return [...set];
}

export const hasAll = (have: readonly Permission[], need: readonly Permission[]): boolean => need.every(p => have.includes(p));
