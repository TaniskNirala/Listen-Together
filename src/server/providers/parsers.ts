const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const SPOTIFY_HOSTS = new Set(['open.spotify.com']);

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_REGEX = /^[a-zA-Z0-9_-]{10,64}$/;
const SPOTIFY_ID_REGEX = /^[a-zA-Z0-9]{15,32}$/;

export interface ParsedYouTubeInput {
  kind: 'video' | 'playlist';
  videoId?: string;
  playlistId?: string;
  canonicalUrl: string;
}

export interface ParsedSpotifyInput {
  kind: 'track' | 'album' | 'playlist';
  id: string;
  canonicalUrl: string;
}

export function safeParseHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isAllowedYouTubeUrl(raw: string): boolean {
  const parsed = safeParseHttpUrl(raw);
  return Boolean(parsed && YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase()));
}

export function isAllowedSpotifyUrl(raw: string): boolean {
  const parsed = safeParseHttpUrl(raw);
  return Boolean(parsed && SPOTIFY_HOSTS.has(parsed.hostname.toLowerCase()));
}

export function parseYouTubeInput(raw: string): ParsedYouTubeInput | null {
  const parsed = safeParseHttpUrl(raw);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const listParam = parsed.searchParams.get('list')?.trim();
  const validPlaylistId = listParam && YOUTUBE_PLAYLIST_REGEX.test(listParam) ? listParam : undefined;

  let videoId: string | undefined;

  if (host === 'youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    if (seg && YOUTUBE_ID_REGEX.test(seg)) {
      videoId = seg;
    }
  } else {
    const pathname = parsed.pathname;
    if (pathname === '/watch') {
      const v = parsed.searchParams.get('v')?.trim();
      if (v && YOUTUBE_ID_REGEX.test(v)) videoId = v;
    } else if (pathname.startsWith('/shorts/') || pathname.startsWith('/embed/') || pathname.startsWith('/live/')) {
      const seg = pathname.split('/').filter(Boolean)[1];
      if (seg && YOUTUBE_ID_REGEX.test(seg)) videoId = seg;
    } else if (pathname === '/playlist' && validPlaylistId) {
      return {
        kind: 'playlist',
        playlistId: validPlaylistId,
        canonicalUrl: `https://www.youtube.com/playlist?list=${validPlaylistId}`,
      };
    }
  }

  // If URL is a playlist URL with no videoId, or explicitly /playlist
  if (!videoId && validPlaylistId) {
    return {
      kind: 'playlist',
      playlistId: validPlaylistId,
      canonicalUrl: `https://www.youtube.com/playlist?list=${validPlaylistId}`,
    };
  }

  // If a watch URL includes a non-radio playlist (PL / OLAK / UU), treat as playlist if user pasted a playlist link,
  // unless it's a watch link with a video + RD mix -> treat as single video.
  if (videoId && validPlaylistId && !validPlaylistId.startsWith('RD') && parsed.pathname === '/playlist') {
    return {
      kind: 'playlist',
      videoId,
      playlistId: validPlaylistId,
      canonicalUrl: `https://www.youtube.com/playlist?list=${validPlaylistId}`,
    };
  }

  if (videoId) {
    return {
      kind: 'video',
      videoId,
      playlistId: validPlaylistId && !validPlaylistId.startsWith('RD') ? validPlaylistId : undefined,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  return null;
}

export function parseSpotifyInput(raw: string): ParsedSpotifyInput | null {
  const parsed = safeParseHttpUrl(raw);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  if (!SPOTIFY_HOSTS.has(host)) return null;

  // Handle optional locale segment like /intl-en/track/...
  const segments = parsed.pathname.split('/').filter(Boolean);
  const filtered = segments[0]?.startsWith('intl-') ? segments.slice(1) : segments;
  const kind = filtered[0];
  const id = filtered[1];

  if ((kind === 'track' || kind === 'album' || kind === 'playlist') && id && SPOTIFY_ID_REGEX.test(id)) {
    return {
      kind,
      id,
      canonicalUrl: `https://open.spotify.com/${kind}/${id}`,
    };
  }

  return null;
}

/**
 * Parses pasted song names (one per line) for the Spotify fallback batch matcher.
 * Strips numbering prefixes like "1. " or "- " and enforces a cap.
 */
export function parseTrackListLines(raw: string, maxItems: number): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^[-•*]\s+/, '')
        .trim()
    )
    .filter((line) => line.length >= 2 && line.length <= 200);

  return lines.slice(0, Math.max(1, maxItems));
}
