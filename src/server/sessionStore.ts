import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { db } from './db';
import { config } from './config';
import { logger } from './logger';

/**
 * PostgreSQL-backed session store for PGlite fallback mode (same user_sessions table schema).
 */
class EmbeddedPgSessionStore extends session.Store {
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.pruneTimer = setInterval(() => {
      void this.pruneExpired();
    }, 1000 * 60 * 15);
    this.pruneTimer.unref();
  }

  private async pruneExpired(): Promise<void> {
    try {
      await db.query('DELETE FROM user_sessions WHERE expire < NOW()');
    } catch (err) {
      logger.warn('session_prune_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  get(sid: string, callback: (err?: unknown, session?: session.SessionData | null) => void): void {
    db.query<{ sess: session.SessionData | string }>(
      'SELECT sess FROM user_sessions WHERE sid = $1 AND expire >= NOW()',
      [sid]
    )
      .then((res) => {
        if (res.rows.length === 0) {
          callback(null, null);
          return;
        }
        const raw = res.rows[0].sess;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        callback(null, parsed);
      })
      .catch((err) => callback(err));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    const maxAge = sess.cookie?.maxAge ?? config.sessionMaxAgeMs;
    const expire = new Date(Date.now() + maxAge).toISOString();
    db.query(
      `INSERT INTO user_sessions (sid, sess, expire)
       VALUES ($1, $2::json, $3::timestamp)
       ON CONFLICT (sid)
       DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(sess), expire]
    )
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    db.query('DELETE FROM user_sessions WHERE sid = $1', [sid])
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    const maxAge = sess.cookie?.maxAge ?? config.sessionMaxAgeMs;
    const expire = new Date(Date.now() + maxAge).toISOString();
    db.query('UPDATE user_sessions SET expire = $2::timestamp WHERE sid = $1', [sid, expire])
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }
}

export function createSessionStore(): session.Store {
  const pool = db.getPgPool();
  if (pool) {
    const PgSession = connectPgSimple(session);
    return new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: false,
      pruneSessionInterval: 60 * 15,
    });
  }
  return new EmbeddedPgSessionStore();
}

export async function destroyUserSessions(userId: number): Promise<void> {
  await db.query(
    `DELETE FROM user_sessions WHERE (sess->>'userId')::int = $1`,
    [userId]
  );
}
