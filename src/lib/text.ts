export function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

export function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function titleFromPath(p: string): string {
  return basename(p).replace(/\.[^.]+$/, '');
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
}

export function countWords(text: string): number {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  return cjk + latin;
}

export function countLines(text: string): number {
  return text === '' ? 1 : text.split('\n').length;
}

/** 把相对链接（如 ./other.md 或 ../a/b.md）解析为相对于根目录的路径。 */
export function resolveRelative(baseFile: string, href: string): string {
  const baseParts = dirname(baseFile).split('/').filter(Boolean);
  const clean = href.split('#')[0].split('?')[0];
  const parts = decodeURIComponent(clean).split('/');
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join('/');
}

export interface TextMatch {
  start: number;
  end: number;
}

/** 大小写不敏感的文本查找，返回所有命中区间。 */
export function findTextMatches(text: string, query: string): TextMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const matches: TextMatch[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    matches.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return matches;
}

/** 把绝对路径转换成相对 root 的路径；不在 root 内时返回 null。 */
export function relativeToRoot(root: string, filePath: string): string | null {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const rootPath = normalize(root);
  const targetPath = normalize(filePath);
  if (!rootPath || !targetPath) return null;

  const windows = /^[a-zA-Z]:\//.test(rootPath);
  const rootKey = windows ? rootPath.toLowerCase() : rootPath;
  const targetKey = windows ? targetPath.toLowerCase() : targetPath;
  if (targetKey === rootKey) return '';
  if (!targetKey.startsWith(`${rootKey}/`)) return null;
  return targetPath.slice(rootPath.length + 1);
}

/** 判断是否为绝对路径（Windows 盘符 / UNC / Unix 根路径）。 */
export function isAbsolutePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/');
}
