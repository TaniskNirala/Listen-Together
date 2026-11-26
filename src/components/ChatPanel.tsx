import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Bell, BellOff, CornerDownRight, Reply, Send, X } from 'lucide-react';
import { buildReplySnippet } from '../shared/validation';
import type { ChatMessage, RoomListener } from '../shared/types';
import { ReactionPicker } from './ReactionPicker';

interface ChatPanelProps {
  messages: ChatMessage[];
  listeners: RoomListener[];
  currentUsername: string;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onSendMessage: (body: string, replyToId?: string) => void;
  onSendReaction: (emoji: string) => void;
}

export function ChatPanel({
  messages,
  listeners,
  currentUsername,
  soundEnabled,
  onToggleSound,
  onSendMessage,
  onSendReaction,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<number | null>(null);

  const messagesById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const listenerById = useMemo(() => {
    const map = new Map<number, RoomListener>();
    for (const l of listeners) map.set(l.userId, l);
    return map;
  }, [listeners]);

  const listenerByName = useMemo(() => {
    const map = new Map<string, RoomListener>();
    for (const l of listeners) map.set(l.username.toLowerCase(), l);
    return map;
  }, [listeners]);

  const { inChatListeners, onScreenListeners, backgroundListeners } = useMemo(() => {
    const inChat: RoomListener[] = [];
    const onScreen: RoomListener[] = [];
    const background: RoomListener[] = [];
    for (const l of listeners) {
      if (l.inChat) inChat.push(l);
      else if (l.tabActive) onScreen.push(l);
      else background.push(l);
    }
    return {
      inChatListeners: inChat,
      onScreenListeners: onScreen,
      backgroundListeners: background,
    };
  }, [listeners]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const handleStartReply = (msg: ChatMessage) => {
    setReplyingTo(msg);
    inputRef.current?.focus();
  };

  const handleJumpToMessage = (targetId: string) => {
    const el = msgRefs.current.get(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(targetId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedId(null), 1650);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = draft.trim();
    if (!cleaned) return;
    onSendMessage(cleaned, replyingTo?.id);
    setDraft('');
    setReplyingTo(null);
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault();
      setReplyingTo(null);
    }
  };

  const visibleActiveUsers = [...inChatListeners, ...onScreenListeners];

  return (
    <div className="flex h-full flex-col">
      {/* Live On-Screen Chat Presence Bar */}
      <div
        data-testid="chat-presence-bar"
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 px-3 py-2 text-[11px] dark:border-[#1E2636]"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              inChatListeners.length > 0
                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                : visibleActiveUsers.length > 0
                ? 'bg-emerald-400/70'
                : 'bg-slate-400 dark:bg-slate-600'
            }`}
            aria-hidden="true"
          />
          <span className="truncate font-medium text-slate-700 dark:text-slate-200">
            {inChatListeners.length > 0 ? (
              <>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {inChatListeners.length} in chat
                </span>
                <span className="text-slate-400 dark:text-slate-500"> · </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {inChatListeners
                    .slice(0, 3)
                    .map((u) => u.username)
                    .join(', ')}
                  {inChatListeners.length > 3 ? ` +${inChatListeners.length - 3}` : ''}
                </span>
              </>
            ) : visibleActiveUsers.length > 0 ? (
              <span className="text-slate-600 dark:text-slate-300">
                {visibleActiveUsers.length} on screen
              </span>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">No one active on screen</span>
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
          {onScreenListeners.length > 0 && inChatListeners.length > 0 && (
            <span title="Tab open on screen (Player/Queue)">
              {onScreenListeners.length} on player
            </span>
          )}
          {backgroundListeners.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500"
              title={backgroundListeners.map((u) => `${u.username} (background tab)`).join(', ')}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-600" aria-hidden="true" />
              {backgroundListeners.length} away
            </span>
          )}
          <button
            type="button"
            data-testid="chat-sound-toggle"
            onClick={onToggleSound}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? 'Mute notification sound' : 'Unmute notification sound'}
            title={
              soundEnabled
                ? 'Subtle notification sound on (click to mute)'
                : 'Notification sound muted (click to turn on)'
            }
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              soundEnabled
                ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1E2636] dark:hover:text-slate-100'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-600 dark:hover:bg-[#1E2636] dark:hover:text-slate-300'
            }`}
          >
            {soundEnabled ? (
              <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
            No messages yet. Say hello to the room.
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.username.toLowerCase() === currentUsername.toLowerCase();
            const time = new Date(msg.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            const isHighlighted = highlightedId === msg.id;
            const liveReplyTarget = msg.replyTo ? messagesById.get(msg.replyTo.id) : undefined;
            const replyUsername = liveReplyTarget?.username || msg.replyTo?.username || '';
            const replySnippet = msg.replyTo?.body || '';
            const senderListener =
              (msg.userId !== null ? listenerById.get(msg.userId) : undefined) ||
              listenerByName.get(msg.username.toLowerCase());
            const statusDotClass = !senderListener
              ? null
              : senderListener.inChat
              ? 'bg-emerald-500'
              : senderListener.tabActive
              ? 'bg-emerald-400/70'
              : 'bg-slate-400 dark:bg-slate-600';
            const statusLabel = !senderListener
              ? undefined
              : senderListener.inChat
              ? 'Active in chat (tab open on screen)'
              : senderListener.tabActive
              ? 'Tab open on screen'
              : 'Tab in background';

            return (
              <div
                key={msg.id}
                ref={(node) => {
                  if (node) msgRefs.current.set(msg.id, node);
                  else msgRefs.current.delete(msg.id);
                }}
                className={`group rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-[#1A202E]/60 ${
                  isHighlighted ? 'animate-chat-highlight ring-1 ring-orange-500/40' : ''
                }`}
              >
                {msg.replyTo && (
                  <button
                    type="button"
                    onClick={() => handleJumpToMessage(msg.replyTo!.id)}
                    aria-label={`Jump to message from ${replyUsername}`}
                    className="mb-1 flex w-full items-center gap-1.5 rounded-lg border-l-2 border-orange-500/75 bg-slate-100/80 px-2 py-1 text-left text-[11px] text-slate-600 transition-colors hover:bg-slate-200/70 dark:bg-[#0B0E14]/80 dark:text-slate-400 dark:hover:bg-[#1E2636]"
                  >
                    <CornerDownRight className="h-3 w-3 shrink-0 text-orange-500" aria-hidden="true" />
                    <span className="shrink-0 font-semibold text-slate-800 dark:text-slate-200">
                      {replyUsername}
                    </span>
                    <span className="min-w-0 truncate">{replySnippet}</span>
                  </button>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    {statusDotClass && (
                      <span
                        title={statusLabel}
                        aria-label={statusLabel}
                        className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass}`}
                      />
                    )}
                    <span
                      className={`font-semibold ${
                        isMine
                          ? 'text-orange-600 dark:text-orange-400'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {msg.username}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                      {time}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStartReply(msg)}
                    aria-label={`Reply to ${msg.username}`}
                    title={`Reply to ${msg.username}`}
                    className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-slate-500 opacity-85 transition-opacity hover:bg-slate-200/70 hover:text-slate-900 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:text-slate-400 dark:hover:bg-[#242C3D] dark:hover:text-slate-100"
                  >
                    <Reply className="h-3 w-3" aria-hidden="true" />
                    <span>Reply</span>
                  </button>
                </div>

                <p className="mt-0.5 break-words text-sm leading-snug text-slate-700 dark:text-slate-300">
                  {msg.body}
                </p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Quick Reactions + Expanded Picker */}
      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 dark:border-[#1E2636]">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          React
        </span>
        <ReactionPicker onSendReaction={onSendReaction} align="right" compact />
      </div>

      {/* Active Reply Banner */}
      {replyingTo && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-2 border-t border-orange-500/25 bg-orange-500/10 px-3 py-2 text-xs dark:bg-orange-500/10"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 font-semibold text-orange-700 dark:text-orange-300">
              <Reply className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Replying to {replyingTo.username}</span>
            </div>
            <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">
              {buildReplySnippet(replyingTo.body, 90)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            aria-label="Cancel reply"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1E2636]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Message Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-[#1E2636]"
      >
        <label htmlFor="room-chat-input" className="sr-only">
          Chat message
        </label>
        <input
          ref={inputRef}
          id="room-chat-input"
          type="text"
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={replyingTo ? `Reply to ${replyingTo.username}...` : 'Message the room...'}
          className="h-10 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
        />
        <button
          type="submit"
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white transition-colors hover:bg-orange-500"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
