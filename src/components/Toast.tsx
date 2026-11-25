import { AlertIcon, CheckIcon } from './Icons';

export interface ToastState {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast ${toast.kind}`} role="status" aria-live="polite">
      {toast.kind === 'error' ? <AlertIcon size={15} /> : <CheckIcon size={15} />}
      <span>{toast.text}</span>
    </div>
  );
}
