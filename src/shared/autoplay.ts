import type {
  AutoplayConfig,
  AutoplayDislike,
  AutoplayMode,
  HistoryItem,
  Track,
} from './types';

export const DEFAULT_AUTOPLAY_CONFIG: AutoplayConfig = {
  enabled: false,
  mode: 'similar',
  moodHint: '',
  allowRepeats: false,
  minDurationSec: 60,
  maxDurationSec: 600,
  blockedArtists: [],
  dislikedTracks: [],
};

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'into',
  'official',
  'video',
  'audio',
  'music',
  'lyric',
  'lyrics',
  'visualizer',
  'feat',
  'ft',
  'featuring',
  'prod',
  'topic',
  'vevo',
  'hd',
  'hq',
  '4k',
  'mv',
  'remastered',
  'remaster',
  'version',
  'edit',
  'original',
  'song',
  'songs',
  'track',
  'youtube',
  'records',
  'entertainment',
]);

const NON_MUSIC_CLUTTER_RE =
  /\b(1\s*hour|2\s*hours|10\s*hours|full\s*album|podcast|interview|tutorial|reaction|unboxing|review|behind\s*the\s*scenes|making\s*of|compilation|playlist\s*mix)\b/i;

const LIVESTREAM_RADIO_RE = /\b(24\/7|live\s*stream|livestream|radio|beats\s+to\s+(relax|study|chill|game|sleep))\b/i;

export function cloneDefaultAutoplayConfig(): AutoplayConfig {
  return {
    ...DEFAULT_AUTOPLAY_CONFIG,
    blockedArtists: [],
    dislikedTracks: [],
  };
}

export function normalizeArtistKey(artist: string): string {
  return artist
    .toLowerCase()
    .replace(/\s*-\s*topic\b/gi, '')
    .replace(/\b(vevo|official|music|records|channel)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanTrackTitleForQuery(title: string): string {
  return title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(official|video|audio|lyric|visualizer|hd|4k|remaster|mv)[^)]*\)/gi, ' ')
    .replace(/\b(official\s*(music\s*)?video|official\s*audio|lyric\s*video|lyrics|visualizer|hd|4k)\b/gi, ' ')
    .replace(/[|•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

export function extractMeaningfulTokens(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok) && !/^\d+$/.test(tok));
  return Array.from(new Set(cleaned));
}

export function sanitizeAutoplayConfig(
  raw: Partial<AutoplayConfig> | null | undefined,
  base: AutoplayConfig = DEFAULT_AUTOPLAY_CONFIG
): AutoplayConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...base,
      blockedArtists: [...base.blockedArtists],
      dislikedTracks: [...base.dislikedTracks],
    };
  }

  const mode: AutoplayMode =
    raw.mode === 'similar' || raw.mode === 'discovery' || raw.mode === 'familiar'
      ? raw.mode
      : base.mode;

  const moodHint =
    typeof raw.moodHint === 'string'
      ? raw.moodHint.replace(/\s+/g, ' ').trim().slice(0, 80)
      : base.moodHint;

  const minDurationSec =
    typeof raw.minDurationSec === 'number' && Number.isFinite(raw.minDurationSec)
      ? Math.max(0, Math.min(300, Math.round(raw.minDurationSec)))
      : base.minDurationSec;

  const maxDurationSec =
    typeof raw.maxDurationSec === 'number' && Number.isFinite(raw.maxDurationSec)
      ? Math.max(Math.max(minDurationSec + 30, 120), Math.min(7200, Math.round(raw.maxDurationSec)))
      : base.maxDurationSec;

  const blockedArtistsSource = Array.isArray(raw.blockedArtists)
    ? raw.blockedArtists
    : base.blockedArtists;
  const seenBlocked = new Set<string>();
  const blockedArtists: string[] = [];
  for (const item of blockedArtistsSource) {
    if (typeof item !== 'string') continue;
    const trimmed = item.replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = normalizeArtistKey(trimmed);
    if (!trimmed || !key || seenBlocked.has(key)) continue;
    seenBlocked.add(key);
    blockedArtists.push(trimmed);
    if (blockedArtists.length >= 50) break;
  }

  const dislikesSource = Array.isArray(raw.dislikedTracks)
    ? raw.dislikedTracks
    : base.dislikedTracks;
  const seenDislikes = new Set<string>();
  const dislikedTracks: AutoplayDislike[] = [];
  for (const item of dislikesSource) {
    if (!item || typeof item !== 'object') continue;
    const ytId = typeof item.youtubeId === 'string' ? item.youtubeId.trim() : '';
    if (!ytId || seenDislikes.has(ytId)) continue;
    seenDislikes.add(ytId);
    dislikedTracks.push({
      youtubeId: ytId,
      title: typeof item.title === 'string' ? item.title.slice(0, 140) : 'Unknown track',
      artist: typeof item.artist === 'string' ? item.artist.slice(0, 100) : 'Unknown artist',
      dislikedAt:
        typeof item.dislikedAt === 'string' ? item.dislikedAt : new Date().toISOString(),
    });
    if (dislikedTracks.length >= 100) break;
  }

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    mode,
    moodHint,
    allowRepeats: typeof raw.allowRepeats === 'boolean' ? raw.allowRepeats : base.allowRepeats,
    minDurationSec,
    maxDurationSec,
    blockedArtists,
    dislikedTracks,
  };
}

