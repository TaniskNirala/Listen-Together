import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import type { ChatMessage } from '../shared/types';

const REACTION_EMOJIS = ['🔥', '❤️', '👏', '🎵', '🙌', '😮'];

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUsername: string;
  onSendMessage: (body: string) => void;
  onSendReaction: (emoji: string) => void;
}

export function ChatPanel({
  messages,
  currentUsername,
  onSendMessage,
  onSendReaction,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = draft.trim();
    if (!cleaned) return;
    onSendMessage(cleaned);
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
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
            return (
              <div key={msg.id} className="space-y-0.5">
                <div className="flex items-baseline gap-2 text-xs">
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
                <p className="break-words text-sm leading-snug text-slate-700 dark:text-slate-300">
                  {msg.body}
                </p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Quick Reactions */}
      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 dark:border-[#1E2636]">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          React
        </span>
        <div className="flex items-center gap-1">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSendReaction(emoji)}
              aria-label={`Send ${emoji} reaction`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-base transition-transform hover:bg-slate-100 active:scale-110 dark:hover:bg-[#1A202E]"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Message Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-[#1E2636]"
      >
        <label htmlFor="room-chat-input" className="sr-only">
          Chat message
        </label>
        <input
          id="room-chat-input"
          type="text"
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the room..."
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
