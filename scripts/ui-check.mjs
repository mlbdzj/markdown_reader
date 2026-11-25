/**
 * 界面冒烟检查（开发用）：自动启动本地服务，用 Chrome DevTools Protocol
 * 检查渲染、搜索、文件操作、查找、拖拽提示等，并生成截图。
 *
 * 前提：Chrome 以 --remote-debugging-port=9222 --headless=new 运行。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const APP_URL = 'http://127.0.0.1:8080/';
const CDP_PORT = 9222;
const SHOTS_DIR = path.resolve('.shots');
const API = 'http://127.0.0.1:8080';
const CONFIG_FILE = path.resolve('.ui-check-config.json');

await fs.rm(CONFIG_FILE, { force: true });
process.env.MD_CONFIG_FILE = CONFIG_FILE;
delete process.env.MD_ROOT;

const { startServer } = await import('../server/index.mjs');
const { server } = await startServer({ port: 8080, host: '127.0.0.1' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openTarget(url) {
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`;
  let res = await fetch(endpoint, { method: 'PUT' });
  if (!res.ok) res = await fetch(endpoint);
  if (!res.ok) throw new Error(`无法创建调试页面：HTTP ${res.status}`);
  const target = await res.json();
  if (!target.webSocketDebuggerUrl) throw new Error('调试页面缺少 webSocketDebuggerUrl');
  return target.webSocketDebuggerUrl;
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.errors = [];
    this.logs = [];
    this.failures = [];
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`));
        else entry.resolve(message.result);
        return;
      }
      if (message.method === 'Network.responseReceived') {
        const { response, type } = message.params;
        if (response.status >= 400) this.failures.push(`${response.status} ${type} ${response.url}`);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params.exceptionDetails;
        this.errors.push(detail.exception?.description ?? detail.text ?? '页面脚本异常');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.logs.push(message.params.entry.text);
      }
    };
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('WebSocket 连接失败'));
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Network.enable');
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async waitFor(expression, timeout = 8000, label = expression) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return true;
      } catch {
        // 页面尚未稳定
      }
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = path.join(SHOTS_DIR, name);
    await fs.writeFile(file, Buffer.from(result.data, 'base64'));
    console.log(`  📸 已保存截图 ${name}`);
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function findTreeFilePath(name) {
  const response = await fetch(`${API}/api/tree`);
  const tree = await response.json();
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.type === 'file' && node.name === name) return node.path;
      if (node.type === 'dir') {
        const found = walk(node.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(tree.children);
}

const checks = [];
function check(name, condition) {
  if (!condition) throw new Error(`检查失败：${name}`);
  checks.push(name);
  console.log(`  ✔ ${name}`);
}

function setInputValue(selector, value) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

async function main() {
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  const wsUrl = await openTarget(APP_URL);
  const cdp = new Cdp(wsUrl);
  await cdp.connect();

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // 清理上一个会话的本地设置，保证从默认状态开始。
  await cdp.evaluate('localStorage.clear()');
  await cdp.send('Page.reload');
  await cdp.waitFor('document.readyState === "complete"', 10000, '页面重新加载');

  console.log('[1] 加载应用');
  await cdp.waitFor('document.readyState === "complete"', 10000, '页面加载');
  await cdp.waitFor(
    '!!document.querySelector(".toolbar") && !!document.querySelector(".editor-textarea")',
    10000,
    '应用渲染',
  );
  await cdp.waitFor('document.querySelectorAll(".tree-row").length >= 3', 8000, '目录树加载');
  await cdp.waitFor('document.querySelector(".editor-textarea").value.length > 0', 8000, '默认文件打开');
  await cdp.waitFor('!!document.querySelector(".preview-pane .markdown-body h1")', 5000, '实时预览渲染');

  check('工具栏与编辑器已渲染', await cdp.evaluate('!!document.querySelector(".toolbar")'));
  check('默认自动打开一篇笔记', await cdp.evaluate('document.querySelector(".editor-textarea").value.length > 0'));
  check('实时预览已渲染正文', await cdp.evaluate('!!document.querySelector(".preview-pane .markdown-body h1")'));
  await cdp.screenshot('01-light-split.png');

  console.log('[2] 全文搜索');
  await cdp.evaluate(setInputValue('#global-search', '实时预览'));
  await cdp.waitFor('document.querySelectorAll(".search-hit").length > 0', 8000, '搜索结果渲染');
  check('搜索命中文件', await cdp.evaluate('document.querySelectorAll(".search-hit").length >= 1'));
  check('搜索命中包含高亮', await cdp.evaluate('!!document.querySelector(".search-hit mark")'));
  await cdp.screenshot('02-search.png');

  console.log('[3] 通过搜索打开文件');
  await cdp.evaluate(setInputValue('#global-search', '欢迎使用 md_reader'));
  await cdp.waitFor(
    '[...document.querySelectorAll(".search-hit")].some((el) => el.textContent.includes("欢迎使用.md"))',
    8000,
    '搜索结果包含欢迎文件',
  );
  await cdp.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.search-hit')].find((el) => el.textContent.includes('欢迎使用.md'));
    hit.click();
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".editor-textarea").value.includes("# 欢迎使用 md_reader")', 8000, '欢迎文件打开');
  await cdp.waitFor(
    'document.querySelector(".preview-pane .markdown-body h1")?.textContent === "欢迎使用 md_reader"',
    5000,
    '欢迎文件预览渲染',
  );
  check('点击搜索结果打开对应文件', await cdp.evaluate('document.querySelector(".editor-textarea").value.includes("欢迎使用 md_reader")'));
  check('预览渲染内嵌 SVG 图片', await cdp.evaluate('!!document.querySelector(".preview-pane img")'));
  await cdp.screenshot('03-light-welcome.png');

  console.log('[4] 自动保存');
  const original = await cdp.evaluate('document.querySelector(".editor-textarea").value');
  await cdp.evaluate(setInputValue('.editor-textarea', `${original}\n\n界面自动保存检查标记。`));
  await sleep(2400);
  const fileResponse = await fetch(`${API}/api/file?path=${encodeURIComponent('欢迎使用.md')}`);
  const saved = await fileResponse.json();
  check('自动保存已写入本地文件', typeof saved.content === 'string' && saved.content.includes('界面自动保存检查标记。'));
  check('界面显示已保存', await cdp.evaluate('document.querySelector(".save-state")?.textContent.includes("已保存")'));

  // 恢复示例内容
  await fetch(`${API}/api/file?path=${encodeURIComponent('欢迎使用.md')}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: original }),
  });

  console.log('[5] 深色主题');
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await cdp.evaluate('document.documentElement.dataset.theme')) === 'dark') break;
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.toolbar .icon-btn')].find((el) => (el.title || '').startsWith('主题'));
      button.click();
      return true;
    })()`);
    await sleep(320);
  }
  await cdp.waitFor('document.documentElement.dataset.theme === "dark"', 4000, '深色主题生效');
  check('深色主题生效', (await cdp.evaluate('document.documentElement.dataset.theme')) === 'dark');
  await cdp.screenshot('04-dark-split.png');

  console.log('[6] 视图切换');
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.view-seg button')].find((el) => el.textContent.includes('预览'));
    button.click();
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".workspace.view-preview") !== null', 3000, '切换到预览视图');
  check('预览视图隐藏编辑器', await cdp.evaluate('getComputedStyle(document.querySelector(".editor-pane")).display === "none"'));
  await cdp.screenshot('05-dark-preview.png');

  console.log('[7] 设置面板');
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.toolbar .icon-btn')].find((el) => el.title === '阅读与编辑设置');
    button.click();
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".settings-panel")', 3000, '设置面板打开');
  check('设置面板可打开', await cdp.evaluate('!!document.querySelector(".settings-panel")'));
  await cdp.screenshot('06-settings.png');
  await cdp.evaluate('document.querySelector(".settings-backdrop").click()');

  console.log('[8] 站内链接跳转');
  cdp.failures.length = 0;
  await cdp.evaluate('document.querySelector(".search-clear")?.click()');
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.view-seg button')].find((el) => el.textContent.includes('分栏'));
    button.click();
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".preview-pane a.internal-link")', 5000, '站内链接标记');
  await cdp.evaluate('document.querySelector(".preview-pane a.internal-link").click()');
  await cdp.waitFor('document.querySelector(".editor-textarea").value.includes("# Markdown 语法速查")', 8000, '站内链接打开文件');
  check('点击站内链接打开对应 Markdown', await cdp.evaluate('document.querySelector(".editor-textarea").value.includes("# Markdown 语法速查")'));

  console.log('[9] 新建 / 重命名 / 删除文件');
  await cdp.evaluate('document.querySelector(\'.sidebar-actions button[title="新建文件"]\').click()');
  await cdp.waitFor('!!document.querySelector(".dialog .text-input")', 3000, '新建文件对话框');
  await cdp.evaluate(setInputValue('.dialog .text-input', '自动化测试.md'));
  await cdp.evaluate('document.querySelector(".dialog-actions .btn.primary").click()');
  await cdp.waitFor('!!document.querySelector(".tree-row.is-active") && document.querySelector(".tree-row.is-active").textContent.includes("自动化测试.md")', 8000, '新文件出现在目录中');
  check('通过界面新建文件', await cdp.evaluate('document.querySelector(".editor-textarea").value.includes("# 自动化测试")'));
  const createdPath = await findTreeFilePath('自动化测试.md');
  check('新文件已写入磁盘', Boolean(createdPath) && (await fetch(`${API}/api/file?path=${encodeURIComponent(createdPath)}`)).status === 200);

  await cdp.evaluate('document.querySelector(\'.tree-row.is-active .mini-btn[title="重命名文件"]\').click()');
  await cdp.waitFor('!!document.querySelector(".dialog .text-input")', 3000, '重命名对话框');
  await cdp.evaluate(setInputValue('.dialog .text-input', '自动化改名.md'));
  await cdp.evaluate('document.querySelector(".dialog-actions .btn.primary").click()');
  await cdp.waitFor('!!document.querySelector(".tree-row.is-active") && document.querySelector(".tree-row.is-active").textContent.includes("自动化改名.md")', 8000, '文件重命名');
  const renamedPath = await findTreeFilePath('自动化改名.md');
  check('通过界面重命名文件', Boolean(renamedPath) && (await fetch(`${API}/api/file?path=${encodeURIComponent(renamedPath)}`)).status === 200);

  await cdp.evaluate('document.querySelector(\'.tree-row.is-active .mini-btn[title="删除文件"]\').click()');
  await cdp.waitFor('!!document.querySelector(".dialog-actions .btn.danger")', 3000, '删除确认框');
  await cdp.evaluate('document.querySelector(".dialog-actions .btn.danger").click()');
  await cdp.waitFor('!!document.querySelector(".empty-workspace")', 8000, '删除后回到空状态');
  check('通过界面删除文件', (await findTreeFilePath('自动化改名.md')) === null);

  console.log('[10] 导出 HTML');
  await cdp.evaluate(`(() => {
    const hit = [...document.querySelectorAll('.tree-row')].find((el) => el.textContent.trim() === '欢迎使用.md');
    hit.click();
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".editor-textarea").value.includes("# 欢迎使用 md_reader")', 8000, '重新打开欢迎文件');
  const downloadDir = path.join(SHOTS_DIR, 'downloads');
  await fs.rm(downloadDir, { recursive: true, force: true });
  await fs.mkdir(downloadDir, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: path.resolve(downloadDir),
    eventsEnabled: true,
  });
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.toolbar-right .btn')].find((el) => el.textContent.includes('导出'));
    button.click();
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".dropdown-menu")', 3000, '导出菜单');
  await cdp.evaluate(`(() => {
    const item = [...document.querySelectorAll('.dropdown-menu button')].find((el) => el.textContent.includes('导出为 HTML'));
    item.click();
    return true;
  })()`);
  const exportPath = path.join(downloadDir, '欢迎使用.html');
  const exportDeadline = Date.now() + 10000;
  while (Date.now() < exportDeadline) {
    try {
      const stat = await fs.stat(exportPath);
      if (stat.size > 0) break;
    } catch {
      // 尚未完成
    }
    await sleep(200);
  }
  const exported = await fs.readFile(exportPath, 'utf8');
  check('导出的 HTML 为独立文档', exported.includes('<article class="markdown-body">') && exported.includes('欢迎使用 md_reader'));
  check('导出时本地图片已内联', exported.includes('data:image/svg+xml;base64'));
  await fs.copyFile(exportPath, path.join(SHOTS_DIR, 'export-preview.html'));

  console.log('[11] 切换笔记空间');
  const originalConfig = await (await fetch(`${API}/api/config`)).json();
  const originalRoot = originalConfig.root;
  const switchDir = path.resolve('.switch-test');
  await fs.rm(switchDir, { recursive: true, force: true });
  await fs.mkdir(switchDir, { recursive: true });
  try {
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.toolbar .icon-btn')].find((el) => el.title === '阅读与编辑设置');
      button.click();
      return true;
    })()`);
    await cdp.waitFor('!!document.querySelector(".root-switch-row .text-input")', 3000, '笔记空间设置');
    await cdp.evaluate(setInputValue('.root-switch-row .text-input', switchDir));
    await cdp.evaluate('document.querySelector(".root-switch-row .btn.primary").click()');
    await cdp.waitFor(
      'document.querySelector(".sidebar-foot .foot-name")?.textContent.trim() === ".switch-test"',
      8000,
      '切换到新笔记空间',
    );
    const switchedConfig = await (await fetch(`${API}/api/config`)).json();
    check('运行时切换笔记空间', path.resolve(switchedConfig.root) === switchDir);
    check('空笔记空间显示空状态', await cdp.evaluate('!!document.querySelector(".empty-workspace")'));

    await cdp.evaluate(setInputValue('.root-switch-row .text-input', originalRoot));
    await cdp.evaluate('document.querySelector(".root-switch-row .btn.primary").click()');
    await cdp.waitFor(
      `document.querySelector(".sidebar-foot .foot-name")?.textContent.trim() === ${JSON.stringify(
        path.basename(originalRoot),
      )}`,
      8000,
      '切回原笔记空间',
    );
    await cdp.waitFor(
      'document.querySelector(".editor-textarea")?.value.includes("# 欢迎使用 md_reader")',
      8000,
      '切回后自动打开笔记',
    );
    const restored = await (await fetch(`${API}/api/config`)).json();
    check('切回原笔记空间', path.resolve(restored.root) === path.resolve(originalRoot));
    await cdp.evaluate('document.querySelector(".settings-backdrop").click()');
  } finally {
    try {
      await fetch(`${API}/api/root`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: originalRoot }),
      });
    } catch {
      // 恢复失败时保留原错误
    }
    await fs.rm(switchDir, { recursive: true, force: true });
  }

  console.log('[12] 工作区右键菜单');
  await cdp.evaluate(`(() => {
    const workspace = document.querySelector('.workspace-wrap');
    workspace.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 620,
      clientY: 340,
    }));
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".context-menu")', 3000, '右键菜单显示');
  check('右键工作区显示菜单', await cdp.evaluate('!!document.querySelector(".context-menu")'));
  check(
    '菜单包含新建文件',
    await cdp.evaluate(
      '[...document.querySelectorAll(".context-item .context-label")].some((el) => el.textContent === "新建文件")',
    ),
  );
  await cdp.screenshot('07-context-menu.png');
  await cdp.evaluate(`(() => {
    const item = [...document.querySelectorAll('.context-item')].find((el) => el.textContent.includes('新建文件'));
    item.click();
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".dialog .text-input")', 3000, '右键新建文件对话框');
  check('右键新建文件打开对话框', await cdp.evaluate('!!document.querySelector(".dialog .text-input")'));
  await cdp.evaluate('document.querySelector(".dialog-actions .btn.ghost").click()');
  await cdp.waitFor('!document.querySelector(".dialog")', 3000, '关闭新建文件对话框');
  check('取消后右键菜单已关闭', await cdp.evaluate('!document.querySelector(".context-menu")'));

  console.log('[13] 其他文本类型');
  const textPath = '文本测试.txt';
  const jsonPath = '配置测试.json';
  const testFiles = [
    [textPath, '纯文本第一行\n纯文本第二行'],
    [jsonPath, '{\n  "name": "md_reader",\n  "ok": true\n}'],
  ];
  for (const [path, content] of testFiles) {
    const created = await fetch(`${API}/api/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    if (!created.ok) throw new Error(`创建测试文件失败：${path}`);
  }
  await cdp.evaluate('document.querySelector(\'.sidebar-actions button[title="刷新目录"]\').click()');
  await cdp.waitFor(
    '[...document.querySelectorAll(".tree-row")].some((el) => el.textContent.trim() === "文本测试.txt")',
    8000,
    '文本文件出现在目录',
  );
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find((el) => el.textContent.trim() === '文本测试.txt');
    row.click();
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".editor-textarea").value.includes("纯文本第一行")', 8000, '打开文本文件');
  await cdp.waitFor('!!document.querySelector(".preview-pane pre.plain-pre")', 5000, '纯文本预览');
  check('打开并预览纯文本文件', await cdp.evaluate('document.querySelector(".plain-pre")?.textContent.includes("纯文本第二行")'));
  check('纯文本不按 Markdown 渲染', await cdp.evaluate('!document.querySelector(".preview-pane .markdown-body h1")'));
  await cdp.screenshot('08-text-preview.png');

  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find((el) => el.textContent.trim() === '配置测试.json');
    row.click();
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".editor-textarea").value.includes(\'"name"\')', 8000, '打开 JSON 文件');
  await cdp.waitFor('!!document.querySelector(".preview-pane pre.hljs[data-lang=\\"json\\"]")', 5000, 'JSON 高亮预览');
  check(
    'JSON 文件使用语法高亮预览',
    await cdp.evaluate('!!document.querySelector(".preview-pane pre.hljs[data-lang=\\"json\\"] .hljs-attr")'),
  );
  await cdp.screenshot('09-json-preview.png');

  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find((el) => el.textContent.trim() === '欢迎使用.md');
    row.click();
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".editor-textarea").value.includes("# 欢迎使用 md_reader")', 8000, '回到 Markdown 文件');
  for (const [path] of testFiles) {
    await fetch(`${API}/api/node?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  }
  await cdp.evaluate('document.querySelector(\'.sidebar-actions button[title="刷新目录"]\').click()');
  await cdp.waitFor(
    '[...document.querySelectorAll(".tree-row")].every((el) => !["文本测试.txt", "配置测试.json"].includes(el.textContent.trim()))',
    8000,
    '清理文本测试文件',
  );
  check('文本测试文件已清理', true);

  console.log('[14] 文档内查找');
  await cdp.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))');
  await cdp.waitFor('!!document.querySelector(".find-bar")', 3000, '文档内查找栏打开');
  check('Ctrl+F 打开文档内查找', await cdp.evaluate('!!document.querySelector(".find-bar")'));

  await cdp.evaluate(setInputValue('.find-input', 'Markdown'));
  await cdp.waitFor('document.querySelector(".find-count")?.textContent.includes("/")', 3000, '查找计数');
  const findCount = await cdp.evaluate('document.querySelector(".find-count")?.textContent.trim()');
  check('文档内查找显示命中计数', Boolean(findCount) && findCount.includes('/'));
  check('预览中的命中有高亮', await cdp.evaluate('document.querySelectorAll(".preview-pane mark.find-mark").length > 0'));
  const firstSelection = await cdp.evaluate('document.querySelector(".editor-textarea").selectionStart');
  const selectedText = await cdp.evaluate(
    '(() => { const el = document.querySelector(".editor-textarea"); return el.value.slice(el.selectionStart, el.selectionEnd); })()',
  );
  check('查找自动选中第一处命中', selectedText.toLowerCase() === 'markdown');
  check('当前命中在预览中高亮', await cdp.evaluate('!!document.querySelector(".preview-pane mark.find-mark.is-active")'));

  await cdp.evaluate(
    'document.querySelector(".find-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))',
  );
  await sleep(150);
  const secondSelection = await cdp.evaluate('document.querySelector(".editor-textarea").selectionStart');
  check('Enter 跳到下一处命中', secondSelection > firstSelection);
  await cdp.screenshot('12-find-bar.png');

  await cdp.evaluate(
    'document.querySelector(".find-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
  );
  await cdp.waitFor('!document.querySelector(".find-bar")', 3000, 'Esc 关闭查找');
  check(
    'Esc 关闭查找并清除高亮',
    await cdp.evaluate('!document.querySelector(".find-bar") && !document.querySelector(".find-mark")'),
  );

  console.log('[15] 拖拽提示（非桌面环境）');
  for (const name of ['拖拽测试.md', '拖拽测试 (1).md']) {
    await fetch(`${API}/api/node?path=${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
  await cdp.evaluate(`(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['# 拖拽测试'], '拖拽测试.md', { type: 'text/markdown' }));
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".drop-overlay")', 3000, '拖拽提示遮罩');
  check('拖入文件时显示提示遮罩', await cdp.evaluate('!!document.querySelector(".drop-overlay")'));

  await cdp.evaluate(`(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['# 拖拽测试'], '拖拽测试.md', { type: 'text/markdown' }));
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".toast")?.textContent.includes("仅支持桌面版")', 5000, '非桌面环境拖拽提示');
  check('非桌面环境提示仅桌面版可用', await cdp.evaluate('document.querySelector(".toast")?.textContent.includes("仅支持桌面版")'));
  check('拖入后提示遮罩已消失', await cdp.evaluate('!document.querySelector(".drop-overlay")'));
  check('非桌面环境不会写入拖入文件', (await findTreeFilePath('拖拽测试.md')) === null);

  console.log('[16] 侧栏右键菜单');
  await cdp.evaluate(`(() => {
    const row = document.querySelector('.tree-row.is-dir[data-path="指南"]');
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 180,
      clientY: 260,
    }));
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".context-menu")', 3000, '侧栏右键菜单');
  check('侧栏右键文件夹显示菜单', await cdp.evaluate('!!document.querySelector(".context-menu")'));
  check(
    '菜单包含新建、重命名、删除',
    await cdp.evaluate(`(() => {
      const labels = [...document.querySelectorAll('.context-item .context-label')].map((el) => el.textContent);
      return ['新建文件', '新建文件夹', '重命名', '删除'].every((label) => labels.includes(label));
    })()`),
  );
  await cdp.screenshot('10-sidebar-context-menu.png');

  await cdp.evaluate(`(() => {
    const item = [...document.querySelectorAll('.context-item')].find(
      (el) => el.querySelector('.context-label')?.textContent === '新建文件',
    );
    item.click();
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".dialog .text-input")', 3000, '侧栏新建文件对话框');
  check('侧栏右键新建文件打开对话框', await cdp.evaluate('!!document.querySelector(".dialog .text-input")'));
  check(
    '新建位置为右键的文件夹',
    await cdp.evaluate('document.querySelector(".dialog-hint")?.textContent.includes("指南/")'),
  );
  await cdp.evaluate(setInputValue('.dialog .text-input', '侧栏右键测试.txt'));
  await cdp.evaluate('document.querySelector(".dialog-actions .btn.primary").click()');
  await cdp.waitFor(
    '[...document.querySelectorAll(".tree-row")].some((el) => el.dataset.path === "指南/侧栏右键测试.txt")',
    8000,
    '侧栏右键创建文件',
  );
  check(
    '侧栏右键创建文件写入磁盘',
    (await fetch(`${API}/api/file?path=${encodeURIComponent('指南/侧栏右键测试.txt')}`)).status === 200,
  );
  check(
    '新文件自动打开',
    await cdp.evaluate('document.querySelector(".tree-row.is-active")?.dataset.path === "指南/侧栏右键测试.txt"'),
  );

  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (el) => el.dataset.path === '欢迎使用.md',
    );
    row.click();
    return true;
  })()`);
  await cdp.waitFor('document.querySelector(".editor-textarea").value.includes("# 欢迎使用 md_reader")', 8000, '回到欢迎文件');
  await fetch(`${API}/api/node?path=${encodeURIComponent('指南/侧栏右键测试.txt')}`, { method: 'DELETE' });
  await cdp.evaluate('document.querySelector(\'.sidebar-actions button[title="刷新目录"]\').click()');
  await cdp.waitFor(
    '[...document.querySelectorAll(".tree-row")].every((el) => el.dataset.path !== "指南/侧栏右键测试.txt")',
    8000,
    '清理侧栏测试文件',
  );

  await cdp.evaluate(`(() => {
    const list = document.querySelector('.sidebar-list');
    list.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 160,
      clientY: 520,
    }));
    return true;
  })()`);
  await cdp.waitFor('!!document.querySelector(".context-menu")', 3000, '侧栏空白处右键菜单');
  check('侧栏空白处可右键新建', await cdp.evaluate('[...document.querySelectorAll(".context-item .context-label")].some((el) => el.textContent === "新建文件")'));
  await cdp.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await cdp.waitFor('!document.querySelector(".context-menu")', 3000, 'Esc 关闭侧栏菜单');
  check('Esc 可关闭侧栏右键菜单', await cdp.evaluate('!document.querySelector(".context-menu")'));

  if (cdp.logs.length > 0) {
    console.log('\n页面资源日志：');
    for (const log of cdp.logs) console.log(`  ⚠ ${log}`);
  }
  if (cdp.failures.length > 0) {
    console.log('\n失败的网络请求：');
    for (const failure of cdp.failures) console.log(`  ⚠ ${failure}`);
  }
  if (cdp.errors.length > 0) {
    console.log('\n页面错误：');
    for (const error of cdp.errors) console.log(`  ✖ ${error}`);
    throw new Error(`页面存在 ${cdp.errors.length} 个脚本错误`);
  }

  console.log(`\n界面检查全部 ${checks.length} 项通过，无脚本错误。`);
  await cdp.close();
}

main()
  .catch((error) => {
    console.error(`\n检查失败：${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(CONFIG_FILE, { force: true });
  });
