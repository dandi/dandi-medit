import { describe, expect, it } from 'vitest';
import { resolveCommitPermission } from './commitPermission';

describe('resolveCommitPermission', () => {
  it('waits while the permission is unknown', () => {
    const result = resolveCommitPermission(null, false);
    expect(result.allowed).toBe(false);
    expect(result.adminModeAvailable).toBe(false);
    expect(result.reason).toMatch(/Checking/);
  });

  it('lets owners commit regardless of admin mode', () => {
    for (const adminMode of [false, true]) {
      const result = resolveCommitPermission({ isOwner: true, isAdmin: true }, adminMode);
      expect(result).toEqual({ allowed: true, viaAdmin: false, adminModeAvailable: false, reason: null });
    }
    expect(resolveCommitPermission({ isOwner: true, isAdmin: false }, false).allowed).toBe(true);
  });

  it('blocks an administrator who is not an owner until admin mode is on', () => {
    const off = resolveCommitPermission({ isOwner: false, isAdmin: true }, false);
    expect(off.allowed).toBe(false);
    expect(off.adminModeAvailable).toBe(true);
    expect(off.reason).toMatch(/admin mode/i);

    const on = resolveCommitPermission({ isOwner: false, isAdmin: true }, true);
    expect(on).toEqual({ allowed: true, viaAdmin: true, adminModeAvailable: true, reason: null });
  });

  it('never lets a non-owner non-admin commit, even with admin mode requested', () => {
    const result = resolveCommitPermission({ isOwner: false, isAdmin: false }, true);
    expect(result.allowed).toBe(false);
    expect(result.adminModeAvailable).toBe(false);
    expect(result.reason).toMatch(/owner/);
  });
});
