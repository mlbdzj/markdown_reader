import { useEffect, useRef, useState } from 'react';
import { AlertIcon } from './Icons';

export interface DialogConfig {
  kind: 'prompt' | 'confirm';
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  confirmText?: string;
  danger?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
}

interface DialogProps {
  config: DialogConfig;
  onClose: () => void;
}

export function Dialog({ config, onClose }: DialogProps) {
  const [value, setValue] = useState(config.defaultValue ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (config.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [config.kind]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const submit = async () => {
    if (busy) return;
    if (config.kind === 'prompt' && !value.trim()) {
      setError('名称不能为空');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await config.onSubmit(value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={config.title}>
        <h2 className="dialog-title">{config.title}</h2>
        {config.message && <p className="dialog-message">{config.message}</p>}
        {config.kind === 'prompt' && (
          <label className="dialog-field">
            {config.label && <span>{config.label}</span>}
            <input
              ref={inputRef}
              className="text-input"
              value={value}
              placeholder={config.placeholder}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </label>
        )}
        {config.hint && <p className="dialog-hint">{config.hint}</p>}
        {error && (
          <p className="dialog-error">
            <AlertIcon size={14} /> {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={`btn ${config.danger ? 'danger' : 'primary'}`}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? '处理中…' : (config.confirmText ?? '确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
