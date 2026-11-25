import markdownCss from '../styles/markdown.css?inline';

interface ExportOptions {
  title: string;
  bodyHtml: string;
  sourcePath?: string;
}

const THEME_CSS = `
  body {
    margin: 0;
    padding: 40px 16px 80px;
    background: #ffffff;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  html[data-theme="dark"] body {
    background: #0d0d0d;
    color: #ededed;
  }
  .export-page { max-width: var(--export-width, 720px); margin: 0 auto; }
  .export-meta {
    max-width: 720px;
    margin: 0 auto 24px;
    padding: 8px 4px 12px;
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    font-size: 12px;
    opacity: 0.6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
`;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildStandaloneHtml({ title, bodyHtml, sourcePath }: ExportOptions): string {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const meta = sourcePath ? `<div class="export-meta">${escapeHtml(sourcePath)} · 由 md_reader 导出</div>` : '';
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(title)}</title>
<style>${markdownCss}</style>
<style>${THEME_CSS}</style>
</head>
<body>
${meta}
<article class="markdown-body">${bodyHtml}</article>
</body>
</html>`;
}

export function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
