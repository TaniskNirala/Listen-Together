import fs from 'node:fs';
import path from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from './config';
import { logger } from './logger';

export interface DbQueryResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount: number;
}

const TRANSIENT_PG_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '57P01',
  '57P02',
  '57P03',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

function isTransientConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && TRANSIENT_PG_CODES.has(e.code)) return true;
  const msg = (e.message || '').toLowerCase();
  return (
    msg.includes('connection terminated') ||
    msg.includes('connection timeout') ||
    msg.includes('socket hang up') ||
    msg.includes('the database system is starting up') ||
    msg.includes('terminating connection') ||
    msg.includes('endpoint is disabled') ||
    msg.includes('could not connect')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldUseSsl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return parsed.searchParams.get('sslmode') === 'require';
    }
    return true;
  } catch {
    return true;
  }
}

class Database {
  private pgPool: Pool | null = null;
  private pglite: PGlite | null = null;
  private initialized = false;
  public mode: 'pg' | 'pglite' = 'pg';

  async init(): Promise<void> {
    if (this.initialized) return;

    if (config.databaseUrl) {
      this.mode = 'pg';
      const useSsl = shouldUseSsl(config.databaseUrl);
      this.pgPool = new Pool({
        connectionString: config.databaseUrl,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
      });

      this.pgPool.on('error', (err) => {
        logger.error('db_pool_idle_error', { message: err.message });
      });

      logger.info('db_initialized', { mode: 'pg', maxPool: 5, ssl: useSsl });
    } else {
      this.mode = 'pglite';
      const dataDir = path.resolve(process.cwd(), '.data', 'pglite');
      fs.mkdirSync(dataDir, { recursive: true });
      this.pglite = new PGlite(dataDir);
      await this.pglite.waitReady;
      logger.info('db_initialized', { mode: 'pglite', dataDir });
    }

    this.initialized = true;
    await this.runMigrations();
  }

  getPgPool(): Pool | null {
    return this.pgPool;
  }

  /**
   * Executes a parameterized SQL query.
   * For Neon Postgres auto-suspend, retries transient connection errors up to 3 times with backoff.
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<DbQueryResult<T>> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.mode === 'pglite' && this.pglite) {
      const res = await this.pglite.query<T>(text, params);
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    }

    if (!this.pgPool) {
      throw new Error('Database pool is not initialized.');
    }

    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.pgPool.query<T>(text, params);
        return {
          rows: res.rows,
          rowCount: res.rowCount ?? res.rows.length,
        };
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts && isTransientConnectionError(err)) {
          const delayMs = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
          logger.warn('db_query_retry_neon_wake', {
            attempt,
            delayMs,
            message: err instanceof Error ? err.message : String(err),
          });
          await sleep(delayMs);
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  async execRaw(sql: string): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
    if (this.mode === 'pglite' && this.pglite) {
      await this.pglite.exec(sql);
      return;
    }
    await this.query(sql);
  }

  async runMigrations(): Promise<void> {
    await this.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      logger.warn('migrations_dir_missing', { migrationsDir });
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedRes = await this.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations'
    );
    const applied = new Set(appliedRes.rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) continue;
      const fullPath = path.resolve(migrationsDir, file);
      if (!fullPath.startsWith(migrationsDir + path.sep)) continue;

      const sql = fs.readFileSync(fullPath, 'utf8');
      logger.info('migration_applying', { file });
      await this.execRaw(sql);
      await this.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      logger.info('migration_applied', { file });
    }
  }

  async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
    }
    this.initialized = false;
  }
}

export const db = new Database();
