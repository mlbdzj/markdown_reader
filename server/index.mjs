import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DIST_DIR, HOST, PORT } from './config.mjs';
import { HttpError } from './store.mjs';
import * as store from './store.mjs';

const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function describeFileSystemError(err) {
  switch (err?.code) {
    case 'ENOENT':
      return { status: 404, message: '文件或目录不存在' };
    case 'EACCES':
    case 'EPERM':
      return { status: 403, message: '没有权限访问该文件或目录' };
    case 'EEXIST':
      return { status: 409, message: '同名文件或目录已存在' };
    case 'ENOTDIR':
      return { status: 400, message: '路径中包含的不是目录' };
    case 'EISDIR':
      return { status: 400, message: '目标是一个目录' };
    case 'ENAMETOOLONG':
      return { status: 400, message: '文件名过长' };
    case 'EINVAL':
      return { status: 400, message: '文件名或路径不合法' };
    default:
      return null;
  }
}

function sendError(res, err) {
  let status = err instanceof HttpError ? err.status : 500;
  let message = err instanceof HttpError ? err.message : '服务器内部错误';

  if (!(err instanceof HttpError)) {
    const fsError = describeFileSystemError(err);
    if (fsError) {
      status = fsError.status;
      message = fsError.message;
    } else {
      console.error('[server]', err);
    }
  }

  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, status, { error: message });
}

async function readJson(req) {
  const limit = 20 * 1024 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '请求体过大（上限 20MB）');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON');
  }
}

async function statOrNull(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '方法不允许');

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '非法的资源路径');
  }
  if (pathname === '/') pathname = '/index.html';

  const distRoot = path.resolve(DIST_DIR);
  let target = path.resolve(distRoot, `.${pathname}`);
  if (target !== distRoot && !target.startsWith(distRoot + path.sep)) {
    throw new HttpError(403, '禁止访问');
  }

  let stat = await statOrNull(target);
  if (!stat || !stat.isFile()) {
    // 前端使用 history 路由之外的简单结构，仅对无扩展名路径回退到 index.html
    if (path.extname(pathname) === '') {
      target = path.join(distRoot, 'index.html');
      stat = await statOrNull(target);
    }
  }

  if (!stat || !stat.isFile()) {
    if (pathname.startsWith('/assets/')) throw new HttpError(404, '资源不存在');
    throw new HttpError(404, '页面不存在，请先执行 npm run build');
  }

  const ext = path.extname(target).toLowerCase();
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'x-content-type-options': 'nosniff',
  };
  if (target.includes(`${path.sep}assets${path.sep}`)) {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  } else {
    headers['cache-control'] = 'no-cache';
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const data = await fs.readFile(target);
  res.end(data);
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const rel = url.searchParams.get('path');

  switch (route) {
    case 'GET /api/health':
      return sendJson(res, 200, { ok: true, root: store.getRoot(), time: Date.now() });

    case 'GET /api/config':
      return sendJson(res, 200, {
        root: store.getRoot(),
        recent: store.getRecentRoots(),
        envOverride: store.isEnvRoot(),
      });

    case 'POST /api/root': {
      const body = await readJson(req);
      return sendJson(res, 200, await store.switchRoot(body.path));
    }

    case 'GET /api/tree':
      return sendJson(res, 200, await store.buildTree());

    case 'GET /api/file': {
      if (!rel) throw new HttpError(400, '缺少 path 参数');
      return sendJson(res, 200, await store.readMarkdown(rel));
    }

    case 'PUT /api/file': {
      if (!rel) throw new HttpError(400, '缺少 path 参数');
      const body = await readJson(req);
      return sendJson(res, 200, await store.writeMarkdown(rel, body.content));
    }

    case 'POST /api/file': {
      const body = await readJson(req);
      if (!body.path) throw new HttpError(400, '缺少 path 参数');
      return sendJson(res, 201, await store.createMarkdown(body.path, body.content ?? ''));
    }

    case 'POST /api/folder': {
      const body = await readJson(req);
      if (!body.path) throw new HttpError(400, '缺少 path 参数');
      return sendJson(res, 201, await store.createFolder(body.path));
    }

    case 'POST /api/rename': {
      const body = await readJson(req);
      if (!body.from || !body.to) throw new HttpError(400, '缺少 from / to 参数');
      return sendJson(res, 200, await store.renameNode(body.from, body.to));
    }

    case 'DELETE /api/node': {
      if (!rel) throw new HttpError(400, '缺少 path 参数');
      const recursive = url.searchParams.get('recursive') === 'true';
      return sendJson(res, 200, await store.deleteNode(rel, recursive));
    }

    case 'GET /api/search': {
      const q = url.searchParams.get('q') ?? '';
      return sendJson(res, 200, { query: q, results: await store.searchText(q) });
    }

    case 'GET /api/asset': {
      if (!rel) throw new HttpError(400, '缺少 path 参数');
      const abs = store.resolveReadable(rel);
      const ext = path.extname(abs).toLowerCase();
      if (!ASSET_EXT.has(ext)) throw new HttpError(400, '只允许读取图片资源');
      const stat = await statOrNull(abs);
      if (!stat || !stat.isFile()) throw new HttpError(404, '图片不存在');
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      res.end(await fs.readFile(abs));
      return;
    }

    default:
      throw new HttpError(404, `未知接口：${route}`);
  }
}

function createHttpServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else {
        await serveStatic(req, res, url);
      }
    } catch (err) {
      sendError(res, err);
    }
  });
}

export async function startServer(options = {}) {
  const port = options.port ?? PORT;
  const host = options.host ?? HOST;

  await store.initRoot();
  const server = createHttpServer();
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`[server] md_reader 已启动：http://${host}:${actualPort}`);
  console.log(`[server] 笔记目录：${store.getRoot()}`);

  const distExists = await statOrNull(path.join(DIST_DIR, 'index.html'));
  if (!distExists) {
    console.log('[server] 提示：未找到 dist/index.html，请先执行 npm run build');
  }

  return { server, port: actualPort };
}
