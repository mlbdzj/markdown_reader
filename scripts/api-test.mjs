import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'md_reader-test-'));
const externalDirs = [];

process.env.PORT = String(PORT);
process.env.MD_ROOT = tempRoot;
process.env.MD_CONFIG_FILE = path.join(tempRoot, 'md_reader-config.json');
process.env.MD_ALLOW_ABSOLUTE = '1';

const { startServer } = await import('../server/index.mjs');
let server = null;

async function req(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const passed = [];
async function step(name, fn) {
  await fn();
  passed.push(name);
  console.log(`  ✔ ${name}`);
}

try {
  ({ server } = await startServer({ port: PORT, host: '127.0.0.1' }));

  await step('健康检查', async () => {
    const { status, data } = await req('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(path.resolve(data.root), path.resolve(tempRoot));
  });

  await step('创建文件／目录', async () => {
    let r = await req('POST', '/api/folder', { path: 'notes' });
    assert.equal(r.status, 201);
    r = await req('POST', '/api/file', { path: 'notes/hello.md', content: '# Hello\n\n世界，你好。' });
    assert.equal(r.status, 201);
    r = await req('POST', '/api/file', { path: 'notes/hello.md' });
    assert.equal(r.status, 409);
  });

  await step('目录树', async () => {
    const { data } = await req('GET', '/api/tree');
    const dir = data.children.find((n) => n.name === 'notes');
    assert.ok(dir && dir.type === 'dir');
    assert.equal(dir.children[0].path, 'notes/hello.md');
  });

  await step('读取文件', async () => {
    const { status, data } = await req('GET', '/api/file?path=notes/hello.md');
    assert.equal(status, 200);
    assert.match(data.content, /世界/);
    assert.ok(data.mtime > 0);
  });

  await step('写入文件', async () => {
    const { status } = await req('PUT', '/api/file?path=notes/hello.md', { content: '# 已更新\n\n正文内容。' });
    assert.equal(status, 200);
    const res = await req('GET', '/api/file?path=notes/hello.md');
    assert.match(res.data.content, /已更新/);
  });

  await step('桌面版按绝对路径读写外部文件', async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md_reader-external-'));
    externalDirs.push(externalDir);
    const externalFile = path.join(externalDir, '外部文件.md');
    const externalImage = path.join(externalDir, '外部图片.png');
    await fs.writeFile(externalFile, '# 外部文件\n\n来自笔记目录外的内容。', 'utf8');
    await fs.writeFile(externalImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const read = await req('GET', `/api/file?path=${encodeURIComponent(externalFile)}`);
    assert.equal(read.status, 200);
    assert.match(read.data.content, /来自笔记目录外/);
    assert.equal(path.resolve(read.data.path), path.resolve(externalFile));

    const written = await req('PUT', `/api/file?path=${encodeURIComponent(externalFile)}`, {
      content: '# 已修改\n\n保存回原路径。',
    });
    assert.equal(written.status, 200);
    assert.match(await fs.readFile(externalFile, 'utf8'), /保存回原路径/);

    const asset = await fetch(`${BASE}/api/asset?path=${encodeURIComponent(externalImage)}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/png');
  });

  await step('支持其他文本类型', async () => {
    const created = await req('POST', '/api/file', {
      path: 'notes/notes.txt',
      content: '纯文本第一行\n纯文本第二行',
    });
    assert.equal(created.status, 201);

    const read = await req('GET', '/api/file?path=notes/notes.txt');
    assert.equal(read.status, 200);
    assert.match(read.data.content, /纯文本第二行/);

    const tree = await req('GET', '/api/tree');
    const notesDir = tree.data.children.find((node) => node.name === 'notes');
    assert.ok(notesDir.children.some((node) => node.name === 'notes.txt'));

    const found = await req('GET', `/api/search?q=${encodeURIComponent('纯文本')}`);
    assert.ok(found.data.results.some((result) => result.path === 'notes/notes.txt'));

    const renamed = await req('POST', '/api/rename', { from: 'notes/notes.txt', to: 'notes/renamed.json' });
    assert.equal(renamed.status, 200);
    const written = await req('PUT', '/api/file?path=notes/renamed.json', { content: '{\n  "ok": true\n}' });
    assert.equal(written.status, 200);
    const readJson = await req('GET', '/api/file?path=notes/renamed.json');
    assert.match(readJson.data.content, /"ok": true/);
  });

  await step('全文搜索', async () => {
    const { status, data } = await req('GET', '/api/search?q=正文');
    assert.equal(status, 200);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].path, 'notes/hello.md');
    assert.equal(data.results[0].matches[0].line, 3);
  });

  await step('重命名', async () => {
    const r = await req('POST', '/api/rename', { from: 'notes/hello.md', to: 'notes/world.md' });
    assert.equal(r.status, 200);
    const oldRes = await req('GET', '/api/file?path=notes/hello.md');
    assert.equal(oldRes.status, 404);
    const newRes = await req('GET', '/api/file?path=notes/world.md');
    assert.match(newRes.data.content, /已更新/);
  });

  await step('删除文件', async () => {
    const r = await req('DELETE', '/api/node?path=notes/world.md');
    assert.equal(r.status, 200);
    const res = await req('GET', '/api/file?path=notes/world.md');
    assert.equal(res.status, 404);
  });

  await step('拒绝路径穿越', async () => {
    const r = await req('GET', '/api/file?path=../package.json');
    assert.equal(r.status, 400);
  });

  await step('读取笔记空间配置', async () => {
    const { status, data } = await req('GET', '/api/config');
    assert.equal(status, 200);
    assert.equal(path.resolve(data.root), path.resolve(tempRoot));
    assert.equal(data.envOverride, true);
    assert.ok(Array.isArray(data.recent));
  });

  await step('运行时切换笔记空间', async () => {
    const secondRoot = path.join(tempRoot, 'second-space');
    await fs.mkdir(secondRoot, { recursive: true });

    const switched = await req('POST', '/api/root', { path: secondRoot });
    assert.equal(switched.status, 200);
    assert.equal(path.resolve(switched.data.root), path.resolve(secondRoot));
    assert.ok(switched.data.recent.some((item) => path.resolve(item) === path.resolve(secondRoot)));

    const emptyTree = await req('GET', '/api/tree');
    assert.equal(emptyTree.data.children.length, 0);
    const created = await req('POST', '/api/file', { path: '新空间.md', content: '# 新空间' });
    assert.equal(created.status, 201);
    const readBack = await req('GET', '/api/file?path=新空间.md');
    assert.match(readBack.data.content, /新空间/);

    const config = await req('GET', '/api/config');
    assert.equal(path.resolve(config.data.root), path.resolve(secondRoot));
    const persisted = JSON.parse(
      await fs.readFile(path.join(tempRoot, 'md_reader-config.json'), 'utf8'),
    );
    assert.equal(path.resolve(persisted.root), path.resolve(secondRoot));

    const switchedBack = await req('POST', '/api/root', { path: tempRoot });
    assert.equal(switchedBack.status, 200);
    assert.equal(path.resolve(switchedBack.data.root), path.resolve(tempRoot));
    assert.ok(switchedBack.data.recent.some((item) => path.resolve(item) === path.resolve(tempRoot)));
    const misplaced = await req('GET', '/api/file?path=新空间.md');
    assert.equal(misplaced.status, 404);
  });

  await step('拒绝相对路径的笔记空间', async () => {
    const r = await req('POST', '/api/root', { path: '../outside' });
    assert.equal(r.status, 400);
  });

  await step('拒绝不支持的文本类型', async () => {
    const r = await req('POST', '/api/file', { path: 'notes/a.png', content: 'x' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /不支持的文件类型/);
  });

  if (process.platform === 'win32') {
    await step('拒绝 Windows 非法文件名', async () => {
      const r = await req('POST', '/api/file', { path: 'notes/bad:name.md', content: 'x' });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /不允许的字符/);
    });
  }

  await step('静态页面服务', async () => {
    const res = await fetch(`${BASE}/`);
    if (res.status === 200) {
      const body = await res.text();
      assert.match(body, /id="root"/);
    } else {
      assert.equal(res.status, 404);
      assert.match(await res.text(), /npm run build/);
    }
  });

  console.log(`\n全部 ${passed.length} 项接口测试通过。`);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
  for (const dir of externalDirs) await fs.rm(dir, { recursive: true, force: true });
}
