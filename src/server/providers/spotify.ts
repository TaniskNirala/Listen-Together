import { logger } from '../logger';
import { getCachedLookup, setCachedLookup } from './cache';
import { isAllowedSpotifyUrl, parseSpotifyInput } from './parsers';
import { searchYouTube } from './youtube';
import type { MusicProvider, ResolveOptions, ResolvedTrackMetadata, ResolveResult } from './types';

const SPOTIFY_CACHE_TTL_SEC = 60 * 60 * 12; // 12 hours
const FETCH_TIMEOUT_MS = 9000;

interface SpotifyTrackSeed {
  title: string;
  artist: string;
  durationSec?: number;
  thumbnailUrl?: string;
  sourceUrl: string;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchSpotifyOEmbed(
  canonicalUrl: string
): Promise<{ title?: string; thumbnail_url?: string } | null> {
  const url = `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PulseRoom/1.0 (+https://pulseroom.local)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return (await res.json()) as { title?: string; thumbnail_url?: string };
}

interface SpotifyEmbedParsed {
  name?: string;
  thumbnailUrl?: string;
  tracks: SpotifyTrackSeed[];
}

/**
 * Extracts public track metadata from Spotify's public /embed/ page (__NEXT_DATA__).
 * Works without any Spotify account, API key, or Premium subscription.
 */
async function fetchSpotifyEmbedPage(
  kind: 'track' | 'album' | 'playlist',
  id: string,
  canonicalUrl: string
): Promise<SpotifyEmbedParsed | null> {
  const embedUrl = `https://open.spotify.com/embed/${kind}/${id}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) return null;
  const html = await res.text();

  const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
    html
  );
  if (!nextDataMatch) return null;

