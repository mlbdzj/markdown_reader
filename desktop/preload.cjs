const { contextBridge, webUtils } = require('electron');

// 渲染进程是普通网页，只有 preload 能拿到拖入文件的真实路径。
contextBridge.exposeInMainWorld('mdReader', {
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});
