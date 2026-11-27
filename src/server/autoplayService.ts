import { logger } from './logger';
import { searchYouTube } from './providers/youtube';
import type { ResolvedTrackMetadata } from './providers/types';
import type { RoomRuntime } from './roomManager';
import {
  buildAutoplaySearchQueries,
  buildAutoplayTasteProfile,
  rankAutoplayCandidates,
} from '../shared/autoplay';

export interface AutoplayPickResult {
  metadata: ResolvedTrackMetadata;
  reason: string;
}

/**
 * Selects the next Autoplay track for a room by reading its play history,
 * respecting user customization (mode, moodHint, duration, repeats),
 * and adapting away from disliked songs & blocked artists.
 */
export async function pickAutoplayTrackForRoom(
  room: RoomRuntime,
  options?: { extraExcludedYoutubeIds?: string[]; avoidArtists?: string[] }
): Promise<AutoplayPickResult | null> {
  const profile = buildAutoplayTasteProfile(
    room.history,
    room.playback.currentTrack,
    room.autoplay
  );

  for (const id of options?.extraExcludedYoutubeIds || []) {
    if (id) profile.dislikedVideoIds.add(id);
  }

  const rotation = room.autoplayRotationIndex;
  room.autoplayRotationIndex = (room.autoplayRotationIndex + 1) % 1000;

  const queries = buildAutoplaySearchQueries(profile, room.autoplay, rotation);
  const collectedFallbackPool: Array<{ metadata: ResolvedTrackMetadata; reason: string }> = [];

  for (const q of queries) {
    try {
      const results = await searchYouTube(q.query, 10);
      if (results.length === 0) continue;

      for (const item of results) {
        collectedFallbackPool.push({ metadata: item, reason: q.reason });
      }

      const ranked = rankAutoplayCandidates(results, {
        profile,
        config: room.autoplay,
        currentTrack: room.playback.currentTrack,
        queue: room.playback.queue,
        history: room.history,
        avoidArtistKeys: options?.avoidArtists,
        jitterSeed: Date.now() ^ rotation,
      });

      if (ranked.length > 0) {
        const best = ranked[0].candidate;
        logger.info('autoplay_track_selected', {
          roomCode: room.code,
          mode: room.autoplay.mode,
          query: q.query,
          youtubeId: best.youtubeId,
          title: best.title,
          artist: best.artist,
          score: Math.round(ranked[0].score * 10) / 10,
        });
        return {
          metadata: best,
          reason: q.reason,
        };
      }
    } catch (err) {
      logger.warn('autoplay_query_failed', {
        roomCode: room.code,
        query: q.query,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fallback pass 1: broader indie/pop song query matching mood if possible
  try {
    const fallbackQuery = room.autoplay.moodHint.trim()
      ? `${room.autoplay.moodHint.trim()} indie pop song`
      : 'indie electronic chill song official audio';
    const fallbackResults = await searchYouTube(fallbackQuery, 10);
    for (const item of fallbackResults) {
      collectedFallbackPool.push({
        metadata: item,
        reason: room.autoplay.moodHint.trim()
          ? `Autoplay · ${room.autoplay.moodHint.trim()}`
          : 'Autoplay discovery pick',
      });
    }

    const strictFallback = rankAutoplayCandidates(fallbackResults, {
      profile,
      config: room.autoplay,
      currentTrack: room.playback.currentTrack,
      queue: room.playback.queue,
      history: room.history,
      avoidArtistKeys: options?.avoidArtists,
      jitterSeed: Date.now(),
    });
    if (strictFallback.length > 0) {
      return {
        metadata: strictFallback[0].candidate,
        reason: room.autoplay.moodHint.trim()
          ? `Autoplay · ${room.autoplay.moodHint.trim()}`
          : 'Autoplay discovery pick',
      };
    }
  } catch (err) {
    logger.warn('autoplay_fallback_failed', {
      roomCode: room.code,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback pass 2: relax duration/mix limits while STILL strictly respecting dislikes & blocked/avoided artists
  if (collectedFallbackPool.length > 0) {
    const reasonById = new Map(collectedFallbackPool.map((p) => [p.metadata.youtubeId, p.reason]));
    const relaxed = rankAutoplayCandidates(
      collectedFallbackPool.map((p) => p.metadata),
      {
        profile,
        config: room.autoplay,
        currentTrack: room.playback.currentTrack,
        queue: room.playback.queue,
        history: room.history,
        avoidArtistKeys: options?.avoidArtists,
        relaxDurationAndLiveFilters: true,
        jitterSeed: Date.now(),
      }
    );
    if (relaxed.length > 0) {
      const winner = relaxed[0].candidate;
      return {
        metadata: winner,
        reason: reasonById.get(winner.youtubeId) || 'Autoplay pick',
      };
    }
  }

  return null;
}
