import { isMarkdownPath } from './fileTypes';
import { renderMarkdown } from './markdown';
import { renderTextPreview } from './plainText';
import { resolveRelative } from './text';
import { buildStandaloneHtml } from './exportHtml';

const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function inlineImage(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_INLINE_IMAGE_BYTES) return null;
    return await readAsDataUrl(blob);
  } catch {
    return null;
  }
}

/**
 * 生成自包含的 HTML 文档。
 * Markdown 会渲染为富文本，其他文本按纯文本 / 语法高亮导出；
 * Markdown 中的本地相对图片会被内联为 data URL。
 */
export async function buildExportDocument(title: string, sourcePath: string, content: string): Promise<string> {
  if (!isMarkdownPath(sourcePath)) {
    return buildStandaloneHtml({
      title,
      bodyHtml: renderTextPreview(content, sourcePath),
      sourcePath,
    });
  }

  const html = renderMarkdown(content);
  const parsed = new DOMParser().parseFromString(`<div id="__export_root">${html}</div>`, 'text/html');
  const root = parsed.getElementById('__export_root');

  if (root) {
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'));
    await Promise.all(
      images.map(async (img) => {
        const src = img.getAttribute('src') ?? '';
        if (!src || /^(data:|blob:)/i.test(src)) return;
        let target: string;
        if (/^https?:/i.test(src)) target = src;
        else if (src.startsWith('/')) {
          target = src;
        } else {
          const resolved = resolveRelative(sourcePath, src);
          target = `/api/asset?path=${encodeURIComponent(resolved)}`;
        }
        const dataUrl = await inlineImage(target);
        if (dataUrl) img.setAttribute('src', dataUrl);
      }),
    );
  }

  const bodyHtml = root ? root.innerHTML : html;
  return buildStandaloneHtml({ title, bodyHtml, sourcePath });
}
