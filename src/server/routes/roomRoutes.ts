import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../auth';
import { config } from '../config';
import { logger } from '../logger';
import { canAddTracks, canManageRoom } from '../permissions';
import { resolveBatchTrackLines, resolveMusicInput } from '../providers';
import { roomManager } from '../roomManager';
import { broadcastRoomPlayback, broadcastRoomToast, emitImportProgressToUser } from '../socket';

const router = Router();
router.use(requireAuth);

const createRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Room name must be at least 2 characters.')
    .max(60, 'Room name must be 60 characters or fewer.'),
  password: z.string().max(64).optional(),
  controlMode: z.enum(['everyone', 'dj_only']).default('everyone'),
});

const addTracksSchema = z.object({
  input: z.string().trim().min(1, 'Paste a link or enter a song name.').max(2048),
  importId: z.string().max(80).optional(),
});

const batchTracksSchema = z.object({
  lines: z.string().trim().min(2, 'Paste at least one song name.').max(20_000),
  importId: z.string().max(80).optional(),
});

router.get('/', async (_req, res) => {
  try {
    const rooms = await roomManager.listRooms();
    res.json({ rooms });
  } catch (err) {
    logger.error('list_rooms_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to list rooms.' });
  }
});

router.post('/', async (req: AuthedRequest, res) => {
  try {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid room settings.' });
      return;
    }

    const room = await roomManager.createRoom({
      name: parsed.data.name,
      password: parsed.data.password,
      controlMode: parsed.data.controlMode,
      host: req.user!,
    });

    logger.info('room_created', {
      roomCode: room.code,
      host: req.user!.username,
      hasPassword: room.hasPassword,
    });

    res.status(201).json({
      room: {
        id: room.id,
        code: room.code,
        name: room.name,
        hasPassword: room.hasPassword,
        controlMode: room.controlMode,
      },
    });
  } catch (err) {
    logger.error('create_room_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create room.',
    });
  }
});

router.delete('/:code', async (req: AuthedRequest, res) => {
  try {
    const room = await roomManager.getOrLoadRoom(req.params.code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const member = room.members.get(req.user!.id);
    const roomRole = req.user!.id === room.hostUserId ? 'host' : member?.role || 'listener';
    if (!canManageRoom({ globalRole: req.user!.role, roomRole, controlMode: room.controlMode })) {
      res.status(403).json({ error: 'Only the host or an administrator can delete this room.' });
      return;
    }

    await roomManager.deleteRoom(room.code);
    broadcastRoomToast(room.code, 'Room was closed by the host.', 'info');
    res.json({ ok: true });
  } catch (err) {
    logger.error('delete_room_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to delete room.' });
  }
});

router.post('/:code/tracks', async (req: AuthedRequest, res) => {
  try {
    const room = await roomManager.getOrLoadRoom(req.params.code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const member = room.members.get(req.user!.id);
    if (!member || member.kicked) {
      res.status(403).json({ error: 'Join the room before adding tracks.' });
      return;
    }

    if (
      !canAddTracks({
        globalRole: req.user!.role,
        roomRole: member.role,
        controlMode: room.controlMode,
      })
    ) {
      res.status(403).json({ error: 'Only DJs and the host can add tracks in this room.' });
      return;
    }

    const parsed = addTracksSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid track input.' });
      return;
    }

    const importId = parsed.data.importId || crypto.randomUUID();
    const result = await resolveMusicInput(parsed.data.input, {
      maxItems: config.maxPlaylistImport,
      onProgress: (p) => {
        emitImportProgressToUser(req.user!.id, {
          importId,
          roomCode: room.code,
          ...p,
        });
      },
    });

    if (result.tracks.length === 0) {
      emitImportProgressToUser(req.user!.id, {
        importId,
        roomCode: room.code,
        stage: 'error',
        processed: 0,
        total: 0,
        added: 0,
        failed: result.failedCount || 0,
        message: result.warning || 'No tracks found.',
      });
      res.status(422).json({
        error: result.warning || 'Could not resolve any tracks from that link.',
        fallbackPasteSupported: Boolean(result.fallbackPasteSupported),
      });
      return;
    }

    const added = await roomManager.enqueueTracks(room, result.tracks, req.user!);
    broadcastRoomPlayback(room);

    emitImportProgressToUser(req.user!.id, {
      importId,
      roomCode: room.code,
      stage: 'done',
      processed: result.tracks.length,
      total: result.tracks.length,
      added: added.length,
      failed: result.failedCount || 0,
      message: `Added ${added.length} track${added.length === 1 ? '' : 's'} to queue.`,
    });

    if (added.length > 1) {
      broadcastRoomToast(
        room.code,
        `${req.user!.username} imported ${added.length} tracks${
          result.playlistTitle ? ` from "${result.playlistTitle}"` : ''
        }.`,
        'info'
      );
    }

    res.status(201).json({
      addedCount: added.length,
      tracks: added,
      playlistTitle: result.playlistTitle,
      truncated: Boolean(result.truncated),
      failedCount: result.failedCount || 0,
      maxPlaylistImport: config.maxPlaylistImport,
    });
  } catch (err) {
    logger.error('add_tracks_error', {
      roomCode: req.params.code,
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to add track.',
    });
  }
});

router.post('/:code/batch-tracks', async (req: AuthedRequest, res) => {
  try {
    const room = await roomManager.getOrLoadRoom(req.params.code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const member = room.members.get(req.user!.id);
    if (!member || member.kicked) {
      res.status(403).json({ error: 'Join the room before adding tracks.' });
      return;
    }

    if (
      !canAddTracks({
        globalRole: req.user!.role,
        roomRole: member.role,
        controlMode: room.controlMode,
      })
    ) {
      res.status(403).json({ error: 'Only DJs and the host can add tracks in this room.' });
      return;
    }

    const parsed = batchTracksSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid track list.' });
      return;
    }

    const importId = parsed.data.importId || crypto.randomUUID();
    const result = await resolveBatchTrackLines(parsed.data.lines, {
      maxItems: config.maxPlaylistImport,
      onProgress: (p) => {
        emitImportProgressToUser(req.user!.id, {
          importId,
          roomCode: room.code,
          ...p,
        });
      },
    });

    if (result.tracks.length === 0) {
      res.status(422).json({ error: 'Could not match any of those songs on YouTube.' });
      return;
    }

    const added = await roomManager.enqueueTracks(room, result.tracks, req.user!);
    broadcastRoomPlayback(room);

    emitImportProgressToUser(req.user!.id, {
      importId,
      roomCode: room.code,
      stage: 'done',
      processed: result.tracks.length + (result.failedCount || 0),
      total: result.tracks.length + (result.failedCount || 0),
      added: added.length,
      failed: result.failedCount || 0,
      message: `Matched and added ${added.length} tracks.`,
    });

    res.status(201).json({
      addedCount: added.length,
      failedCount: result.failedCount || 0,
      tracks: added,
    });
  } catch (err) {
    logger.error('batch_tracks_error', {
      roomCode: req.params.code,
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to match track list.',
    });
  }
});

export default router;
