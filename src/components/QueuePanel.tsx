import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  History,
  ListMusic,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { formatDuration } from '../shared/sync';
import type { AutoplayConfig, HistoryItem, Track } from '../shared/types';

interface QueuePanelProps {
  queue: Track[];
  history: HistoryItem[];
  autoplay: AutoplayConfig;
  autoplayLoading: boolean;
  canControl: boolean;
  onOpenAddModal: () => void;
  onToggleAutoplay: () => void;
  onOpenAutoplaySettings: () => void;
  onPlayNow: (trackId: string) => void;
  onRemove: (trackId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function QueuePanel({
  queue,
  history,
  autoplay,
  autoplayLoading,
  canControl,
  onOpenAddModal,
  onToggleAutoplay,
  onOpenAutoplaySettings,
  onPlayNow,
  onRemove,
  onReorder,
}: QueuePanelProps) {
  const [subTab, setSubTab] = useState<'upnext' | 'history'>('upnext');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Sub-header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-[#1E2636]">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-[#0B0E14]">
          <button
            type="button"
            onClick={() => setSubTab('upnext')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
              subTab === 'upnext'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <ListMusic className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Up Next</span>
            <span className="font-mono text-[11px] tabular-nums opacity-75">{queue.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
              subTab === 'history'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            <span>History</span>
          </button>
        </div>

        {canControl && queue.length > 0 && (
          <button
            type="button"
            onClick={onOpenAddModal}
            className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#242C3D] dark:bg-[#1A202E] dark:text-slate-200 dark:hover:bg-[#242C3D]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </button>
        )}
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {subTab === 'upnext' ? (
          queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Queue is empty
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {autoplay.enabled
                  ? autoplayLoading
                    ? 'Autoplay is finding a matching song from your history...'
                    : `Autoplay (${autoplay.mode === 'similar' ? 'Similar vibe' : autoplay.mode === 'discovery' ? 'Explore new' : 'History favorites'}${autoplay.moodHint ? ` · ${autoplay.moodHint}` : ''}) will play next automatically.`
                  : canControl
                  ? 'Add a YouTube link, Spotify URL, or turn on Autoplay.'
                  : 'Waiting for a DJ or host to queue the next track.'}
              </p>
              {canControl && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenAddModal}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#2A3347] dark:bg-[#1A202E] dark:text-slate-100 dark:hover:bg-[#242C3D]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add track
                  </button>
                  {autoplay.enabled ? (
                    <button
                      type="button"
                      onClick={onOpenAutoplaySettings}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3.5 text-xs font-semibold text-orange-600 hover:bg-orange-500/15 dark:text-orange-400"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      Customize Autoplay
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onToggleAutoplay}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-[#242C3D] dark:bg-[#131822] dark:text-slate-300 dark:hover:bg-[#1A202E]"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
                      Enable Autoplay
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {queue.map((track, idx) => {
                const isOver = dragOverIndex === idx && dragIndex !== idx;
                return (
                  <li
                    key={track.id}
                    draggable={canControl}
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      if (!canControl) return;
                      e.preventDefault();
                      setDragOverIndex(idx);
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex === idx) setDragOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (canControl && dragIndex !== null && dragIndex !== idx) {
                        onReorder(dragIndex, idx);
                      }
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors ${
                      isOver
                        ? 'bg-orange-500/10 ring-1 ring-orange-500/50'
                        : 'hover:bg-slate-100/80 dark:hover:bg-[#1A202E]'
                    }`}
                  >
                    {canControl && (
                      <span
                        className="hidden cursor-grab text-slate-400 sm:inline-flex"
                        aria-hidden="true"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                    )}

                    <img
                      src={track.thumbnailUrl}
                      alt={track.title}
                      referrerPolicy="no-referrer"
                      className="h-10 w-14 shrink-0 rounded-lg bg-slate-200 object-cover dark:bg-[#1A202E]"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {track.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="max-w-[120px] truncate">{track.artist}</span>
                        {track.durationSec > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatDuration(track.durationSec)}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="truncate">Added by {track.addedByUsername}</span>
                        {track.source === 'spotify' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Playing via YouTube
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {canControl && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => onPlayNow(track.id)}
                          aria-label={`Play ${track.title} now`}
                          title="Play now"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-orange-600 dark:text-slate-400 dark:hover:bg-[#242C3D] dark:hover:text-orange-400"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => onReorder(idx, idx - 1)}
                            aria-label={`Move ${track.title} up`}
                            title="Move up"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#242C3D] dark:hover:text-slate-100"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {idx < queue.length - 1 && (
                          <button
                            type="button"
                            onClick={() => onReorder(idx, idx + 1)}
                            aria-label={`Move ${track.title} down`}
                            title="Move down"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#242C3D] dark:hover:text-slate-100"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemove(track.id)}
                          aria-label={`Remove ${track.title} from queue`}
                          title="Remove"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
            Played tracks will appear here.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200/70 dark:divide-[#1E2636]">
            {history.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-2 py-2.5">
                <img
                  src={item.track.thumbnailUrl}
                  alt={item.track.title}
                  referrerPolicy="no-referrer"
                  className="h-9 w-12 shrink-0 rounded-md bg-slate-200 object-cover opacity-80 dark:bg-[#1A202E]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800 dark:text-slate-200">
                    {item.track.title}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {item.track.artist} · Queued by {item.addedByUsername}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
