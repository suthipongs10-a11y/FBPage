import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@fbpm/database';

/** โฟลเดอร์ migration: image production คัดลอกไว้ที่ /app/prisma · เครื่องพัฒนาอยู่ใน packages/database */
export function migrationsDir(cwd = process.cwd()): string | null {
  const candidates = [join(cwd, 'prisma/migrations'), join(cwd, 'packages/database/prisma/migrations'), join(cwd, '../../packages/database/prisma/migrations')];
  return candidates.find(d => existsSync(d)) ?? null;
}

/** migration ที่มีในโค้ดแต่ยังไม่ได้รันกับฐานข้อมูล — null = ตรวจไม่ได้ (ไม่พบโฟลเดอร์) */
export async function pendingMigrations(prisma: Pick<PrismaClient, '$queryRaw'>, dir = migrationsDir()): Promise<string[] | null> {
  if (!dir) return null;
  const inCode = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && /^\d{14}_/.test(d.name)).map(d => d.name);
  const applied = await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const done = new Set(applied.map(r => r.migration_name));
  return inCode.filter(n => !done.has(n)).sort();
}
