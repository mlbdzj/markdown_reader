import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, UIEvent as ReactUIEvent } from 'react';
import { isMarkdownHref, renderMarkdown } from '../lib/markdown';
import { renderTextPreview } from '../lib/plainText';
import { resolveRelative } from '../lib/text';

export interface PreviewHandle {
  setScrollRatio: (ratio: number) => void;
  scrollToTop: () => void;
  scrollToAnchor: (id: string) => void;
}

interface PreviewProps {
  content: string;
  basePath: string | null;
  kind: 'markdown' | 'text';
  findQuery: string;
  findIndex: number;
  onFindCount: (count: number) => void;
  onOpenFile: (path: string, anchor?: string) => void;
  onScrollRatio: (ratio: number) => void;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 退化方案：兼容不支持 Clipboard API 的环境
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function clearFindMarks(root: HTMLElement) {
  root.querySelectorAll('mark.find-mark').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  });
}

function markFindMatches(root: HTMLElement, query: string): HTMLElement[] {
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!node.nodeValue || !parent) continue;
    if (parent.closest('button, script, style, noscript')) continue;
    textNodes.push(node);
  }

  const marks: HTMLElement[] = [];
  for (const node of textNodes) {
    const value = node.nodeValue ?? '';
    const lower = value.toLowerCase();
    let index = lower.indexOf(needle);
    if (index === -1) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    while (index !== -1) {
      if (index > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, index)));
      const mark = document.createElement('mark');
      mark.className = 'find-mark';
      mark.textContent = value.slice(index, index + needle.length);
      fragment.appendChild(mark);
      marks.push(mark);
      cursor = index + needle.length;
      index = lower.indexOf(needle, cursor);
    }
    if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }
  return marks;
}

export const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
  { content, basePath, kind, findQuery, findIndex, onFindCount, onOpenFile, onScrollRatio },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const skipScroll = useRef(false);
  const suppressSync = useRef(false);

  const html = useMemo(
    () => (kind === 'text' ? renderTextPreview(content, basePath ?? '') : renderMarkdown(content, basePath ?? undefined)),
    [content, basePath, kind],
  );

  useImperativeHandle(
    ref,
    () => ({
      setScrollRatio(ratio: number) {
        const el = scrollRef.current;
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        skipScroll.current = true;
        el.scrollTop = Math.max(0, max) * ratio;
        window.setTimeout(() => {
          skipScroll.current = false;
        }, 120);
      },
      scrollToTop() {
        const el = scrollRef.current;
        if (el) el.scrollTop = 0;
      },
      scrollToAnchor(id: string) {
        const root = bodyRef.current;
        if (!root) return;
        const target = root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
        target?.scrollIntoView({ block: 'start' });
      },
    }),
    [],
  );

  // 增强渲染结果：改写相对图片地址、标记站内 .md 链接、为代码块添加复制按钮。
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;

    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') ?? '';
      if (/^https?:/i.test(href)) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        return;
      }
      if (!href || href.startsWith('#') || /^(mailto:|tel:)/i.test(href)) return;
      if (!basePath || !isMarkdownHref(href)) return;
      const [filePart, hashPart] = href.split('#');
      anchor.dataset.file = resolveRelative(basePath, filePart);
      if (hashPart) anchor.dataset.anchor = decodeURIComponent(hashPart);
      anchor.classList.add('internal-link');
    });

    root.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      if (/^https?:/i.test(img.getAttribute('src') ?? '')) img.loading = 'lazy';
    });

    root.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
      if (pre.querySelector('.copy-code')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code';
      button.textContent = '复制';
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const code = pre.querySelector('code');
        await copyText(code?.textContent ?? '');
        button.textContent = '已复制';
        window.setTimeout(() => {
          button.textContent = '复制';
        }, 1500);
      });
      pre.appendChild(button);
    });
  }, [html, basePath]);

  // 文档内查找：在渲染结果中标记命中，并把当前命中滚动到视野中央。
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    clearFindMarks(root);
    const query = findQuery.trim();
    if (!query) {
      onFindCount(0);
      return;
    }
    const marks = markFindMatches(root, query);
    onFindCount(marks.length);
    const active = marks[Math.min(Math.max(findIndex, 0), Math.max(marks.length - 1, 0))];
    active?.classList.add('is-active');
    if (active) {
      // 查找跳转引起的滚动不需要回写编辑器，避免打乱定位。
      suppressSync.current = true;
      active.scrollIntoView({ block: 'center' });
      window.setTimeout(() => {
        suppressSync.current = false;
      }, 160);
    }
  }, [html, findQuery, findIndex, onFindCount]);

  function handleScroll(event: ReactUIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (skipScroll.current || suppressSync.current) return;
    const max = el.scrollHeight - el.clientHeight;
    onScrollRatio(max > 0 ? el.scrollTop / max : 0);
  }

  function handleClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('.copy-code')) return;
    const anchor = target.closest('a');
    if (!anchor) return;
    const file = anchor.dataset.file;
    if (file) {
      event.preventDefault();
      onOpenFile(file, anchor.dataset.anchor || undefined);
      return;
    }
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  }

  return (
    <div className="preview-pane" ref={scrollRef} onScroll={handleScroll}>
      {html.trim() ? (
        <article
          ref={bodyRef}
          className={`markdown-body ${kind === 'text' ? 'plain-body' : ''}`}
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="preview-empty">
          <p>开始输入，预览会显示在这里。</p>
        </div>
      )}
    </div>
  );
});
