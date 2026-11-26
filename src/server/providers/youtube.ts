import youtubeSrModule from 'youtube-sr';
import { config } from '../config';
import { logger } from '../logger';
import { getCachedLookup, setCachedLookup } from './cache';
import { isAllowedYouTubeUrl, parseYouTubeInput } from './parsers';
import type { MusicProvider, ResolveOptions, ResolvedTrackMetadata, ResolveResult } from './types';

// Handle ESM/CJS interop safely for youtube-sr
const YouTube =
  (youtubeSrModule as unknown as { YouTube?: typeof youtubeSrModule }).YouTube || youtubeSrModule;

const VIDEO_CACHE_TTL_SEC = 60 * 60 * 24; // 24 hours
const SEARCH_CACHE_TTL_SEC = 60 * 60; // 1 hour
const PLAYLIST_CACHE_TTL_SEC = 60 * 60; // 1 hour
const FETCH_TIMEOUT_MS = 8500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delayMs = 350 * Math.pow(2, attempt - 1);
        logger.warn('provider_retry', {
          label,
          attempt,
          delayMs,
          message: err instanceof Error ? err.message : String(err),
        });
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function parseIsoDurationToSec(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const h = Number.parseInt(match[1] || '0', 10);
  const m = Number.parseInt(match[2] || '0', 10);
  const s = Number.parseInt(match[3] || '0', 10);
  return h * 3600 + m * 60 + s;
}

function defaultThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function fetchYouTubeApiVideo(videoId: string): Promise<ResolvedTrackMetadata | null> {
  if (!config.youtubeApiKey) return null;
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(
    videoId
  )}&key=${encodeURIComponent(config.youtubeApiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
      };
      contentDetails?: { duration?: string };
    }>;
  };
  const item = data.items?.[0];
  if (!item) return null;
  return {
    youtubeId: videoId,
    title: item.snippet?.title || `YouTube Video (${videoId})`,
    artist: item.snippet?.channelTitle || 'YouTube',
    durationSec: parseIsoDurationToSec(item.contentDetails?.duration || ''),
    thumbnailUrl:
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      defaultThumbnail(videoId),
    source: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function fetchYouTubeOEmbed(videoId: string): Promise<ResolvedTrackMetadata | null> {
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;
  const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };
  if (!data.title) return null;
  return {
    youtubeId: videoId,
    title: data.title,
    artist: data.author_name || 'YouTube',
    durationSec: 0,
    thumbnailUrl: data.thumbnail_url || defaultThumbnail(videoId),
    source: 'youtube',
    sourceUrl: targetUrl,
  };
}