  try {
    const parsed = JSON.parse(nextDataMatch[1]) as {
      props?: {
        pageProps?: {
          state?: {
            data?: {
              entity?: {
                name?: string;
                title?: string;
                subtitle?: string;
                duration?: number;
                artists?: Array<{ name?: string }>;
                visualIdentity?: { image?: Array<{ url?: string }> };
                coverArt?: { sources?: Array<{ url?: string }> };
                trackList?: Array<{
                  title?: string;
                  subtitle?: string;
                  duration?: number;
                  uri?: string;
                }>;
              };
            };
          };
        };
      };
    };

    const entity = parsed.props?.pageProps?.state?.data?.entity;
    if (!entity) return null;

    const cover =
      entity.coverArt?.sources?.[0]?.url ||
      entity.visualIdentity?.image?.[0]?.url ||
      undefined;

    if (kind === 'track') {
      const title = entity.name || entity.title || '';
      const artists =
        entity.artists?.map((a) => a.name).filter(Boolean).join(', ') ||
        entity.subtitle ||
        '';
      if (!title) return null;
      return {
        name: title,
        thumbnailUrl: cover,
        tracks: [
          {
            title: decodeHtmlEntities(title),
            artist: decodeHtmlEntities(artists),
            durationSec: entity.duration ? Math.round(entity.duration / 1000) : undefined,
            thumbnailUrl: cover,
            sourceUrl: canonicalUrl,
          },
        ],
      };
    }

    const list = entity.trackList || [];
    const tracks: SpotifyTrackSeed[] = list
      .filter((t) => Boolean(t.title))
      .map((t) => {
        const uriParts = t.uri?.split(':');
        const trackId = uriParts?.[2];
        return {
          title: decodeHtmlEntities(t.title || ''),
          artist: decodeHtmlEntities((t.subtitle || '').replace(/\u00a0/g, ' ')),
          durationSec: t.duration ? Math.round(t.duration / 1000) : undefined,
          thumbnailUrl: cover,
          sourceUrl: trackId ? `https://open.spotify.com/track/${trackId}` : canonicalUrl,
        };
      });

    return {
      name: entity.name || entity.title || `Spotify ${kind}`,
      thumbnailUrl: cover,
      tracks,
    };
  } catch (err) {
    logger.warn('spotify_embed_parse_error', {
      kind,
      id,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function matchSpotifySeedToYouTube(
  seed: SpotifyTrackSeed
): Promise<ResolvedTrackMetadata | null> {
  const query = seed.artist ? `${seed.artist} - ${seed.title}` : seed.title;
  const cacheKey = `sp:ytmatch:${query.toLowerCase()}`;
  const cached = await getCachedLookup<ResolvedTrackMetadata>(cacheKey);
  if (cached) {
    return {
      ...cached,
      source: 'spotify',
      matchedVia: 'youtube',
      sourceUrl: seed.sourceUrl,
      thumbnailUrl: seed.thumbnailUrl || cached.thumbnailUrl,
    };
  }

  const results = await searchYouTube(query, 3);
  if (results.length === 0) return null;

  const best = results[0];
  const matched: ResolvedTrackMetadata = {
    youtubeId: best.youtubeId,
    title: seed.title || best.title,
    artist: seed.artist || best.artist,
    durationSec: best.durationSec || seed.durationSec || 0,
    thumbnailUrl: seed.thumbnailUrl || best.thumbnailUrl,
    source: 'spotify',
    sourceUrl: seed.sourceUrl,
    matchedVia: 'youtube',
  };

  await setCachedLookup(cacheKey, 'spotify', matched, SPOTIFY_CACHE_TTL_SEC);
  return matched;
}

export const spotifyProvider: MusicProvider = {
  id: 'spotify',

  canHandle(input: string): boolean {
    return isAllowedSpotifyUrl(input);
  },

  async resolve(input: string, options: ResolveOptions): Promise<ResolveResult> {
    const parsed = parseSpotifyInput(input);
    if (!parsed) {
      throw new Error('Invalid Spotify URL.');
    }

    const cacheKey = `sp:${parsed.kind}:${options.maxItems}:${parsed.id}`;
    const cached = await getCachedLookup<ResolveResult>(cacheKey);
    if (cached && cached.tracks.length > 0) {
      return cached;
    }

    options.onProgress?.({
      stage: 'fetching',
      processed: 0,
      total: 0,
      added: 0,
      failed: 0,
      message: `Reading Spotify ${parsed.kind} metadata...`,
    });

    // Try public embed page first (works for track, album, playlist)
    let embedData: SpotifyEmbedParsed | null = null;
    try {
      embedData = await fetchSpotifyEmbedPage(parsed.kind, parsed.id, parsed.canonicalUrl);
    } catch (err) {
      logger.warn('spotify_embed_fetch_failed', {
        kind: parsed.kind,
        id: parsed.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    let seeds: SpotifyTrackSeed[] = embedData?.tracks || [];
    let playlistTitle = embedData?.name;

    // Fallback to Spotify oEmbed for single tracks if embed scrape missed
    if (seeds.length === 0 && parsed.kind === 'track') {
      try {
        const oembed = await fetchSpotifyOEmbed(parsed.canonicalUrl);
        if (oembed?.title) {
          seeds = [
            {
              title: oembed.title,
              artist: '',
              thumbnailUrl: oembed.thumbnail_url,
              sourceUrl: parsed.canonicalUrl,
            },
          ];
        }
      } catch (err) {
        logger.warn('spotify_oembed_failed', {
          id: parsed.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (seeds.length === 0) {
      return {
        tracks: [],
        provider: 'spotify',
        fallbackPasteSupported: true,
        warning:
          parsed.kind === 'track'
            ? 'Could not read this Spotify track automatically. Paste "Artist - Song Title" below to match on YouTube.'
            : 'Spotify blocked automatic playlist reading. Paste your track names (one per line) below to match them on YouTube.',
      };
    }

    const truncated = seeds.length > options.maxItems;
    const limitedSeeds = seeds.slice(0, options.maxItems);
    const total = limitedSeeds.length;
    const matchedTracks: ResolvedTrackMetadata[] = [];
    let processed = 0;
    let failedCount = 0;

    // Concurrency-bounded matching (3 at a time) so Render free tier stays fast & gentle on YouTube
    const concurrency = 3;
    let cursor = 0;

    async function worker() {
      while (cursor < limitedSeeds.length) {
        const idx = cursor++;
        const seed = limitedSeeds[idx];
        try {
          const matched = await matchSpotifySeedToYouTube(seed);
          if (matched) {
            matchedTracks.push(matched);
          } else {
            failedCount++;
          }
        } catch {
          failedCount++;
        }
        processed++;
        options.onProgress?.({
          stage: 'matching',
          processed,
          total,
          added: matchedTracks.length,
          failed: failedCount,
          message: `Matched ${matchedTracks.length} of ${total} tracks on YouTube...`,
        });
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

    if (matchedTracks.length === 0) {
      return {
        tracks: [],
        provider: 'spotify',
        playlistTitle,
        failedCount,
        fallbackPasteSupported: true,
        warning:
          'Found Spotify metadata, but could not match tracks on YouTube right now. Try searching directly or pasting song names.',
      };
    }

    const result: ResolveResult = {
      tracks: matchedTracks,
      provider: 'spotify',
      playlistTitle,
      truncated,
      failedCount,
    };

    await setCachedLookup(cacheKey, 'spotify', result, SPOTIFY_CACHE_TTL_SEC);
    return result;
  },
};
