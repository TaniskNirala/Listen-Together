import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { apiFetch, ApiError } from './lib/api';
import { disconnectSocket, getSocket } from './lib/socket';
import {
  installAudioUnlock,
  playSubtleNotificationSound,
  readNotificationSoundPreference,
  writeNotificationSoundPreference,
} from './lib/sound';
import {
  resolveChatNotificationTone,
  shouldPlayNotificationSound,
} from './shared/notificationSound';
import { useTheme } from './hooks/useTheme';
import { useClockSync } from './hooks/useClockSync';
import { TopBar, type AppView } from './components/TopBar';
import { AuthView } from './components/AuthView';
import { LobbyView } from './components/LobbyView';
import { AdminPanel } from './components/AdminPanel';
import { RoomView } from './components/RoomView';
import { ChangeUsernameModal } from './components/ChangeUsernameModal';
import { ReconnectingOverlay } from './components/ReconnectingOverlay';
import { ToastContainer, type ToastItem } from './components/ToastContainer';
import type {
  AuthUser,
  AutoplayConfig,
  ChatMessage,
  ControlMode,
  HistoryItem,
  PlaylistImportProgress,
  ReactionEvent,
  RepeatMode,
  RoomFullState,
  RoomListener,
  RoomPlaybackState,
  RoomRole,
} from './shared/types';

