import type { ControlMode, GlobalRole, RoomRole } from '../shared/types';

export interface PermissionContext {
  globalRole: GlobalRole;
  roomRole: RoomRole;
  controlMode: ControlMode;
}

/**
 * Can this user play, pause, seek, skip, change repeat/shuffle, or reorder/remove tracks?
 */
export function canControlPlayback(ctx: PermissionContext): boolean {
  if (ctx.roomRole === 'host' || ctx.roomRole === 'dj') {
    return true;
  }
  return ctx.controlMode === 'everyone';
}

/**
 * Can this user add tracks or import playlists to the queue?
 */
export function canAddTracks(ctx: PermissionContext): boolean {
  if (ctx.roomRole === 'host' || ctx.roomRole === 'dj') {
    return true;
  }
  return ctx.controlMode === 'everyone';
}

/**
 * Can this user promote/demote roles, kick members, or change room control mode?
 */
export function canManageRoom(ctx: PermissionContext): boolean {
  return ctx.roomRole === 'host' || ctx.globalRole === 'admin';
}

/**
 * Validates whether actor can change target's role in a room.
 */
export function canChangeMemberRole(params: {
  actorRoomRole: RoomRole;
  actorGlobalRole: GlobalRole;
  actorUserId: number;
  targetUserId: number;
  targetCurrentRole: RoomRole;
  nextRole: RoomRole;
}): { allowed: boolean; reason?: string } {
  const {
    actorRoomRole,
    actorGlobalRole,
    actorUserId,
    targetUserId,
    targetCurrentRole,
    nextRole,
  } = params;

  if (actorRoomRole !== 'host' && actorGlobalRole !== 'admin') {
    return { allowed: false, reason: 'Only the room host can manage roles.' };
  }
  if (actorUserId === targetUserId) {
    return { allowed: false, reason: 'You cannot change your own role.' };
  }
  if (targetCurrentRole === 'host') {
    return { allowed: false, reason: 'Cannot change the room host role.' };
  }
  if (nextRole !== 'dj' && nextRole !== 'listener') {
    return { allowed: false, reason: 'Target role must be DJ or listener.' };
  }
  return { allowed: true };
}

/**
 * Validates whether actor can kick target from a room.
 */
export function canKickMember(params: {
  actorRoomRole: RoomRole;
  actorGlobalRole: GlobalRole;
  actorUserId: number;
  targetUserId: number;
  targetCurrentRole: RoomRole;
}): { allowed: boolean; reason?: string } {
  const { actorRoomRole, actorGlobalRole, actorUserId, targetUserId, targetCurrentRole } = params;
  if (actorRoomRole !== 'host' && actorGlobalRole !== 'admin') {
    return { allowed: false, reason: 'Only the room host can kick members.' };
  }
  if (actorUserId === targetUserId) {
    return { allowed: false, reason: 'You cannot kick yourself.' };
  }
  if (targetCurrentRole === 'host') {
    return { allowed: false, reason: 'Cannot kick the room host.' };
  }
  return { allowed: true };
}
