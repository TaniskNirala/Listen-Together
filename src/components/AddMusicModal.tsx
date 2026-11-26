import { useState, type FormEvent } from 'react';
import { Link2, ListMusic, Loader2, Plus, Search, X } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { formatDuration } from '../shared/sync';
import type { PlaylistImportProgress } from '../shared/types';

interface SearchResultItem {
  youtubeId: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnailUrl: string;
  sourceUrl: string;
}

interface AddMusicModalProps {
  roomCode: string;
  importProgress: PlaylistImportProgress | null;
  onClose: () => void;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

type ModalTab = 'link' | 'search' | 'batch';

export function AddMusicModal({
  roomCode,
  importProgress,
  onClose,
  onNotify,
}: AddMusicModalProps) {
  const [tab, setTab] = useState<ModalTab>('link');
  const [linkInput, setLinkInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [batchLines, setBatchLines] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null);

  const handleLinkSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!linkInput.trim()) return;
    setError(null);
    setSubmitting(true);

    try {
      const data = await apiFetch<{
        addedCount: number;
        playlistTitle?: string;
        truncated?: boolean;
        failedCount?: number;
        maxPlaylistImport?: number;
      }>(`/api/rooms/${encodeURIComponent(roomCode)}/tracks`, {
        method: 'POST',
        body: JSON.stringify({
          input: linkInput.trim(),
          importId: crypto.randomUUID(),
        }),
      });

      let msg =
        data.addedCount === 1
          ? 'Added track to queue.'
          : `Added ${data.addedCount} tracks${data.playlistTitle ? ` from "${data.playlistTitle}"` : ''}.`;
      if (data.truncated && data.maxPlaylistImport) {
        msg += ` (Capped at ${data.maxPlaylistImport} tracks.)`;
      }
      if (data.failedCount && data.failedCount > 0) {
        msg += ` ${data.failedCount} could not be matched.`;
      }

      onNotify(msg, 'success');
      setLinkInput('');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.data?.fallbackPasteSupported) {
          setTab('batch');
        }
      } else {
        setError('Could not add this link. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setError(null);
    setSearching(true);
    try {
      const data = await apiFetch<{ results: SearchResultItem[] }>(
        `/api/music/search?q=${encodeURIComponent(searchQuery.trim())}&limit=8`
      );
      setSearchResults(data.results);
      if (data.results.length === 0) {
        setError('No YouTube results found. Try a different search or paste a direct link.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleAddSearchResult = async (item: SearchResultItem) => {
    setAddingVideoId(item.youtubeId);
    setError(null);
    try {
      await apiFetch(`/api/rooms/${encodeURIComponent(roomCode)}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ input: item.sourceUrl }),
      });
      onNotify(`Queued "${item.title}".`, 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add track.');
    } finally {
      setAddingVideoId(null);
    }
  };

  const handleBatchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!batchLines.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<{ addedCount: number; failedCount: number }>(
        `/api/rooms/${encodeURIComponent(roomCode)}/batch-tracks`,
        {
          method: 'POST',
          body: JSON.stringify({
            lines: batchLines,
            importId: crypto.randomUUID(),
          }),
        }
      );
      onNotify(
        `Matched and queued ${data.addedCount} track${data.addedCount === 1 ? '' : 's'}${
          data.failedCount ? ` (${data.failedCount} unmatched)` : ''
        }.`,
        'success'
      );
      setBatchLines('');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not match tracks.');
    } finally {
      setSubmitting(false);
    }
  };

  const showProgress =
    submitting &&
    importProgress &&
    importProgress.roomCode === roomCode &&
    (importProgress.stage === 'fetching' || importProgress.stage === 'matching');

  const progressPct =
    showProgress && importProgress.total > 0
      ? Math.min(100, Math.round((importProgress.processed / importProgress.total) * 100))
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-music-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-[#242C3D] dark:bg-[#131822]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#1E2636]">
          <h2
            id="add-music-title"
            className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            Add Music to Queue
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close add music dialog"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1E2636] dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-[#0B0E14]">
            <button
              type="button"
              onClick={() => {
                setTab('link');
                setError(null);
              }}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === 'link'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Paste Link
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('search');
                setError(null);
              }}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === 'search'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('batch');
                setError(null);
              }}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === 'batch'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <ListMusic className="h-3.5 w-3.5" aria-hidden="true" />
              Track List
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {error}
            </div>
          )}

          {showProgress && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-[#242C3D] dark:bg-[#0B0E14]">
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                <span>{importProgress.message}</span>
                {importProgress.total > 0 && (
                  <span className="font-mono tabular-nums">
                    {importProgress.processed}/{importProgress.total}
                  </span>
                )}
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-[#1E2636]">
                <div
                  className="h-full rounded-full bg-orange-500 transition-all duration-200"
                  style={{ width: `${importProgress.total > 0 ? progressPct : 25}%` }}
                />
              </div>
            </div>
          )}

          {tab === 'link' && (
            <form onSubmit={handleLinkSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="music-link-input"
                  className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  YouTube, YouTube Music, or Spotify URL
                </label>
                <input
                  id="music-link-input"
                  type="text"
                  required
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or https://open.spotify.com/track/..."
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Supports YouTube videos & playlists, music.youtube.com, and Spotify tracks,
                  albums, or playlists (matched automatically to YouTube, capped at 100 tracks).
                </p>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Resolving tracks...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add to queue
                  </>
                )}
              </button>
            </form>
          )}

          {tab === 'search' && (
            <div className="space-y-4">
              <form onSubmit={handleSearch} className="flex gap-2">
                <label htmlFor="yt-search-input" className="sr-only">
                  Search YouTube
                </label>
                <input
                  id="yt-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search artist or song title..."
                  className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                >
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                </button>
              </form>

              {searchResults.length > 0 && (
                <ul className="divide-y divide-slate-200 dark:divide-[#1E2636]">
                  {searchResults.map((item) => (
                    <li key={item.youtubeId} className="flex items-center gap-3 py-2.5">
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="h-11 w-16 shrink-0 rounded-lg bg-slate-200 object-cover dark:bg-[#1A202E]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {item.title}
                        </p>
                        <p className="truncate text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          {item.artist}
                          {item.durationSec > 0 ? ` · ${formatDuration(item.durationSec)}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={addingVideoId === item.youtubeId}
                        onClick={() => void handleAddSearchResult(item)}
                        aria-label={`Add ${item.title} to queue`}
                        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#242C3D] dark:bg-[#1A202E] dark:text-slate-100 dark:hover:bg-[#242C3D]"
                      >
                        {addingVideoId === item.youtubeId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'batch' && (
            <form onSubmit={handleBatchSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="batch-lines-input"
                  className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Song names (one per line, up to 100)
                </label>
                <textarea
                  id="batch-lines-input"
                  rows={6}
                  required
                  value={batchLines}
                  onChange={(e) => setBatchLines(e.target.value)}
                  placeholder={'Daft Punk - Instant Crush\nKhruangbin - Time (You and I)\nParcels - Tieduprightnow'}
                  className="w-full rounded-xl border border-slate-300 bg-white p-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Great fallback if a Spotify playlist is private or blocked — each line is matched
                  to YouTube automatically.
                </p>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Matching songs on YouTube...
                  </>
                ) : (
                  'Match & add tracks'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
