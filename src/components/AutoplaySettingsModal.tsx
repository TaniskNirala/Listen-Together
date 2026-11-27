import { useState, type FormEvent } from 'react';
import { Ban, RotateCcw, Sparkles, ThumbsDown, X } from 'lucide-react';
import type { AutoplayConfig, AutoplayMode } from '../shared/types';
import { normalizeArtistKey } from '../shared/autoplay';

interface AutoplaySettingsModalProps {
  config: AutoplayConfig;
  historyCount: number;
  canControl: boolean;
  onSave: (patch: Partial<AutoplayConfig>) => void;
  onClose: () => void;
}

const MODE_OPTIONS: Array<{
  id: AutoplayMode;
  label: string;
  description: string;
}> = [
  {
    id: 'similar',
    label: 'Similar vibe',
    description: 'Blends your room history with closely related tracks.',
  },
  {
    id: 'discovery',
    label: 'Explore new',
    description: 'Prioritizes fresh artists inspired by what you played.',
  },
  {
    id: 'familiar',
    label: 'History favorites',
    description: 'Stays close to the room’s most-played artists.',
  },
];

const MOOD_PRESETS = ['Chill', 'Upbeat', 'Late night', 'Acoustic', 'Electronic', 'Indie'];

const DURATION_OPTIONS = [
  { label: 'Up to 6m', sec: 360 },
  { label: 'Up to 10m', sec: 600 },
  { label: 'Up to 20m', sec: 1200 },
];

