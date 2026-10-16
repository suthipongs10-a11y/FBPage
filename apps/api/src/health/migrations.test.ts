import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsDir, pendingMigrations } from './migrations';

function fakeRepo(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'fbpm-mig-')); const dir = join(root, 'prisma/migrations');
  for (const n of names) mkdirSync(join(dir, n), { recursive: true });
  writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
  return root;
}
const db = (applied: string[]) => ({ $queryRaw: (async () => applied.map(migration_name => ({ migration_name }))) as never });

describe('pendingMigrations', () => {
  it('lists migrations that exist in code but were never applied (update without migrate)', async () => {
    const root = fakeRepo(['20260901000000_base', '20260930120000_client_portal_line', '20261001120000_service_plans']);
    const dir = migrationsDir(root);
    expect(dir).toBe(join(root, 'prisma/migrations'));
    expect(await pendingMigrations(db(['20260901000000_base']), dir)).toEqual(['20260930120000_client_portal_line', '20261001120000_service_plans']);
    expect(await pendingMigrations(db(['20260901000000_base', '20260930120000_client_portal_line', '20261001120000_service_plans']), dir)).toEqual([]);
  });
  it('returns null when the migrations folder is not shipped (cannot tell)', async () => {
    expect(migrationsDir(mkdtempSync(join(tmpdir(), 'fbpm-none-')))).toBeNull();
    expect(await pendingMigrations(db([]), null)).toBeNull();
  });
});
