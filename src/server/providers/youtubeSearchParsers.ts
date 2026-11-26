import type { ResolvedTrackMetadata } from './types';

const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function isValidYouTubeVideoId(id: unknown): id is string {
  return typeof id === 'string' && YOUTUBE_VIDEO_ID_REGEX.test(id);
}

export function defaultYouTubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function sanitizeThumbnailUrl(url: unknown, videoId: string): string {
  if (typeof url !== 'string' || !url.trim()) {
    return defaultYouTubeThumbnail(videoId);
  }
  const trimmed = url.trim();
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return defaultYouTubeThumbnail(videoId);
    }
    const host = parsed.hostname.toLowerCase();
    const isSafeHost =
      host === 'i.ytimg.com' ||
      host.endsWith('.ytimg.com') ||
      host.endsWith('.ggpht.com') ||
      host.endsWith('.googleusercontent.com');
    if (isSafeHost) {
      return parsed.protocol === 'http:'
        ? `https://${parsed.host}${parsed.pathname}${parsed.search}`
        : parsed.toString();
    }
  } catch {
    // Fall through to canonical YouTube thumbnail
  }
  return defaultYouTubeThumbnail(videoId);
}

export function parseDurationTextToSec(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const cleaned = text.trim();
  if (!cleaned || !/^\d{1,2}(?::\d{2}){1,2}$/.test(cleaned)) {
    return 0;
  }
  const parts = cleaned.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function readYouTubeText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const obj = node as {
    simpleText?: unknown;
    runs?: Array<{ text?: unknown }>;
  };
  if (typeof obj.simpleText === 'string' && obj.simpleText.trim()) {
    return obj.simpleText.trim();
  }
  if (Array.isArray(obj.runs)) {
    const joined = obj.runs
      .map((r) => (typeof r?.text === 'string' ? r.text : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }
  return '';
}

function pickThumbnailFromList(node: unknown, videoId: string): string {
  if (!node || typeof node !== 'object') return defaultYouTubeThumbnail(videoId);
  const thumbnails = (node as { thumbnails?: Array<{ url?: unknown }> }).thumbnails;
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return defaultYouTubeThumbnail(videoId);
  }
  // Last thumbnail in YouTube's array is typically the highest resolution
  for (let i = thumbnails.length - 1; i >= 0; i--) {
    const url = thumbnails[i]?.url;
    if (typeof url === 'string' && url.trim()) {
      return sanitizeThumbnailUrl(url, videoId);
    }
  }
  return defaultYouTubeThumbnail(videoId);
}

function mapVideoRenderer(renderer: Record<string, unknown>): ResolvedTrackMetadata | null {
  const videoId = renderer.videoId;
  if (!isValidYouTubeVideoId(videoId)) return null;

  const title = readYouTubeText(renderer.title) || readYouTubeText(renderer.headline);
  if (!title) return null;

  const artist =
    readYouTubeText(renderer.ownerText) ||
    readYouTubeText(renderer.longBylineText) ||
    readYouTubeText(renderer.shortBylineText) ||
    'YouTube';

  const durationText =
    readYouTubeText(renderer.lengthText) ||
    readYouTubeText(
      (renderer.thumbnailOverlays as Array<{ thumbnailOverlayTimeStatusRenderer?: { text?: unknown } }> | undefined)?.find(
        (o) => o?.thumbnailOverlayTimeStatusRenderer?.text
      )?.thumbnailOverlayTimeStatusRenderer?.text
    );

  const durationSec = parseDurationTextToSec(durationText);
  const thumbnailUrl = pickThumbnailFromList(renderer.thumbnail, videoId);

  return {
    youtubeId: videoId,
    title,
    artist,
    durationSec,
    thumbnailUrl,
    source: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

/**
 * Recursively extracts video results from any YouTube InnerTube or ytInitialData JSON tree.
 * Resilient to YouTube wrapping results in different container renderers over time.
 */
export function extractInnerTubeVideoRenderers(
  root: unknown,
  limit = 8
): ResolvedTrackMetadata[] {
  const capped = Math.min(Math.max(1, limit), 20);
  const results: ResolvedTrackMetadata[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [root];
  let visited = 0;
  const MAX_NODES = 12_000;

  while (stack.length > 0 && results.length < capped && visited < MAX_NODES) {
    const current = stack.pop();
    visited += 1;
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) {
        stack.push(current[i]);
      }
      continue;
    }

    const obj = current as Record<string, unknown>;

    const candidate =
      (obj.videoRenderer as Record<string, unknown> | undefined) ||
      (obj.compactVideoRenderer as Record<string, unknown> | undefined) ||
      (obj.gridVideoRenderer as Record<string, unknown> | undefined) ||
      (obj.playlistVideoRenderer as Record<string, unknown> | undefined);

    if (candidate && typeof candidate === 'object') {
      const mapped = mapVideoRenderer(candidate);
      if (mapped && !seen.has(mapped.youtubeId)) {
        seen.add(mapped.youtubeId);
        results.push(mapped);
        if (results.length >= capped) break;
      }
      continue;
    }

    const keys = Object.keys(obj);
    for (let i = keys.length - 1; i >= 0; i--) {
      const val = obj[keys[i]];
      if (val && typeof val === 'object') {
        stack.push(val);
      }
    }
  }

  return results;
}

/**
 * Extracts the balanced JSON object assigned to `ytInitialData` in a YouTube HTML page.
 */
export function extractYtInitialDataFromHtml(html: string): unknown | null {
  if (!html || typeof html !== 'string') return null;

  const markers = [
    'var ytInitialData =',
    'window["ytInitialData"] =',
    "window['ytInitialData'] =",
    'ytInitialData =',
  ];

  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;

    const startBrace = html.indexOf('{', idx + marker.length);
    if (startBrace === -1) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startBrace; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const jsonSlice = html.slice(startBrace, i + 1);
          try {
            return JSON.parse(jsonSlice);
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Parses results from an Invidious `/api/v1/search?q=...&type=video` JSON payload.
 */
export function parseInvidiousSearchResults(
  payload: unknown,
  limit = 8
): ResolvedTrackMetadata[] {
  if (!Array.isArray(payload)) return [];
  const capped = Math.min(Math.max(1, limit), 20);
  const results: ResolvedTrackMetadata[] = [];
  const seen = new Set<string>();

  for (const entry of payload) {
    if (results.length >= capped) break;
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as {
      type?: unknown;
      videoId?: unknown;
      title?: unknown;
      author?: unknown;
      lengthSeconds?: unknown;
      videoThumbnails?: Array<{ url?: unknown; quality?: unknown }>;
    };

    if (item.type && item.type !== 'video') continue;
    if (!isValidYouTubeVideoId(item.videoId)) continue;
    if (seen.has(item.videoId)) continue;

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;

    const artist =
      typeof item.author === 'string' && item.author.trim() ? item.author.trim() : 'YouTube';
    const durationSec =
      typeof item.lengthSeconds === 'number' && Number.isFinite(item.lengthSeconds) && item.lengthSeconds > 0
        ? Math.round(item.lengthSeconds)
        : 0;

    const thumbCandidate =
      item.videoThumbnails?.find((t) => t?.quality === 'high' || t?.quality === 'medium')?.url ||
      item.videoThumbnails?.[0]?.url;

    seen.add(item.videoId);
    results.push({
      youtubeId: item.videoId,
      title,
      artist,
      durationSec,
      thumbnailUrl: sanitizeThumbnailUrl(thumbCandidate, item.videoId),
      source: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
    });
  }

  return results;
}

function extractVideoIdFromRelativeUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const match = /[?&]v=([a-zA-Z0-9_-]{11})/.exec(rawUrl);
  if (match && isValidYouTubeVideoId(match[1])) return match[1];
  const shortMatch = /\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/.exec(rawUrl);
  if (shortMatch && isValidYouTubeVideoId(shortMatch[1])) return shortMatch[1];
  return null;
}

/**
 * Parses results from a Piped `/search?q=...&filter=videos` JSON payload.
 */
export function parsePipedSearchResults(payload: unknown, limit = 8): ResolvedTrackMetadata[] {
  if (!payload || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const capped = Math.min(Math.max(1, limit), 20);
  const results: ResolvedTrackMetadata[] = [];
  const seen = new Set<string>();

  for (const entry of items) {
    if (results.length >= capped) break;
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as {
      type?: unknown;
      url?: unknown;
      title?: unknown;
      uploaderName?: unknown;
      duration?: unknown;
      thumbnail?: unknown;
    };

    if (item.type && item.type !== 'stream' && item.type !== 'video') continue;
    const videoId = extractVideoIdFromRelativeUrl(item.url);
    if (!videoId || seen.has(videoId)) continue;

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;

    const artist =
      typeof item.uploaderName === 'string' && item.uploaderName.trim()
        ? item.uploaderName.trim()
        : 'YouTube';
    const durationSec =
      typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0
        ? Math.round(item.duration)
        : 0;

    seen.add(videoId);
    results.push({
      youtubeId: videoId,
      title,
      artist,
      durationSec,
      thumbnailUrl: sanitizeThumbnailUrl(item.thumbnail, videoId),
      source: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }

  return results;
}