export function AutoplaySettingsModal({
  config,
  historyCount,
  canControl,
  onSave,
  onClose,
}: AutoplaySettingsModalProps) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [mode, setMode] = useState<AutoplayMode>(config.mode);
  const [moodHint, setMoodHint] = useState(config.moodHint);
  const [allowRepeats, setAllowRepeats] = useState(config.allowRepeats);
  const [maxDurationSec, setMaxDurationSec] = useState(config.maxDurationSec);
  const [blockedArtists, setBlockedArtists] = useState<string[]>(config.blockedArtists);
  const [dislikedTracks, setDislikedTracks] = useState(config.dislikedTracks);
  const [artistInput, setArtistInput] = useState('');

  const handleAddBlockedArtist = () => {
    const cleaned = artistInput.trim();
    const key = normalizeArtistKey(cleaned);
    if (!cleaned || !key) return;
    if (!blockedArtists.some((a) => normalizeArtistKey(a) === key)) {
      setBlockedArtists((prev) => [cleaned, ...prev].slice(0, 50));
    }
    setArtistInput('');
  };

  const handleRemoveBlockedArtist = (artist: string) => {
    const key = normalizeArtistKey(artist);
    setBlockedArtists((prev) => prev.filter((a) => normalizeArtistKey(a) !== key));
  };

  const handleUndoDislike = (youtubeId: string) => {
    setDislikedTracks((prev) => prev.filter((d) => d.youtubeId !== youtubeId));
  };

  const handleResetFeedback = () => {
    setBlockedArtists([]);
    setDislikedTracks([]);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canControl) {
      onClose();
      return;
    }
    onSave({
      enabled,
      mode,
      moodHint: moodHint.trim(),
      allowRepeats,
      maxDurationSec,
      blockedArtists,
      dislikedTracks,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="autoplay-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#242C3D] dark:bg-[#131822]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#1E2636]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="autoplay-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Customize Autoplay
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {historyCount > 0
                  ? `Learning from ${historyCount} track${historyCount === 1 ? '' : 's'} in room history`
                  : 'Plays automatically when the queue finishes'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Autoplay settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1E2636] dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* Master Toggle */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 dark:border-[#1E2636] dark:bg-[#0B0E14]/60">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Autoplay when queue ends
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Automatically picks and plays matching music from your history.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="autoplay-modal-enabled"
                aria-checked={enabled}
                disabled={!canControl}
                onClick={() => setEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? 'bg-orange-600' : 'bg-slate-300 dark:bg-[#2A3347]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Recommendation Mode */}
            <fieldset disabled={!canControl} className="space-y-2">
              <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Recommendation style
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MODE_OPTIONS.map((opt) => {
                  const active = mode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`autoplay-mode-${opt.id}`}
                      onClick={() => setMode(opt.id)}
                      className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                        active
                          ? 'border-orange-500 bg-orange-500/10 text-slate-900 dark:text-slate-100'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-[#242C3D] dark:bg-[#0B0E14]/50 dark:text-slate-300 dark:hover:bg-[#1A202E]'
                      }`}
                    >
                      <span className="text-xs font-semibold">{opt.label}</span>
                      <span className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        {opt.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Optional Mood / Genre Steering */}
            <div className="space-y-2">
              <label
                htmlFor="autoplay-mood-hint"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Mood or genre focus (optional)
              </label>
              <input
                id="autoplay-mood-hint"
                type="text"
                maxLength={80}
                disabled={!canControl}
                value={moodHint}
                onChange={(e) => setMoodHint(e.target.value)}
                placeholder="e.g. lofi chill, 90s hip hop, synthwave, acoustic"
                className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
              />
              <div className="flex flex-wrap gap-1.5">
                {MOOD_PRESETS.map((preset) => {
                  const selected = moodHint.trim().toLowerCase() === preset.toLowerCase();
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={!canControl}
                      onClick={() => setMoodHint(selected ? '' : preset.toLowerCase())}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selected
                          ? 'border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-[#242C3D] dark:bg-[#1A202E] dark:text-slate-300 dark:hover:bg-[#242C3D]'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track Length & Repeats */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Max track length
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-[#0B0E14]">
                  {DURATION_OPTIONS.map((opt) => {
                    const active = maxDurationSec === opt.sec;
                    return (
                      <button
                        key={opt.sec}
                        type="button"
                        disabled={!canControl}
                        onClick={() => setMaxDurationSec(opt.sec)}
                        className={`h-8 rounded-lg text-[11px] font-medium transition-colors ${
                          active
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-[#1E2636]">
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Allow older repeats
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Revisit past favorites
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowRepeats}
                  disabled={!canControl}
                  onClick={() => setAllowRepeats((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    allowRepeats ? 'bg-orange-600' : 'bg-slate-300 dark:bg-[#2A3347]'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      allowRepeats ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Blocked Artists & Disliked Tracks Feedback */}
            <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-[#1E2636]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Adaptive feedback
                </span>
                {(blockedArtists.length > 0 || dislikedTracks.length > 0) && canControl && (
                  <button
                    type="button"
                    onClick={handleResetFeedback}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-orange-600 dark:text-slate-400 dark:hover:text-orange-400"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Reset all
                  </button>
                )}
              </div>

              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Marking an autoplayed track as <strong className="font-medium text-slate-700 dark:text-slate-300">Not interested</strong> skips it right away and steers Autoplay away from similar songs. Disliking the same artist twice automatically blocks them.
              </p>

              {/* Avoid Artist Input */}
              {canControl && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={artistInput}
                    maxLength={80}
                    onChange={(e) => setArtistInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddBlockedArtist();
                      }
                    }}
                    placeholder="Avoid an artist (e.g. Artist Name)"
                    className="h-9 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddBlockedArtist}
                    className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-[#242C3D] dark:bg-[#1A202E] dark:text-slate-200 dark:hover:bg-[#242C3D]"
                  >
                    Block
                  </button>
                </div>
              )}

              {/* Blocked Artists List */}
              {blockedArtists.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <Ban className="h-3 w-3" aria-hidden="true" />
                    Blocked artists ({blockedArtists.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {blockedArtists.map((artist) => (
                      <span
                        key={artist}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300"
                      >
                        {artist}
                        {canControl && (
                          <button
                            type="button"
                            onClick={() => handleRemoveBlockedArtist(artist)}
                            aria-label={`Unblock ${artist}`}
                            className="ml-0.5 rounded hover:text-rose-900 dark:hover:text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Disliked Songs List */}
              {dislikedTracks.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                    Not interested tracks ({dislikedTracks.length})
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-2 dark:border-[#1E2636] dark:bg-[#0B0E14]/50">
                    {dislikedTracks.map((item) => (
                      <li
                        key={item.youtubeId}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-700 dark:text-slate-200">
                            {item.title}
                          </p>
                          <p className="truncate text-slate-500 dark:text-slate-400">
                            {item.artist}
                          </p>
                        </div>
                        {canControl && (
                          <button
                            type="button"
                            onClick={() => handleUndoDislike(item.youtubeId)}
                            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1E2636] dark:hover:text-slate-100"
                          >
                            Undo
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-[#1E2636]">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#242C3D] dark:text-slate-300 dark:hover:bg-[#1A202E]"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="autoplay-save-btn"
              className="h-10 rounded-xl bg-orange-600 px-4 text-xs font-semibold text-white hover:bg-orange-500"
            >
              Save settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
