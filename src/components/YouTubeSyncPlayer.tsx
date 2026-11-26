import { useEffect, useRef, useState } from 'react';
import { Disc3, Headphones, Loader2 } from 'lucide-react';
import { computeExpectedPositionSec, evaluateDriftCorrection } from '../shared/sync';
import type { RoomPlaybackState } from '../shared/types';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          width?: string | number;
          height?: string | number;
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
  destroy: () => void;
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      resolve();
    };
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

interface YouTubeSyncPlayerProps {
  playback: RoomPlaybackState;
  volume: number;
  muted: boolean;
  audioUnlocked: boolean;
  getEstimatedServerNowMs: () => number;
  onUnlockAudio: () => void;
  onTrackEnded: (trackId: string) => void;
  onEmbedError: (trackId: string) => void;
  onDurationDiscovered: (trackId: string, durationSec: number) => void;
}

export function YouTubeSyncPlayer({
  playback,
  volume,
  muted,
  audioUnlocked,
  getEstimatedServerNowMs,
  onUnlockAudio,
  onTrackEnded,
  onEmbedError,
  onDurationDiscovered,
}: YouTubeSyncPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const playbackRef = useRef(playback);
  const audioUnlockedRef = useRef(audioUnlocked);
  const callbacksRef = useRef({
    getEstimatedServerNowMs,
    onTrackEnded,
    onEmbedError,
    onDurationDiscovered,
  });

  const [playerReady, setPlayerReady] = useState(false);
  const [buffering, setBuffering] = useState(false);

  playbackRef.current = playback;
  audioUnlockedRef.current = audioUnlocked;
  callbacksRef.current = {
    getEstimatedServerNowMs,
    onTrackEnded,
    onEmbedError,
    onDurationDiscovered,
  };

  // Mount YouTube IFrame Player once
  useEffect(() => {
    let disposed = false;

    loadYouTubeIframeApi().then(() => {
      if (disposed || !containerRef.current || !window.YT?.Player) return;

      const mountEl = document.createElement('div');
      mountEl.className = 'h-full w-full';
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mountEl);

      playerRef.current = new window.YT.Player(mountEl, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            if (disposed) return;
            e.target.setVolume(volume);
            if (muted) e.target.mute();
            setPlayerReady(true);
          },
          onStateChange: (e) => {
            if (disposed) return;
            const state = e.data;
            const YTState = window.YT?.PlayerState;
            if (!YTState) return;

            setBuffering(state === YTState.BUFFERING);

            if (state === YTState.CUED) {
              const current = playbackRef.current;
              const dur = e.target.getDuration();
              if (current.currentTrack && dur > 0 && current.currentTrack.durationSec === 0) {
                callbacksRef.current.onDurationDiscovered(current.currentTrack.id, dur);
              }
            }

            // When buffering finishes and playback resumes, re-sync locally without pausing others
            if (state === YTState.PLAYING) {
              const current = playbackRef.current;
              if (current.currentTrack) {
                const dur = e.target.getDuration();
                if (dur > 0 && current.currentTrack.durationSec === 0) {
                  callbacksRef.current.onDurationDiscovered(current.currentTrack.id, dur);
                }
                const expected = computeExpectedPositionSec({
                  isPlaying: current.isPlaying,
                  positionAtTimestamp: current.positionAtTimestamp,
                  serverTimestamp: current.serverTimestamp,
                  estimatedServerNowMs: callbacksRef.current.getEstimatedServerNowMs(),
                  durationSec: current.currentTrack.durationSec || dur,
                });
                const actual = e.target.getCurrentTime();
                if (Math.abs(expected - actual) > 1.5) {
                  e.target.seekTo(expected, true);
                }
              }
            }

            // Natural track end -> notify server (idempotently guarded by trackId)
            if (state === YTState.ENDED) {
              const currentTrack = playbackRef.current.currentTrack;
              if (currentTrack && playbackRef.current.isPlaying) {
                callbacksRef.current.onTrackEnded(currentTrack.id);
              }
            }
          },
          onError: (e) => {
            if (disposed) return;
            // YouTube error codes: 100 = unavailable/removed, 101 & 150 = embed blocked by owner
            if (e.data === 100 || e.data === 101 || e.data === 150) {
              const currentTrack = playbackRef.current.currentTrack;
              if (currentTrack) {
                callbacksRef.current.onEmbedError(currentTrack.id);
              }
            }
          },
        },
      });
    });

    return () => {
      disposed = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // ignore cleanup error
      }
      playerRef.current = null;
      loadedTrackIdRef.current = null;
      loadedVideoIdRef.current = null;
    };
  }, []);

  // Apply local volume & mute independently per listener
  useEffect(() => {
    const player = playerRef.current;
    if (!playerReady || !player) return;
    try {
      player.setVolume(volume);
      if (muted) {
        player.mute();
      } else {
        player.unMute();
      }
    } catch {
      // ignore if player is transitioning
    }
  }, [playerReady, volume, muted]);

  // Synchronize whenever authoritative server playback state changes OR audio is unlocked
  useEffect(() => {
    const player = playerRef.current;
    if (!playerReady || !player) return;

    const track = playback.currentTrack;
    if (!track) {
      loadedTrackIdRef.current = null;
      loadedVideoIdRef.current = null;
      try {
        player.pauseVideo();
      } catch {
        // ignore
      }
      return;
    }

    const expectedSec = computeExpectedPositionSec({
      isPlaying: playback.isPlaying,
      positionAtTimestamp: playback.positionAtTimestamp,
      serverTimestamp: playback.serverTimestamp,
      estimatedServerNowMs: callbacksRef.current.getEstimatedServerNowMs(),
      durationSec: track.durationSec,
    });

    const trackChanged =
      loadedTrackIdRef.current !== track.id || loadedVideoIdRef.current !== track.youtubeId;

    try {
      if (trackChanged) {
        loadedTrackIdRef.current = track.id;
        loadedVideoIdRef.current = track.youtubeId;
        player.setPlaybackRate(1);
        if (playback.isPlaying && audioUnlocked) {
          player.loadVideoById({ videoId: track.youtubeId, startSeconds: expectedSec });
        } else {
          player.cueVideoById({ videoId: track.youtubeId, startSeconds: expectedSec });
        }
        return;
      }

      if (!audioUnlocked) {
        player.pauseVideo();
        return;
      }

      const actual = player.getCurrentTime();
      const decision = evaluateDriftCorrection(actual, expectedSec, playback.isPlaying);

      if (playback.isPlaying) {
        if (decision.action === 'seek') {
          player.setPlaybackRate(1);
          player.seekTo(decision.targetPositionSec, true);
        } else {
          player.setPlaybackRate(decision.playbackRate);
        }
        if (player.getPlayerState() !== window.YT?.PlayerState.PLAYING) {
          player.playVideo();
        }
      } else {
        player.setPlaybackRate(1);
        if (Math.abs(expectedSec - actual) > 0.35) {
          player.seekTo(expectedSec, true);
        }
        player.pauseVideo();
      }
    } catch {
      // Player might still be initializing
    }
  }, [playerReady, playback, audioUnlocked]);

  // Periodic drift correction every 2.5 seconds (strictly follows <300ms / 300ms-2s / >2s rules)
  useEffect(() => {
    if (!playerReady || !audioUnlocked) return;

    const interval = window.setInterval(() => {
      const player = playerRef.current;
      const current = playbackRef.current;
      if (!player || !current.currentTrack || !audioUnlockedRef.current) return;

      try {
        const state = player.getPlayerState();
        const YTState = window.YT?.PlayerState;
        // Do not fight YouTube while buffering
        if (YTState && state === YTState.BUFFERING) return;

        const dur = current.currentTrack.durationSec || player.getDuration();
        const expected = computeExpectedPositionSec({
          isPlaying: current.isPlaying,
          positionAtTimestamp: current.positionAtTimestamp,
          serverTimestamp: current.serverTimestamp,
          estimatedServerNowMs: callbacksRef.current.getEstimatedServerNowMs(),
          durationSec: dur,
        });

        const actual = player.getCurrentTime();
        const decision = evaluateDriftCorrection(actual, expected, current.isPlaying);

        if (!current.isPlaying) {
          if (YTState && state === YTState.PLAYING) {
            player.pauseVideo();
          }
          if (decision.action === 'seek') {
            player.seekTo(decision.targetPositionSec, true);
          }
          return;
        }

        if (decision.action === 'seek') {
          if (player.getPlaybackRate() !== 1) player.setPlaybackRate(1);
          player.seekTo(decision.targetPositionSec, true);
        } else if (decision.action === 'gentle') {
          if (player.getPlaybackRate() !== decision.playbackRate) {
            player.setPlaybackRate(decision.playbackRate);
          }
        } else if (player.getPlaybackRate() !== 1) {
          player.setPlaybackRate(1);
        }

        if (YTState && state !== YTState.PLAYING && state !== YTState.ENDED) {
          player.playVideo();
        }
      } catch {
        // Non-fatal drift check error
      }
    }, 2500);

    return () => window.clearInterval(interval);
  }, [playerReady, audioUnlocked]);

  const handleTapJoin = () => {
    onUnlockAudio();
    const player = playerRef.current;
    const current = playbackRef.current;
    if (player && current.currentTrack) {
      try {
        const expected = computeExpectedPositionSec({
          isPlaying: current.isPlaying,
          positionAtTimestamp: current.positionAtTimestamp,
          serverTimestamp: current.serverTimestamp,
          estimatedServerNowMs: callbacksRef.current.getEstimatedServerNowMs(),
          durationSec: current.currentTrack.durationSec,
        });
        if (!muted) player.unMute();
        player.setVolume(volume);
        if (current.isPlaying) {
          player.loadVideoById({
            videoId: current.currentTrack.youtubeId,
            startSeconds: expected,
          });
        }
      } catch {
        // handled by effect
      }
    }
  };

  const hasTrack = Boolean(playback.currentTrack);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#0B0E14]">
      {/* Official YouTube IFrame Player mount */}
      <div
        ref={containerRef}
        className={`h-full w-full transition-opacity duration-300 ${
          hasTrack ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Empty Stage when queue has no active track */}
      {!hasTrack && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#131822] via-[#0F131C] to-[#0B0E14] p-6 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1A202E] text-slate-400">
            <Disc3 className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="font-display text-base font-semibold text-slate-100">
            Nothing playing yet
          </p>
          <p className="mt-1 max-w-xs text-xs text-slate-400">
            Add a YouTube link, Spotify track, or playlist to start listening together.
          </p>
        </div>
      )}

      {/* One-time Autoplay Unlock Overlay ("Tap to join the music") */}
      {hasTrack && !audioUnlocked && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/75 p-6 text-center backdrop-blur-sm">
          {playback.currentTrack?.thumbnailUrl && (
            <img
              src={playback.currentTrack.thumbnailUrl}
              alt={playback.currentTrack.title}
              referrerPolicy="no-referrer"
              className="mb-4 h-20 w-36 rounded-lg object-cover opacity-90 shadow-lg"
            />
          )}
          <button
            type="button"
            onClick={handleTapJoin}
            className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-orange-600 px-6 text-sm font-semibold text-white shadow-lg shadow-orange-950/40 transition-transform hover:bg-orange-500 active:scale-[0.98]"
          >
            <Headphones className="h-4 w-4" aria-hidden="true" />
            Tap to join the music
          </button>
          <p className="mt-2.5 text-xs text-slate-300">
            Unlocks browser audio and syncs straight to the room’s live position.
          </p>
        </div>
      )}

      {/* Local buffering indicator (never pauses other listeners) */}
      {hasTrack && audioUnlocked && buffering && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg bg-slate-950/80 px-2.5 py-1.5 text-xs text-slate-200 backdrop-blur-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" aria-hidden="true" />
          <span>Re-syncing buffer</span>
        </div>
      )}
    </div>
  );
}
