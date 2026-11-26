import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-20 right-4 z-50 flex max-w-sm flex-col gap-2 lg:bottom-5"
    >
      {toasts.map((toast) => {
        const icon =
          toast.tone === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
          ) : toast.tone === 'warning' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          ) : toast.tone === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
          ) : (
            <Info className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
          );

        return (
          <div
            key={toast.id}
            role="status"
            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg dark:border-[#242C3D] dark:bg-[#131822] dark:text-slate-100"
          >
            <span className="mt-0.5">{icon}</span>
            <p className="flex-1 leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#1E2636] dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
