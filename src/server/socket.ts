import crypto from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { z } from 'zod';
import { findUserById, toAuthUser } from './auth';
import { logger } from './logger';
import {
  canChangeMemberRole,
  canControlPlayback,
  canKickMember,
  canManageRoom,
} from './permissions';
import { roomManager, type RoomRuntime } from './roomManager';
import { normalizeReactionEmoji } from '../shared/validation';
import type { AuthUser, PlaylistImportProgress, ReactionEvent } from '../shared/types';

let ioInstance: SocketIOServer | null = null;

interface SocketData {
  user: AuthUser;
  roomCode: string | null;
  lastReactionAt: number;
  lastChatAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEventMap = Record<string, (...args: any[]) => void>;
type AuthedSocket = Socket<AnyEventMap, AnyEventMap, AnyEventMap, SocketData>;

const joinSchema = z.object({
  code: z.string().trim().min(3).max(16),
  password: z.string().max(64).optional(),
});

const seekSchema = z.object({
  positionSec: z.number().min(0).max(86_400),
  clientEventId: z.string().max(80).optional(),
});

const trackIdSchema = z.object({
  trackId: z.string().min(1).max(80),
  clientEventId: z.string().max(80).optional(),
});

const reorderSchema = z.object({
  fromIndex: z.number().int().min(0),
  toIndex: z.number().int().min(0),
  clientEventId: z.string().max(80).optional(),
});

const repeatSchema = z.object({
  repeatMode: z.enum(['off', 'one', 'all']),
  clientEventId: z.string().max(80).optional(),
});

const shuffleSchema = z.object({
  shuffleEnabled: z.boolean(),
  clientEventId: z.string().max(80).optional(),
});

const controlModeSchema = z.object({
  controlMode: z.enum(['everyone', 'dj_only']),
});

const roleChangeSchema = z.object({
  targetUserId: z.number().int().positive(),
  role: z.enum(['dj', 'listener']),
});

const kickSchema = z.object({
  targetUserId: z.number().int().positive(),
});

const chatSchema = z.object({
  body: z.string().trim().min(1).max(500),
  clientMessageId: z.string().max(80).optional(),
});

const reactionSchema = z.object({
  emoji: z.string().min(1).max(8),
});

const durationReportSchema = z.object({
  trackId: z.string().min(1).max(80),
  durationSec: z.number().positive().max(86_400),
});

function getRoomChannel(code: string): string {
  return `room:${code}`;
}

export function broadcastRoomPlayback(room: RoomRuntime): void {
  if (!ioInstance) return;
  ioInstance.to(getRoomChannel(room.code)).emit('room:playback', {
    playback: { ...room.playback, queue: [...room.playback.queue] },
    history: [...room.history],
  });
}

export function broadcastRoomListeners(room: RoomRuntime): void {
  if (!ioInstance) return;
  ioInstance.to(getRoomChannel(room.code)).emit('room:listeners', {
    listeners: roomManager.getListeners(room),
    controlMode: room.controlMode,
  });
}

export function broadcastRoomToast(
  roomCode: string,
  message: string,
  tone: 'info' | 'warning' | 'error' = 'info'
): void {
  if (!ioInstance) return;
  ioInstance.to(getRoomChannel(roomCode)).emit('room:toast', { message, tone });
}

export function emitImportProgressToUser(userId: number, progress: PlaylistImportProgress): void {
  if (!ioInstance) return;
  const socketIds = roomManager.getSocketIdsForUser(userId);
  for (const sid of socketIds) {
    ioInstance.to(sid).emit('playlist:import_progress', progress);
  }
}

export function disconnectUserSockets(userId: number, reason: string): void {
  if (!ioInstance) return;
  const socketIds = roomManager.getSocketIdsForUser(userId);
  for (const sid of socketIds) {
    const s = ioInstance.sockets.sockets.get(sid);
    if (s) {
      s.emit('auth:revoked', { reason });
      s.disconnect(true);
    }
  }
}

export function syncUserRenameAcrossSockets(userId: number, updatedUser: AuthUser): void {
  const affectedRooms = roomManager.updateUsernameInMemory(userId, updatedUser.username);
  if (!ioInstance) return;

  const socketIds = roomManager.getSocketIdsForUser(userId);
  for (const sid of socketIds) {
    const s = ioInstance.sockets.sockets.get(sid);
    if (s) {
      (s.data as SocketData).user = updatedUser;
      s.emit('auth:user_updated', { user: updatedUser });
    }
  }

  for (const { room, playbackChanged, chatChanged } of affectedRooms) {
    broadcastRoomListeners(room);
    if (playbackChanged) {
      broadcastRoomPlayback(room);
    }
    if (chatChanged) {
      ioInstance.to(getRoomChannel(room.code)).emit('chat:user_renamed', {
        userId,
        username: updatedUser.username,
      });
    }
  }
}

async function getAuthorizedRoomContext(socket: AuthedSocket): Promise<{
  room: RoomRuntime;
  roomRole: 'host' | 'dj' | 'listener';
} | null> {
  const code = socket.data.roomCode;
  if (!code) return null;
  const room = await roomManager.getOrLoadRoom(code);
  if (!room) return null;
  const member = room.members.get(socket.data.user.id);
  if (!member || member.kicked) return null;
  return { room, roomRole: member.role };
}

export function attachSocketServer(
  httpServer: HttpServer,
  sessionMiddleware: RequestHandler
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    transports: ['websocket', 'polling'],
  });

  ioInstance = io;

  // Reuse Express Postgres-backed session middleware for Socket.IO handshakes
  io.use((socket, next) => {
    const req = socket.request as Parameters<RequestHandler>[0];
    const res = {} as Parameters<RequestHandler>[1];
    sessionMiddleware(req, res, (err?: unknown) => {
      if (err) {
        next(new Error('Session middleware error'));
        return;
      }
      const userId = (req as { session?: { userId?: number } }).session?.userId;
      if (!userId) {
        next(new Error('UNAUTHORIZED'));
        return;
      }
      findUserById(userId)
        .then((userRow) => {
          if (!userRow || userRow.disabled) {
            next(new Error('UNAUTHORIZED'));
            return;
          }
          socket.data.user = toAuthUser(userRow);
          socket.data.roomCode = null;
          socket.data.lastReactionAt = 0;
          socket.data.lastChatAt = 0;
          next();
        })
        .catch(() => next(new Error('AUTH_ERROR')));
    });
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthedSocket;
    const user = socket.data.user;
    roomManager.registerSocket(socket.id, user.id);

    // NTP-style clock sync ping/pong
    socket.on('sync:ping', (payload: unknown, ack?: (resp: unknown) => void) => {
      const clientSendTime =
        payload && typeof payload === 'object' && 'clientSendTime' in payload
          ? Number((payload as { clientSendTime: unknown }).clientSendTime)
          : Date.now();
      const response = {
        clientSendTime: Number.isFinite(clientSendTime) ? clientSendTime : Date.now(),
        serverTime: Date.now(),
      };
      if (typeof ack === 'function') {
        ack(response);
      } else {
        socket.emit('sync:pong', response);
      }
    });

    socket.on('room:join', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const parsed = joinSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Invalid room code.' });
          return;
        }

        const prevCode = socket.data.roomCode;
        const { room, role } = await roomManager.joinRoom({
          code: parsed.data.code,
          user: socket.data.user,
          socketId: socket.id,
          password: parsed.data.password,
        });

        if (prevCode && prevCode !== room.code) {
          socket.leave(getRoomChannel(prevCode));
          const prevRoom = await roomManager.getOrLoadRoom(prevCode);
          if (prevRoom) broadcastRoomListeners(prevRoom);
        }

        socket.data.roomCode = room.code;
        await socket.join(getRoomChannel(room.code));

        broadcastRoomListeners(room);
        const fullState = roomManager.buildFullState(room, role);
        ack?.({ ok: true, state: fullState });
      } catch (err) {
        const e = err as Error & { code?: string };
        ack?.({
          ok: false,
          code: e.code,
          error: e.message || 'Could not join room.',
        });
      }
    });

    socket.on('room:leave', async () => {
      const prevCode = socket.data.roomCode;
      if (!prevCode) return;
      socket.leave(getRoomChannel(prevCode));
      socket.data.roomCode = null;
      roomManager.unregisterSocket(socket.id);
      roomManager.registerSocket(socket.id, user.id);
      const prevRoom = await roomManager.getOrLoadRoom(prevCode);
      if (prevRoom) broadcastRoomListeners(prevRoom);
    });

    socket.on('playback:play', async (payload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can control playback.' });
        }

        const eventId =
          payload && typeof payload === 'object' && 'clientEventId' in payload
            ? String((payload as { clientEventId?: string }).clientEventId || '')
            : undefined;
        if (!roomManager.markEventProcessed(ctx.room, eventId)) {
          return ack?.({ ok: true });
        }

        await roomManager.play(ctx.room);
        broadcastRoomPlayback(ctx.room);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Playback action failed.' });
      }
    });

    socket.on('playback:pause', async (payload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can control playback.' });
        }

        const eventId =
          payload && typeof payload === 'object' && 'clientEventId' in payload
            ? String((payload as { clientEventId?: string }).clientEventId || '')
            : undefined;
        if (!roomManager.markEventProcessed(ctx.room, eventId)) {
          return ack?.({ ok: true });
        }

        await roomManager.pause(ctx.room);
        broadcastRoomPlayback(ctx.room);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Pause failed.' });
      }
    });

    socket.on('playback:seek', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can seek.' });
        }

        const parsed = seekSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid seek position.' });
        if (!roomManager.markEventProcessed(ctx.room, parsed.data.clientEventId)) {
          return ack?.({ ok: true });
        }

        await roomManager.seek(ctx.room, parsed.data.positionSec);
        broadcastRoomPlayback(ctx.room);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Seek failed.' });
      }
    });

    socket.on('playback:skip', async (payload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can skip tracks.' });
        }

        const eventId =
          payload && typeof payload === 'object' && 'clientEventId' in payload
            ? String((payload as { clientEventId?: string }).clientEventId || '')
            : undefined;
        if (!roomManager.markEventProcessed(ctx.room, eventId)) {
          return ack?.({ ok: true });
        }

        await roomManager.advanceTrack(ctx.room, { forcedSkip: true });
        broadcastRoomPlayback(ctx.room);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Skip failed.' });
      }
    });

    socket.on('playback:track_ended', async (rawPayload: unknown) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return;
        const parsed = trackIdSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const advanced = await roomManager.advanceTrack(ctx.room, {
          forcedSkip: false,
          expectedTrackId: parsed.data.trackId,
        });
        if (advanced) {
          broadcastRoomPlayback(ctx.room);
        }
      } catch (err) {
        logger.warn('track_ended_error', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on('playback:embed_error', async (rawPayload: unknown) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return;
        const parsed = trackIdSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const failedTitle = ctx.room.playback.currentTrack?.title || 'This video';
        const advanced = await roomManager.advanceTrack(ctx.room, {
          forcedSkip: true,
          expectedTrackId: parsed.data.trackId,
        });
        if (advanced) {
          broadcastRoomPlayback(ctx.room);
          broadcastRoomToast(
            ctx.room.code,
            `"${failedTitle}" does not allow embedding — skipped to next track.`,
            'warning'
          );
        }
      } catch (err) {
        logger.warn('embed_error_skip_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    socket.on('playback:report_duration', async (rawPayload: unknown) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return;
        const parsed = durationReportSchema.safeParse(rawPayload);
        if (!parsed.success) return;

        const updated = await roomManager.updateCurrentTrackDurationIfUnknown(
          ctx.room,
          parsed.data.trackId,
          parsed.data.durationSec
        );
        if (updated) {
          broadcastRoomPlayback(ctx.room);
        }
      } catch {
        // Non-fatal duration sync
      }
    });

    socket.on('queue:play_now', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can change the track.' });
        }

        const parsed = trackIdSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid track ID.' });
        if (!roomManager.markEventProcessed(ctx.room, parsed.data.clientEventId)) {
          return ack?.({ ok: true });
        }

        const ok = await roomManager.playQueueItemNow(ctx.room, parsed.data.trackId);
        if (ok) broadcastRoomPlayback(ctx.room);
        ack?.({ ok });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to play track.' });
      }
    });

    socket.on('queue:remove', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can remove tracks.' });
        }

        const parsed = trackIdSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid track ID.' });

        await roomManager.removeQueueItem(ctx.room, parsed.data.trackId);
        broadcastRoomPlayback(ctx.room);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Remove failed.' });
      }
    });

    socket.on('queue:reorder', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can reorder the queue.' });
        }

        const parsed = reorderSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid reorder indices.' });

        const ok = await roomManager.reorderQueue(
          ctx.room,
          parsed.data.fromIndex,
          parsed.data.toIndex
        );
        if (ok) broadcastRoomPlayback(ctx.room);
        ack?.({ ok });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Reorder failed.' });
      }
    });

    socket.on('queue:repeat', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can change repeat mode.' });
        }

        const parsed = repeatSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid repeat mode.' });

        await roomManager.setRepeatMode(ctx.room, parsed.data.repeatMode);
        broadcastRoomPlayback(ctx.room);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Repeat toggle failed.' });
      }
    });

    socket.on('queue:shuffle', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canControlPlayback({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only DJs and the host can toggle shuffle.' });
        }

        const parsed = shuffleSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid shuffle toggle.' });

        await roomManager.setShuffle(ctx.room, parsed.data.shuffleEnabled);
        broadcastRoomPlayback(ctx.room);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Shuffle toggle failed.' });
      }
    });

    socket.on('room:control_mode', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });
        if (
          !canManageRoom({
            globalRole: user.role,
            roomRole: ctx.roomRole,
            controlMode: ctx.room.controlMode,
          })
        ) {
          return ack?.({ ok: false, error: 'Only the room host can change playback permissions.' });
        }

        const parsed = controlModeSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid control mode.' });

        await roomManager.setControlMode(ctx.room, parsed.data.controlMode);
        broadcastRoomListeners(ctx.room);
        broadcastRoomToast(
          ctx.room.code,
          parsed.data.controlMode === 'dj_only'
            ? 'Playback controls restricted to Host & DJs.'
            : 'Everyone in the room can now control playback.',
          'info'
        );
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to update setting.' });
      }
    });

    socket.on('member:role', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });

        const parsed = roleChangeSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid role request.' });

        const target = ctx.room.members.get(parsed.data.targetUserId);
        if (!target) return ack?.({ ok: false, error: 'Member not found.' });

        const check = canChangeMemberRole({
          actorRoomRole: ctx.roomRole,
          actorGlobalRole: user.role,
          actorUserId: user.id,
          targetUserId: target.userId,
          targetCurrentRole: target.role,
          nextRole: parsed.data.role,
        });
        if (!check.allowed) {
          return ack?.({ ok: false, error: check.reason });
        }

        await roomManager.updateMemberRole(ctx.room, target.userId, parsed.data.role);
        broadcastRoomListeners(ctx.room);
        // Notify target sockets of their updated role
        const targetSockets = ctx.room.onlineSockets.get(target.userId);
        if (targetSockets) {
          for (const sid of targetSockets) {
            io.to(sid).emit('room:my_role', { role: parsed.data.role });
          }
        }
        broadcastRoomToast(
          ctx.room.code,
          `${target.username} is now ${parsed.data.role === 'dj' ? 'a DJ' : 'a listener'}.`,
          'info'
        );
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to change role.' });
      }
    });

    socket.on('member:kick', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });

        const parsed = kickSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Invalid kick request.' });

        const target = ctx.room.members.get(parsed.data.targetUserId);
        if (!target) return ack?.({ ok: false, error: 'Member not found.' });

        const check = canKickMember({
          actorRoomRole: ctx.roomRole,
          actorGlobalRole: user.role,
          actorUserId: user.id,
          targetUserId: target.userId,
          targetCurrentRole: target.role,
        });
        if (!check.allowed) {
          return ack?.({ ok: false, error: check.reason });
        }

        const kickedSocketIds = await roomManager.kickMember(ctx.room, target.userId);
        for (const sid of kickedSocketIds) {
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            targetSocket.leave(getRoomChannel(ctx.room.code));
            (targetSocket.data as SocketData).roomCode = null;
            targetSocket.emit('room:kicked', {
              roomCode: ctx.room.code,
              reason: 'You were removed from the room by the host.',
            });
          }
        }
        broadcastRoomListeners(ctx.room);
        broadcastRoomToast(ctx.room.code, `${target.username} was removed from the room.`, 'warning');
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to kick member.' });
      }
    });

    socket.on('chat:send', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) return ack?.({ ok: false, error: 'Not in a room.' });

        const now = Date.now();
        if (now - socket.data.lastChatAt < 400) {
          return ack?.({ ok: false, error: 'You are sending messages too quickly.' });
        }

        const parsed = chatSchema.safeParse(rawPayload);
        if (!parsed.success) return ack?.({ ok: false, error: 'Message must be 1–500 characters.' });

        socket.data.lastChatAt = now;
        const msg = await roomManager.addChatMessage(
          ctx.room,
          socket.data.user,
          parsed.data.body,
          parsed.data.clientMessageId
        );
        if (msg) {
          io.to(getRoomChannel(ctx.room.code)).emit('chat:message', msg);
        }
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to send message.' });
      }
    });

    socket.on('reaction:send', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const ctx = await getAuthorizedRoomContext(socket);
        if (!ctx) {
          ack?.({ ok: false, error: 'Not connected to a room.' });
          return;
        }

        const now = Date.now();
        if (now - socket.data.lastReactionAt < 250) {
          ack?.({ ok: true, throttled: true });
          return;
        }

        const parsed = reactionSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Invalid reaction.' });
          return;
        }

        const emoji = normalizeReactionEmoji(parsed.data.emoji);
        if (!emoji) {
          ack?.({ ok: false, error: 'Unsupported reaction emoji.' });
          return;
        }

        socket.data.lastReactionAt = now;
        const event: ReactionEvent = {
          id: crypto.randomUUID(),
          emoji,
          username: socket.data.user.username,
          timestamp: now,
        };
        io.to(getRoomChannel(ctx.room.code)).emit('reaction:burst', event);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'Could not send reaction.' });
      }
    });

    socket.on('disconnect', async () => {
      const { leftRoomCode } = roomManager.unregisterSocket(socket.id);
      if (leftRoomCode) {
        const room = await roomManager.getOrLoadRoom(leftRoomCode);
        if (room) broadcastRoomListeners(room);
      }
    });
  });

  return io;
}
