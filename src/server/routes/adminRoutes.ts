import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  AccountRenameError,
  hashPassword,
  renameUserAccount,
  requireAdmin,
  requireAuth,
  type AuthedRequest,
  type UserRow,
} from '../auth';
import { roomManager } from '../roomManager';
import { destroyUserSessions } from '../sessionStore';
import { disconnectUserSockets, syncUserRenameAcrossSockets } from '../socket';
import { logger } from '../logger';
import type { AdminUserRecord } from '../../shared/types';

const router = Router();
router.use(requireAuth, requireAdmin);

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, 'Username must be at least 2 characters.')
    .max(32, 'Username must be 32 characters or fewer.')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores, or hyphens.'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters.')
    .max(128, 'Password is too long.'),
  role: z.enum(['admin', 'user']).default('user'),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters.').max(128),
});

const disableSchema = z.object({
  disabled: z.boolean(),
});

router.get('/users', async (_req, res) => {
  try {
    const result = await db.query<UserRow>(
      `SELECT id, username, username_lower, role, disabled, created_at
       FROM users
       ORDER BY created_at ASC`
    );

    const users: AdminUserRecord[] = result.rows.map((row) => {
      const presence = roomManager.getUserOnlinePresence(row.id);
      return {
        id: row.id,
        username: row.username,
        role: row.role,
        disabled: row.disabled,
        createdAt: row.created_at,
        online: presence.online,
        currentRoomCode: presence.currentRoomCode,
        currentRoomName: presence.currentRoomName,
      };
    });

    res.json({ users });
  } catch (err) {
    logger.error('admin_list_users_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

router.post('/users', async (req: AuthedRequest, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user data.' });
      return;
    }

    const { username, password, role } = parsed.data;
    const normalized = username.toLowerCase();

    const exists = await db.query('SELECT 1 FROM users WHERE username_lower = $1', [normalized]);
    if (exists.rows.length > 0) {
      res.status(409).json({ error: `Username "${username}" already exists.` });
      return;
    }

    const passwordHash = await hashPassword(password);
    const createdRes = await db.query<UserRow>(
      `INSERT INTO users (username, username_lower, password_hash, role, disabled)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, username, username_lower, role, disabled, created_at`,
      [username, normalized, passwordHash, role]
    );

    const row = createdRes.rows[0];
    logger.info('admin_created_user', {
      actor: req.user?.username,
      targetUsername: row.username,
      role: row.role,
    });

    res.status(201).json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        disabled: row.disabled,
        createdAt: row.created_at,
        online: false,
        currentRoomCode: null,
        currentRoomName: null,
      } satisfies AdminUserRecord,
    });
  } catch (err) {
    logger.error('admin_create_user_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

router.post('/users/:id/reset-password', async (req: AuthedRequest, res) => {
  try {
    const targetId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) {
      res.status(400).json({ error: 'Invalid user ID.' });
      return;
    }

    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password.' });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const updated = await db.query(
      'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1 RETURNING id, username',
      [targetId, passwordHash]
    );

    if (updated.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    // Revoke existing sessions for non-self resets so old credentials cannot persist
    if (req.user && req.user.id !== targetId) {
      await destroyUserSessions(targetId);
      disconnectUserSockets(targetId, 'Your password was reset by an administrator. Please sign in again.');
    }

    logger.info('admin_reset_password', { actor: req.user?.username, targetId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('admin_reset_password_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

router.patch('/users/:id/username', async (req: AuthedRequest, res) => {
  try {
    const targetId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) {
      res.status(400).json({ error: 'Invalid user ID.' });
      return;
    }

    const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
    const updatedUser = await renameUserAccount(targetId, rawUsername);
    syncUserRenameAcrossSockets(targetId, updatedUser);

    logger.info('admin_renamed_user', {
      actor: req.user?.username,
      targetId,
      newUsername: updatedUser.username,
    });
    res.json({ user: updatedUser });
  } catch (err) {
    if (err instanceof AccountRenameError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error('admin_rename_user_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to update username.' });
  }
});

router.patch('/users/:id/disable', async (req: AuthedRequest, res) => {
  try {
    const targetId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) {
      res.status(400).json({ error: 'Invalid user ID.' });
      return;
    }
    if (req.user && req.user.id === targetId) {
      res.status(400).json({ error: 'You cannot disable your own account.' });
      return;
    }

    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid disabled state.' });
      return;
    }

    const updated = await db.query(
      'UPDATE users SET disabled = $2, updated_at = NOW() WHERE id = $1 RETURNING id',
      [targetId, parsed.data.disabled]
    );
    if (updated.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (parsed.data.disabled) {
      await destroyUserSessions(targetId);
      disconnectUserSockets(targetId, 'Your account was disabled by an administrator.');
    }

    logger.info('admin_toggle_disable_user', {
      actor: req.user?.username,
      targetId,
      disabled: parsed.data.disabled,
    });
    res.json({ ok: true, disabled: parsed.data.disabled });
  } catch (err) {
    logger.error('admin_disable_user_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to update user status.' });
  }
});

router.delete('/users/:id', async (req: AuthedRequest, res) => {
  try {
    const targetId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) {
      res.status(400).json({ error: 'Invalid user ID.' });
      return;
    }
    if (req.user && req.user.id === targetId) {
      res.status(400).json({ error: 'You cannot delete your own account.' });
      return;
    }

    await destroyUserSessions(targetId);
    disconnectUserSockets(targetId, 'Your account has been removed by an administrator.');

    const deleted = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [targetId]);
    if (deleted.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    logger.info('admin_deleted_user', { actor: req.user?.username, targetId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('admin_delete_user_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

export default router;
