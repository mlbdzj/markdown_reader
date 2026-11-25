import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { CONFIG_FILE, DEFAULT_ROOT, IGNORED_DIRS, TEXT_EXT } from './config.mjs';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_TREE_DEPTH = 12;
const MAX_SEARCH_FILES = 100;
const MAX_MATCHES_PER_FILE = 6;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 当前笔记空间的根目录，可在运行时通过 switchRoot 切换。 */
let activeRoot = DEFAULT_ROOT;
let recentRoots = [];

/** 桌面模式会打开拖入的任意位置文件；未开启时不支持绝对路径。 */
const ALLOW_ABSOLUTE = process.env.MD_ALLOW_ABSOLUTE === '1';

export function getRoot() {
  return activeRoot;
}

export function getRecentRoots() {
  return [...recentRoots];
}

export function isEnvRoot() {
  return Boolean(process.env.MD_ROOT);
}

function validateWindowsPath(raw) {
  if (process.platform !== 'win32') return;
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.' || segment === '..') continue;
    if (/[<>:"|?*\u0000-\u001f]/.test(segment)) {
      throw new HttpError(400, '名称包含 Windows 不允许的字符（< > : " | ? *）');
    }
    if (/[. ]$/.test(segment)) {
      throw new HttpError(400, '名称不能以空格或点结尾');
    }
    if (WINDOWS_RESERVED.test(segment.split('.')[0])) {
      throw new HttpError(400, '该名称是 Windows 保留名称');
    }
  }
}

/** 把用户传入的相对路径解析到当前根目录内，并阻止路径穿越。 */
export function resolveSafe(rel) {
  const raw = String(rel ?? '').replaceAll('\\', '/');
  if (raw.includes('\0')) throw new HttpError(400, '非法路径');
  validateWindowsPath(raw);
  const root = path.resolve(activeRoot);
  const abs = path.resolve(root, raw);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new HttpError(400, '路径越界：只能访问笔记根目录内的文件');
  }
  return abs;
}

export function toRel(abs) {
  return path.relative(activeRoot, abs).split(path.sep).join('/');
}

function isInsideRoot(abs) {
  const root = path.resolve(activeRoot);
  return abs === root || abs.startsWith(root + path.sep);
}

/** 文件接口使用的路径解析：桌面版允许绝对路径，其余限制在笔记根目录内。 */
export function resolveReadable(rel) {
  const raw = String(rel ?? '').replaceAll('\\', '/');
  if (ALLOW_ABSOLUTE && path.isAbsolute(raw)) {
    if (raw.includes('\0')) throw new HttpError(400, '非法路径');
    return path.resolve(raw);
  }
  return resolveSafe(rel);
}

function responsePath(abs) {
  return isInsideRoot(abs) ? toRel(abs) : abs.split(path.sep).join('/');
}

function assertTextFile(abs) {
  if (!isTextFile(abs)) throw new HttpError(400, '不支持的文件类型（支持 .md/.txt/.json/.yaml 等文本格式）');
}

export function isTextFile(filePath) {
  return TEXT_EXT.has(path.extname(filePath).toLowerCase());
}

async function statOrNull(abs) {
  try {
    return await fs.stat(abs);
  } catch {
    return null;
  }
}

export async function ensureRoot() {
  await fs.mkdir(activeRoot, { recursive: true });
}

async function readConfigFile() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function persistRoot() {
  try {
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    const payload = { root: activeRoot, recent: recentRoots };
    await fs.writeFile(CONFIG_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn('[store] 无法保存笔记目录配置：', err.message);
  }
}

/**
 * 启动时恢复上次选择的目录。
 * 显式设置 MD_ROOT 环境变量时，以环境变量为准。
 */
export async function initRoot() {
  const config = await readConfigFile();
  if (config) {
    if (Array.isArray(config.recent)) {
      recentRoots = config.recent
        .filter((item) => typeof item === 'string' && path.isAbsolute(item))
        .slice(0, 6);
    }
    if (!process.env.MD_ROOT && typeof config.root === 'string' && path.isAbsolute(config.root)) {
      const stat = await statOrNull(config.root);
      if (stat?.isDirectory()) activeRoot = path.resolve(config.root);
    }
  }
  await ensureRoot();
}

/** 运行时切换笔记空间；目录不存在时会自动创建。 */
export async function switchRoot(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new HttpError(400, '请填写笔记目录');
  if (!path.isAbsolute(raw)) {
    throw new HttpError(400, '请填写绝对路径，例如 D:\\notes');
  }
  const abs = path.resolve(raw);
  let stat = await statOrNull(abs);
  if (!stat) {
    await fs.mkdir(abs, { recursive: true });
    stat = await fs.stat(abs);
  }
  if (!stat.isDirectory()) throw new HttpError(400, '目标路径不是文件夹');

  try {
    await fs.access(abs, constants.W_OK);
  } catch {
    throw new HttpError(403, '没有该目录的写入权限');
  }

  if (abs !== activeRoot) {
    activeRoot = abs;
    recentRoots = [abs, ...recentRoots.filter((item) => item !== abs)].slice(0, 6);
    await persistRoot();
  }

  return { root: activeRoot, recent: getRecentRoots(), envOverride: isEnvRoot() };
}

async function walkDir(dir, depth) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || depth >= MAX_TREE_DEPTH) continue;
      dirs.push({
        name: entry.name,
        path: toRel(abs),
        type: 'dir',
        children: await walkDir(abs, depth + 1),
      });
    } else if (entry.isFile() && isTextFile(entry.name)) {
      const stat = await statOrNull(abs);
      files.push({
        name: entry.name,
        path: toRel(abs),
        type: 'file',
        size: stat?.size ?? 0,
        mtime: stat?.mtimeMs ?? 0,
      });
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN');
  dirs.sort(byName);
  files.sort(byName);
  return [...dirs, ...files];
}

