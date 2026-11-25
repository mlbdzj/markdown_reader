import { useEffect, useRef } from 'react';
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from './Icons';

interface FindBarProps {
  query: string;
  total: number;
  activeIndex: number;
  onChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function FindBar({ query, total, activeIndex, onChange, onPrev, onNext, onClose }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="find-bar"
      role="search"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (event.shiftKey) onPrev();
          else onNext();
        }
      }}
    >
      <SearchIcon size={14} className="find-icon" />
      <input
        id="find-input"
        ref={inputRef}
        type="text"
        className="find-input"
        placeholder="在当前文档中查找"
        value={query}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className={`find-count${hasQuery && total === 0 ? ' is-empty' : ''}`}>
        {hasQuery ? (total > 0 ? `${activeIndex + 1} / ${total}` : '无结果') : ''}
      </span>
      <button
        type="button"
        className="icon-btn sm"
        title="上一个（Shift+Enter）"
        disabled={total === 0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPrev}
      >
        <ChevronUpIcon size={14} />
      </button>
      <button
        type="button"
        className="icon-btn sm"
        title="下一个（Enter）"
        disabled={total === 0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onNext}
      >
        <ChevronDownIcon size={14} />
      </button>
      <button
        type="button"
        className="icon-btn sm"
        title="关闭（Esc）"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
