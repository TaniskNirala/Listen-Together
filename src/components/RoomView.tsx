import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ListMusic,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { resolveClientPresence, type PresenceSnapshot } from '../shared/presence';
import { computeExpectedPositionSec, formatDuration } from '../shared/sync';
import type {
  AuthUser,
  AutoplayConfig,
  ControlMode,
  PlaylistImportProgress,
  ReactionEvent,
  RepeatMode,
  RoomFullState,
} from '../shared/types';
import { AddMusicModal } from './AddMusicModal';
import { AutoplaySettingsModal } from './AutoplaySettingsModal';
import { ChatPanel } from './ChatPanel';
import { ListenersPanel } from './ListenersPanel';
import { QueuePanel } from './QueuePanel';
import { ReactionPicker } from './ReactionPicker';
import { YouTubeSyncPlayer } from './YouTubeSyncPlayer';

const DESKTOP_REACTION_LANES = [
  'right-4 reaction-sway-left',
  'right-16 reaction-sway-right',
  'right-28 reaction-sway-mid',
  'right-40 reaction-sway-left',
  'right-52 reaction-sway-right',
] as const;

const MOBILE_REACTION_LANES = [
  'right-3 reaction-sway-left',
  'right-14 reaction-sway-right',
  'right-24 reaction-sway-mid',
] as const;

function reactionLaneIndex(id: string, totalLanes: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % totalLanes;
}

interface RoomViewProps {
  user: AuthUser;
  room: RoomFullState;
  reactions: ReactionEvent[];
  importProgress: PlaylistImportProgress | null;
  getEstimatedServerNowMs: () => number;
  onLeaveRoom: () => void;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (positionSec: number) => void;
  onSkip: () => void;
  onTrackEnded: (trackId: string) => void;
  onEmbedError: (trackId: string) => void;
  onDurationDiscovered: (trackId: string, durationSec: number) => void;
  onPlayQueueItemNow: (trackId: string) => void;
  onRemoveQueueItem: (trackId: string) => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onCycleRepeat: (nextMode: RepeatMode) => void;
  onToggleShuffle: (enabled: boolean) => void;
  onChangeControlMode: (mode: ControlMode) => void;
  onChangeMemberRole: (targetUserId: number, role: 'dj' | 'listener') => void;
  onKickMember: (targetUserId: number) => void;
  onSendChat: (body: string, replyToId?: string) => void;
  onSendReaction: (emoji: string) => void;
  onPresenceChange: (presence: PresenceSnapshot) => void;
  autoplayLoading: boolean;
  onUpdateAutoplay: (patch: Partial<AutoplayConfig>) => void;
  onDislikeTrack: (trackId: string, blockArtist?: boolean) => void;
  notificationSoundEnabled: boolean;
  onToggleNotificationSound: () => void;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

type SideTab = 'queue' | 'chat' | 'listeners';
type MobileTab = 'player' | 'queue' | 'chat' | 'listeners';

export function RoomView({
  user,
  room,
  reactions,
  importProgress,
  getEstimatedServerNowMs,
  onLeaveRoom,
  onPlay,
  onPause,
  onSeek,
  onSkip,
  onTrackEnded,
  onEmbedError,
  onDurationDiscovered,
  onPlayQueueItemNow,
  onRemoveQueueItem,
  onReorderQueue,
  onCycleRepeat,
  onToggleShuffle,
  onChangeControlMode,
  onChangeMemberRole,
  onKickMember,
  onSendChat,
  onSendReaction,
  onPresenceChange,
  autoplayLoading,
  onUpdateAutoplay,
  onDislikeTrack,
  notificationSoundEnabled,
  onToggleNotificationSound,
  onNotify,
}: RoomViewProps) {
  const [sideTab, setSideTab] = useState<SideTab>('queue');
  const [mobileTab, setMobileTab] = useState<MobileTab>('player');
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAutoplayModal, setShowAutoplayModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastSentPresenceRef = useRef<string | null>(null);
  const onPresenceChangeRef = useRef(onPresenceChange);
  onPresenceChangeRef.current = onPresenceChange;

  // Per-user local volume & autoplay unlock
  const [volume, setVolume] = useState<number>(() => {
    const saved = window.localStorage.getItem('pulseroom-volume');
    const parsed = saved ? Number.parseInt(saved, 10) : 80;
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 80;
  });
  const [muted, setMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  // Smooth local seek bar display derived from server clock
  const [displayPos, setDisplayPos] = useState(0);
  const [draggingSeek, setDraggingSeek] = useState<number | null>(null);

  const canControl = useMemo(() => {
    if (room.myRole === 'host' || room.myRole === 'dj') return true;
    return room.controlMode === 'everyone';
  }, [room.myRole, room.controlMode]);

  const canManage = room.myRole === 'host' || user.role === 'admin';
  const currentTrack = room.playback.currentTrack;

  useEffect(() => {
    try {
      window.localStorage.setItem('pulseroom-volume', String(volume));
    } catch {
      // ignore
    }
  }, [volume]);

  // Track responsive breakpoint so we know accurately whether Chat is visible on screen
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const syncBreakpoint = () => setIsDesktop(mq.matches);
    syncBreakpoint();
    mq.addEventListener('change', syncBreakpoint);
    return () => mq.removeEventListener('change', syncBreakpoint);
  }, []);

