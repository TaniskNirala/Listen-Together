import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';
import { config } from './config';
import { logger } from './logger';
import type { AuthUser, GlobalRole } from '../shared/types';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

const BCRYPT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface UserRow {
  id: number;
  username: string;
  username_lower: string;
  password_hash: string;
  role: GlobalRole;
  disabled: boolean;
  created_at: string;
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: row.disabled,
    createdAt: row.created_at,
  };
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const res = await db.query<UserRow>(
    'SELECT id, username, username_lower, password_hash, role, disabled, created_at FROM users WHERE id = $1',
    [id]
  );
  return res.rows[0] ?? null;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const normalized = username.trim().toLowerCase();
  const res = await db.query<UserRow>(
    'SELECT id, username, username_lower, password_hash, role, disabled, created_at FROM users WHERE username_lower = $1',
    [normalized]
  );
  return res.rows[0] ?? null;
}

export async function hasAnyAdmin(): Promise<boolean> {
  const res = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'"
  );
  return Number.parseInt(res.rows[0]?.count ?? '0', 10) > 0;
}

/**
 * Seeds the initial admin user from ADMIN_USERNAME and ADMIN_PASSWORD env vars on first run.
 * If env vars are configured, ensures that admin exists and is enabled.
 */
export async function ensureEnvAdmin(): Promise<void> {
  if (!config.adminUsername || !config.adminPassword) {
    const adminExists = await hasAnyAdmin();
    if (!adminExists) {
      logger.info('admin_bootstrap_waiting', {
        message: 'ADMIN_USERNAME/ADMIN_PASSWORD not set; first-run admin setup form is active.',
      });
    }
    return;
  }

  const normalized = config.adminUsername.toLowerCase();
  const existing = await findUserByUsername(normalized);
  if (!existing) {
    const passwordHash = await hashPassword(config.adminPassword);
    await db.query(
      `INSERT INTO users (username, username_lower, password_hash, role, disabled)
       VALUES ($1, $2, $3, 'admin', FALSE)
       ON CONFLICT (username_lower) DO NOTHING`,
      [config.adminUsername, normalized, passwordHash]
    );
    logger.info('admin_seeded_from_env', { username: config.adminUsername });
  } else if (existing.role !== 'admin' || existing.disabled) {
    await db.query(
      `UPDATE users SET role = 'admin', disabled = FALSE, updated_at = NOW() WHERE id = $1`,
      [existing.id]
    );
    logger.info('admin_restored_from_env', { username: config.adminUsername });
  }
}

/**
 * CSRF defense for cookie-authenticated state-changing requests.
 * Requires either X-Requested-With header or matching Origin/Host.
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    next();
    return;
  }

  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // fall through to 403
    }
  }

  res.status(403).json({ error: 'Invalid request origin.' });
}

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const user = await findUserById(userId);
    if (!user || user.disabled) {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'Session is no longer valid.' });
      return;
    }

    req.user = toAuthUser(user);
    next();
  } catch (err) {
    logger.error('require_auth_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to verify session.' });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  next();
}
