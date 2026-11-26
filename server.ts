import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { config } from './src/server/config';
import { logger } from './src/server/logger';
import { db } from './src/server/db';
import { createSessionStore } from './src/server/sessionStore';
import { ensureEnvAdmin, verifyCsrf } from './src/server/auth';
import { roomManager } from './src/server/roomManager';
import { attachSocketServer } from './src/server/socket';
import { pruneExpiredCache } from './src/server/providers/cache';
import authRoutes from './src/server/routes/authRoutes';
import adminRoutes from './src/server/routes/adminRoutes';
import roomRoutes from './src/server/routes/roomRoutes';
import musicRoutes from './src/server/routes/musicRoutes';

const startedAt = Date.now();

// Global process-level guards so unexpected bad input never crashes the Render free service
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

async function bootstrap() {
  // 1. Initialize Postgres (Neon via pg.Pool or PGlite fallback) + run SQL migrations
  await db.init();
  await ensureEnvAdmin();
  await roomManager.loadAllFromDb();

  // Periodic lightweight lookup cache cleanup
  const cachePruneTimer = setInterval(() => {
    void pruneExpiredCache();
  }, 1000 * 60 * 60);
  cachePruneTimer.unref();

  const app = express();
  const httpServer = http.createServer(app);

  // Required on Render and AI Studio proxies so req.secure & rate-limit IPs work accurately
  app.set('trust proxy', 1);

  // Cheap /health endpoint that never hits Postgres (ideal for external uptime pingers)
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  // Security headers with YouTube IFrame & Google Fonts allowed, frameguard off for iframe preview
  app.use(
    helmet({
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https://www.youtube.com',
            'https://s.ytimg.com',
          ],
          'frame-src': [
            "'self'",
            'https://www.youtube.com',
            'https://www.youtube-nocookie.com',
          ],
          'img-src': [
            "'self'",
            'data:',
            'https://i.ytimg.com',
            'https://*.ytimg.com',
            'https://yt3.ggpht.com',
            'https://i.scdn.co',
            'https://mosaic.scdn.co',
            'https://image-cdn-ak.spotifycdn.com',
            'https://image-cdn-fa.spotifycdn.com',
          ],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:', 'https:'],
          'frame-ancestors': ['*'],
        },
      },
    })
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // Postgres-backed sessions (connect-pg-simple in Neon/pg mode, SQL user_sessions in PGlite mode)
  const store = createSessionStore();
  const baseSessionConfig = {
    name: 'pulseroom.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    proxy: true,
  };

  const httpsSessionMiddleware = session({
    ...baseSessionConfig,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      maxAge: config.sessionMaxAgeMs,
    } as session.CookieOptions,
  });

  const httpSessionMiddleware = session({
    ...baseSessionConfig,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: config.sessionMaxAgeMs,
    },
  });

  const adaptiveSessionMiddleware: express.RequestHandler = (req, res, next) => {
    const isHttps =
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      (typeof req.headers.origin === 'string' && req.headers.origin.startsWith('https://'));
    if (isHttps) {
      httpsSessionMiddleware(req, res, next);
    } else {
      httpSessionMiddleware(req, res, next);
    }
  };

  app.use(adaptiveSessionMiddleware);

  // API routes with CSRF protection on mutating requests
  app.use('/api', verifyCsrf);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/music', musicRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  // Attach Socket.IO to the same HTTP server
  const io = attachSocketServer(httpServer, adaptiveSessionMiddleware);

  // Serve Vite in dev or prebuilt dist/ in production (single Render Web Service)
  const distDir = path.resolve(process.cwd(), 'dist');
  const hasBuiltDist = fs.existsSync(path.join(distDir, 'index.html'));

  if (config.isProduction && hasBuiltDist) {
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
    logger.info('frontend_mode', { mode: 'static_dist', distDir });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    logger.info('frontend_mode', { mode: 'vite_middleware' });
  }

  // Global Express error middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('express_unhandled_error', { message: err.message });
    if (res.headersSent) return;
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  httpServer.listen(config.port, '0.0.0.0', () => {
    logger.info('server_listening', {
      port: config.port,
      nodeEnv: config.nodeEnv,
      dbMode: db.mode,
    });
  });

  // Graceful shutdown on Render deploys / SIGTERM
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server_shutdown_start', { signal });
    clearInterval(cachePruneTimer);

    io.close();
    httpServer.close(async () => {
      try {
        await db.close();
      } catch (err) {
        logger.error('db_close_error', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
      logger.info('server_shutdown_complete', { signal });
      process.exit(0);
    });

    // Force exit safety timer if keepalive sockets linger
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('server_bootstrap_fatal', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