function readRoomCodeFromUrl(): string | null {
  const match = /^\/room\/([a-zA-Z0-9_-]{3,16})\/?$/.exec(window.location.pathname);
  return match ? match[1].toUpperCase() : null;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();

  const [booting, setBooting] = useState(true);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeView, setActiveView] = useState<AppView>('lobby');

  // Room & Socket state
  const [socketConnected, setSocketConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [nextRetrySec, setNextRetrySec] = useState(0);

  const [activeRoom, setActiveRoom] = useState<RoomFullState | null>(null);
  const [pendingRoomCode, setPendingRoomCode] = useState<string | null>(() => readRoomCodeFromUrl());
  const [passwordPromptCode, setPasswordPromptCode] = useState<string | null>(null);
  const [roomPasswordDraft, setRoomPasswordDraft] = useState('');
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [importProgress, setImportProgress] = useState<PlaylistImportProgress | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [autoplayLoading, setAutoplayLoading] = useState(false);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState<boolean>(() =>
    readNotificationSoundPreference()
  );

  const activeRoomCodeRef = useRef<string | null>(null);
  const activeRoomPasswordRef = useRef<string | undefined>(undefined);
  const latestPresenceRef = useRef<{ tabActive: boolean; inChat: boolean }>({
    tabActive: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
    inChat: false,
  });
  const currentUserRef = useRef<AuthUser | null>(null);
  const notificationSoundEnabledRef = useRef<boolean>(notificationSoundEnabled);
  const lastSoundAtRef = useRef<number | null>(null);
  const seenChatIdsRef = useRef<Set<string>>(new Set());
  const reactionTimersRef = useRef<Set<number>>(new Set());
  const reactionComboRef = useRef<Map<string, { count: number; lastAt: number }>>(new Map());
  activeRoomCodeRef.current = activeRoom?.code ?? null;
  currentUserRef.current = user;
  notificationSoundEnabledRef.current = notificationSoundEnabled;
  const userId = user?.id ?? null;

  useEffect(() => {
    return installAudioUnlock();
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastItem['tone'] = 'info') => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const socket = user ? getSocket() : null;
  const { getEstimatedServerNowMs, refreshClock } = useClockSync(socket, socketConnected);

  // Initial session & setup-status bootstrap
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const status = await apiFetch<{ needsAdminSetup: boolean }>('/api/auth/setup-status');
        if (cancelled) return;
        setNeedsAdminSetup(status.needsAdminSetup);
        if (!status.needsAdminSetup) {
          try {
            const me = await apiFetch<{ user: AuthUser }>('/api/auth/me');
            if (!cancelled) setUser(me.user);
          } catch {
            // Not signed in
          }
        }
      } catch (err) {
        if (!cancelled) {
          notify(
            err instanceof ApiError ? err.message : 'Unable to reach server.',
            'warning'
          );
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const joinRoomViaSocket = useCallback(
    (code: string, password?: string) => {
      const s = getSocket();
      const normalized = code.trim().toUpperCase();
      activeRoomPasswordRef.current = password;

      if (!s.connected) {
        setPendingRoomCode(normalized);
        s.connect();
        return;
      }

      const isVisible =
        typeof document === 'undefined' ? true : document.visibilityState === 'visible';
      const isRejoiningSameRoom = activeRoomCodeRef.current === normalized;
      s.emit(
        'room:join',
        {
          code: normalized,
          password,
          tabActive: isVisible,
          inChat: isVisible && isRejoiningSameRoom ? latestPresenceRef.current.inChat : false,
        },
        (resp?: { ok: boolean; state?: RoomFullState; code?: string; error?: string }) => {
          if (!resp) {
            notify('Timed out joining room. Retrying...', 'warning');
            return;
          }
          if (!resp.ok) {
            if (resp.code === 'PASSWORD_REQUIRED') {
              setPasswordPromptCode(normalized);
              setRoomPasswordDraft('');
              return;
            }
            notify(resp.error || 'Could not join room.', 'error');
            setPendingRoomCode(null);
            return;
          }
          if (resp.state) {
            setPasswordPromptCode(null);
            setPendingRoomCode(null);
            setActiveRoom(resp.state);
            setActiveView('room');
            if (window.location.pathname !== `/room/${resp.state.code}`) {
              window.history.replaceState(null, '', `/room/${resp.state.code}`);
            }
            refreshClock();
          }
        }
      );
    },
    [notify, refreshClock]
  );

  // Manage Socket.IO lifecycle, auto-reconnect, retry countdown, and room resync
  useEffect(() => {
    if (!userId) {
      disconnectSocket();
      setSocketConnected(false);
      setReconnecting(false);
      return;
    }

    const s = getSocket();
    let countdownTimer: number | null = null;

    const startCountdown = (attemptNum: number) => {
      const waitSec = Math.min(15, Math.max(1, Math.round(Math.pow(1.6, Math.min(attemptNum, 6)))));
      setNextRetrySec(waitSec);
      if (countdownTimer) window.clearInterval(countdownTimer);
      countdownTimer = window.setInterval(() => {
        setNextRetrySec((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    };

    const onConnect = () => {
      setSocketConnected(true);
      setReconnecting(false);
      setReconnectAttempt(0);
      setNextRetrySec(0);
      if (countdownTimer) window.clearInterval(countdownTimer);

      // Automatically rejoin room & resync full state after reconnect / server cold-start
      const codeToJoin = activeRoomCodeRef.current || pendingRoomCode;
      if (codeToJoin) {
        joinRoomViaSocket(codeToJoin, activeRoomPasswordRef.current);
      }
    };

    const onDisconnect = (reason: string) => {
      setSocketConnected(false);
      if (reason !== 'io client disconnect') {
        setReconnecting(true);
        setReconnectAttempt((n) => n + 1);
        startCountdown(1);
      }
    };

    const onConnectError = (err: Error) => {
      setSocketConnected(false);
      if (err.message === 'UNAUTHORIZED') {
        setUser(null);
        setActiveRoom(null);
        setReconnecting(false);
        return;
      }
      setReconnecting(true);
      setReconnectAttempt((prev) => {
        const next = prev + 1;
        startCountdown(next);
        return next;
      });
    };

    const onPlaybackUpdate = (payload: {
      playback: RoomPlaybackState;
      history: HistoryItem[];
    }) => {
      setActiveRoom((prev) =>
        prev
          ? {
              ...prev,
              playback: payload.playback,
              history: payload.history,
            }
          : prev
      );
    };

    const onListenersUpdate = (payload: {
      listeners: RoomListener[];
      controlMode: ControlMode;
    }) => {
      setActiveRoom((prev) =>
        prev
          ? {
              ...prev,
              listeners: payload.listeners,
              controlMode: payload.controlMode,
            }
          : prev
      );
    };

    const onAutoplayUpdate = (payload: { autoplay: AutoplayConfig }) => {
      setActiveRoom((prev) => (prev ? { ...prev, autoplay: payload.autoplay } : prev));
    };

    const onAutoplayStatus = (payload: { loading: boolean }) => {
      setAutoplayLoading(Boolean(payload?.loading));
    };

    const onMyRole = (payload: { role: RoomRole }) => {
      setActiveRoom((prev) => (prev ? { ...prev, myRole: payload.role } : prev));
    };

    const onChatMessage = (msg: ChatMessage) => {
      const alreadySeen = seenChatIdsRef.current.has(msg.id);
      if (!alreadySeen) {
        seenChatIdsRef.current.add(msg.id);
        if (seenChatIdsRef.current.size > 200) {
          const oldest = seenChatIdsRef.current.values().next().value;
          if (oldest) seenChatIdsRef.current.delete(oldest);
        }
        const now = Date.now();
        const me = currentUserRef.current;
        const isOwnEvent =
          me !== null &&
          (msg.userId === me.id || msg.username.toLowerCase() === me.username.toLowerCase());
        if (
          shouldPlayNotificationSound({
            enabled: notificationSoundEnabledRef.current,
            isOwnEvent,
            nowMs: now,
            lastPlayedAtMs: lastSoundAtRef.current,
          })
        ) {
          const tone = resolveChatNotificationTone({
            replyToUsername: msg.replyTo?.username,
            currentUsername: me?.username,
          });
          if (playSubtleNotificationSound(tone)) {
            lastSoundAtRef.current = now;
          }
        }
      }

      setActiveRoom((prev) => {
        if (!prev) return prev;
        if (prev.chat.some((c) => c.id === msg.id)) return prev;
        return {
          ...prev,
          chat: [...prev.chat, msg].slice(-100),
        };
      });
    };

    const onReactionBurst = (event: ReactionEvent) => {
      const now = Date.now();
      const comboKey = `${event.username}:${event.emoji}`;
      const prevCombo = reactionComboRef.current.get(comboKey);
      const nextCount = prevCombo && now - prevCombo.lastAt <= 2200 ? prevCombo.count + 1 : 1;
      reactionComboRef.current.set(comboKey, { count: nextCount, lastAt: now });
      if (reactionComboRef.current.size > 40) {
        for (const [key, val] of reactionComboRef.current.entries()) {
          if (now - val.lastAt > 4000) reactionComboRef.current.delete(key);
        }
      }

      const enriched: ReactionEvent = {
        ...event,
        comboCount: nextCount >= 2 ? nextCount : undefined,
      };
      setReactions((prev) => [...prev.slice(-15), enriched]);
      const timerId = window.setTimeout(() => {
        reactionTimersRef.current.delete(timerId);
        setReactions((prev) => prev.filter((r) => r.id !== event.id));
      }, 2650);
      reactionTimersRef.current.add(timerId);
    };

    const onUserUpdated = (payload: { user?: AuthUser }) => {
      if (payload?.user) {
        setUser(payload.user);
      }
    };

    const onChatUserRenamed = (payload: { userId: number; username: string }) => {
      setActiveRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chat: prev.chat.map((msg) =>
            msg.userId === payload.userId ? { ...msg, username: payload.username } : msg
          ),
        };
      });
    };

    const onRoomToast = (payload: { message: string; tone?: ToastItem['tone'] }) => {
      notify(payload.message, payload.tone || 'info');
      const now = Date.now();
      if (
        shouldPlayNotificationSound({
          enabled: notificationSoundEnabledRef.current,
          isOwnEvent: false,
          nowMs: now,
          lastPlayedAtMs: lastSoundAtRef.current,
        })
      ) {
        if (playSubtleNotificationSound('room')) {
          lastSoundAtRef.current = now;
        }
      }
    };

    const onRoomKicked = (payload: { reason?: string }) => {
      setActiveRoom(null);
      setActiveView('lobby');
      window.history.replaceState(null, '', '/');
      notify(payload.reason || 'You were removed from the room.', 'warning');
    };

    const onAuthRevoked = (payload: { reason?: string }) => {
      setUser(null);
      setActiveRoom(null);
      setActiveView('lobby');
      notify(payload.reason || 'Session ended.', 'warning');
    };

    const onImportProgress = (progress: PlaylistImportProgress) => {
      setImportProgress(progress);
      if (progress.stage === 'done' || progress.stage === 'error') {
        window.setTimeout(() => setImportProgress(null), 1500);
      }
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.on('room:playback', onPlaybackUpdate);
    s.on('room:listeners', onListenersUpdate);
    s.on('room:autoplay', onAutoplayUpdate);
    s.on('room:autoplay_status', onAutoplayStatus);
    s.on('room:my_role', onMyRole);
    s.on('chat:message', onChatMessage);
    s.on('chat:user_renamed', onChatUserRenamed);
    s.on('reaction:burst', onReactionBurst);
    s.on('auth:user_updated', onUserUpdated);
    s.on('room:toast', onRoomToast);
    s.on('room:kicked', onRoomKicked);
    s.on('auth:revoked', onAuthRevoked);
    s.on('playlist:import_progress', onImportProgress);

    if (!s.connected) {
      s.connect();
    } else {
      onConnect();
    }

    return () => {
      if (countdownTimer) window.clearInterval(countdownTimer);
      for (const timerId of reactionTimersRef.current) {
        window.clearTimeout(timerId);
      }
      reactionTimersRef.current.clear();
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.off('room:playback', onPlaybackUpdate);
      s.off('room:listeners', onListenersUpdate);
      s.off('room:autoplay', onAutoplayUpdate);
      s.off('room:autoplay_status', onAutoplayStatus);
      s.off('room:my_role', onMyRole);
      s.off('chat:message', onChatMessage);
      s.off('chat:user_renamed', onChatUserRenamed);
      s.off('reaction:burst', onReactionBurst);
      s.off('auth:user_updated', onUserUpdated);
      s.off('room:toast', onRoomToast);
      s.off('room:kicked', onRoomKicked);
      s.off('auth:revoked', onAuthRevoked);
      s.off('playlist:import_progress', onImportProgress);
    };
  }, [userId, pendingRoomCode, joinRoomViaSocket, notify]);

  const emitWithAck = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      const s = getSocket();
      if (!s.connected) {
        notify('Reconnecting to server...', 'warning');
        return;
      }
      s.emit(event, payload, (resp?: { ok: boolean; error?: string }) => {
        if (resp && !resp.ok && resp.error) {
          notify(resp.error, 'error');
        }
      });
    },
    [notify]
  );

  const handlePresenceChange = useCallback(
    (presence: { tabActive: boolean; inChat: boolean }) => {
      latestPresenceRef.current = presence;
      const s = getSocket();
      if (s.connected) {
        s.emit('presence:update', presence);
      }
    },
    []
  );

  const handleToggleNotificationSound = useCallback(() => {
    const next = !notificationSoundEnabledRef.current;
    notificationSoundEnabledRef.current = next;
    setNotificationSoundEnabled(next);
    writeNotificationSoundPreference(next);
    if (next) {
      playSubtleNotificationSound('chat');
      lastSoundAtRef.current = Date.now();
    }
  }, []);

  const handleLeaveRoom = () => {
    const s = getSocket();
    if (s.connected) s.emit('room:leave');
    setActiveRoom(null);
    setAutoplayLoading(false);
    setReactions([]);
    activeRoomPasswordRef.current = undefined;
    latestPresenceRef.current = {
      tabActive: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
      inChat: false,
    };
    setActiveView('lobby');
    window.history.replaceState(null, '', '/');
  };

  const handleRenameSelf = async (nextUsername: string) => {
    const data = await apiFetch<{ user: AuthUser }>('/api/auth/username', {
      method: 'PATCH',
      body: JSON.stringify({ username: nextUsername }),
    });
    setUser(data.user);
    notify(`Username updated to "${data.user.username}".`, 'success');
  };

  const handleSignOut = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // proceed with local signout regardless
    }
    disconnectSocket();
    setUser(null);
    setActiveRoom(null);
    setReactions([]);
    setShowRenameModal(false);
    setActiveView('lobby');
    window.history.replaceState(null, '', '/');
  };

  const handlePasswordPromptSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!passwordPromptCode) return;
    joinRoomViaSocket(passwordPromptCode, roomPasswordDraft);
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] dark:bg-[#0B0E14]">
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin text-orange-500" aria-hidden="true" />
          <span>Loading PulseRoom...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] dark:bg-[#0B0E14] dark:text-[#F1F5F9]">
      <TopBar
        user={user}
        activeView={activeView}
        activeRoomCode={activeRoom?.code ?? null}
        theme={theme}
        onToggleTheme={toggleTheme}
        onNavigate={(view) => {
          if (view === 'room' && !activeRoom) {
            setActiveView('lobby');
            return;
          }
          setActiveView(view);
        }}
        onOpenRename={() => setShowRenameModal(true)}
        onSignOut={() => void handleSignOut()}
      />

      {!user ? (
        <AuthView
          needsAdminSetup={needsAdminSetup}
          onAuthenticated={(authedUser) => {
            setNeedsAdminSetup(false);
            setUser(authedUser);
            notify(`Signed in as ${authedUser.username}.`, 'success');
          }}
        />
      ) : activeView === 'admin' && user.role === 'admin' ? (
        <AdminPanel
          currentUser={user}
          onCurrentUserUpdated={setUser}
          onJumpToRoom={(code) => joinRoomViaSocket(code)}
          onNotify={notify}
        />
      ) : activeView === 'room' && activeRoom ? (
        <RoomView
          user={user}
          room={activeRoom}
          reactions={reactions}
          importProgress={importProgress}
          getEstimatedServerNowMs={getEstimatedServerNowMs}
          onLeaveRoom={handleLeaveRoom}
          onPlay={() => emitWithAck('playback:play', { clientEventId: crypto.randomUUID() })}
          onPause={() => emitWithAck('playback:pause', { clientEventId: crypto.randomUUID() })}
          onSeek={(positionSec) =>
            emitWithAck('playback:seek', { positionSec, clientEventId: crypto.randomUUID() })
          }
          onSkip={() => emitWithAck('playback:skip', { clientEventId: crypto.randomUUID() })}
          onTrackEnded={(trackId) => getSocket().emit('playback:track_ended', { trackId })}
          onEmbedError={(trackId) => getSocket().emit('playback:embed_error', { trackId })}
          onDurationDiscovered={(trackId, durationSec) =>
            getSocket().emit('playback:report_duration', { trackId, durationSec })
          }
          onPlayQueueItemNow={(trackId) =>
            emitWithAck('queue:play_now', { trackId, clientEventId: crypto.randomUUID() })
          }
          onRemoveQueueItem={(trackId) => emitWithAck('queue:remove', { trackId })}
          onReorderQueue={(fromIndex, toIndex) =>
            emitWithAck('queue:reorder', { fromIndex, toIndex })
          }
          onCycleRepeat={(repeatMode) => emitWithAck('queue:repeat', { repeatMode })}
          onToggleShuffle={(shuffleEnabled) => emitWithAck('queue:shuffle', { shuffleEnabled })}
          onChangeControlMode={(controlMode) => emitWithAck('room:control_mode', { controlMode })}
          onChangeMemberRole={(targetUserId, role) =>
            emitWithAck('member:role', { targetUserId, role })
          }
          onKickMember={(targetUserId) => emitWithAck('member:kick', { targetUserId })}
          onSendChat={(body, replyToId) =>
            emitWithAck('chat:send', {
              body,
              replyToId,
              clientMessageId: crypto.randomUUID(),
            })
          }
          onSendReaction={(emoji) => emitWithAck('reaction:send', { emoji })}
          onPresenceChange={handlePresenceChange}
          autoplayLoading={autoplayLoading}
          onUpdateAutoplay={(patch) => emitWithAck('autoplay:update', patch as Record<string, unknown>)}
          onDislikeTrack={(trackId, blockArtist) =>
            emitWithAck('autoplay:dislike', { trackId, blockArtist })
          }
          notificationSoundEnabled={notificationSoundEnabled}
          onToggleNotificationSound={handleToggleNotificationSound}
          onNotify={notify}
        />
      ) : (
        <LobbyView
          user={user}
          onEnterRoom={(code, password) => joinRoomViaSocket(code, password)}
          onNotify={notify}
        />
      )}

      {/* Room Password Dialog */}
      {passwordPromptCode && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-password-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-[#242C3D] dark:bg-[#131822]">
            <div className="mb-3 flex items-center gap-2.5">
              <Lock className="h-5 w-5 text-orange-500" aria-hidden="true" />
              <h2
                id="room-password-title"
                className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100"
              >
                Password required ({passwordPromptCode})
              </h2>
            </div>
            <form onSubmit={handlePasswordPromptSubmit} className="space-y-4">
              <div>
                <label htmlFor="prompt-room-pw" className="sr-only">
                  Room password
                </label>
                <input
                  id="prompt-room-pw"
                  type="password"
                  required
                  autoFocus
                  value={roomPasswordDraft}
                  onChange={(e) => setRoomPasswordDraft(e.target.value)}
                  placeholder="Enter room password"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPasswordPromptCode(null)}
                  className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#242C3D] dark:text-slate-300 dark:hover:bg-[#1A202E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-500"
                >
                  Unlock room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Own Username Dialog */}
      {showRenameModal && user && (
        <ChangeUsernameModal
          title="Change username"
          description="Your new username updates immediately in rooms, chat, and sign-in."
          currentUsername={user.username}
          onSave={handleRenameSelf}
          onClose={() => setShowRenameModal(false)}
        />
      )}

      {/* Server Waking Up / Reconnecting Overlay */}
      <ReconnectingOverlay
        visible={Boolean(user) && reconnecting}
        attempt={reconnectAttempt}
        nextRetryInSec={nextRetrySec}
        onRetryNow={() => {
          const s = getSocket();
          if (!s.connected) s.connect();
        }}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
