import { Loader2, RefreshCw } from 'lucide-react';

interface ReconnectingOverlayProps {
  visible: boolean;
  attempt: number;
  nextRetryInSec: number;
  onRetryNow: () => void;
}

export function ReconnectingOverlay({
  visible,
  attempt,
  nextRetryInSec,
  onRetryNow,
}: ReconnectingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="reconnecting-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-[#242C3D] dark:bg-[#131822]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
        <h2
          id="reconnecting-title"
          className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Server waking up, reconnecting...
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Free-tier hosts sleep after inactivity. Your room, queue, and playback position are
          saved and will resync automatically.
        </p>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          <span>Attempt {Math.max(1, attempt)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {nextRetryInSec > 0 ? `Next retry in ${nextRetryInSec}s` : 'Connecting now...'}
          </span>
        </div>

        <button
          type="button"
          onClick={onRetryNow}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-medium text-white transition-colors hover:bg-orange-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry now
        </button>
      </div>
    </div>
  );
}
