import { useState, type FormEvent } from 'react';
import { Lock, Radio, ShieldCheck } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import type { AuthUser } from '../shared/types';

interface AuthViewProps {
  needsAdminSetup: boolean;
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthView({ needsAdminSetup, onAuthenticated }: AuthViewProps) {
  const [username, setUsername] = useState(needsAdminSetup ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (needsAdminSetup) {
      if (password.length < 8) {
        setError('Admin password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = needsAdminSetup ? '/api/auth/setup-admin' : '/api/auth/login';
      const resp = await apiFetch<{ user: AuthUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      onAuthenticated(resp.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
      <div className="grid w-full max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Left editorial column */}
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-orange-600 dark:text-orange-400">
            <Radio className="h-4 w-4" aria-hidden="true" />
            <span>Private Listen-Together Rooms</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance sm:text-4xl dark:text-slate-100">
            Listen to the exact same beat, in sync with your group.
          </h1>
          <p className="max-w-md text-base leading-relaxed text-slate-600 dark:text-slate-400">
            Queue YouTube videos, YouTube Music playlists, or Spotify links matched automatically
            to YouTube. Server-authoritative sync keeps every listener locked within milliseconds.
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Invite-only accounts</span>
            <span aria-hidden="true">·</span>
            <span>Persistent queues</span>
            <span aria-hidden="true">·</span>
            <span>No Spotify Premium required</span>
          </div>
        </div>

        {/* Right sign-in / first-run setup panel */}
        <section
          aria-labelledby="auth-heading"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-[#242C3D] dark:bg-[#131822]"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
              {needsAdminSetup ? (
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Lock className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2
                id="auth-heading"
                className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100"
              >
                {needsAdminSetup ? 'Create Administrator Account' : 'Sign in to PulseRoom'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {needsAdminSetup
                  ? 'First-run setup: claim the initial admin account.'
                  : 'Accounts are created by your room administrator.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="auth-username"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Username
              </label>
              <input
                id="auth-username"
                name="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alex"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={needsAdminSetup ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={needsAdminSetup ? 'At least 8 characters' : 'Enter your password'}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            {needsAdminSetup && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm password
                </label>
                <input
                  id="auth-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? needsAdminSetup
                  ? 'Creating admin...'
                  : 'Signing in...'
                : needsAdminSetup
                ? 'Initialize Admin Account'
                : 'Sign in'}
            </button>
          </form>

          {!needsAdminSetup && (
            <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
              Need access? Ask your administrator to create an account for you.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
