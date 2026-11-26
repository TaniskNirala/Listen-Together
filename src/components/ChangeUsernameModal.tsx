import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, X } from 'lucide-react';
import { validateUsername } from '../shared/validation';

interface ChangeUsernameModalProps {
  title: string;
  description?: string;
  currentUsername: string;
  onSave: (nextUsername: string) => Promise<void>;
  onClose: () => void;
}

export function ChangeUsernameModal({
  title,
  description = 'Use 2–32 characters: letters, numbers, dots, underscores, or hyphens.',
  currentUsername,
  onSave,
  onClose,
}: ChangeUsernameModalProps) {
  const [draft, setDraft] = useState(currentUsername);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const check = validateUsername(draft);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (check.username === currentUsername) {
      onClose();
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave(check.username);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update username.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-username-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-[#242C3D] dark:bg-[#131822]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Pencil className="h-4 w-4 text-orange-500" aria-hidden="true" />
            <h2
              id="change-username-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close username dialog"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#1E2636]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="change-username-input"
              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              New username
            </label>
            <input
              id="change-username-input"
              type="text"
              required
              autoFocus
              minLength={2}
              maxLength={32}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter new username"
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-[#2A3347] dark:bg-[#0B0E14] dark:text-slate-100"
            />
            {error && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-[#242C3D] dark:text-slate-300 dark:hover:bg-[#1A202E]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save username'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
