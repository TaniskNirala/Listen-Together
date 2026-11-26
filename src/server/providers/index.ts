import { config } from '../config';
import { parseTrackListLines, safeParseHttpUrl } from './parsers';
import { spotifyProvider } from './spotify';
import type { MusicProvider, ResolveOptions, ResolvedTrackMetadata, ResolveResult } from './types';
import { searchYouTube, youtubeProvider } from './youtube';

const providers: MusicProvider[] = [youtubeProvider, spotifyProvider];

export async function resolveMusicInput(
  input: string,
  options?: Partial<ResolveOptions>
): Promise<ResolveResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Please enter a YouTube link, Spotify link, or search query.');
  }

  const resolveOpts: ResolveOptions = {
    maxItems: options?.maxItems ?? config.maxPlaylistImport,
    onProgress: options?.onProgress,
  };

  for (const provider of providers) {
    if (provider.canHandle(trimmed)) {
      return provider.resolve(trimmed, resolveOpts);
    }
  }

  // Reject arbitrary unsupported URLs instead of searching them as raw URLs
  if (safeParseHttpUrl(trimmed)) {
    throw new Error(
      'Unsupported link. Paste a YouTube, YouTube Music, or Spotify track/album/playlist URL, or enter a song title to search.'
    );
  }

  // Treat plain text as a direct YouTube search and pick the top match
  const results = await searchYouTube(trimmed, 1);
  if (results.length === 0) {
    throw new Error(`No YouTube results found for "${trimmed}".`);
  }

  return {
    tracks: [results[0]],
    provider: 'youtube',
  };
}

export async function resolveBatchTrackLines(
  rawLines: string,
  options?: Partial<ResolveOptions>
): Promise<ResolveResult> {
  const maxItems = options?.maxItems ?? config.maxPlaylistImport;
  const lines = parseTrackListLines(rawLines, maxItems);
  if (lines.length === 0) {
    throw new Error('Paste at least one song name (one per line).');
  }

  const tracks: ResolvedTrackMetadata[] = [];
  let processed = 0;
  let failedCount = 0;
  let cursor = 0;
  const concurrency = 3;

  async function worker() {
    while (cursor < lines.length) {
      const idx = cursor++;
      const line = lines[idx];
      try {
        const results = await searchYouTube(line, 1);
        if (results[0]) {
          tracks.push({
            ...results[0],
            source: 'spotify',
            matchedVia: 'youtube',
          });
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
      processed++;
      options?.onProgress?.({
        stage: 'matching',
        processed,
        total: lines.length,
        added: tracks.length,
        failed: failedCount,
        message: `Matched ${tracks.length} of ${lines.length} songs on YouTube...`,
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, lines.length) }, () => worker()));

  return {
    tracks,
    provider: 'youtube',
    failedCount,
  };
}

export { searchYouTube };
