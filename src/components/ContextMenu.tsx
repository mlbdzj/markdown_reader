import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ContextMenuAction {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuAction[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // 菜单渲染后再测量尺寸，避免超出窗口边缘。
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (buttons.length === 0) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };

    const close = () => onClose();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div ref={menuRef} className="context-menu" style={position} role="menu" aria-label="工作区菜单">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`}>
            {item.separatorBefore && <div className="context-separator" role="separator" />}
            <button
              type="button"
              role="menuitem"
              className={`context-item ${item.danger ? 'danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onClose();
                item.onSelect();
              }}
            >
              <span className="context-icon">{item.icon}</span>
              <span className="context-label">{item.label}</span>
              {item.shortcut && <span className="context-shortcut">{item.shortcut}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
