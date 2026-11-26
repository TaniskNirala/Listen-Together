import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeClockSample,
  estimateClockOffsetMs,
  computeExpectedPositionSec,
  evaluateDriftCorrection,
  computeNextTrackTransition,
  formatDuration,
} from './sync';
import type { Track } from './types';

function makeTrack(id: string): Track {
  return {
    id,
    youtubeId: `yt_${id}`,
    title: `Track ${id}`,
    artist: 'Artist',
    durationSec: 200,
    thumbnailUrl: '',
    source: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=yt_${id}`,
    addedByUserId: 1,
    addedByUsername: 'alice',
    addedAt: new Date().toISOString(),
  };
}

test('computeClockSample calculates symmetric RTT and offset', () => {
  // Client clock is 500ms behind server, 40ms RTT
  const sample = computeClockSample(1000, 1040, 1520);
  assert.equal(sample.rttMs, 40);
  assert.equal(sample.offsetMs, 500);
});

test('estimateClockOffsetMs rejects high-RTT spikes and computes median of best half', () => {
  const samples = [
    { rttMs: 30, offsetMs: 100, measuredAt: 1 },
    { rttMs: 35, offsetMs: 110, measuredAt: 2 },
    { rttMs: 40, offsetMs: 120, measuredAt: 3 },
    { rttMs: 850, offsetMs: 900, measuredAt: 4 },
    { rttMs: 1200, offsetMs: -400, measuredAt: 5 },
    { rttMs: 900, offsetMs: 500, measuredAt: 6 },
  ];
  // Fastest 3 samples have offsets 100, 110, 120 -> median is 110
  assert.equal(estimateClockOffsetMs(samples), 110);
});

test('computeExpectedPositionSec advances only while playing and clamps to duration', () => {
  assert.equal(
    computeExpectedPositionSec({
      isPlaying: true,
      positionAtTimestamp: 30,
      serverTimestamp: 10_000,
      estimatedServerNowMs: 15_500,
      durationSec: 180,
    }),
    35.5
  );

  assert.equal(
    computeExpectedPositionSec({
      isPlaying: false,
      positionAtTimestamp: 30,
      serverTimestamp: 10_000,
      estimatedServerNowMs: 90_000,
      durationSec: 180,
    }),
    30
  );

  assert.equal(
    computeExpectedPositionSec({
      isPlaying: true,
      positionAtTimestamp: 175,
      serverTimestamp: 10_000,
      estimatedServerNowMs: 25_000,
      durationSec: 180,
    }),
    180
  );
});

test('evaluateDriftCorrection enforces <300ms none, 300ms-2s gentle, >2s hard seek', () => {
  const tiny = evaluateDriftCorrection(50.0, 50.25, true);
  assert.equal(tiny.action, 'none');
  assert.equal(tiny.playbackRate, 1.0);

  const behindGentle = evaluateDriftCorrection(50.0, 50.8, true);
  assert.equal(behindGentle.action, 'gentle');
  assert.ok(behindGentle.playbackRate > 1.0);

  const aheadGentle = evaluateDriftCorrection(51.2, 50.0, true);
  assert.equal(aheadGentle.action, 'gentle');
  assert.ok(aheadGentle.playbackRate < 1.0);

  const largeDrift = evaluateDriftCorrection(50.0, 52.5, true);
  assert.equal(largeDrift.action, 'seek');
  assert.equal(largeDrift.playbackRate, 1.0);
  assert.equal(largeDrift.targetPositionSec, 52.5);
});

test('computeNextTrackTransition handles off, repeat-one, repeat-all, and shuffle', () => {
  const t1 = makeTrack('1');
  const t2 = makeTrack('2');
  const t3 = makeTrack('3');

  // Repeat-one on natural end replays current track
  const r1 = computeNextTrackTransition({
    currentTrack: t1,
    queue: [t2],
    repeatMode: 'one',
    shuffleEnabled: false,
    forcedSkip: false,
  });
  assert.equal(r1.nextTrack?.id, '1');
  assert.equal(r1.nextQueue.length, 1);

  // Forced skip overrides repeat-one
  const r2 = computeNextTrackTransition({
    currentTrack: t1,
    queue: [t2],
    repeatMode: 'one',
    shuffleEnabled: false,
    forcedSkip: true,
  });
  assert.equal(r2.nextTrack?.id, '2');
  assert.equal(r2.nextQueue.length, 0);

  // Repeat-all cycles currentTrack to back of queue
  const r3 = computeNextTrackTransition({
    currentTrack: t1,
    queue: [t2],
    repeatMode: 'all',
    shuffleEnabled: false,
    forcedSkip: false,
  });
  assert.equal(r3.nextTrack?.id, '2');
  assert.equal(r3.nextQueue.length, 1);
  assert.equal(r3.nextQueue[0].id, '1');

  // Shuffle picks deterministic index with custom RNG
  const r4 = computeNextTrackTransition({
    currentTrack: t1,
    queue: [t2, t3],
    repeatMode: 'off',
    shuffleEnabled: true,
    forcedSkip: true,
    randomFn: () => 0.9,
  });
  assert.equal(r4.nextTrack?.id, '3');
  assert.deepEqual(
    r4.nextQueue.map((t) => t.id),
    ['2']
  );
});

test('formatDuration formats mm:ss and h:mm:ss cleanly', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3661), '1:01:01');
});
