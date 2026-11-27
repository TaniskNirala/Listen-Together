import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDislikeToAutoplayConfig,
  buildAutoplaySearchQueries,
  buildAutoplayTasteProfile,
  cloneDefaultAutoplayConfig,
  normalizeArtistKey,
  rankAutoplayCandidates,
  sanitizeAutoplayConfig,
} from './autoplay';
import type { HistoryItem, Track } from './types';

function makeTrack(overrides: Partial<Track> & { youtubeId: string; title: string; artist: string }): Track {
  return {
    id: `id-${overrides.youtubeId}`,
    durationSec: 210,
    thumbnailUrl: 'https://i.ytimg.com/vi/test/hqdefault.jpg',
    source: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=${overrides.youtubeId}`,
    addedByUserId: 1,
    addedByUsername: 'alex',
    addedAt: '2026-11-26T10:00:00.000Z',
    ...overrides,
  };
}

function makeHistory(tracks: Track[]): HistoryItem[] {
  return tracks.map((track, idx) => ({
    id: idx + 1,
    track,
    addedByUsername: track.addedByUsername,
    playedAt: '2026-11-26T10:00:00.000Z',
  }));
}

test('normalizeArtistKey unifies Topic/VEVO/Official suffixes', () => {
  assert.equal(normalizeArtistKey('Daft Punk - Topic'), 'daft punk');
  assert.equal(normalizeArtistKey('DaftPunkVEVO'), 'daftpunkvevo');
  assert.equal(normalizeArtistKey('Tame Impala Official'), 'tame impala');
});

test('applyDislikeToAutoplayConfig records dislike and auto-blocks artist after 2nd dislike', () => {
  const base = cloneDefaultAutoplayConfig();

  // First dislike -> records track, does NOT auto-block artist yet
  const first = applyDislikeToAutoplayConfig(base, {
    youtubeId: 'bad1',
    title: 'Loud Dubstep Remix',
    artist: 'Noisy DJ - Topic',
  });
  assert.equal(first.nextConfig.dislikedTracks.length, 1);
  assert.equal(first.autoBlockedArtist, false);
  assert.equal(first.nextConfig.blockedArtists.length, 0);

  // Second dislike of same artist -> automatically blocks artist
  const second = applyDislikeToAutoplayConfig(first.nextConfig, {
    youtubeId: 'bad2',
    title: 'Another Dubstep Track',
    artist: 'Noisy DJ',
  });
  assert.equal(second.nextConfig.dislikedTracks.length, 2);
  assert.equal(second.autoBlockedArtist, true);
  assert.deepEqual(second.nextConfig.blockedArtists, ['Noisy DJ']);
});

test('rankAutoplayCandidates excludes disliked songs, blocked artists, queued tracks, and adapts away from disliked vibes', () => {
  let config = sanitizeAutoplayConfig({
    enabled: true,
    mode: 'similar',
    moodHint: 'synthwave',
    allowRepeats: false,
  });

  // Dislike one track from "Heavy Metal Band" (not yet hard-blocked, but strongly downranked)
  config = applyDislikeToAutoplayConfig(config, {
    youtubeId: 'disliked-1',
    title: 'Screaming Metal Anthem',
    artist: 'Heavy Metal Band',
  }).nextConfig;

  // Explicitly block "Blocked Artist"
  config = sanitizeAutoplayConfig({
    ...config,
    blockedArtists: ['Blocked Artist'],
  });

  const history = makeHistory([
    makeTrack({ youtubeId: 'hist-1', title: 'Instant Crush', artist: 'Daft Punk' }),
    makeTrack({ youtubeId: 'hist-2', title: 'Nightcall', artist: 'Kavinsky' }),
  ]);

  const currentTrack = makeTrack({ youtubeId: 'curr-1', title: 'Sunset', artist: 'The Midnight' });
  const queue = [makeTrack({ youtubeId: 'queued-1', title: 'Already Queued', artist: 'FM-84' })];

  const profile = buildAutoplayTasteProfile(history, currentTrack, config);

  const candidates = [
    { youtubeId: 'disliked-1', title: 'Screaming Metal Anthem', artist: 'Heavy Metal Band', durationSec: 200 },
    { youtubeId: 'hist-1', title: 'Instant Crush', artist: 'Daft Punk', durationSec: 240 },
    { youtubeId: 'queued-1', title: 'Already Queued', artist: 'FM-84', durationSec: 210 },
    { youtubeId: 'blocked-vid', title: 'Synthwave Dream', artist: 'Blocked Artist - Topic', durationSec: 220 },
    { youtubeId: 'too-short', title: 'Short Clip', artist: 'Daft Punk', durationSec: 25 },
    { youtubeId: 'too-long', title: '2 Hours Synthwave Mix', artist: 'Chill Channel', durationSec: 3600 },
    { youtubeId: 'metal-2', title: 'Another Screaming Track', artist: 'Heavy Metal Band', durationSec: 220 },
    { youtubeId: 'winner-1', title: 'Midnight Synthwave Drive', artist: 'Kavinsky', durationSec: 230 },
  ];

  const ranked = rankAutoplayCandidates(candidates, {
    profile,
    config,
    currentTrack,
    queue,
    history,
    jitterSeed: 7,
  });

  // Disliked, history (allowRepeats=false), queued, blocked, too-short, and too-long are all filtered out
  assert.deepEqual(
    ranked.map((r) => r.candidate.youtubeId),
    ['winner-1', 'metal-2']
  );
  // Synthwave + Kavinsky cleanly outranks the downranked disliked-artist track
  assert.ok(ranked[0].score > ranked[1].score + 40);
});

test('buildAutoplaySearchQueries reads history and adapts queries to mode and moodHint', () => {
  const history = makeHistory([
    makeTrack({ youtubeId: 'h1', title: 'Less I Know The Better (Official Video)', artist: 'Tame Impala - Topic' }),
  ]);

  const discoveryConfig = sanitizeAutoplayConfig({
    enabled: true,
    mode: 'discovery',
    moodHint: 'dreamy',
  });
  const profile = buildAutoplayTasteProfile(history, null, discoveryConfig);
  const queries = buildAutoplaySearchQueries(profile, discoveryConfig, 0);

  assert.ok(queries.length >= 1);
  assert.match(queries[0].query.toLowerCase(), /tame impala/);
  assert.match(queries[0].query.toLowerCase(), /dreamy/);
  assert.match(queries[0].reason.toLowerCase(), /tame impala/);

  // Empty history with moodHint uses moodHint directly
  const emptyProfile = buildAutoplayTasteProfile([], null, discoveryConfig);
  const emptyQueries = buildAutoplaySearchQueries(emptyProfile, discoveryConfig, 0);
  assert.match(emptyQueries[0].query.toLowerCase(), /dreamy/);
});

test('rankAutoplayCandidates skips 24/7 radio livestreams and respects avoidArtistKeys after Not interested', () => {
  const config = sanitizeAutoplayConfig({ enabled: true, mode: 'discovery', moodHint: 'lofi chill' });
  const profile = buildAutoplayTasteProfile([], null, config);

  const ranked = rankAutoplayCandidates(
    [
      { youtubeId: 'live-1', title: 'lofi hip hop radio beats to relax/study to', artist: 'Lofi Girl', durationSec: 0 },
      { youtubeId: 'same-artist', title: 'Lofi Girl Track', artist: 'Lofi Girl', durationSec: 185 },
      { youtubeId: 'fresh-song', title: 'Rainy Night Lofi Chill', artist: 'Jinsang', durationSec: 162 },
    ],
    {
      profile,
      config,
      currentTrack: null,
      queue: [],
      history: [],
      avoidArtistKeys: ['Lofi Girl'],
    }
  );

  assert.deepEqual(
    ranked.map((r) => r.candidate.youtubeId),
    ['fresh-song']
  );
});
