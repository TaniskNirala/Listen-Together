import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canControlPlayback,
  canAddTracks,
  canManageRoom,
  canChangeMemberRole,
  canKickMember,
} from './permissions';

test('playback & queue permissions respect room controlMode and roles', () => {
  assert.equal(
    canControlPlayback({ globalRole: 'user', roomRole: 'listener', controlMode: 'everyone' }),
    true
  );
  assert.equal(
    canControlPlayback({ globalRole: 'user', roomRole: 'listener', controlMode: 'dj_only' }),
    false
  );
  assert.equal(
    canAddTracks({ globalRole: 'user', roomRole: 'listener', controlMode: 'dj_only' }),
    false
  );
  assert.equal(
    canControlPlayback({ globalRole: 'user', roomRole: 'dj', controlMode: 'dj_only' }),
    true
  );
  assert.equal(
    canControlPlayback({ globalRole: 'user', roomRole: 'host', controlMode: 'dj_only' }),
    true
  );
});

test('host and global admin can manage rooms, listeners and DJs cannot', () => {
  assert.equal(
    canManageRoom({ globalRole: 'user', roomRole: 'host', controlMode: 'dj_only' }),
    true
  );
  assert.equal(
    canManageRoom({ globalRole: 'admin', roomRole: 'listener', controlMode: 'dj_only' }),
    true
  );
  assert.equal(
    canManageRoom({ globalRole: 'user', roomRole: 'dj', controlMode: 'everyone' }),
    false
  );
});

test('role change and kick protections prevent self-action and targeting host', () => {
  assert.equal(
    canChangeMemberRole({
      actorRoomRole: 'host',
      actorGlobalRole: 'user',
      actorUserId: 1,
      targetUserId: 2,
      targetCurrentRole: 'listener',
      nextRole: 'dj',
    }).allowed,
    true
  );

  assert.equal(
    canChangeMemberRole({
      actorRoomRole: 'dj',
      actorGlobalRole: 'user',
      actorUserId: 2,
      targetUserId: 3,
      targetCurrentRole: 'listener',
      nextRole: 'dj',
    }).allowed,
    false
  );

  assert.equal(
    canChangeMemberRole({
      actorRoomRole: 'host',
      actorGlobalRole: 'user',
      actorUserId: 1,
      targetUserId: 1,
      targetCurrentRole: 'host',
      nextRole: 'dj',
    }).allowed,
    false
  );

  assert.equal(
    canKickMember({
      actorRoomRole: 'admin' as never,
      actorGlobalRole: 'admin',
      actorUserId: 9,
      targetUserId: 1,
      targetCurrentRole: 'host',
    }).allowed,
    false
  );

  assert.equal(
    canKickMember({
      actorRoomRole: 'host',
      actorGlobalRole: 'user',
      actorUserId: 1,
      targetUserId: 3,
      targetCurrentRole: 'dj',
    }).allowed,
    true
  );
});
