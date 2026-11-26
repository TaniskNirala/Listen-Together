import type { ClockSample, DriftDecision, RepeatMode, Track } from './types';

export const DRIFT_IGNORE_THRESHOLD_SEC = 0.3;
export const DRIFT_HARD_SEEK_THRESHOLD_SEC = 2.0;
export const GENTLE_RATE_FAST = 1.05;
export const GENTLE_RATE_SLOW = 0.95;

/**
 * Computes a single NTP-style clock offset sample:
 * offsetMs = serverTime - (clientSendTime + RTT / 2)
 * Adding offsetMs to local Date.now() estimates the authoritative server clock.
 */
export function computeClockSample(
  clientSendTime: number,
  clientReceiveTime: number,
  serverTime: number
): ClockSample {
  const rttMs = Math.max(0, clientReceiveTime - clientSendTime);
  const midpoint = clientSendTime + rttMs / 2;
  const offsetMs = serverTime - midpoint;
  return {
    rttMs,
    offsetMs,
    measuredAt: clientReceiveTime,
  };
}

/**
 * Estimates clock offset from a rolling window of NTP samples by discarding
 * high-RTT outliers (keeping the fastest half) and taking the median offset.
 */
export function estimateClockOffsetMs(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0].offsetMs;

  const byRtt = [...samples].sort((a, b) => a.rttMs - b.rttMs);
  const keepCount = Math.max(1, Math.ceil(byRtt.length / 2));
  const bestSamples = byRtt.slice(0, keepCount);

  const offsets = bestSamples.map((s) => s.offsetMs).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  if (offsets.length % 2 === 1) {
    return offsets[mid];
  }
  return (offsets[mid - 1] + offsets[mid]) / 2;
}

/**
 * Computes the authoritative playback position (in seconds) at a given server timestamp.
 */
export function computeExpectedPositionSec(params: {
  isPlaying: boolean;
  positionAtTimestamp: number;
  serverTimestamp: number;
  estimatedServerNowMs: number;
  durationSec?: number;
}): number {
  const {
    isPlaying,
    positionAtTimestamp,
    serverTimestamp,
    estimatedServerNowMs,
    durationSec,
  } = params;

  const base = Number.isFinite(positionAtTimestamp) ? Math.max(0, positionAtTimestamp) : 0;
  if (!isPlaying) {
    return durationSec && durationSec > 0 ? Math.min(base, durationSec) : base;
  }

  const elapsedSec = Math.max(0, (estimatedServerNowMs - serverTimestamp) / 1000);
  const expected = base + elapsedSec;
  if (durationSec && durationSec > 0) {
    return Math.min(expected, durationSec);
  }
  return expected;
}

/**
 * Decides how a client player should correct drift against authoritative server position:
 * - |drift| < 0.3s: no adjustment, normal 1.0x speed
 * - 0.3s <= |drift| <= 2.0s: gentle playbackRate nudge (0.95x or 1.05x)
 * - |drift| > 2.0s: immediate hard seek + reset to 1.0x
 */
export function evaluateDriftCorrection(
  actualPositionSec: number,
  expectedPositionSec: number,
  isPlaying: boolean
): DriftDecision {
  const driftSec = expectedPositionSec - actualPositionSec; // positive = client is behind server
  const absDrift = Math.abs(driftSec);

  if (!isPlaying) {
    if (absDrift > DRIFT_IGNORE_THRESHOLD_SEC) {
      return {
        driftSec,
        action: 'seek',
        playbackRate: 1.0,
        targetPositionSec: expectedPositionSec,
      };
    }
    return {
      driftSec,
      action: 'none',
      playbackRate: 1.0,
      targetPositionSec: expectedPositionSec,
    };
  }

  if (absDrift < DRIFT_IGNORE_THRESHOLD_SEC) {
    return {
      driftSec,
      action: 'none',
      playbackRate: 1.0,
      targetPositionSec: expectedPositionSec,
    };
  }

  if (absDrift <= DRIFT_HARD_SEEK_THRESHOLD_SEC) {
    return {
      driftSec,
      action: 'gentle',
      playbackRate: driftSec > 0 ? GENTLE_RATE_FAST : GENTLE_RATE_SLOW,
      targetPositionSec: expectedPositionSec,
    };
  }

  return {
    driftSec,
    action: 'seek',
    playbackRate: 1.0,
    targetPositionSec: expectedPositionSec,
  };
}

/**
 * Pure queue transition logic for advancing to the next track.
 */
export function computeNextTrackTransition(params: {
  currentTrack: Track | null;
  queue: Track[];
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  forcedSkip: boolean;
  randomFn?: () => number;
}): {
  nextTrack: Track | null;
  nextQueue: Track[];
  shouldRecordHistory: boolean;
} {
  const {
    currentTrack,
    queue,
    repeatMode,
    shuffleEnabled,
    forcedSkip,
    randomFn = Math.random,
  } = params;

  const workingQueue = [...queue];

  // Natural track end on repeat-one replays the same track
  if (!forcedSkip && repeatMode === 'one' && currentTrack) {
    return {
      nextTrack: currentTrack,
      nextQueue: workingQueue,
      shouldRecordHistory: true,
    };
  }

  // On repeat-all, append the finished/skipped currentTrack back to the end of the queue
  if (repeatMode === 'all' && currentTrack) {
    workingQueue.push(currentTrack);
  }

  if (workingQueue.length === 0) {
    return {
      nextTrack: null,
      nextQueue: [],
      shouldRecordHistory: Boolean(currentTrack),
    };
  }

  let pickIndex = 0;
  if (shuffleEnabled && workingQueue.length > 1) {
    const raw = randomFn();
    const clamped = Math.min(0.9999999, Math.max(0, raw));
    pickIndex = Math.floor(clamped * workingQueue.length);
  }

  const [nextTrack] = workingQueue.splice(pickIndex, 1);
  return {
    nextTrack,
    nextQueue: workingQueue,
    shouldRecordHistory: Boolean(currentTrack),
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
