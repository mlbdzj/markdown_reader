import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { packager } from '@electron/packager';

const root = process.cwd();
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('缺少 dist/index.html，请先运行 npm run build');
  process.exit(1);
}

function buildLauncher(outputDir) {
  const coreExe = path.join(outputDir, 'md_reader.exe');
  const runtimeExe = path.join(outputDir, 'md_reader-core.exe');
  if (!fs.existsSync(coreExe)) {
    throw new Error(`未找到打包后的可执行文件：${coreExe}`);
  }
  fs.renameSync(coreExe, runtimeExe);

  const cscCandidates = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  const csc = cscCandidates.find((candidate) => fs.existsSync(candidate));
  if (!csc) {
    throw new Error('未找到 C# 编译器（csc.exe），无法生成启动器');
  }

  execFileSync(
    csc,
    [
      '/nologo',
      '/codepage:65001',
      '/target:winexe',
      `/win32icon:${path.join(root, 'build', 'icon.ico')}`,
      `/out:${coreExe}`,
      path.join(root, 'launcher', 'Launcher.cs'),
      '/reference:System.Windows.Forms.dll',
    ],
    { stdio: 'inherit' },
  );
}

// 允许使用本地缓存的 Electron 压缩包，便于离线打包。
const zipDir = path.join(root, '.electron-zips');
const hasLocalZip = fs.existsSync(path.join(zipDir, 'electron-v45.4.1-win32-x64.zip'));

const outputs = await packager({
  dir: root,
  name: 'md_reader',
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'release'),
  overwrite: true,
  prune: false,
  asar: false,
  ...(hasLocalZip ? { electronZipDir: zipDir } : {}),
  icon: path.join(root, 'build', 'icon.ico'),
  extraResource: [path.join(root, 'docs')],
  ignore: [
    /^\/(src|scripts|screenshots|public|release|node_modules|docs|launcher)(\/|$)/,
    /^\/(README\.md|AGENTS\.md|package-lock\.json|index\.html|tsconfig\.json|vite\.config\.ts|\.gitignore)$/,
    /^\/\.npm-(cache|logs)(\/|$)/,
    /^\/\.electron-zips(\/|$)/,
    /^\/\.electron-.*/,
    /^\/\.desktop-.*/,
    /^\/\.packaged-.*/,
    /^\/(\.tmp|\.shots|\.chrome-profile|\.chrome-gui|\.switch-test|\.ui-check-config\.json|\.md_reader\.json|\.md-reader\.json)(\/|$)/,
    /^\/npm-desktop-install\.log$/,
  ],
});

for (const output of outputs) {
  buildLauncher(output);
  console.log(`桌面应用已生成：${output}`);
  console.log(`双击启动：${path.join(output, 'md_reader.exe')}`);
}
