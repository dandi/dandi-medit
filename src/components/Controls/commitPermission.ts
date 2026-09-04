import type { EditPermission } from '../../utils/api';

export interface CommitPermission {
  /** Whether the commit button may be enabled. */
  allowed: boolean;
  /** The commit would rely on administrator rights rather than ownership. */
  viaAdmin: boolean;
  /** Admin mode is relevant: the user is an administrator but not an owner. */
  adminModeAvailable: boolean;
  /** Why the commit is not allowed, for the button tooltip. */
  reason: string | null;
}

/**
 * Decide whether the user may commit, given what the API said about them and
 * whether they have switched admin mode on. Owners commit as usual.
 * Administrators who do not own the dandiset can commit only after enabling
 * admin mode, so that administrator rights are never used by accident.
 */
export function resolveCommitPermission(
  permission: EditPermission | null,
  adminMode: boolean,
): CommitPermission {
  if (!permission) {
    return { allowed: false, viaAdmin: false, adminModeAvailable: false, reason: 'Checking your permissions for this dandiset' };
  }
  if (permission.isOwner) {
    return { allowed: true, viaAdmin: false, adminModeAvailable: false, reason: null };
  }
  if (permission.isAdmin) {
    return adminMode
      ? { allowed: true, viaAdmin: true, adminModeAvailable: true, reason: null }
      : {
          allowed: false,
          viaAdmin: false,
          adminModeAvailable: true,
          reason: 'You are not an owner of this dandiset. Turn on admin mode to commit as a DANDI administrator.',
        };
  }
  return {
    allowed: false,
    viaAdmin: false,
    adminModeAvailable: false,
    reason: 'You must be an owner of this dandiset to commit changes',
  };
}