  const isChatOpen = isDesktop ? sideTab === 'chat' : mobileTab === 'chat';

  // Report live foreground tab visibility + active chat presence to the room
  useEffect(() => {
    const publishPresence = () => {
      const next = resolveClientPresence({
        visibilityState: document.visibilityState,
        isChatOpen,
      });
      const key = `${room.code}:${next.tabActive ? 1 : 0}:${next.inChat ? 1 : 0}`;
      if (lastSentPresenceRef.current === key) return;
      lastSentPresenceRef.current = key;
      onPresenceChangeRef.current(next);
    };

    const handlePageHide = () => {
      const key = `${room.code}:0:0`;
      if (lastSentPresenceRef.current === key) return;
      lastSentPresenceRef.current = key;
      onPresenceChangeRef.current({ tabActive: false, inChat: false });
    };

    publishPresence();
    document.addEventListener('visibilitychange', publishPresence);
    window.addEventListener('focus', publishPresence);
    window.addEventListener('pageshow', publishPresence);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', publishPresence);
      window.removeEventListener('focus', publishPresence);
      window.removeEventListener('pageshow', publishPresence);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [room.code, isChatOpen]);

  // Update seek bar readout every 250ms purely in client UI (never writes to DB)
  useEffect(() => {
    const computeNow = () => {
      if (!room.playback.currentTrack) {
        setDisplayPos(0);
        return;
      }
      const pos = computeExpectedPositionSec({
        isPlaying: room.playback.isPlaying,
        positionAtTimestamp: room.playback.positionAtTimestamp,
        serverTimestamp: room.playback.serverTimestamp,
        estimatedServerNowMs: getEstimatedServerNowMs(),
        durationSec: room.playback.currentTrack.durationSec,
      });
      setDisplayPos(pos);
    };

    computeNow();
    const timer = window.setInterval(computeNow, 250);
    return () => window.clearInterval(timer);
  }, [room.playback, getEstimatedServerNowMs]);

  // Keyboard shortcuts: Space = Play/Pause, N = Next track
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!canControl || showAddModal) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (room.playback.isPlaying) {
          onPause();
        } else {
          setAudioUnlocked(true);
          onPlay();
        }
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onSkip();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canControl, showAddModal, room.playback.isPlaying, onPlay, onPause, onSkip]);

  const handleCopyInvite = async () => {
    const inviteUrl = `${window.location.origin}/room/${room.code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      onNotify(`Copied room link (${room.code}).`, 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify(`Room code: ${room.code}`, 'info');
    }
  };

  const nextRepeatMode = (): RepeatMode => {
    if (room.playback.repeatMode === 'off') return 'all';
    if (room.playback.repeatMode === 'all') return 'one';
    return 'off';
  };

  const durationSec = currentTrack?.durationSec || 0;
  const effectiveSeekVal = draggingSeek !== null ? draggingSeek : displayPos;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20 pt-4 sm:px-6 lg:pb-8 lg:pt-6">
      {/* Room Header Strip */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onLeaveRoom}
            aria-label="Leave room and return to lobby"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-[#242C3D] dark:bg-[#131822] dark:text-slate-300 dark:hover:bg-[#1A202E]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold text-slate-900 sm:text-xl dark:text-slate-100">
              {room.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                {room.code}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {room.listeners.length} {room.listeners.length === 1 ? 'listener' : 'listeners'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">Your role: {room.myRole}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyInvite()}
            className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#242C3D] dark:bg-[#131822] dark:text-slate-200 dark:hover:bg-[#1A202E]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy link'}
          </button>

          {canControl && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-orange-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-orange-500"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add music
            </button>
          )}
        </div>
      </div>

      {/* Main 2-Column Studio Grid on Desktop, Tabbed Views on Mobile */}
      <div className="grid gap-6 lg:grid-cols-12 lg:items-stretch">
        {/* Left: Now Playing Stage & Controls */}
        <section
          aria-label="Now playing"
          className={`min-w-0 lg:col-span-7 ${mobileTab === 'player' ? 'block' : 'hidden lg:block'}`}
        >
          <div className="h-full rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-[#242C3D] dark:bg-[#131822]">
            {/* Video Stage + Floating Emoji Reactions */}
            <div className="relative">
              <YouTubeSyncPlayer
                playback={room.playback}
                volume={volume}
                muted={muted}
                audioUnlocked={audioUnlocked}
                getEstimatedServerNowMs={getEstimatedServerNowMs}
                onUnlockAudio={() => setAudioUnlocked(true)}
                onTrackEnded={onTrackEnded}
                onEmbedError={onEmbedError}
                onDurationDiscovered={onDurationDiscovered}
              />

              {/* Floating Reaction Bursts (Desktop: staggered lanes across full 16:9 stage) */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-20 hidden overflow-hidden lg:block"
              >
                {reactions.map((r) => {
                  const laneClass =
                    DESKTOP_REACTION_LANES[reactionLaneIndex(r.id, DESKTOP_REACTION_LANES.length)];
                  return (
                    <div
                      key={r.id}
                      data-testid="reaction-burst"
                      className={`animate-reaction-float absolute bottom-4 flex flex-col items-center rounded-2xl border border-white/15 bg-slate-950/85 px-3 py-2 text-center shadow-xl backdrop-blur-md ${laneClass}`}
                    >
                      {r.comboCount && r.comboCount >= 2 && (
                        <span className="absolute -right-2 -top-2 rounded-full bg-orange-600 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-white shadow-sm tabular-nums">
                          ×{r.comboCount}
                        </span>
                      )}
                      <span className="text-3xl leading-none drop-shadow-sm">{r.emoji}</span>
                      <span className="mt-1 max-w-[96px] truncate text-[10px] font-medium text-slate-100">
                        {r.username}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Track Metadata */}
            <div className="mt-4 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {currentTrack
                    ? currentTrack.title
                    : autoplayLoading
                    ? 'Finding next track...'
                    : 'Ready to play'}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {currentTrack
                      ? currentTrack.artist
                      : autoplayLoading
                      ? 'Autoplay is picking from your history'
                      : 'Add a link or search YouTube'}
                  </span>
                  {currentTrack && !currentTrack.autoplay && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Queued by {currentTrack.addedByUsername}</span>
                    </>
                  )}
                  {currentTrack?.autoplay && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        data-testid="autoplay-track-badge"
                        className="inline-flex items-center gap-1 font-medium text-orange-600 dark:text-orange-400"
                      >
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {currentTrack.autoplayReason || 'Autoplay'}
                      </span>
                    </>
                  )}
                  {currentTrack?.source === 'spotify' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        Playing via YouTube
                      </span>
                    </>
                  )}
                </div>
              </div>

              {currentTrack?.autoplay && canControl && (
                <button
                  type="button"
                  data-testid="autoplay-dislike-btn"
                  disabled={autoplayLoading}
                  onClick={() => onDislikeTrack(currentTrack.id)}
                  title="Skip this autoplayed song and steer Autoplay away from similar tracks"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:border-[#242C3D] dark:bg-[#1A202E] dark:text-slate-300 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                >
                  <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Not interested</span>
                </button>
              )}
            </div>

            {/* Seek Bar */}
            <div className="mt-5">
              <label htmlFor="room-seek-slider" className="sr-only">
                Playback position
              </label>
              <input
                id="room-seek-slider"
                type="range"
                min={0}
                max={durationSec > 0 ? durationSec : 100}
                step={1}
                disabled={!currentTrack || !canControl || durationSec === 0}
                value={
                  durationSec > 0
                    ? Math.min(durationSec, Math.floor(effectiveSeekVal))
                    : 0
                }
                onChange={(e) => setDraggingSeek(Number(e.target.value))}
                onMouseUp={() => {
                  if (draggingSeek !== null) {
                    onSeek(draggingSeek);
                    setDraggingSeek(null);
                  }
                }}
                onTouchEnd={() => {
                  if (draggingSeek !== null) {
                    onSeek(draggingSeek);
                    setDraggingSeek(null);
                  }
                }}
                onKeyUp={(e) => {
                  if (
                    draggingSeek !== null &&
                    (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
                  ) {
                    onSeek(draggingSeek);
                    setDraggingSeek(null);
                  }
                }}
                className="h-2 w-full cursor-pointer accent-orange-600 disabled:cursor-default disabled:opacity-60"
              />
              <div className="mt-1 flex items-center justify-between font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                <span>{formatDuration(effectiveSeekVal)}</span>
                <span>{durationSec > 0 ? formatDuration(durationSec) : '--:--'}</span>
              </div>
            </div>

            {/* Transport Controls + Local Volume */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-[#1E2636]">
              {/* Playback Controls */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canControl}
                  onClick={() => onToggleShuffle(!room.playback.shuffleEnabled)}
                  aria-label={room.playback.shuffleEnabled ? 'Disable shuffle' : 'Enable shuffle'}
                  aria-pressed={room.playback.shuffleEnabled}
                  title="Shuffle"
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${
                    room.playback.shuffleEnabled
                      ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1A202E] dark:hover:text-slate-100'
                  }`}
                >
                  <Shuffle className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  disabled={!canControl || (!currentTrack && room.playback.queue.length === 0)}
                  onClick={() => {
                    if (room.playback.isPlaying) {
                      onPause();
                    } else {
                      setAudioUnlocked(true);
                      onPlay();
                    }
                  }}
                  aria-label={room.playback.isPlaying ? 'Pause playback' : 'Play playback'}
                  title="Play / Pause (Space)"
                  className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-600 text-white transition-colors hover:bg-orange-500 disabled:opacity-40"
                >
                  {room.playback.isPlaying ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5 translate-x-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  disabled={!canControl || (!currentTrack && room.playback.queue.length === 0)}
                  onClick={onSkip}
                  aria-label="Skip to next track"
                  title="Next track (N)"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-[#1A202E] dark:hover:text-slate-100"
                >
                  <SkipForward className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  disabled={!canControl}
                  onClick={() => onCycleRepeat(nextRepeatMode())}
                  aria-label={`Repeat mode: ${room.playback.repeatMode}`}
                  title={`Repeat: ${room.playback.repeatMode}`}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${
                    room.playback.repeatMode !== 'off'
                      ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1A202E] dark:hover:text-slate-100'
                  }`}
                >
                  {room.playback.repeatMode === 'one' ? (
                    <Repeat1 className="h-4 w-4" />
                  ) : (
                    <Repeat className="h-4 w-4" />
                  )}
                </button>

                <span
                  aria-hidden="true"
                  className="mx-1 h-5 w-px bg-slate-200 dark:bg-[#242C3D]"
                />

                <button
                  type="button"
                  data-testid="autoplay-toggle"
                  disabled={!canControl}
                  onClick={() => onUpdateAutoplay({ enabled: !room.autoplay.enabled })}
                  aria-pressed={room.autoplay.enabled}
                  aria-label={room.autoplay.enabled ? 'Disable Autoplay' : 'Enable Autoplay'}
                  title={
                    room.autoplay.enabled
                      ? `Autoplay on (${room.autoplay.mode}) — click to turn off`
                      : 'Turn on Autoplay to play music automatically from room history'
                  }
                  className={`inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    room.autoplay.enabled
                      ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1A202E] dark:hover:text-slate-100'
                  }`}
                >
                  {autoplayLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">Autoplay</span>
                </button>

                <button
                  type="button"
                  data-testid="autoplay-settings-btn"
                  onClick={() => setShowAutoplayModal(true)}
                  aria-label="Customize Autoplay settings"
                  title="Customize Autoplay"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1A202E] dark:hover:text-slate-100"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>

              {/* Independent Per-User Local Volume */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? 'Unmute local audio' : 'Mute local audio'}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#1A202E]"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <label htmlFor="local-volume-slider" className="sr-only">
                  Local volume
                </label>
                <input
                  id="local-volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setVolume(next);
                    if (next > 0 && muted) setMuted(false);
                  }}
                  className="h-1.5 w-24 cursor-pointer accent-orange-600 sm:w-28"
                />
                <span className="w-8 text-right font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {muted ? 0 : volume}%
                </span>
              </div>
            </div>

            {/* Quick Reactions + Expanded Picker + Keyboard shortcuts hint */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-[#1E2636]/70">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  React
                </span>
                <ReactionPicker onSendReaction={onSendReaction} align="left" />
              </div>

              {canControl && (
                <p className="hidden text-[11px] text-slate-400 lg:block dark:text-slate-500">
                  Space: play/pause · N: skip
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Right: Tabbed Queue / Chat / Listeners Panel */}
        <aside
          aria-label="Room queue, chat, and listeners"
          className={`min-w-0 flex h-[calc(100dvh-16.5rem)] min-h-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white lg:col-span-5 lg:h-full lg:max-h-[680px] dark:border-[#242C3D] dark:bg-[#131822] ${
            mobileTab !== 'player' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* Desktop Panel Tabs */}
          <div
            role="tablist"
            aria-label="Room sidebar sections"
            className="hidden grid-cols-3 border-b border-slate-200 p-1.5 lg:grid dark:border-[#1E2636]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'queue'}
              onClick={() => setSideTab('queue')}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-colors ${
                sideTab === 'queue'
                  ? 'bg-slate-100 text-slate-900 dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <ListMusic className="h-4 w-4" aria-hidden="true" />
              Queue
              <span className="font-mono text-[11px] tabular-nums opacity-75">
                {room.playback.queue.length}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'chat'}
              onClick={() => setSideTab('chat')}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-colors ${
                sideTab === 'chat'
                  ? 'bg-slate-100 text-slate-900 dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Chat
              <span className="font-mono text-[11px] tabular-nums opacity-75">
                {room.chat.length}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'listeners'}
              onClick={() => setSideTab('listeners')}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-colors ${
                sideTab === 'listeners'
                  ? 'bg-slate-100 text-slate-900 dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              People
              <span className="font-mono text-[11px] tabular-nums opacity-75">
                {room.listeners.length}
              </span>
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {(mobileTab === 'queue' || (mobileTab === 'player' && sideTab === 'queue')) && (
              <QueuePanel
                queue={room.playback.queue}
                history={room.history}
                autoplay={room.autoplay}
                autoplayLoading={autoplayLoading}
                canControl={canControl}
                onOpenAddModal={() => setShowAddModal(true)}
                onToggleAutoplay={() => onUpdateAutoplay({ enabled: !room.autoplay.enabled })}
                onOpenAutoplaySettings={() => setShowAutoplayModal(true)}
                onPlayNow={onPlayQueueItemNow}
                onRemove={onRemoveQueueItem}
                onReorder={onReorderQueue}
              />
            )}
            {(mobileTab === 'chat' || (mobileTab === 'player' && sideTab === 'chat')) && (
              <ChatPanel
                messages={room.chat}
                listeners={room.listeners}
                currentUsername={user.username}
                soundEnabled={notificationSoundEnabled}
                onToggleSound={onToggleNotificationSound}
                onSendMessage={onSendChat}
                onSendReaction={onSendReaction}
              />
            )}
            {(mobileTab === 'listeners' || (mobileTab === 'player' && sideTab === 'listeners')) && (
              <ListenersPanel
                listeners={room.listeners}
                currentUserId={user.id}
                controlMode={room.controlMode}
                canManage={canManage}
                onChangeControlMode={onChangeControlMode}
                onChangeMemberRole={onChangeMemberRole}
                onKickMember={onKickMember}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Mobile Bottom Thumb-Zone Navigation Bar (compact h-14, keeps sticky surfaces <15%) */}
      <nav
        aria-label="Room mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-30 grid h-14 grid-cols-4 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe lg:hidden dark:border-[#1E2636] dark:bg-[#0B0E14]/95"
      >
        {(
          [
            { id: 'player', label: 'Player', icon: Radio },
            { id: 'queue', label: 'Queue', icon: ListMusic },
            { id: 'chat', label: 'Chat', icon: MessageSquare },
            { id: 'listeners', label: 'People', icon: Users },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = mobileTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMobileTab(item.id);
                if (item.id !== 'player') setSideTab(item.id);
              }}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Floating Reaction Bursts (Mobile: staggered lanes visible over all room tabs) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-28 right-0 z-40 h-60 w-44 lg:hidden"
      >
        {reactions.map((r) => {
          const laneClass =
            MOBILE_REACTION_LANES[reactionLaneIndex(r.id, MOBILE_REACTION_LANES.length)];
          return (
            <div
              key={r.id}
              data-testid="reaction-burst-mobile"
              className={`animate-reaction-float absolute bottom-0 flex flex-col items-center rounded-2xl border border-white/15 bg-slate-950/85 px-2.5 py-1.5 text-center shadow-xl backdrop-blur-md ${laneClass}`}
            >
              {r.comboCount && r.comboCount >= 2 && (
                <span className="absolute -right-2 -top-2 rounded-full bg-orange-600 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-white shadow-sm tabular-nums">
                  ×{r.comboCount}
                </span>
              )}
              <span className="text-2xl leading-none">{r.emoji}</span>
              <span className="mt-1 max-w-[84px] truncate text-[10px] font-medium text-slate-100">
                {r.username}
              </span>
            </div>
          );
        })}
      </div>

      {/* Add Music Modal */}
      {showAddModal && (
        <AddMusicModal
          roomCode={room.code}
          importProgress={importProgress}
          onClose={() => setShowAddModal(false)}
          onNotify={onNotify}
        />
      )}

      {/* Customize Autoplay Modal */}
      {showAutoplayModal && (
        <AutoplaySettingsModal
          config={room.autoplay}
          historyCount={room.history.length}
          canControl={canControl}
          onSave={onUpdateAutoplay}
          onClose={() => setShowAutoplayModal(false)}
        />
      )}
    </main>
  );
}
