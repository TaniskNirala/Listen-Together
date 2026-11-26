import { db } from '../db';
import { logger } from '../logger';

export async function getCachedLookup<T>(cacheKey: string): Promise<T | null> {
  try {
    const res = await db.query<{ payload_json: T | string }>(
      `SELECT payload_json
       FROM lookup_cache
       WHERE cache_key = $1 AND expires_at > NOW()`,
      [cacheKey]
    );
    if (res.rows.length === 0) return null;
    const payload = res.rows[0].payload_json;
    return (typeof payload === 'string' ? JSON.parse(payload) : payload) as T;
  } catch (err) {
    logger.warn('lookup_cache_read_failed', {
      cacheKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function setCachedLookup<T>(
  cacheKey: string,
  provider: string,
  payload: T,
  ttlSeconds: number
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await db.query(
      `INSERT INTO lookup_cache (cache_key, provider, payload_json, expires_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (cache_key)
       DO UPDATE SET payload_json = EXCLUDED.payload_json, expires_at = EXCLUDED.expires_at`,
      [cacheKey, provider, JSON.stringify(payload), expiresAt]
    );
  } catch (err) {
    logger.warn('lookup_cache_write_failed', {
      cacheKey,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function pruneExpiredCache(): Promise<void> {
  try {
    await db.query('DELETE FROM lookup_cache WHERE expires_at < NOW()');
  } catch {
    // Non-fatal maintenance
  }
}
