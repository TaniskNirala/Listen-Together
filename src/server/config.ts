import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Generate an ephemeral per-process fallback secret only when SESSION_SECRET is unset in dev/preview.
const fallbackSessionSecret = crypto.randomBytes(32).toString('hex');

export const config = {
  port: parsePositiveInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  sessionSecret: (process.env.SESSION_SECRET || '').trim() || fallbackSessionSecret,
  hasExplicitSessionSecret: Boolean((process.env.SESSION_SECRET || '').trim()),
  adminUsername: (process.env.ADMIN_USERNAME || '').trim(),
  adminPassword: (process.env.ADMIN_PASSWORD || '').trim(),
  youtubeApiKey: (process.env.YOUTUBE_API_KEY || '').trim(),
  maxRooms: parsePositiveInt(process.env.MAX_ROOMS, 50),
  maxUsersPerRoom: parsePositiveInt(process.env.MAX_USERS_PER_ROOM, 30),
  maxPlaylistImport: parsePositiveInt(process.env.MAX_PLAYLIST_IMPORT, 100),
  maxChatMessages: parsePositiveInt(process.env.MAX_CHAT_MESSAGES, 100),
  maxHistoryItems: 50,
  sessionMaxAgeMs: 1000 * 60 * 60 * 24 * 14, // 14 days
};
