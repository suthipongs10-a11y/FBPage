/**
 * @fbpm/database — จุดเดียวที่ import Prisma client
 * ทุก query ที่แตะข้อมูลผู้เช่าต้อง scope ด้วย workspaceId (AGENTS.md §57) — ดู tenant.ts
 */
export { PrismaClient, Prisma } from '../generated/client';
export type * from '../generated/client';
export * from './tenant';
export * from './crypto';
export * from './notify';
export * from './mail';
