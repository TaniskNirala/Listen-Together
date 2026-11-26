import { useEffect, useRef, useState } from 'react';
import { SmilePlus, X } from 'lucide-react';
import { QUICK_REACTION_EMOJIS, REACTION_GROUPS } from '../shared/validation';

interface ReactionPickerProps {
  onSendReaction: (emoji: string) => void;
  align?: 'left' | 'right';
  compact?: boolean;
}

export function ReactionPicker({
  onSendReaction,
  align = 'left',
  compact = false,
}: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const [lastPopped, setLastPopped] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
    };
  }, []);

  const triggerReaction = (emoji: string) => {
    onSendReaction(emoji);
    setLastPopped(emoji);
    if (popTimerRef.current) window.clearTimeout(popTimerRef.current);
    popTimerRef.current = window.setTimeout(() => setLastPopped(null), 220);
  };

  const buttonSize = compact ? 'h-8 w-8 text-base' : 'h-8 w-8 text-base';

  return (
    <div ref={rootRef} className="relative flex items-center gap-0.5 sm:gap-1" role="group" aria-label="Quick reactions">
      {QUICK_REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => triggerReaction(emoji)}
          aria-label={`React with ${emoji}`}
          className={`flex ${buttonSize} items-center justify-center rounded-lg transition-transform hover:bg-slate-100 active:scale-125 dark:hover:bg-[#1A202E] ${
            lastPopped === emoji ? 'scale-125 bg-orange-500/15' : ''
          }`}
        >
          {emoji}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? 'Close more reactions' : 'More reactions'}
        aria-expanded={open}
        title="More reactions"
        className={`flex ${buttonSize} items-center justify-center rounded-lg transition-colors ${
          open
            ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1A202E] dark:hover:text-slate-100'
        }`}
      >
        <SmilePlus className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="All reactions"
          className={`absolute bottom-full z-40 mb-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-[#2A3347] dark:bg-[#131822] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Reactions
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close reactions tray"
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#1E2636] dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2.5">
            {REACTION_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.label}
                </p>
                <div className="grid grid-cols-6 gap-1">
                  {group.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => triggerReaction(emoji)}
                      aria-label={`React with ${emoji}`}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-transform hover:scale-110 hover:bg-slate-100 active:scale-125 dark:hover:bg-[#1E2636] ${
                        lastPopped === emoji ? 'scale-125 bg-orange-500/20' : ''
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
