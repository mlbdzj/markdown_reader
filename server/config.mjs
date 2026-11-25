import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(here, '..');
export const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

/**
 * 默认笔记根目录。默认是项目下的 docs/，可用环境变量 MD_ROOT 覆盖。
 * 运行时可以在设置面板中切换，选择结果保存在 CONFIG_FILE 中。
 */
export const DEFAULT_ROOT = path.resolve(process.env.MD_ROOT || path.join(PROJECT_ROOT, 'docs'));

/** 保存当前笔记目录与最近使用的目录，避免重启后丢失选择。 */
export const CONFIG_FILE = path.resolve(
  process.env.MD_CONFIG_FILE || path.join(PROJECT_ROOT, '.md_reader.json'),
);

export const PORT = Number(process.env.PORT || 8080);
export const HOST = process.env.HOST || '127.0.0.1';

export const MD_EXT = new Set(['.md', '.markdown']);

/** 允许读写和展示的文本文件扩展名（二进制、图片不在其中）。 */
export const TEXT_EXT = new Set([
  ...MD_EXT,
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

/** 目录树中忽略的目录名 */
export const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.obsidian', '.trash', '.dsh']);
