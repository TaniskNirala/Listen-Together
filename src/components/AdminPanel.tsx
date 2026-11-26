import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Pencil, RefreshCw, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { ChangeUsernameModal } from './ChangeUsernameModal';
import type { AdminUserRecord, AuthUser, GlobalRole } from '../shared/types';

interface AdminPanelProps {
  currentUser: AuthUser;
  onCurrentUserUpdated: (user: AuthUser) => void;
  onJumpToRoom: (code: string) => void;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function AdminPanel({
  currentUser,
  onCurrentUserUpdated,
  onJumpToRoom,
  onNotify,
}: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<GlobalRole>('user');
  const [creating, setCreating] = useState(false);

  // Reset password & rename inline modal state
  const [resetTarget, setResetTarget] = useState<AdminUserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AdminUserRecord | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ users: AdminUserRecord[] }>('/api/admin/users');
      setUsers(data.users);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to load users.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    const timer = window.setInterval(() => void loadUsers(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const data = await apiFetch<{ user: AdminUserRecord }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password, role }),
      });
      setUsers((prev) => [...prev, data.user]);
      setUsername('');
      setPassword('');
      setRole('user');
      onNotify(`Created account for "${data.user.username}".`, 'success');
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to create user.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetting(true);
    try {
      await apiFetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPassword }),
      });
      onNotify(`Password updated for "${resetTarget.username}".`, 'success');
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Password reset failed.', 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleRenameUser = async (nextUsername: string) => {
    if (!renameTarget) return;
    const data = await apiFetch<{ user: AuthUser }>(`/api/admin/users/${renameTarget.id}/username`, {
      method: 'PATCH',
      body: JSON.stringify({ username: nextUsername }),
    });
    setUsers((prev) =>
      prev.map((item) =>
        item.id === renameTarget.id ? { ...item, username: data.user.username } : item
      )
    );
    if (renameTarget.id === currentUser.id) {
      onCurrentUserUpdated(data.user);
    }
    onNotify(`Renamed "${renameTarget.username}" to "${data.user.username}".`, 'success');
  };

  const handleToggleDisable = async (u: AdminUserRecord) => {
    try {
      const nextDisabled = !u.disabled;
      await apiFetch(`/api/admin/users/${u.id}/disable`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: nextDisabled }),
      });
      setUsers((prev) =>
        prev.map((item) =>
          item.id === u.id
            ? {
                ...item,
                disabled: nextDisabled,
                online: nextDisabled ? false : item.online,
                currentRoomCode: nextDisabled ? null : item.currentRoomCode,
                currentRoomName: nextDisabled ? null : item.currentRoomName,
              }
            : item
        )
      );
      onNotify(
        nextDisabled ? `Disabled "${u.username}".` : `Re-enabled "${u.username}".`,
        'info'
      );
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Could not update user.', 'error');
    }
  };

  const handleDeleteUser = async (u: AdminUserRecord) => {
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      setUsers((prev) => prev.filter((item) => item.id !== u.id));
      onNotify(`Deleted user "${u.username}".`, 'info');
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to delete user.', 'error');
    }
  };

  const onlineCount = users.filter((u) => u.online).length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
            Admin Console
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 tabular-nums">
            {users.length} {users.length === 1 ? 'account' : 'accounts'} · {onlineCount} online now
            {' '}· Public signup is disabled
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsers()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#242C3D] dark:bg-[#131822] dark:text-slate-200 dark:hover:bg-[#1A202E]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Create User Form */}
        <section
          aria-labelledby="create-user-heading"
          className="h-fit rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-4 dark:border-[#242C3D] dark:bg-[#131822]"
        >
          <h2
            id="create-user-heading"
            className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Create User Account
          </h2>
          <form onSubmit={handleCreateUser} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="new-user-username"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Username
              </label>
              <input
                id="new-user-username"
                type="text"
                required
                minLength={2}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. maya"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="new-user-password"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Temporary password
              </label>
              <input
                id="new-user-password"
                type="password"
                required
                minLength={6}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="new-user-role"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Account role
              </label>
              <select
                id="new-user-role"
                value={role}
                onChange={(e) => setRole(e.target.value as GlobalRole)}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
              >
                <option value="user">Standard Member</option>
                <option value="admin">Administrator</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {creating ? 'Creating...' : 'Create account'}
            </button>
          </form>
        </section>

        {/* Users & Live Presence Table */}
        <section
          aria-labelledby="users-table-heading"
          className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-8 dark:border-[#242C3D] dark:bg-[#131822]"
        >
          <h2
            id="users-table-heading"
            className="mb-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Accounts & Live Presence
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-[#1E2636] dark:text-slate-400">
                  <th className="pb-3 pr-4">User</th>
                  <th className="pb-3 pr-4">Presence</th>
                  <th className="pb-3 pr-4">Account Status</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#1E2636]">
                {users.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  return (
                    <tr key={u.id} className="align-middle">
                      <td className="py-3.5 pr-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {u.username}
                          {isSelf && (
                            <span className="ml-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                              (you)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {u.role === 'admin' ? 'Administrator' : 'Member'}
                        </div>
                      </td>

                      <td className="py-3.5 pr-4">
                        {u.online ? (
                          <div className="text-xs">
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">
                              Online
                            </span>
                            {u.currentRoomCode ? (
                              <span className="ml-1.5 text-slate-600 dark:text-slate-300">
                                in{' '}
                                <button
                                  type="button"
                                  onClick={() => onJumpToRoom(u.currentRoomCode!)}
                                  className="font-mono underline decoration-slate-400 underline-offset-2 hover:text-orange-500"
                                >
                                  {u.currentRoomName || u.currentRoomCode}
                                </button>
                              </span>
                            ) : (
                              <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                                · Lobby
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Offline</span>
                        )}
                      </td>

                      <td className="py-3.5 pr-4 text-xs">
                        {u.disabled ? (
                          <span className="font-medium text-red-600 dark:text-red-400">
                            Disabled
                          </span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-300">Active</span>
                        )}
                      </td>

                      <td className="py-3.5 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setRenameTarget(u)}
                            aria-label={`Rename ${u.username}`}
                            title="Change username"
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1E2636] dark:hover:text-slate-100"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResetTarget(u);
                              setNewPassword('');
                            }}
                            aria-label={`Reset password for ${u.username}`}
                            title="Reset password"
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1E2636] dark:hover:text-slate-100"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          {!isSelf && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleToggleDisable(u)}
                                aria-label={
                                  u.disabled
                                    ? `Enable ${u.username}`
                                    : `Disable ${u.username}`
                                }
                                title={u.disabled ? 'Enable account' : 'Disable account'}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-amber-600 dark:text-slate-400 dark:hover:bg-[#1E2636] dark:hover:text-amber-400"
                              >
                                {u.disabled ? (
                                  <UserCheck className="h-4 w-4" />
                                ) : (
                                  <UserX className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteUser(u)}
                                aria-label={`Delete ${u.username}`}
                                title="Delete user"
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Password Reset Dialog */}
      {resetTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-pw-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-[#242C3D] dark:bg-[#131822]">
            <h3
              id="reset-pw-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              Reset password for {resetTarget.username}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Active sessions for this account will be signed out immediately.
            </p>
            <form onSubmit={handleResetPassword} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="reset-password-input"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  New password
                </label>
                <input
                  id="reset-password-input"
                  type="password"
                  required
                  minLength={6}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#242C3D] dark:text-slate-300 dark:hover:bg-[#1A202E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="h-10 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                >
                  {resetting ? 'Saving...' : 'Save password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Rename User Dialog */}
      {renameTarget && (
        <ChangeUsernameModal
          title={`Rename ${renameTarget.username}`}
          description="Updates this account's login and display username immediately across active rooms."
          currentUsername={renameTarget.username}
          onSave={handleRenameUser}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </main>
  );
}
