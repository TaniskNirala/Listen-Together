import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Lock, Music2, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import type { AuthUser, ControlMode, RoomSummary } from '../shared/types';

interface LobbyViewProps {
  user: AuthUser;
  onEnterRoom: (code: string, password?: string) => void;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function LobbyView({ user, onEnterRoom, onNotify }: LobbyViewProps) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');

  // Create room form state
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [controlMode, setControlMode] = useState<ControlMode>('everyone');
  const [creating, setCreating] = useState(false);

  const loadRooms = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ rooms: RoomSummary[] }>('/api/rooms');
      setRooms(data.rooms);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to load rooms.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRooms();
  }, []);

  const handleCreateRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    setCreating(true);
    try {
      const data = await apiFetch<{ room: { code: string; name: string } }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: roomName.trim(),
          password: roomPassword.trim() || undefined,
          controlMode,
        }),
      });
      setRoomName('');
      setRoomPassword('');
      onNotify(`Created room "${data.room.name}" (${data.room.code}).`, 'success');
      onEnterRoom(data.room.code, roomPassword.trim() || undefined);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to create room.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode
      .trim()
      .replace(/^.*\/room\//i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
    if (!cleaned) {
      onNotify('Enter a room code or paste a room link.', 'warning');
      return;
    }
    onEnterRoom(cleaned, joinPassword.trim() || undefined);
  };

  const handleDeleteRoom = async (room: RoomSummary) => {
    try {
      await apiFetch(`/api/rooms/${encodeURIComponent(room.code)}`, { method: 'DELETE' });
      setRooms((prev) => prev.filter((r) => r.code !== room.code));
      onNotify(`Deleted room "${room.name}".`, 'info');
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Could not delete room.', 'error');
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
            Listening Rooms
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Join an active session by code or create a synchronized room for your group.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRooms()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#242C3D] dark:bg-[#131822] dark:text-slate-200 dark:hover:bg-[#1A202E]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left column: Join by code + Create Room */}
        <div className="space-y-6 lg:col-span-5">
          <section
            aria-labelledby="join-code-heading"
            className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-[#242C3D] dark:bg-[#131822]"
          >
            <h2
              id="join-code-heading"
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Join by code or link
            </h2>
            <form onSubmit={handleJoinByCode} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="join-room-code"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Room code or URL
                </label>
                <input
                  id="join-room-code"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="e.g. K7M9P2 or paste invite link"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="join-room-password"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Password (if required)
                </label>
                <input
                  id="join-room-password"
                  type="password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="Optional room password"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
              </div>

              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:border-[#2A3347] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                Join room
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </section>

          <section
            aria-labelledby="create-room-heading"
            className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-[#242C3D] dark:bg-[#131822]"
          >
            <h2
              id="create-room-heading"
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Create a new room
            </h2>
            <form onSubmit={handleCreateRoom} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="create-room-name"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Room name
                </label>
                <input
                  id="create-room-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={60}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. Friday Vinyl Session"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="create-room-password"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Room password (optional)
                </label>
                <input
                  id="create-room-password"
                  type="password"
                  maxLength={64}
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  placeholder="Leave blank for open invite code"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
              </div>

              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Who controls playback & queue
                </legend>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-[#0B0E14]">
                  <button
                    type="button"
                    onClick={() => setControlMode('everyone')}
                    className={`h-10 rounded-lg text-xs font-medium transition-colors ${
                      controlMode === 'everyone'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    Everyone
                  </button>
                  <button
                    type="button"
                    onClick={() => setControlMode('dj_only')}
                    className={`h-10 rounded-lg text-xs font-medium transition-colors ${
                      controlMode === 'dj_only'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    Host & DJs only
                  </button>
                </div>
              </fieldset>

              <button
                type="submit"
                disabled={creating}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {creating ? 'Creating room...' : 'Create room'}
              </button>
            </form>
          </section>
        </div>

        {/* Right column: Active Rooms Directory */}
        <section
          aria-labelledby="active-rooms-heading"
          className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-7 dark:border-[#242C3D] dark:bg-[#131822]"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2
              id="active-rooms-heading"
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Saved Rooms
            </h2>
            <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
              {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
            </span>
          </div>

          {loading ? (
            <div className="space-y-3" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-[#1A202E]"
                />
              ))}
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-[#1A202E] dark:text-slate-400">
                <Music2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                No rooms created yet
              </p>
              <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
                Create the first listening room on the left to start queueing YouTube or Spotify
                tracks together.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-[#1E2636]">
              {rooms.map((room) => {
                const canDelete =
                  user.role === 'admin' || user.username.toLowerCase() === room.hostUsername.toLowerCase();
                return (
                  <li
                    key={room.code}
                    className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-1 last:pb-1"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                          {room.name}
                        </h3>
                        {room.hasPassword && (
                          <Lock
                            className="h-3.5 w-3.5 shrink-0 text-slate-400"
                            aria-label="Password protected"
                          />
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                          {room.code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Host: {room.hostUsername}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {room.onlineCount} online
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{room.controlMode === 'dj_only' ? 'DJs only' : 'Open controls'}</span>
                      </div>
                      {room.currentTrackTitle && (
                        <p className="mt-1.5 truncate text-xs text-orange-600 dark:text-orange-400">
                          {room.isPlaying ? 'Now playing: ' : 'Paused: '}
                          {room.currentTrackTitle}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteRoom(room)}
                          aria-label={`Delete room ${room.name}`}
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onEnterRoom(room.code)}
                        className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-orange-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-orange-500"
                      >
                        Enter
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
