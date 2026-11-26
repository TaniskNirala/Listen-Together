import { LogOut, Moon, Sun } from 'lucide-react';
import type { AuthUser } from '../shared/types';
import type { Theme } from '../hooks/useTheme';

export type AppView = 'lobby' | 'room' | 'admin';

interface TopBarProps {
  user: AuthUser | null;
  activeView: AppView;
  activeRoomCode: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onNavigate: (view: AppView) => void;
  onSignOut: () => void;
}

export function TopBar({
  user,
  activeView,
  activeRoomCode,
  theme,
  onToggleTheme,
  onNavigate,
  onSignOut,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-[#1E2636] dark:bg-[#0B0E14]/90">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:gap-8 sm:px-6">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('lobby')}
          className="font-display shrink-0 whitespace-nowrap text-base font-bold tracking-tight text-slate-900 transition-colors hover:text-orange-600 sm:text-lg dark:text-slate-100 dark:hover:text-orange-400"
        >
          PulseRoom
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        {user ? (
          <nav aria-label="Main navigation" className="flex items-center gap-3 text-xs font-medium sm:gap-6 sm:text-sm">
            <button
              type="button"
              onClick={() => onNavigate('lobby')}
              className={`shrink-0 whitespace-nowrap py-1 transition-colors ${
                activeView === 'lobby'
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Rooms
            </button>
            {activeRoomCode && (
              <button
                type="button"
                onClick={() => onNavigate('room')}
                className={`shrink-0 whitespace-nowrap py-1 transition-colors ${
                  activeView === 'room'
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Live Room
              </button>
            )}
            {user.role === 'admin' && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className={`shrink-0 whitespace-nowrap py-1 transition-colors ${
                  activeView === 'admin'
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Admin
              </button>
            )}
          </nav>
        ) : (
          <div />
        )}

        {/* Zone 3: Theme switch + account action */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1A202E] dark:hover:text-slate-100"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {user && (
            <button
              type="button"
              onClick={onSignOut}
              aria-label={`Sign out ${user.username}`}
              className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#242C3D] dark:bg-[#131822] dark:text-slate-200 dark:hover:bg-[#1A202E]"
            >
              <span className="hidden max-w-[110px] truncate sm:inline">{user.username}</span>
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
