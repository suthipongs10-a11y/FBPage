import { describe, expect, it } from 'vitest';
import {
  canTransitionContent, nextContentStatuses, CONTENT_STATUSES,
  toolAllowedWithoutApproval, hasPermission, ROLE_PERMISSIONS, PERMISSIONS,
} from './index';

describe('content state machine (§28)', () => {
  it('follows the happy path', () => {
    const path = ['IDEA', 'PLANNED', 'DRAFT', 'AI_REVIEW', 'READY_FOR_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'ANALYZED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransitionContent(path[i], path[i + 1])).toBe(true);
  });
  it('blocks skipping approval', () => {
    expect(canTransitionContent('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransitionContent('DRAFT', 'SCHEDULED')).toBe(false);
    expect(canTransitionContent('READY_FOR_APPROVAL', 'PUBLISHING')).toBe(false);
  });
  it('terminal states have no exits', () => {
    expect(nextContentStatuses('ANALYZED')).toHaveLength(0);
    expect(nextContentStatuses('CANCELLED')).toHaveLength(0);
  });
  it('failure states are recoverable', () => {
    expect(canTransitionContent('PUBLISH_FAILED', 'SCHEDULED')).toBe(true);
    expect(canTransitionContent('REJECTED', 'DRAFT')).toBe(true);
  });
  it('every status has a transition table entry', () => {
    for (const s of CONTENT_STATUSES) expect(Array.isArray(nextContentStatuses(s))).toBe(true);
  });
});

describe('tool risk vs automation level (§27, §44)', () => {
  it('READ is always allowed', () => {
    expect(toolAllowedWithoutApproval('READ', 'READ_ONLY')).toBe(true);
  });
  it('WRITE needs at least AUTO_DRAFT', () => {
    expect(toolAllowedWithoutApproval('WRITE', 'READ_ONLY')).toBe(false);
    expect(toolAllowedWithoutApproval('WRITE', 'AUTO_DRAFT')).toBe(true);
  });
  it('PUBLISH only in FULL_AUTO', () => {
    expect(toolAllowedWithoutApproval('PUBLISH', 'APPROVAL_REQUIRED')).toBe(false);
    expect(toolAllowedWithoutApproval('PUBLISH', 'FULL_AUTO')).toBe(true);
  });
  it('MONEY never auto', () => {
    expect(toolAllowedWithoutApproval('MONEY', 'FULL_AUTO')).toBe(false);
  });
});

describe('RBAC (§58)', () => {
  it('owner has everything, viewer cannot publish', () => {
    expect(ROLE_PERMISSIONS.owner).toHaveLength(PERMISSIONS.length);
    expect(hasPermission('viewer', 'content.publish')).toBe(false);
    expect(hasPermission('reviewer', 'content.approve')).toBe(true);
    expect(hasPermission('editor', 'content.approve')).toBe(false);
  });
});