/**
 * Records a user's "Not interested" signal and adapts Autoplay preferences.
 * Disliking 2+ songs by the same artist (or explicitly blocking them) automatically
 * adds that artist to blockedArtists so Autoplay decisively steers away.
 */
export function applyDislikeToAutoplayConfig(
  config: AutoplayConfig,
  track: Pick<Track, 'youtubeId' | 'title' | 'artist'>,
  options?: { blockArtist?: boolean; nowIso?: string }
): { nextConfig: AutoplayConfig; autoBlockedArtist: boolean } {
  const nowIso = options?.nowIso || new Date().toISOString();
  const nextDislikes: AutoplayDislike[] = [
    {
      youtubeId: track.youtubeId,
      title: track.title,
      artist: track.artist,
      dislikedAt: nowIso,
    },
    ...config.dislikedTracks.filter((d) => d.youtubeId !== track.youtubeId),
  ].slice(0, 100);

  const artistKey = normalizeArtistKey(track.artist);
  const dislikesForArtist = artistKey
    ? nextDislikes.filter((d) => normalizeArtistKey(d.artist) === artistKey).length
    : 0;

  const alreadyBlocked =
    Boolean(artistKey) &&
    config.blockedArtists.some((a) => normalizeArtistKey(a) === artistKey);

  const shouldBlockArtist =
    Boolean(artistKey) && !alreadyBlocked && (Boolean(options?.blockArtist) || dislikesForArtist >= 2);

  const nextBlocked = shouldBlockArtist
    ? [track.artist.replace(/\s*-\s*topic\b/gi, '').trim(), ...config.blockedArtists].slice(0, 50)
    : [...config.blockedArtists];

  return {
    nextConfig: sanitizeAutoplayConfig({
      ...config,
      blockedArtists: nextBlocked,
      dislikedTracks: nextDislikes,
    }),
    autoBlockedArtist: shouldBlockArtist,
  };
}

export interface AutoplayTasteProfile {
  likedArtistWeights: Map<string, number>;
  likedArtistDisplay: Map<string, string>;
  penalizedArtistCounts: Map<string, number>;
  likedTokens: Map<string, number>;
  penalizedTokens: Map<string, number>;
  seedTracks: Array<{ title: string; artist: string; cleanTitle: string; artistKey: string }>;
  blockedArtistKeys: Set<string>;
  dislikedVideoIds: Set<string>;
}

/**
 * Analyzes room listening history + current track against dislike/block feedback
 * to produce a weighted room taste profile for Autoplay.
 */
