import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { Env, MarkdownIt as MarkdownItInstance, RendererRule } from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from './highlight';
import { resolveRelative } from './text';

interface RenderEnv {
  headingIds: Map<string, number>;
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()#>+\-.!?:,;'"“”‘’、，。：；！？（）【】《》]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const md: MarkdownItInstance = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    const language = (lang || '').trim().split(/\s+/)[0];
    if (language && hljs.getLanguage(language)) {
      try {
        const highlighted = hljs.highlight(str, { language, ignoreIllegals: true }).value;
        return `<pre class="hljs" data-lang="${md.utils.escapeHtml(language)}"><code>${highlighted}</code></pre>`;
      } catch {
        // 退回纯文本
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(taskLists, { enabled: false });

const defaultHeadingOpen: RendererRule = (tokens, idx, options, _env, renderer) =>
  renderer.renderToken(tokens, idx, options);

const headingOpen: RendererRule = (tokens, idx, options, env, renderer) => {
  const inline = tokens[idx + 1];
  const text = inline?.type === 'inline' ? inline.content : '';
  const envIds = (env as unknown as RenderEnv).headingIds;
  const base = slugify(text) || `section-${envIds.size + 1}`;
  const seen = envIds.get(base) ?? 0;
  const id = seen === 0 ? base : `${base}-${seen}`;
  envIds.set(base, seen + 1);
  tokens[idx].attrSet('id', id);
  return defaultHeadingOpen(tokens, idx, options, env, renderer);
};

md.renderer.rules.heading_open = headingOpen;

const SANITIZE_OPTIONS = {
  ADD_TAGS: ['input'],
  ADD_ATTR: ['checked', 'disabled', 'type', 'data-lang', 'target', 'rel'],
};

export function renderMarkdown(source: string, basePath?: string): string {
  const env: RenderEnv = { headingIds: new Map() };
  const raw = md.render(source, env as unknown as Env);
  const clean = DOMPurify.sanitize(raw, SANITIZE_OPTIONS);
  if (!basePath) return clean;

  // 提前把相对图片地址改写为本地资源接口，避免页面先请求一次不存在的路径。
  const template = document.createElement('template');
  template.innerHTML = clean;
  template.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (!src || /^(data:|https?:|blob:|\/\/|\/|#)/i.test(src)) return;
    const resolved = resolveRelative(basePath, src);
    img.setAttribute('src', `/api/asset?path=${encodeURIComponent(resolved)}`);
    img.setAttribute('loading', 'lazy');
  });
  return template.innerHTML;
}

export const isMarkdownHref = (href: string): boolean => /\.(md|markdown)([?#].*)?$/i.test(href);