export async function buildTree() {
  await ensureRoot();
  const stat = await fs.stat(activeRoot);
  return {
    name: path.basename(activeRoot),
    path: '',
    type: 'dir',
    mtime: stat.mtimeMs,
    children: await walkDir(activeRoot, 0),
  };
}

export async function readMarkdown(rel) {
  const abs = resolveReadable(rel);
  assertTextFile(abs);
  const stat = await statOrNull(abs);
  if (!stat) throw new HttpError(404, '文件不存在');
  if (!stat.isFile()) throw new HttpError(400, '目标不是文件');
  const content = await fs.readFile(abs, 'utf8');
  return { path: responsePath(abs), content, mtime: stat.mtimeMs, size: stat.size };
}

export async function writeMarkdown(rel, content) {
  if (typeof content !== 'string') throw new HttpError(400, 'content 必须是字符串');
  const abs = resolveReadable(rel);
  assertTextFile(abs);
  const stat = await statOrNull(abs);
  if (!stat) throw new HttpError(404, '文件不存在，无法保存');
  if (!stat.isFile()) throw new HttpError(400, '目标不是文件');
  await fs.writeFile(abs, content, 'utf8');
  const next = await fs.stat(abs);
  return { path: responsePath(abs), mtime: next.mtimeMs, size: next.size };
}

export async function createMarkdown(rel, content = '') {
  const abs = resolveSafe(rel);
  assertTextFile(abs);
  if (await statOrNull(abs)) throw new HttpError(409, '同名文件已存在');
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  const stat = await fs.stat(abs);
  return { path: toRel(abs), mtime: stat.mtimeMs, size: stat.size };
}

export async function createFolder(rel) {
  const abs = resolveSafe(rel);
  if (abs === path.resolve(activeRoot)) throw new HttpError(400, '目录名不能为空');
  const stat = await statOrNull(abs);
  if (stat) throw new HttpError(409, '同名文件或目录已存在');
  await fs.mkdir(abs, { recursive: true });
  return { path: toRel(abs), type: 'dir' };
}

export async function renameNode(fromRel, toRelName) {
  const fromAbs = resolveSafe(fromRel);
  const toAbs = resolveSafe(toRelName);
  if (fromAbs === path.resolve(activeRoot)) throw new HttpError(400, '不能重命名根目录');
  if (fromAbs === toAbs) return { from: toRel(fromAbs), to: toRel(toAbs) };

  if (isTextFile(fromAbs) && !isTextFile(toAbs)) {
    throw new HttpError(400, '目标文件类型不受支持');
  }

  const fromStat = await statOrNull(fromAbs);
  if (!fromStat) throw new HttpError(404, '源文件不存在');

  if (fromStat.isDirectory()) {
    if (toAbs.startsWith(fromAbs + path.sep)) throw new HttpError(400, '不能把目录移动到自身内部');
  }

  if (await statOrNull(toAbs)) throw new HttpError(409, '目标名称已存在');
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  return { from: toRel(fromAbs), to: toRel(toAbs), type: fromStat.isDirectory() ? 'dir' : 'file' };
}

export async function deleteNode(rel, recursive) {
  const abs = resolveSafe(rel);
  if (abs === path.resolve(activeRoot)) throw new HttpError(400, '不能删除根目录');
  const stat = await statOrNull(abs);
  if (!stat) throw new HttpError(404, '文件或目录不存在');
  if (stat.isDirectory()) {
    if (recursive !== true && recursive !== 'true') {
      const entries = await fs.readdir(abs);
      if (entries.length > 0) throw new HttpError(400, '目录非空，需要确认递归删除');
    }
    await fs.rm(abs, { recursive: true, force: false });
  } else {
    assertTextFile(abs);
    await fs.unlink(abs);
  }
  return { path: toRel(abs), type: stat.isDirectory() ? 'dir' : 'file' };
}

async function collectTextFiles(dir, out) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await collectTextFiles(abs, out);
    } else if (entry.isFile() && isTextFile(entry.name)) {
      out.push(abs);
    }
  }
}

export async function searchText(query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];

  const files = [];
  await collectTextFiles(activeRoot, files);

  const results = [];
  for (const abs of files) {
    if (results.length >= MAX_SEARCH_FILES) break;
    let text;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const matches = [];
    for (let i = 0; i < lines.length && matches.length < MAX_MATCHES_PER_FILE; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(needle)) {
        const trimmed = line.trim();
        matches.push({
          line: i + 1,
          text: trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed,
        });
      }
    }
    if (matches.length > 0) {
      const stat = await statOrNull(abs);
      results.push({
        path: toRel(abs),
        name: path.basename(abs),
        mtime: stat?.mtimeMs ?? 0,
        matches,
      });
    }
  }

  results.sort((a, b) => {
    const aName = a.name.toLowerCase().includes(needle) ? 0 : 1;
    const bName = b.name.toLowerCase().includes(needle) ? 0 : 1;
    if (aName !== bName) return aName - bName;
    return b.mtime - a.mtime;
  });

  return results;
}
