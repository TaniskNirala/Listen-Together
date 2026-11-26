import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db';
import {
  findUserByUsername,
  hasAnyAdmin,
  hashPassword,
  requireAuth,
  toAuthUser,
  verifyPassword,
  type AuthedRequest,
  type UserRow,
} from '../auth';
import { logger } from '../logger';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait a few minutes and try again.' },
});

const loginSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(1).max(128),
});

const setupAdminSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, 'Username must be at least 2 characters.')
    .max(32, 'Username must be 32 characters or fewer.')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores, or hyphens.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password is too long.'),
});

router.get('/setup-status', async (_req, res) => {
  try {
    const adminExists = await hasAnyAdmin();
    res.json({ needsAdminSetup: !adminExists });
  } catch (err) {
    logger.error('setup_status_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Unable to check server setup status.' });
  }
});

/**
 * One-time first-run admin claim route.
 * Permanently locks itself as soon as any admin exists (or when ADMIN_USERNAME/ADMIN_PASSWORD are set).
 */
router.post('/setup-admin', authLimiter, async (req, res) => {
  try {
    const adminExists = await hasAnyAdmin();
    if (adminExists) {
      res.status(403).json({ error: 'Initial administrator has already been configured.' });
      return;
    }

    const parsed = setupAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
      return;
    }

    const { username, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const normalized = username.toLowerCase();

    const insertRes = await db.query<UserRow>(
      `INSERT INTO users (username, username_lower, password_hash, role, disabled)
       SELECT $1, $2, $3, 'admin', FALSE
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
       RETURNING id, username, username_lower, password_hash, role, disabled, created_at`,
      [username, normalized, passwordHash]
    );

    const created = insertRes.rows[0];
    if (!created) {
      res.status(403).json({ error: 'Initial administrator was already configured.' });
      return;
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error('session_regen_error', { message: String(regenErr) });
        res.status(500).json({ error: 'Failed to create session.' });
        return;
      }
      req.session.userId = created.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('session_save_error', { message: String(saveErr) });
          res.status(500).json({ error: 'Failed to save session.' });
          return;
        }
        logger.info('admin_claimed_first_run', { username: created.username });
        res.status(201).json({ user: toAuthUser(created) });
      });
    });
  } catch (err) {
    logger.error('setup_admin_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to initialize admin account.' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter both username and password.' });
      return;
    }

    const user = await findUserByUsername(parsed.data.username);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    if (user.disabled) {
      res.status(403).json({ error: 'This account has been disabled by an administrator.' });
      return;
    }

    const valid = await verifyPassword(parsed.data.password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error('login_session_regen_error', { message: String(regenErr) });
        res.status(500).json({ error: 'Could not start session.' });
        return;
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('login_session_save_error', { message: String(saveErr) });
          res.status(500).json({ error: 'Could not save session.' });
          return;
        }
        logger.info('user_logged_in', { userId: user.id, username: user.username });
        res.json({ user: toAuthUser(user) });
      });
    });
  } catch (err) {
    logger.error('login_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Sign-in failed. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('pulseroom.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

export default router;
