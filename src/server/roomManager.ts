import crypto from 'node:crypto';
import { db } from './db';
import { config } from './config';
import { logger } from './logger';
import { hashPassword, verifyPassword } from './auth';
import { computeExpectedPositionSec, computeNextTrackTransition } from '../shared/sync';
import type {
  AuthUser,
  ChatMessage,
  ControlMode,
  HistoryItem,
  RepeatMode,
  RoomFullState,
  RoomListener,
  RoomPlaybackState,
  RoomRole,
  RoomSummary,
  Track,
} from '../shared/types';
import type { ResolvedTrackMetadata } from './providers/types';

interface RoomRow {
  id: number;
  code: string;
  name: string;
  password_hash: string | null;
  host_user_id: number;
  control_mode: ControlMode;
  repeat_mode: RepeatMode;
  shuffle_enabled: boolean;
  current_track_json: Track | string | null;
  is_playing: boolean;
  position_at_timestamp: number;
  server_timestamp: string | number;
  state_version: number;
  created_at: string;
}

interface MemberRow {
  room_id: number;
  user_id: number;
  username: string;
  role: RoomRole;
  kicked: boolean;
}

interface QueueRow {
  id: string;
  position: number;
  track_json: Track | string;
  added_by_user_id: number | null;
  added_by_username: string;
  created_at: string;
}

interface HistoryRow {
  id: number;
  track_json: Track | string;
  added_by_username: string;
  played_at: string;
}

interface ChatRow {
  id: string;
  room_id: number;
  user_id: number | null;
  username: string;
  body: string;
  created_at: string;
}

export interface RoomRuntime {
  id: number;
  code: string;
  name: string;
  hasPassword: boolean;
  passwordHash: string | null;
  hostUserId: number;
  controlMode: ControlMode;
  playback: RoomPlaybackState;
  members: Map<number, { userId: number; username: string; role: RoomRole; kicked: boolean }>;
  onlineSockets: Map<number, Set<string>>;
  chat: ChatMessage[];
  history: HistoryItem[];
  recentEventIds: Set<string>;
}

interface GlobalSocketPresence {
  socketId: string;
  userId: number;
  roomCode: string | null;
  roomName: string | null;
}

function parseJsonField<T>(value: T | string | null): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value;
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

class RoomManager {
  private roomsByCode = new Map<string, RoomRuntime>();
  private socketPresence = new Map<string, GlobalSocketPresence>();

  /**
   * Preload persisted rooms into memory on server startup so restarts/sleep lose nothing.
   */
  async loadAllFromDb(): Promise<void> {
    const res = await db.query<{ code: string }>('SELECT code FROM rooms');
    for (const row of res.rows) {
      await this.getOrLoadRoom(row.code);
    }
    logger.info('rooms_loaded_from_db', { count: this.roomsByCode.size });
  }

  registerSocket(socketId: string, userId: number): void {
    this.socketPresence.set(socketId, {
      socketId,
      userId,
      roomCode: null,
      roomName: null,
    });
  }

  unregisterSocket(socketId: string): { leftRoomCode: string | null; userId: number | null } {
    const presence = this.socketPresence.get(socketId);
    this.socketPresence.delete(socketId);
    if (!presence) return { leftRoomCode: null, userId: null };

    if (presence.roomCode) {
      const room = this.roomsByCode.get(presence.roomCode);
      if (room) {
        const set = room.onlineSockets.get(presence.userId);
        if (set) {
          set.delete(socketId);
          if (set.size === 0) {
            room.onlineSockets.delete(presence.userId);
          }
        }
      }
      return { leftRoomCode: presence.roomCode, userId: presence.userId };
    }

    return { leftRoomCode: null, userId: presence.userId };
  }

