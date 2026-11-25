import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { ChangeEvent, KeyboardEvent, UIEvent } from 'react';

export interface EditorHandle {
  setScrollRatio: (ratio: number) => void;
  scrollToTop: () => void;
  selectRange: (start: number, end: number) => void;
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onScrollRatio: (ratio: number) => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { value, onChange, onScrollRatio },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const skipScroll = useRef(false);

  const lineNumbers = useMemo(() => {
    const count = value.split('\n').length;
    const parts: string[] = [];
    for (let i = 1; i <= count; i++) parts.push(String(i));
    return parts.join('\n');
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      setScrollRatio(ratio: number) {
        const el = textareaRef.current;
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        skipScroll.current = true;
        el.scrollTop = Math.max(0, max) * ratio;
        window.setTimeout(() => {
          skipScroll.current = false;
        }, 120);
      },
      scrollToTop() {
        const el = textareaRef.current;
        if (el) el.scrollTop = 0;
      },
      selectRange(start: number, end: number) {
        const el = textareaRef.current;
        if (!el) return;
        const style = window.getComputedStyle(el);
        const fontSize = Number.parseFloat(style.fontSize) || 13;
        const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.7;
        const paddingTop = Number.parseFloat(style.paddingTop) || 0;
        const line = el.value.slice(0, start).split('\n').length - 1;
        el.setSelectionRange(start, end);
        el.scrollTop = Math.max(0, paddingTop + line * lineHeight - el.clientHeight / 2);
      },
    }),
    [],
  );

  function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop;
    if (skipScroll.current) return;
    const max = el.scrollHeight - el.clientHeight;
    onScrollRatio(max > 0 ? el.scrollTop / max : 0);
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.currentTarget.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const el = event.currentTarget;
      el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
      onChange(el.value);
    }
  }

  return (
    <div className="editor">
      <pre ref={gutterRef} className="line-numbers" aria-hidden="true">
        {lineNumbers}
      </pre>
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={value}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="开始输入内容…"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
      />
    </div>
  );
});
