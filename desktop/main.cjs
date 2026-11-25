const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_NAME = 'md_reader';

function logError(err) {
  try {
    const logFile = path.join(app.getPath('userData'), 'desktop.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${err?.stack ?? err}\n`, 'utf8');
  } catch {
    // 日志写入失败时忽略
  }
}

process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

let httpServer = null;
let serverPort = 0;

function notesDirectory() {
  return path.join(app.getPath('documents'), APP_NAME);
}

function isWritableDirectory(dir) {
  try {
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function copySampleDocs(dir) {
  const sampleDir = app.isPackaged
    ? path.join(process.resourcesPath, 'docs')
    : path.join(__dirname, '..', 'docs');
  if (fs.existsSync(sampleDir)) {
    fs.cpSync(sampleDir, dir, { recursive: true });
  }
}

function seedNotes() {
  const candidates = [notesDirectory(), path.join(app.getPath('userData'), 'notes')];
  let lastError = null;

  for (const dir of candidates) {
    try {
      const existed = fs.existsSync(dir);
      if (!existed) fs.mkdirSync(dir, { recursive: true });
      if (!isWritableDirectory(dir)) throw new Error(`目录不可写：${dir}`);
      if (!existed) copySampleDocs(dir);
      return dir;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('无法创建笔记目录');
}

function prepareConfig() {
  const configFile = path.join(app.getPath('userData'), 'md_reader.json');
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    // 首次启动或配置损坏时重新生成
  }

  const root = config && typeof config.root === 'string' ? config.root : '';
  if (root && fs.existsSync(root) && fs.statSync(root).isDirectory() && isWritableDirectory(root)) {
    return configFile;
  }

  const notes = seedNotes();
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(
    configFile,
    JSON.stringify({ root: notes, recent: Array.isArray(config?.recent) ? config.recent : [] }, null, 2),
    'utf8',
  );
  return configFile;
}

async function startLocalServer() {
  process.env.MD_CONFIG_FILE = prepareConfig();
  // 桌面版允许拖入任意位置的文件，直接按原路径读写。
  process.env.MD_ALLOW_ABSOLUTE = '1';
  delete process.env.MD_ROOT;
  delete process.env.PORT;

  const serverPath = path.join(__dirname, '..', 'server', 'index.mjs');
  const { startServer } = await import(pathToFileURL(serverPath).href);
  const result = await startServer({ port: 0, host: '127.0.0.1' });
  httpServer = result.server;
  serverPort = result.port;
  return result.port;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#ffffff',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const origin = `http://127.0.0.1:${serverPort}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  win.once('ready-to-show', () => win.show());
  await win.loadURL(origin);
}

app.setAppUserModelId('com.moduo.reader');

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    await startLocalServer();
    await createWindow();
  } catch (err) {
    logError(err);
    dialog.showErrorBox('md_reader 启动失败', err instanceof Error ? err.message : String(err));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (!httpServer) return;
  try {
    httpServer.close();
  } catch {
    // 进程退出时忽略关闭错误
  }
  httpServer = null;
});