  getUserOnlinePresence(userId: number): {
    online: boolean;
    currentRoomCode: string | null;
    currentRoomName: string | null;
  } {
    let online = false;
    let currentRoomCode: string | null = null;
    let currentRoomName: string | null = null;

    for (const p of this.socketPresence.values()) {
      if (p.userId === userId) {
        online = true;
        if (p.roomCode) {
          currentRoomCode = p.roomCode;
          currentRoomName = p.roomName;
          break;
        }
      }
    }

    return { online, currentRoomCode, currentRoomName };
  }

  getSocketIdsForUser(userId: number): string[] {
    const ids: string[] = [];
    for (const p of this.socketPresence.values()) {
      if (p.userId === userId) ids.push(p.socketId);
    }
    return ids;
  }

  async listRooms(): Promise<RoomSummary[]> {
    const res = await db.query<{
      id: number;
      code: string;
      name: string;
      password_hash: string | null;
      host_username: string;
      control_mode: ControlMode;
      current_track_json: Track | string | null;
      is_playing: boolean;
      created_at: string;
    }>(
      `SELECT r.id, r.code, r.name, r.password_hash, u.username AS host_username,
              r.control_mode, r.current_track_json, r.is_playing, r.created_at
       FROM rooms r
       JOIN users u ON u.id = r.host_user_id
       ORDER BY r.updated_at DESC`
    );

    return res.rows.map((row) => {
      const live = this.roomsByCode.get(row.code);
      const currentTrack = live
        ? live.playback.currentTrack
        : parseJsonField<Track>(row.current_track_json);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        hasPassword: Boolean(row.password_hash),
        hostUsername: row.host_username,
        controlMode: live ? live.controlMode : row.control_mode,
        onlineCount: live ? live.onlineSockets.size : 0,
        currentTrackTitle: currentTrack ? currentTrack.title : null,
        isPlaying: live ? live.playback.isPlaying : row.is_playing,
        createdAt: row.created_at,
      };
    });
  }

  async createRoom(params: {
    name: string;
    password?: string;
    controlMode: ControlMode;
    host: AuthUser;
  }): Promise<RoomRuntime> {
    const countRes = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM rooms');
    const totalRooms = Number.parseInt(countRes.rows[0]?.count ?? '0', 10);
    if (totalRooms >= config.maxRooms) {
      throw new Error(`Room limit reached (${config.maxRooms} rooms max).`);
    }

    let code = generateRoomCode();
    for (let i = 0; i < 5; i++) {
      const exists = await db.query('SELECT 1 FROM rooms WHERE code = $1', [code]);
      if (exists.rows.length === 0) break;
      code = generateRoomCode();
    }

    const passwordHash = params.password?.trim()
      ? await hashPassword(params.password.trim())
      : null;

    const now = Date.now();
    const roomRes = await db.query<RoomRow>(
      `INSERT INTO rooms (code, name, password_hash, host_user_id, control_mode, server_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [code, params.name.trim(), passwordHash, params.host.id, params.controlMode, now]
    );
    const row = roomRes.rows[0];

    await db.query(
      `INSERT INTO room_members (room_id, user_id, role, kicked)
       VALUES ($1, $2, 'host', FALSE)
       ON CONFLICT (room_id, user_id) DO UPDATE SET role = 'host', kicked = FALSE`,
      [row.id, params.host.id]
    );

    const runtime: RoomRuntime = {
      id: row.id,
      code: row.code,
      name: row.name,
      hasPassword: Boolean(row.password_hash),
      passwordHash: row.password_hash,
      hostUserId: row.host_user_id,
      controlMode: row.control_mode,
      playback: {
        currentTrack: null,
        isPlaying: false,
        positionAtTimestamp: 0,
        serverTimestamp: now,
        queue: [],
        repeatMode: 'off',
        shuffleEnabled: false,
        version: 1,
      },
      members: new Map([
        [
          params.host.id,
          { userId: params.host.id, username: params.host.username, role: 'host', kicked: false },
        ],
      ]),
      onlineSockets: new Map(),
      chat: [],
      history: [],
      recentEventIds: new Set(),
    };

    this.roomsByCode.set(runtime.code, runtime);
    return runtime;
  }

  async deleteRoom(code: string): Promise<boolean> {
    const normalized = code.trim().toUpperCase();
    const res = await db.query('DELETE FROM rooms WHERE code = $1 RETURNING id', [normalized]);
    this.roomsByCode.delete(normalized);
    for (const p of this.socketPresence.values()) {
      if (p.roomCode === normalized) {
        p.roomCode = null;
        p.roomName = null;
      }
    }
    return res.rows.length > 0;
  }

  async getOrLoadRoom(code: string): Promise<RoomRuntime | null> {
    const normalized = code.trim().toUpperCase();
    const cached = this.roomsByCode.get(normalized);
    if (cached) return cached;

    const roomRes = await db.query<RoomRow>('SELECT * FROM rooms WHERE code = $1', [normalized]);
    if (roomRes.rows.length === 0) return null;
    const row = roomRes.rows[0];

    const [membersRes, queueRes, historyRes, chatRes] = await Promise.all([
      db.query<MemberRow>(
        `SELECT rm.room_id, rm.user_id, u.username, rm.role, rm.kicked
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id = $1`,
        [row.id]
      ),
      db.query<QueueRow>(
        `SELECT id, position, track_json, added_by_user_id, added_by_username, created_at
         FROM queue_items
         WHERE room_id = $1
         ORDER BY position ASC`,
        [row.id]
      ),
      db.query<HistoryRow>(
        `SELECT id, track_json, added_by_username, played_at
         FROM play_history
         WHERE room_id = $1
         ORDER BY played_at DESC
         LIMIT $2`,
        [row.id, config.maxHistoryItems]
      ),
      db.query<ChatRow>(
        `SELECT id, room_id, user_id, username, body, created_at
         FROM chat_messages
         WHERE room_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [row.id, config.maxChatMessages]
      ),
    ]);

    const members = new Map<number, { userId: number; username: string; role: RoomRole; kicked: boolean }>();
    for (const m of membersRes.rows) {
      members.set(m.user_id, {
        userId: m.user_id,
        username: m.username,
        role: m.role,
        kicked: m.kicked,
      });
    }

    const queue: Track[] = queueRes.rows
      .map((q) => parseJsonField<Track>(q.track_json))
      .filter((t): t is Track => Boolean(t));

    const history: HistoryItem[] = historyRes.rows
      .map((h) => {
        const track = parseJsonField<Track>(h.track_json);
        if (!track) return null;
        return {
          id: h.id,
          track,
          addedByUsername: h.added_by_username,
          playedAt: h.played_at,
        };
      })
      .filter((h): h is HistoryItem => Boolean(h));

    const chat: ChatMessage[] = chatRes.rows
      .map((c) => ({
        id: c.id,
        roomId: c.room_id,
        userId: c.user_id,
        username: c.username,
        body: c.body,
        createdAt: c.created_at,
      }))
      .reverse();

    const runtime: RoomRuntime = {
      id: row.id,
      code: row.code,
      name: row.name,
      hasPassword: Boolean(row.password_hash),
      passwordHash: row.password_hash,
      hostUserId: row.host_user_id,
      controlMode: row.control_mode,
      playback: {
        currentTrack: parseJsonField<Track>(row.current_track_json),
        isPlaying: row.is_playing,
        positionAtTimestamp: Number(row.position_at_timestamp) || 0,
        serverTimestamp: Number(row.server_timestamp) || Date.now(),
        queue,
        repeatMode: row.repeat_mode,
        shuffleEnabled: row.shuffle_enabled,
        version: row.state_version || 1,
      },
      members,
      onlineSockets: new Map(),
      chat,
      history,
      recentEventIds: new Set(),
    };

    this.roomsByCode.set(runtime.code, runtime);
    return runtime;
  }

  async joinRoom(params: {
    code: string;
    user: AuthUser;
    socketId: string;
    password?: string;
  }): Promise<{ room: RoomRuntime; role: RoomRole }> {
    const room = await this.getOrLoadRoom(params.code);
    if (!room) {
      throw new Error('Room not found. Check the room code and try again.');
    }

    const existingMember = room.members.get(params.user.id);
    if (existingMember?.kicked && params.user.role !== 'admin') {
      throw new Error('You have been removed from this room by the host.');
    }

    const alreadyMember = Boolean(existingMember && !existingMember.kicked);
    if (
      room.passwordHash &&
      !alreadyMember &&
      params.user.id !== room.hostUserId &&
      params.user.role !== 'admin'
    ) {
      const ok = params.password ? await verifyPassword(params.password, room.passwordHash) : false;
      if (!ok) {
        const err = new Error('Room password required or incorrect.') as Error & { code?: string };
        err.code = 'PASSWORD_REQUIRED';
        throw err;
      }
    }

    const isAlreadyOnline = room.onlineSockets.has(params.user.id);
    if (!isAlreadyOnline && room.onlineSockets.size >= config.maxUsersPerRoom) {
      throw new Error(`Room is full (${config.maxUsersPerRoom} listeners max).`);
    }

    let role: RoomRole = existingMember?.role || 'listener';
    if (params.user.id === room.hostUserId) {
      role = 'host';
    }

    if (!existingMember || existingMember.kicked) {
      await db.query(
        `INSERT INTO room_members (room_id, user_id, role, kicked)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role, kicked = FALSE`,
        [room.id, params.user.id, role]
      );
      room.members.set(params.user.id, {
        userId: params.user.id,
        username: params.user.username,
        role,
        kicked: false,
      });
    }

    // Leave any previously tracked room for this socket
    const prev = this.socketPresence.get(params.socketId);
    if (prev?.roomCode && prev.roomCode !== room.code) {
      const prevRoom = this.roomsByCode.get(prev.roomCode);
      if (prevRoom) {
        const s = prevRoom.onlineSockets.get(params.user.id);
        s?.delete(params.socketId);
        if (s && s.size === 0) prevRoom.onlineSockets.delete(params.user.id);
      }
    }

    let sockets = room.onlineSockets.get(params.user.id);
    if (!sockets) {
      sockets = new Set();
      room.onlineSockets.set(params.user.id, sockets);
    }
    sockets.add(params.socketId);

    this.socketPresence.set(params.socketId, {
      socketId: params.socketId,
      userId: params.user.id,
      roomCode: room.code,
      roomName: room.name,
    });

    return { room, role };
  }

  getListeners(room: RoomRuntime): RoomListener[] {
    const list: RoomListener[] = [];
    for (const [userId, sockets] of room.onlineSockets.entries()) {
      if (sockets.size === 0) continue;
      const member = room.members.get(userId);
      if (!member || member.kicked) continue;
      list.push({
        userId: member.userId,
        username: member.username,
        role: member.role,
        online: true,
      });
    }

    const order: Record<RoomRole, number> = { host: 0, dj: 1, listener: 2 };
    list.sort((a, b) => order[a.role] - order[b.role] || a.username.localeCompare(b.username));
    return list;
  }

  buildFullState(room: RoomRuntime, myRole: RoomRole): RoomFullState {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      hasPassword: room.hasPassword,
      hostUserId: room.hostUserId,
      controlMode: room.controlMode,
      myRole,
      playback: { ...room.playback, queue: [...room.playback.queue] },
      listeners: this.getListeners(room),
      chat: [...room.chat],
      history: [...room.history],
    };
  }

  /**
   * Idempotency guard for client-originated mutation events.
   */
  markEventProcessed(room: RoomRuntime, clientEventId?: string): boolean {
    if (!clientEventId) return true;
    if (room.recentEventIds.has(clientEventId)) return false;
    room.recentEventIds.add(clientEventId);
    if (room.recentEventIds.size > 250) {
      const oldest = room.recentEventIds.values().next().value;
      if (oldest) room.recentEventIds.delete(oldest);
    }
    return true;
  }

  async persistPlaybackState(room: RoomRuntime): Promise<void> {
    room.playback.version += 1;
    await db.query(
      `UPDATE rooms
       SET control_mode = $2,
           repeat_mode = $3,
           shuffle_enabled = $4,
           current_track_json = $5::jsonb,
           is_playing = $6,
           position_at_timestamp = $7,
           server_timestamp = $8,
           state_version = $9,
           updated_at = NOW()
       WHERE id = $1`,
      [
        room.id,
        room.controlMode,
        room.playback.repeatMode,
        room.playback.shuffleEnabled,
        room.playback.currentTrack ? JSON.stringify(room.playback.currentTrack) : null,
        room.playback.isPlaying,
        room.playback.positionAtTimestamp,
        room.playback.serverTimestamp,
        room.playback.version,
      ]
    );
  }

  async persistQueue(room: RoomRuntime): Promise<void> {
    await db.query('DELETE FROM queue_items WHERE room_id = $1', [room.id]);
    for (let i = 0; i < room.playback.queue.length; i++) {
      const t = room.playback.queue[i];
      await db.query(
        `INSERT INTO queue_items (id, room_id, position, track_json, added_by_user_id, added_by_username)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [t.id, room.id, i, JSON.stringify(t), t.addedByUserId, t.addedByUsername]
      );
    }
  }

  private async recordHistory(room: RoomRuntime, track: Track): Promise<void> {
    const res = await db.query<{ id: number; played_at: string }>(
      `INSERT INTO play_history (room_id, track_json, added_by_username)
       VALUES ($1, $2::jsonb, $3)
       RETURNING id, played_at`,
      [room.id, JSON.stringify(track), track.addedByUsername]
    );
    const row = res.rows[0];
    room.history.unshift({
      id: row.id,
      track,
      addedByUsername: track.addedByUsername,
      playedAt: row.played_at,
    });
    if (room.history.length > config.maxHistoryItems) {
      room.history.length = config.maxHistoryItems;
    }
  }

  async enqueueTracks(
    room: RoomRuntime,
    metadataList: ResolvedTrackMetadata[],
    addedBy: AuthUser
  ): Promise<Track[]> {
    const nowIso = new Date().toISOString();
    const created: Track[] = metadataList.map((m) => ({
      id: crypto.randomUUID(),
      youtubeId: m.youtubeId,
      title: m.title,
      artist: m.artist,
      durationSec: m.durationSec,
      thumbnailUrl: m.thumbnailUrl,
      source: m.source,
      sourceUrl: m.sourceUrl,
      matchedVia: m.matchedVia,
      addedByUserId: addedBy.id,
      addedByUsername: addedBy.username,
      addedAt: nowIso,
    }));

    if (created.length === 0) return [];

    // If nothing is currently playing, immediately start the first added track!
    let autoStarted = false;
    if (!room.playback.currentTrack) {
      const [first, ...rest] = created;
      room.playback.currentTrack = first;
      room.playback.isPlaying = true;
      room.playback.positionAtTimestamp = 0;
      room.playback.serverTimestamp = Date.now();
      room.playback.queue.push(...rest);
      autoStarted = true;
    } else {
      room.playback.queue.push(...created);
    }

    await this.persistQueue(room);
    await this.persistPlaybackState(room);
    if (autoStarted) {
      logger.info('room_autostart_first_track', {
        roomCode: room.code,
        trackId: room.playback.currentTrack?.id,
      });
    }
    return created;
  }

  async play(room: RoomRuntime): Promise<void> {
    const now = Date.now();
    if (!room.playback.currentTrack && room.playback.queue.length > 0) {
      const [next, ...rest] = room.playback.queue;
      room.playback.currentTrack = next;
      room.playback.queue = rest;
      room.playback.positionAtTimestamp = 0;
      room.playback.isPlaying = true;
      room.playback.serverTimestamp = now;
      await this.persistQueue(room);
      await this.persistPlaybackState(room);
      return;
    }

    if (!room.playback.currentTrack || room.playback.isPlaying) return;

    room.playback.isPlaying = true;
    room.playback.serverTimestamp = now;
    await this.persistPlaybackState(room);
  }

  async pause(room: RoomRuntime): Promise<void> {
    if (!room.playback.currentTrack || !room.playback.isPlaying) return;
    const now = Date.now();
    const pos = computeExpectedPositionSec({
      isPlaying: true,
      positionAtTimestamp: room.playback.positionAtTimestamp,
      serverTimestamp: room.playback.serverTimestamp,
      estimatedServerNowMs: now,
      durationSec: room.playback.currentTrack.durationSec,
    });
    room.playback.positionAtTimestamp = pos;
    room.playback.isPlaying = false;
    room.playback.serverTimestamp = now;
    await this.persistPlaybackState(room);
  }

  async seek(room: RoomRuntime, positionSec: number): Promise<void> {
    if (!room.playback.currentTrack) return;
    const clamped = Math.max(
      0,
      room.playback.currentTrack.durationSec > 0
        ? Math.min(positionSec, room.playback.currentTrack.durationSec)
        : positionSec
    );
    room.playback.positionAtTimestamp = clamped;
    room.playback.serverTimestamp = Date.now();
    await this.persistPlaybackState(room);
  }

  async advanceTrack(
    room: RoomRuntime,
    options: { forcedSkip: boolean; expectedTrackId?: string }
  ): Promise<boolean> {
    // Idempotency: if a client reports track end or embed error for an old track, ignore it
    if (
      options.expectedTrackId &&
      room.playback.currentTrack?.id !== options.expectedTrackId
    ) {
      return false;
    }

    const previous = room.playback.currentTrack;
    const transition = computeNextTrackTransition({
      currentTrack: previous,
      queue: room.playback.queue,
      repeatMode: room.playback.repeatMode,
      shuffleEnabled: room.playback.shuffleEnabled,
      forcedSkip: options.forcedSkip,
    });

    if (transition.shouldRecordHistory && previous) {
      await this.recordHistory(room, previous);
    }

    room.playback.currentTrack = transition.nextTrack;
    room.playback.queue = transition.nextQueue;
    room.playback.positionAtTimestamp = 0;
    room.playback.serverTimestamp = Date.now();
    room.playback.isPlaying = Boolean(transition.nextTrack);

    await this.persistQueue(room);
    await this.persistPlaybackState(room);
    return true;
  }

  async playQueueItemNow(room: RoomRuntime, trackId: string): Promise<boolean> {
    const idx = room.playback.queue.findIndex((t) => t.id === trackId);
    if (idx === -1) return false;

    const previous = room.playback.currentTrack;
    if (previous) {
      await this.recordHistory(room, previous);
    }

    const [selected] = room.playback.queue.splice(idx, 1);
    room.playback.currentTrack = selected;
    room.playback.positionAtTimestamp = 0;
    room.playback.serverTimestamp = Date.now();
    room.playback.isPlaying = true;

    await this.persistQueue(room);
    await this.persistPlaybackState(room);
    return true;
  }

  async removeQueueItem(room: RoomRuntime, trackId: string): Promise<boolean> {
    const idx = room.playback.queue.findIndex((t) => t.id === trackId);
    if (idx === -1) return false;
    room.playback.queue.splice(idx, 1);
    await this.persistQueue(room);
    await this.persistPlaybackState(room);
    return true;
  }

  async reorderQueue(room: RoomRuntime, fromIndex: number, toIndex: number): Promise<boolean> {
    const len = room.playback.queue.length;
    if (
      fromIndex < 0 ||
      fromIndex >= len ||
      toIndex < 0 ||
      toIndex >= len ||
      fromIndex === toIndex
    ) {
      return false;
    }
    const [moved] = room.playback.queue.splice(fromIndex, 1);
    room.playback.queue.splice(toIndex, 0, moved);
    await this.persistQueue(room);
    await this.persistPlaybackState(room);
    return true;
  }

  async setRepeatMode(room: RoomRuntime, repeatMode: RepeatMode): Promise<void> {
    room.playback.repeatMode = repeatMode;
    await this.persistPlaybackState(room);
  }

  async setShuffle(room: RoomRuntime, shuffleEnabled: boolean): Promise<void> {
    room.playback.shuffleEnabled = shuffleEnabled;
    await this.persistPlaybackState(room);
  }

  async setControlMode(room: RoomRuntime, controlMode: ControlMode): Promise<void> {
    room.controlMode = controlMode;
    await this.persistPlaybackState(room);
  }

  async updateMemberRole(room: RoomRuntime, targetUserId: number, role: RoomRole): Promise<void> {
    await db.query(
      'UPDATE room_members SET role = $3 WHERE room_id = $1 AND user_id = $2',
      [room.id, targetUserId, role]
    );
    const member = room.members.get(targetUserId);
    if (member) {
      member.role = role;
    }
  }

  async kickMember(room: RoomRuntime, targetUserId: number): Promise<string[]> {
    await db.query(
      'UPDATE room_members SET kicked = TRUE, role = \'listener\' WHERE room_id = $1 AND user_id = $2',
      [room.id, targetUserId]
    );
    const member = room.members.get(targetUserId);
    if (member) {
      member.kicked = true;
      member.role = 'listener';
    }
    const sockets = Array.from(room.onlineSockets.get(targetUserId) || []);
    room.onlineSockets.delete(targetUserId);
    for (const sid of sockets) {
      const p = this.socketPresence.get(sid);
      if (p && p.roomCode === room.code) {
        p.roomCode = null;
        p.roomName = null;
      }
    }
    return sockets;
  }

  async addChatMessage(
    room: RoomRuntime,
    user: AuthUser,
    body: string,
    clientMessageId?: string
  ): Promise<ChatMessage | null> {
    const id = clientMessageId || crypto.randomUUID();
    if (room.chat.some((m) => m.id === id)) {
      return null; // Idempotent guard
    }

    const res = await db.query<{ created_at: string }>(
      `INSERT INTO chat_messages (id, room_id, user_id, username, body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING
       RETURNING created_at`,
      [id, room.id, user.id, user.username, body]
    );
    if (res.rows.length === 0) return null;

    const msg: ChatMessage = {
      id,
      roomId: room.id,
      userId: user.id,
      username: user.username,
      body,
      createdAt: res.rows[0].created_at,
    };

    room.chat.push(msg);
    if (room.chat.length > config.maxChatMessages) {
      room.chat.splice(0, room.chat.length - config.maxChatMessages);
      // Trim oldest rows in Postgres to keep storage bounded on free tier
      await db.query(
        `DELETE FROM chat_messages
         WHERE room_id = $1
           AND id NOT IN (
             SELECT id FROM chat_messages
             WHERE room_id = $1
             ORDER BY created_at DESC
             LIMIT $2
           )`,
        [room.id, config.maxChatMessages]
      );
    }

    return msg;
  }

  /**
   * Update track duration if YouTube IFrame discovers the exact duration for an oEmbed fallback track.
   */
  async updateCurrentTrackDurationIfUnknown(
    room: RoomRuntime,
    trackId: string,
    durationSec: number
  ): Promise<boolean> {
    if (
      !room.playback.currentTrack ||
      room.playback.currentTrack.id !== trackId ||
      room.playback.currentTrack.durationSec > 0 ||
      !Number.isFinite(durationSec) ||
      durationSec <= 0
    ) {
      return false;
    }
    room.playback.currentTrack = {
      ...room.playback.currentTrack,
      durationSec: Math.round(durationSec),
    };
    await this.persistPlaybackState(room);
    return true;
  }
}

export const roomManager = new RoomManager();