export async function lookupYouTubeVideo(videoId: string): Promise<ResolvedTrackMetadata> {
  const cacheKey = `yt:video:${videoId}`;
  const cached = await getCachedLookup<ResolvedTrackMetadata>(cacheKey);
  if (cached) return cached;

  let resolved: ResolvedTrackMetadata | null = null;

  // 1. Optional YouTube Data API v3 (if user provided a free API key)
  if (config.youtubeApiKey) {
    try {
      resolved = await fetchYouTubeApiVideo(videoId);
    } catch (err) {
      logger.warn('yt_api_video_failed', {
        videoId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Primary keyless lookup via youtube-sr
  if (!resolved) {
    try {
      const video = await withRetry(
        () =>
          withTimeout(
            YouTube.getVideo(`https://www.youtube.com/watch?v=${videoId}`),
            FETCH_TIMEOUT_MS,
            'youtube-sr getVideo'
          ),
        'youtube-sr getVideo'
      );
      if (video && video.id) {
        resolved = {
          youtubeId: video.id,
          title: video.title || `YouTube Video (${videoId})`,
          artist: video.channel?.name || 'YouTube',
          durationSec: Math.max(0, Math.round((video.duration || 0) / 1000)),
          thumbnailUrl: video.thumbnail?.url || defaultThumbnail(videoId),
          source: 'youtube',
          sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      }
    } catch (err) {
      logger.warn('yt_sr_video_failed', {
        videoId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Fallback to official YouTube oEmbed endpoint
  if (!resolved) {
    try {
      resolved = await withRetry(() => fetchYouTubeOEmbed(videoId), 'youtube oembed');
    } catch (err) {
      logger.warn('yt_oembed_failed', {
        videoId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Graceful last-resort metadata so valid video IDs can still play in the IFrame player
  if (!resolved) {
    resolved = {
      youtubeId: videoId,
      title: `YouTube Video (${videoId})`,
      artist: 'YouTube',
      durationSec: 0,
      thumbnailUrl: defaultThumbnail(videoId),
      source: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } else {
    await setCachedLookup(cacheKey, 'youtube', resolved, VIDEO_CACHE_TTL_SEC);
  }

  return resolved;
}

export async function searchYouTube(
  query: string,
  limit = 6
): Promise<ResolvedTrackMetadata[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const cappedLimit = Math.min(Math.max(1, limit), 15);
  const cacheKey = `yt:search:${cappedLimit}:${cleanQuery.toLowerCase()}`;
  const cached = await getCachedLookup<ResolvedTrackMetadata[]>(cacheKey);
  if (cached) return cached;

  let results: ResolvedTrackMetadata[] = [];

  // Optional YouTube Data API search
  if (config.youtubeApiKey) {
    try {
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${cappedLimit}&q=${encodeURIComponent(
        cleanQuery
      )}&key=${encodeURIComponent(config.youtubeApiKey)}`;
      const res = await fetch(searchUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{
            id?: { videoId?: string };
            snippet?: {
              title?: string;
              channelTitle?: string;
              thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
            };
          }>;
        };
        results = (data.items || [])
          .filter((item) => Boolean(item.id?.videoId))
          .map((item) => {
            const vid = item.id!.videoId!;
            return {
              youtubeId: vid,
              title: item.snippet?.title || 'Untitled',
              artist: item.snippet?.channelTitle || 'YouTube',
              durationSec: 0,
              thumbnailUrl:
                item.snippet?.thumbnails?.high?.url ||
                item.snippet?.thumbnails?.medium?.url ||
                defaultThumbnail(vid),
              source: 'youtube' as const,
              sourceUrl: `https://www.youtube.com/watch?v=${vid}`,
            };
          });
      }
    } catch (err) {
      logger.warn('yt_api_search_failed', {
        query: cleanQuery,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Primary keyless search via youtube-sr
  if (results.length === 0) {
    try {
      const videos = await withRetry(
        () =>
          withTimeout(
            YouTube.search(cleanQuery, { limit: cappedLimit, type: 'video', safeSearch: false }),
            FETCH_TIMEOUT_MS,
            'youtube-sr search'
          ),
        'youtube-sr search'
      );

      results = (videos || [])
        .filter((v) => Boolean(v.id))
        .map((v) => ({
          youtubeId: v.id!,
          title: v.title || 'Untitled',
          artist: v.channel?.name || 'YouTube',
          durationSec: Math.max(0, Math.round((v.duration || 0) / 1000)),
          thumbnailUrl: v.thumbnail?.url || defaultThumbnail(v.id!),
          source: 'youtube' as const,
          sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
        }));
    } catch (err) {
      logger.warn('yt_sr_search_failed', {
        query: cleanQuery,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (results.length > 0) {
    await setCachedLookup(cacheKey, 'youtube', results, SEARCH_CACHE_TTL_SEC);
  }

  return results;
}

async function lookupYouTubePlaylist(
  playlistId: string,
  options: ResolveOptions
): Promise<ResolveResult> {
  const cacheKey = `yt:playlist:${options.maxItems}:${playlistId}`;
  const cached = await getCachedLookup<ResolveResult>(cacheKey);
  if (cached) {
    return cached;
  }

  options.onProgress?.({
    stage: 'fetching',
    processed: 0,
    total: 0,
    added: 0,
    failed: 0,
    message: 'Fetching YouTube playlist...',
  });

  const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
  const playlist = await withRetry(
    () =>
      withTimeout(
        YouTube.getPlaylist(playlistUrl, { fetchAll: false, limit: options.maxItems }),
        12_000,
        'youtube-sr getPlaylist'
      ),
    'youtube-sr getPlaylist'
  );

  if (!playlist || !playlist.videos || playlist.videos.length === 0) {
    throw new Error('Could not load tracks from this YouTube playlist. Make sure it is public or unlisted.');
  }

  const truncated = playlist.videos.length > options.maxItems;
  const sliced = playlist.videos.slice(0, options.maxItems);

  const tracks: ResolvedTrackMetadata[] = sliced
    .filter((v) => Boolean(v.id))
    .map((v) => ({
      youtubeId: v.id!,
      title: v.title || `YouTube Video (${v.id})`,
      artist: v.channel?.name || 'YouTube',
      durationSec: Math.max(0, Math.round((v.duration || 0) / 1000)),
      thumbnailUrl: v.thumbnail?.url || defaultThumbnail(v.id!),
      source: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
    }));

  const result: ResolveResult = {
    tracks,
    provider: 'youtube',
    playlistTitle: playlist.title || 'YouTube Playlist',
    truncated,
  };

  if (tracks.length > 0) {
    await setCachedLookup(cacheKey, 'youtube', result, PLAYLIST_CACHE_TTL_SEC);
  }

  return result;
}

export const youtubeProvider: MusicProvider = {
  id: 'youtube',

  canHandle(input: string): boolean {
    return isAllowedYouTubeUrl(input);
  },

  async resolve(input: string, options: ResolveOptions): Promise<ResolveResult> {
    const parsed = parseYouTubeInput(input);
    if (!parsed) {
      throw new Error('Invalid YouTube URL.');
    }

    if (parsed.kind === 'playlist' && parsed.playlistId) {
      return lookupYouTubePlaylist(parsed.playlistId, options);
    }

    if (parsed.videoId) {
      const track = await lookupYouTubeVideo(parsed.videoId);
      return {
        tracks: [track],
        provider: 'youtube',
      };
    }

    throw new Error('Could not find a video or playlist ID in this YouTube link.');
  },
};
