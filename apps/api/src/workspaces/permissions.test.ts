import { describe, expect, it } from 'vitest';
import { effectivePermissions, hasAll } from './permissions';

describe('effectivePermissions (§58)', () => {
  it('viewer gets read-only defaults', () => {
    const p = effectivePermissions('viewer');
    expect(p).toContain('client.read');
    expect(p).not.toContain('client.manage');
  });
  it('adds known extra permissions and ignores unknown strings', () => {
    const p = effectivePermissions('viewer', ['content.approve', 'not.a.permission']);
    expect(p).toContain('content.approve');
    expect(p).not.toContain('not.a.permission' as never);
  });
  it('hasAll requires every permission', () => {
    expect(hasAll(['client.read', 'client.manage'], ['client.read'])).toBe(true);
    expect(hasAll(['client.read'], ['client.read', 'client.manage'])).toBe(false);
  });
});