export function buildAutoplayTasteProfile(
  history: HistoryItem[],
  currentTrack: Track | null,
  config: AutoplayConfig
): AutoplayTasteProfile {
  const dislikedVideoIds = new Set(config.dislikedTracks.map((d) => d.youtubeId));
  const blockedArtistKeys = new Set(
    config.blockedArtists.map((a) => normalizeArtistKey(a)).filter(Boolean)
  );

  const penalizedArtistCounts = new Map<string, number>();
  for (const d of config.dislikedTracks) {
    const key = normalizeArtistKey(d.artist);
    if (key) {
      penalizedArtistCounts.set(key, (penalizedArtistCounts.get(key) || 0) + 1);
    }
  }

  // Combine current track + recent history (most recent first)
  const orderedTracks: Track[] = [];
  if (currentTrack) orderedTracks.push(currentTrack);
  for (const item of history) {
    orderedTracks.push(item.track);
  }

  const likedArtistWeights = new Map<string, number>();
  const likedArtistDisplay = new Map<string, string>();
  const likedTokens = new Map<string, number>();
  const seedTracks: Array<{ title: string; artist: string; cleanTitle: string; artistKey: string }> =
    [];
  const seenSeedKeys = new Set<string>();

  for (let i = 0; i < Math.min(orderedTracks.length, 30); i++) {
    const track = orderedTracks[i];
    if (dislikedVideoIds.has(track.youtubeId)) continue;

    const artistKey = normalizeArtistKey(track.artist);
    if (artistKey && blockedArtistKeys.has(artistKey)) continue;

    const dislikePenaltyCount = artistKey ? penalizedArtistCounts.get(artistKey) || 0 : 0;
    // Recency decay: recent songs matter more; human-queued tracks outweigh autoplayed tracks
    const recencyWeight = Math.max(0.25, 1.35 - i * 0.065);
    const sourceMultiplier = track.autoplay ? 0.7 : 1.35;
    const penaltyMultiplier = dislikePenaltyCount > 0 ? Math.pow(0.45, dislikePenaltyCount) : 1;
    const weight = recencyWeight * sourceMultiplier * penaltyMultiplier;

    if (artistKey) {
      likedArtistWeights.set(artistKey, (likedArtistWeights.get(artistKey) || 0) + weight);
      if (!likedArtistDisplay.has(artistKey)) {
        likedArtistDisplay.set(
          artistKey,
          track.artist.replace(/\s*-\s*topic\b/gi, '').trim() || track.artist
        );
      }
    }

    const cleanTitle = cleanTrackTitleForQuery(track.title);
    for (const token of extractMeaningfulTokens(`${cleanTitle} ${track.artist}`)) {
      likedTokens.set(token, (likedTokens.get(token) || 0) + weight);
    }

    const seedDedupeKey = `${artistKey}:${cleanTitle.toLowerCase()}`;
    if (cleanTitle && !seenSeedKeys.has(seedDedupeKey) && dislikePenaltyCount === 0) {
      seenSeedKeys.add(seedDedupeKey);
      seedTracks.push({
        title: track.title,
        artist: track.artist.replace(/\s*-\s*topic\b/gi, '').trim() || track.artist,
        cleanTitle,
        artistKey,
      });
    }
  }

  // Extract penalized tokens from disliked tracks, ignoring strongly liked tokens
  const penalizedTokens = new Map<string, number>();
  for (const d of config.dislikedTracks) {
    const tokens = extractMeaningfulTokens(`${cleanTrackTitleForQuery(d.title)} ${d.artist}`);
    for (const token of tokens) {
      const positive = likedTokens.get(token) || 0;
      if (positive < 1.5) {
        penalizedTokens.set(token, (penalizedTokens.get(token) || 0) + 1);
      }
    }
  }

  return {
    likedArtistWeights,
    likedArtistDisplay,
    penalizedArtistCounts,
    likedTokens,
    penalizedTokens,
    seedTracks,
    blockedArtistKeys,
    dislikedVideoIds,
  };
}

export interface AutoplaySearchQuery {
  query: string;
  reason: string;
}

/**
 * Generates targeted YouTube search queries from the room's taste profile + user customization.
 */
