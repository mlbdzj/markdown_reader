/**
 * 可编辑的文本扩展名与预览语言映射。
 * 注意：扩展名列表需要与 server/config.mjs 中的 TEXT_EXT 保持一致。
 */

export const MD_EXTENSIONS = new Set(['.md', '.markdown']);

export const TEXT_EXTENSIONS = new Set([
  ...MD_EXTENSIONS,
  '.txt',
  '.text',
  '.log',
  '.rst',
  '.json',
  '.jsonc',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.properties',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
  '.svelte',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.gql',
  '.diff',
  '.patch',
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.conf': 'ini',
  '.cfg': 'ini',
  '.properties': 'ini',
  '.xml': 'xml',
  '.html': 'xml',
  '.htm': 'xml',
  '.vue': 'xml',
  '.svelte': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.diff': 'diff',
  '.patch': 'diff',
};

export function extensionOf(filePath: string): string {
  const name = filePath.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot).toLowerCase();
}

export function isMarkdownPath(filePath: string): boolean {
  return MD_EXTENSIONS.has(extensionOf(filePath));
}

export function isSupportedTextPath(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(filePath));
}

export function languageForPath(filePath: string): string | null {
  return LANGUAGE_BY_EXTENSION[extensionOf(filePath)] ?? null;
}

/** 新建文件时补全扩展名；未写扩展名默认使用 .md。 */
export function ensureNewFileName(name: string): string {
  const ext = extensionOf(name);
  if (!ext) return `${name}.md`;
  if (!TEXT_EXTENSIONS.has(ext)) throw new Error(`不支持的文件类型：${ext}`);
  return name;
}

/** 重命名文件时：未写扩展名则保留原扩展名，写了则必须是受支持的文本类型。 */
export function ensureRenamedFileName(name: string, originalName: string): string {
  const ext = extensionOf(name);
  if (!ext) {
    const originalExt = extensionOf(originalName);
    return `${name}${TEXT_EXTENSIONS.has(originalExt) ? originalExt : '.md'}`;
  }
  if (!TEXT_EXTENSIONS.has(ext)) throw new Error(`不支持的文件类型：${ext}`);
  return name;
}
