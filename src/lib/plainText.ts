import hljs from './highlight';
import { languageForPath } from './fileTypes';

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * 非 Markdown 文本的预览：代码类型使用语法高亮，其余按纯文本展示。
 */
export function renderTextPreview(source: string, filePath: string): string {
  if (!source.trim()) return '';

  const language = languageForPath(filePath);
  if (language && hljs.getLanguage(language)) {
    try {
      const highlighted = hljs.highlight(source, { language, ignoreIllegals: true }).value;
      return `<pre class="hljs" data-lang="${language}"><code>${highlighted}</code></pre>`;
    } catch {
      // 退回纯文本
    }
  }

  return `<pre class="plain-pre"><code>${escapeHtml(source)}</code></pre>`;
}