export function buildAutoplaySearchQueries(
  profile: AutoplayTasteProfile,
  config: AutoplayConfig,
  rotationIndex = 0
): AutoplaySearchQuery[] {
  const queries: AutoplaySearchQuery[] = [];
  const mood = config.moodHint.trim();

  const rankedArtists = Array.from(profile.likedArtistWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => ({ key, name: profile.likedArtistDisplay.get(key) || key }));

  const seed =
    profile.seedTracks.length > 0
      ? profile.seedTracks[rotationIndex % profile.seedTracks.length]
      : null;

  const primaryArtist =
    rankedArtists.length > 0 ? rankedArtists[rotationIndex % rankedArtists.length] : null;
  const secondaryArtist =
    rankedArtists.length > 1 ? rankedArtists[(rotationIndex + 1) % rankedArtists.length] : null;

  if (seed && primaryArtist) {
    if (config.mode === 'familiar') {
      queries.push({
        query: mood
          ? `${primaryArtist.name} ${mood} official audio`
          : `${primaryArtist.name} best songs official audio`,
        reason: mood
          ? `${primaryArtist.name} · ${mood}`
          : `More from ${primaryArtist.name}`,
      });
      if (secondaryArtist) {
        queries.push({
          query: `${secondaryArtist.name} top songs official audio`,
          reason: `From your history · ${secondaryArtist.name}`,
        });
      }
    } else if (config.mode === 'discovery') {
      queries.push({
        query: mood
          ? `songs like ${primaryArtist.name} ${mood} music`
          : `artists similar to ${primaryArtist.name} songs`,
        reason: mood
          ? `Discovering ${mood} via ${primaryArtist.name}`
          : `Discovery inspired by ${primaryArtist.name}`,
      });
      queries.push({
        query: mood
          ? `${mood} indie music audio`
          : `if you like ${seed.cleanTitle} ${seed.artist} songs`,
        reason: `Fresh pick from your history`,
      });
    } else {
      // 'similar' balanced mode
      queries.push({
        query: mood
          ? `${seed.artist} ${mood} songs`
          : `songs like ${seed.cleanTitle} ${seed.artist}`,
        reason: mood
          ? `Similar to ${seed.artist} · ${mood}`
          : `Similar to ${seed.artist}`,
      });
      queries.push({
        query: secondaryArtist
          ? `${primaryArtist.name} ${secondaryArtist.name} vibe music`
          : `${primaryArtist.name} songs official audio`,
        reason: secondaryArtist
          ? `Blended from ${primaryArtist.name} & ${secondaryArtist.name}`
          : `Based on ${primaryArtist.name}`,
      });
    }
  } else if (mood) {
    queries.push({
      query: `${mood} song official audio`,
      reason: `Autoplay · ${mood}`,
    });
    queries.push({
      query: `${mood} single track lyrics`,
      reason: `Autoplay · ${mood}`,
    });
  } else {
    // Brand-new room with no history and no mood hint yet
    const starterMixes = [
      { query: 'chill indie electronic songs official audio', reason: 'Autoplay starter mix' },
      { query: 'late night lo-fi synth pop songs', reason: 'Autoplay starter mix' },
      { query: 'feel good alternative indie songs audio', reason: 'Autoplay starter mix' },
    ];
    const picked = starterMixes[rotationIndex % starterMixes.length];
    queries.push(picked);
  }

  return queries;
}

export interface AutoplayCandidateInput {
  youtubeId: string;
  title: string;
  artist: string;
  durationSec: number;
}

export interface AutoplayRankingContext {
  profile: AutoplayTasteProfile;
  config: AutoplayConfig;
  currentTrack: Track | null;
  queue: Track[];
  history: HistoryItem[];
  avoidArtistKeys?: string[];
  relaxDurationAndLiveFilters?: boolean;
  jitterSeed?: number;
}

/**
 * Deterministic lightweight hash in [0, 1) for gentle tie-breaking variety.
 */
function deterministicJitter(videoId: string, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < videoId.length; i++) {
    h = Math.imul(h ^ videoId.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h % 1000) / 1000;
}

/**
 * Filters out disliked/blocked/already-queued/unsuitable candidates and ranks
 * remaining songs according to history taste profile, mode, mood hint, and dislikes.
 */
export function rankAutoplayCandidates<T extends AutoplayCandidateInput>(
  candidates: T[],
  ctx: AutoplayRankingContext
): Array<{ candidate: T; score: number }> {
  const { profile, config, currentTrack, queue, history } = ctx;
  const jitterSeed = ctx.jitterSeed ?? 1;

  const excludedVideoIds = new Set<string>(profile.dislikedVideoIds);
  if (currentTrack) excludedVideoIds.add(currentTrack.youtubeId);
  for (const q of queue) excludedVideoIds.add(q.youtubeId);

  const historyVideoIds = new Set<string>();
  const veryRecentVideoIds = new Set<string>();
  for (let i = 0; i < history.length; i++) {
    const ytId = history[i].track.youtubeId;
    historyVideoIds.add(ytId);
    if (i < 4) veryRecentVideoIds.add(ytId);
  }

  const lastArtistKey = currentTrack ? normalizeArtistKey(currentTrack.artist) : '';
  const temporaryAvoidArtistKeys = new Set(
    (ctx.avoidArtistKeys || []).map((a) => normalizeArtistKey(a)).filter(Boolean)
  );
  const moodTokens = extractMeaningfulTokens(config.moodHint);
  const seenIds = new Set<string>();

  const scored: Array<{ candidate: T; score: number }> = [];

  for (const candidate of candidates) {
    if (!candidate.youtubeId || seenIds.has(candidate.youtubeId)) continue;
    seenIds.add(candidate.youtubeId);

    // Hard exclusions
    if (excludedVideoIds.has(candidate.youtubeId)) continue;
    if (veryRecentVideoIds.has(candidate.youtubeId)) continue;
    if (!config.allowRepeats && historyVideoIds.has(candidate.youtubeId)) continue;

    const artistKey = normalizeArtistKey(candidate.artist);
    if (artistKey && profile.blockedArtistKeys.has(artistKey)) continue;
    if (artistKey && temporaryAvoidArtistKeys.has(artistKey)) continue;

    // Skip 24/7 livestreams / endless radios unless in relaxed fallback
    if (
      !ctx.relaxDurationAndLiveFilters &&
      candidate.durationSec === 0 &&
      LIVESTREAM_RADIO_RE.test(candidate.title)
    ) {
      continue;
    }

    // Duration guardrails (when duration is known and not in relaxed fallback)
    if (!ctx.relaxDurationAndLiveFilters && candidate.durationSec > 0) {
      if (candidate.durationSec < config.minDurationSec) continue;
      if (candidate.durationSec > config.maxDurationSec) continue;
    }

    // Skip obvious non-music long mixes/podcasts unless user explicitly raised maxDurationSec > 30min or relaxed fallback
    if (
      !ctx.relaxDurationAndLiveFilters &&
      config.maxDurationSec <= 1800 &&
      NON_MUSIC_CLUTTER_RE.test(candidate.title)
    ) {
      continue;
    }

    let score = 50;

    // Strongly prefer tracks with known finite duration over unknown-length/live videos
    if (candidate.durationSec === 0) {
      score -= 30;
    }

    // 1. Artist affinity according to Autoplay mode
    const artistAffinity = artistKey ? profile.likedArtistWeights.get(artistKey) || 0 : 0;
    if (config.mode === 'familiar') {
      score += Math.min(35, artistAffinity * 14);
    } else if (config.mode === 'discovery') {
      if (artistAffinity === 0) {
        score += 18; // Reward new artists
      } else {
        score -= Math.min(22, artistAffinity * 8);
      }
    } else {
      // 'similar' balanced
      score += Math.min(20, artistAffinity * 7);
    }

    // Avoid playing the exact same artist twice in a row unless familiar mode
    if (artistKey && lastArtistKey && artistKey === lastArtistKey && config.mode !== 'familiar') {
      score -= 18;
    }

    // 2. Strong adaptive downranking from "Not interested" feedback
    const artistDislikes = artistKey ? profile.penalizedArtistCounts.get(artistKey) || 0 : 0;
    if (artistDislikes > 0) {
      score -= artistDislikes * 65;
    }

    const candidateTokens = extractMeaningfulTokens(
      `${cleanTrackTitleForQuery(candidate.title)} ${candidate.artist}`
    );
    for (const tok of candidateTokens) {
      const positiveTok = profile.likedTokens.get(tok) || 0;
      if (positiveTok > 0) {
        score += Math.min(8, positiveTok * 2.5);
      }
      const dislikedTok = profile.penalizedTokens.get(tok) || 0;
      if (dislikedTok > 0) {
        score -= Math.min(24, dislikedTok * 12);
      }
    }

    // 3. Mood / genre hint alignment
    if (moodTokens.length > 0) {
      const candidateText = `${candidate.title} ${candidate.artist}`.toLowerCase();
      let matches = 0;
      for (const tok of moodTokens) {
        if (candidateText.includes(tok)) matches += 1;
      }
      score += matches * 11;
    }

    // 4. Sweet-spot song duration preference (2m – 6m)
    if (candidate.durationSec >= 120 && candidate.durationSec <= 380) {
      score += 6;
    }

    // 5. Mild penalty for repeats when allowRepeats is enabled so fresh songs still win first
    if (historyVideoIds.has(candidate.youtubeId)) {
      score -= 15;
    }

    // 6. Gentle deterministic variety jitter (0–6 pts)
    score += deterministicJitter(candidate.youtubeId, jitterSeed) * 6;

    scored.push({ candidate, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
