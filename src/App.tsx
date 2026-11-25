import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import * as api from './api';
import { ContextMenu, type ContextMenuAction } from './components/ContextMenu';
import { Dialog, type DialogConfig } from './components/Dialog';
import { Editor, type EditorHandle } from './components/Editor';
import { FindBar } from './components/FindBar';
import { CopyIcon, FilePlusIcon, FolderPlusIcon, PencilIcon, RefreshIcon, SaveIcon, TrashIcon } from './components/Icons';
import { Preview, type PreviewHandle } from './components/Preview';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toast, type ToastState } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { useDebouncedValue } from './lib/hooks';
import { buildExportDocument } from './lib/exportDoc';
import {
  ensureNewFileName,
  ensureRenamedFileName,
  isMarkdownPath,
  isSupportedTextPath,
} from './lib/fileTypes';
import { downloadTextFile } from './lib/exportHtml';
import { DEFAULT_SETTINGS, FONT_STACKS, loadSettings, saveSettings } from './lib/settings';
import {
  countLines,
  countWords,
  basename,
  dirname,
  findTextMatches,
  isAbsolutePath,
  joinPath,
  relativeToRoot,
  titleFromPath,
} from './lib/text';
import type { AppConfig, SearchHit, Settings, ThemeMode, TreeNode, ViewMode } from './types';

const LAST_FILE_KEY = 'md_reader.last-file.v1';
const EXPANDED_KEY = 'md_reader.expanded.v1';

function collectFiles(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
  for (const child of node.children ?? []) {
    if (child.type === 'file') out.push(child);
    else collectFiles(child, out);
  }
  return out;
}

function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  const result: string[] = [];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    result.push(current);
  }
  return result;
}

function getSelectedText(): string {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && active.selectionStart !== active.selectionEnd) {
    return active.value.slice(active.selectionStart, active.selectionEnd);
  }
  const selection = window.getSelection();
  return selection && !selection.isCollapsed ? selection.toString() : '';
}

type ContextMenuState =
  | { kind: 'workspace'; x: number; y: number; selection: string }
  | { kind: 'sidebar'; x: number; y: number; dir: string; node: TreeNode | null };

function EmptyState({ onNewFile }: { onNewFile: () => void }) {
  return (
    <div className="empty-workspace">
      <span className="empty-eyebrow">md_reader · 本地笔记</span>
      <h1>从一页空白开始</h1>
      <p>在左侧选择文件，或新建一个 Markdown / 文本文件；也可以把文件直接拖入窗口。</p>
      <button type="button" className="btn primary lg" onClick={() => onNewFile()}>
        <FilePlusIcon size={15} />
        新建文件
      </button>
    </div>
  );
}

export default function App() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeDir, setActiveDir] = useState('');
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [splitPct, setSplitPct] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [previewFindCount, setPreviewFindCount] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [printing, setPrinting] = useState(false);

  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startPct: number; width: number } | null>(null);
  const dropDepth = useRef(0);
  const toastTimer = useRef<number | null>(null);

  const dirty = currentPath !== null && content !== savedContent;
  const findMatches = useMemo(() => findTextMatches(content, findQuery), [content, findQuery]);
  const findTotal = viewMode === 'preview' ? previewFindCount : findMatches.length;
  const findActiveIndex = findTotal > 0 ? findIndex % findTotal : -1;

  const stateRef = useRef({ currentPath, content, dirty, saving, autosave: settings.autosave });
  stateRef.current = { currentPath, content, dirty, saving, autosave: settings.autosave };

  const showToast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery('');
    setFindIndex(0);
  }, []);

  const openFind = useCallback(() => {
    if (!stateRef.current.currentPath) return;
    setFindOpen(true);
    window.requestAnimationFrame(() => {
      const input = document.getElementById('find-input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }, []);

  const handleFindQueryChange = useCallback(
    (value: string) => {
      setFindQuery(value);
      setFindIndex(0);
      if (viewMode === 'preview' || !value.trim()) return;
      const first = findTextMatches(content, value)[0];
      if (first) editorRef.current?.selectRange(first.start, first.end);
    },
    [content, viewMode],
  );

  const stepFind = useCallback(
    (delta: number) => {
      if (findTotal === 0) return;
      const next = (findIndex + delta + findTotal) % findTotal;
      setFindIndex(next);
      if (viewMode === 'preview') return;
      const matches = findTextMatches(content, findQuery);
      const match = matches[next % matches.length];
      if (match) editorRef.current?.selectRange(match.start, match.end);
    },
    [content, findIndex, findQuery, findTotal, viewMode],
  );

  const copySelection = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制选中内容');
    } catch {
      showToast('复制失败，请使用 Ctrl+C', 'error');
    }
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const expandAncestors = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      for (const ancestor of ancestorPaths(path)) next.add(ancestor);
      return next;
    });
  }, []);

  const clearEditor = useCallback(() => {
    setCurrentPath(null);
    setContent('');
    setSavedContent('');
    setSavedAt(null);
    closeFind();
    localStorage.removeItem(LAST_FILE_KEY);
  }, [closeFind]);

  const saveCurrent = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      const path = stateRef.current.currentPath;
      if (!path) return false;
      if (stateRef.current.saving) return false;
      const snapshot = stateRef.current.content;
      setSaving(true);
      try {
        await api.saveFile(path, snapshot);
        setSavedContent(snapshot);
        setSavedAt(Date.now());
        if (!options?.silent) showToast('已保存');
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : '保存失败', 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [showToast],
  );

  const openFile = useCallback(
    async (path: string, anchor?: string): Promise<boolean> => {
      const state = stateRef.current;
      if (path === state.currentPath && !anchor) return false;
      if (state.dirty && state.currentPath) {
        if (state.autosave) {
          const saved = await saveCurrent({ silent: true });
          if (!saved) return false;
        } else if (!window.confirm('当前文件有未保存的修改，切换后将丢失。是否继续？')) {
          return false;
        }
      }

      setLoadingFile(true);
      try {
        const file = await api.readFile(path);
        setCurrentPath(file.path);
        setContent(file.content);
        setSavedContent(file.content);
        setSavedAt(null);
        if (isAbsolutePath(file.path)) {
          setActiveDir('');
        } else {
          setActiveDir(dirname(file.path));
          expandAncestors(file.path);
          localStorage.setItem(LAST_FILE_KEY, file.path);
        }
        setFindIndex(0);
        window.requestAnimationFrame(() => {
          editorRef.current?.scrollToTop();
          previewRef.current?.scrollToTop();
          if (anchor) {
            window.requestAnimationFrame(() => previewRef.current?.scrollToAnchor(anchor));
          }
        });
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : '打开文件失败', 'error');
        return false;
      } finally {
        setLoadingFile(false);
      }
    },
    [expandAncestors, saveCurrent, showToast],
  );

  const refreshTree = useCallback(
    async (options?: { notify?: boolean; skipCurrentCheck?: boolean }) => {
      setTreeLoading(true);
      try {
        const next = await api.getTree();
        setTree(next);
        if (options?.notify) showToast('目录已刷新');
        const state = stateRef.current;
        if (!options?.skipCurrentCheck && state.currentPath && !isAbsolutePath(state.currentPath)) {
          const exists = collectFiles(next).some((file) => file.path === state.currentPath);
          if (!exists) {
            clearEditor();
            showToast('当前文件已不存在，可能被外部删除', 'error');
          }
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : '刷新目录失败', 'error');
      } finally {
        setTreeLoading(false);
      }
    },
    [clearEditor, showToast],
  );

  // 拖入文件：桌面版直接打开原文件，笔记目录内的文件仍用相对路径以保持树高亮。
  const handleDroppedFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      if (!isSupportedTextPath(file.name)) {
        showToast(`不支持的文件类型：${file.name}`, 'error');
        return;
      }

      const absolutePath = window.mdReader?.getPathForFile(file) ?? '';
      if (!absolutePath) {
        showToast('拖拽打开仅支持桌面版', 'error');
        return;
      }

      const root = config?.root ?? '';
      const rel = root ? relativeToRoot(root, absolutePath) : null;
      const targetPath = rel || absolutePath.replaceAll('\\', '/');
      try {
        if (rel) await refreshTree({ skipCurrentCheck: true });
        if (await openFile(targetPath)) showToast(`已打开 ${file.name}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : '打开拖入的文件失败', 'error');
      }
    },
    [config, openFile, refreshTree, showToast],
  );

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dropDepth.current += 1;
      setDropping(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dropDepth.current = Math.max(0, dropDepth.current - 1);
      if (dropDepth.current === 0) setDropping(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dropDepth.current = 0;
      setDropping(false);
      void handleDroppedFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleDroppedFiles]);

  // 首次加载：拉取目录树，恢复上次打开的文件（否则打开第一篇）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTreeLoading(true);
      try {
        const next = await api.getTree();
        if (cancelled) return;
        setTree(next);
        try {
          const appConfig = await api.getConfig();
          if (!cancelled) setConfig(appConfig);
        } catch {
          // 配置接口失败不影响正常读写
        }
        if (!localStorage.getItem(EXPANDED_KEY)) {
          setExpanded(new Set((next.children ?? []).filter((node) => node.type === 'dir').map((node) => node.path)));
        }
        const files = collectFiles(next);
        const lastPath = localStorage.getItem(LAST_FILE_KEY);
        const preferred = files.find((file) => /^(欢迎使用|readme)\.md$/i.test(file.name));
        const target = files.find((file) => file.path === lastPath) ?? preferred ?? files[0];
        if (target) await openFile(target.path);
      } catch (err) {
        if (!cancelled) showToast(err instanceof Error ? err.message : '加载目录失败', 'error');
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动保存：停止输入约 1 秒后写入。
  useEffect(() => {
    if (!settings.autosave || !currentPath || !dirty || saving) return;
    const timer = window.setTimeout(() => {
      void saveCurrent({ silent: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [settings.autosave, currentPath, dirty, saving, content, saveCurrent]);

  // 搜索（防抖）
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.search(query);
        if (!cancelled) setSearchResults(response.results);
      } catch (err) {
        if (!cancelled) {
          setSearchResults([]);
          showToast(err instanceof Error ? err.message : '搜索失败', 'error');
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, showToast]);

  // 主题：写入 html[data-theme]，跟随系统时监听系统变化。
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
      document.documentElement.dataset.theme = effective;
    };
    apply();
    if (settings.theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [settings.theme]);

  // 排版设置：通过 CSS 变量应用到预览区，并持久化。
  useEffect(() => {
    const style = document.documentElement.style;
    style.setProperty('--content-font-size', `${settings.fontSize}px`);
    style.setProperty('--content-line-height', String(settings.lineHeight));
    style.setProperty('--content-width', `${settings.contentWidth}px`);
    style.setProperty('--content-font-family', FONT_STACKS[settings.fontFamily]);
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      // 忽略存储失败
    }
  }, [expanded]);

  useEffect(() => {
    document.title = currentPath ? `${titleFromPath(currentPath)} · md_reader` : 'md_reader · Markdown';
  }, [currentPath]);

  // 全局快捷键：Ctrl+S 保存、Ctrl+B 侧栏、Ctrl+K 搜索、Ctrl+F 文档内查找、Ctrl+E 切换视图。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || dialog) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void saveCurrent();
      } else if (key === 'b') {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (key === 'k') {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      } else if (key === 'f') {
        if (!stateRef.current.currentPath) return;
        event.preventDefault();
        openFind();
      } else if (key === 'e') {
        event.preventDefault();
        setViewMode((mode) => (mode === 'split' ? 'editor' : mode === 'editor' ? 'preview' : 'split'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, openFind, saveCurrent, settingsOpen]);

  const toggleDir = useCallback((path: string) => {
    setActiveDir(path);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openNewFileDialog = (targetDir?: string) => {
    const dir = typeof targetDir === 'string' ? targetDir : activeDir;
    setDialog({
      kind: 'prompt',
      title: '新建文件',
      label: '文件名',
      defaultValue: '未命名.md',
      placeholder: '例如：读书笔记.md、notes.txt',
      hint: dir ? `创建位置：${dir}/` : '创建位置：笔记根目录',
      confirmText: '创建',
      onSubmit: async (raw) => {
        const name = ensureNewFileName(raw.trim());
        if (/[\\/]/.test(name)) throw new Error('文件名不能包含斜杠');
        const path = joinPath(dir, name);
        const initial = isMarkdownPath(name) ? `# ${titleFromPath(name)}\n\n` : '';
        await api.createFile(path, initial);
        await refreshTree();
        setSearchQuery('');
        setExpanded((previous) => {
          const next = new Set(previous);
          for (const ancestor of dir ? ancestorPaths(`${dir}/x`) : []) next.add(ancestor);
          return next;
        });
        setActiveDir(dir);
        await openFile(path);
        showToast('已创建文件');
      },
    });
  };

  const openNewFolderDialog = (targetDir?: string) => {
    const dir = typeof targetDir === 'string' ? targetDir : activeDir;
    setDialog({
      kind: 'prompt',
      title: '新建文件夹',
      label: '文件夹名称',
      defaultValue: '新建文件夹',
      hint: dir ? `创建位置：${dir}/` : '创建位置：笔记根目录',
      confirmText: '创建',
      onSubmit: async (raw) => {
        const name = raw.trim();
        if (/[\\/]/.test(name)) throw new Error('文件夹名称不能包含斜杠');
        const path = joinPath(dir, name);
        await api.createFolder(path);
        await refreshTree();
        setSearchQuery('');
        setExpanded((previous) => {
          const next = new Set(previous);
          for (const ancestor of dir ? ancestorPaths(`${dir}/x`) : []) next.add(ancestor);
          return next;
        });
        setActiveDir(path);
        showToast('已创建文件夹');
      },
    });
  };

  const openRenameDialog = (node: TreeNode) => {
    const isDir = node.type === 'dir';
    setDialog({
      kind: 'prompt',
      title: isDir ? '重命名文件夹' : '重命名文件',
      label: '新名称',
      defaultValue: node.name,
      confirmText: '重命名',
      hint: isDir ? '文件夹内的文件路径会随之改变' : '未填写扩展名时会保留原扩展名',
      onSubmit: async (raw) => {
        const name = raw.trim();
        if (/[\\/]/.test(name)) throw new Error('名称不能包含斜杠');
        const targetName = isDir ? name : ensureRenamedFileName(name, node.name);
        const to = joinPath(dirname(node.path), targetName);
        if (to === node.path) return;

        if (stateRef.current.dirty) {
          const saved = await saveCurrent({ silent: true });
          if (!saved) throw new Error('当前文件保存失败，已取消重命名');
        }

        await api.renameNode(node.path, to);
        const state = stateRef.current;
        let nextCurrent = state.currentPath;
        if (state.currentPath === node.path) {
          nextCurrent = to;
        } else if (isDir && state.currentPath?.startsWith(`${node.path}/`)) {
          nextCurrent = `${to}${state.currentPath.slice(node.path.length)}`;
        }
        if (nextCurrent && nextCurrent !== state.currentPath) {
          setCurrentPath(nextCurrent);
          localStorage.setItem(LAST_FILE_KEY, nextCurrent);
        }
        if (activeDir === node.path) setActiveDir(to);
        else if (activeDir.startsWith(`${node.path}/`)) setActiveDir(`${to}${activeDir.slice(node.path.length)}`);
        await refreshTree({ skipCurrentCheck: true });
        setSearchQuery('');
        showToast('已重命名');
      },
    });
  };

  const openDeleteDialog = (node: TreeNode) => {
    const isDir = node.type === 'dir';
    setDialog({
      kind: 'confirm',
      title: isDir ? '删除文件夹' : '删除文件',
      message: isDir
        ? `确定删除文件夹「${node.name}」及其中的全部内容吗？此操作不可撤销。`
        : `确定删除文件「${node.name}」吗？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
      onSubmit: async () => {
        await api.deleteNode(node.path, isDir);
        const state = stateRef.current;
        const affectsCurrent =
          state.currentPath !== null &&
          (state.currentPath === node.path || (isDir && state.currentPath.startsWith(`${node.path}/`)));
        if (affectsCurrent) {
          clearEditor();
          showToast('已删除当前打开的文件');
        } else {
          showToast('已删除');
        }
        await refreshTree({ skipCurrentCheck: true });
        setSearchQuery('');
      },
    });
  };

  const openSidebarContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    const searchHit = target.closest<HTMLElement>('.search-hit');
    if (searchHit?.dataset.path) {
      event.preventDefault();
      const path = searchHit.dataset.path;
      setContextMenu({
        kind: 'sidebar',
        x: event.clientX,
        y: event.clientY,
        dir: dirname(path),
        node: { name: basename(path), path, type: 'file' },
      });
      return;
    }

    const row = target.closest<HTMLElement>('.tree-row');
    if (row?.dataset.path) {
      event.preventDefault();
      const path = row.dataset.path;
      const type: TreeNode['type'] = row.dataset.kind === 'dir' ? 'dir' : 'file';
      setContextMenu({
        kind: 'sidebar',
        x: event.clientX,
        y: event.clientY,
        dir: type === 'dir' ? path : dirname(path),
        node: { name: basename(path), path, type },
      });
      return;
    }

    if (target.closest('.sidebar-list')) {
      event.preventDefault();
      setContextMenu({ kind: 'sidebar', x: event.clientX, y: event.clientY, dir: '', node: null });
    }
  };

  const cycleTheme = () => {
    setSettings((previous) => {
      const next: ThemeMode = previous.theme === 'light' ? 'dark' : previous.theme === 'dark' ? 'system' : 'light';
      return { ...previous, theme: next };
    });
  };

  const handleSwitchRoot = async (path: string) => {
    const state = stateRef.current;
    if (state.dirty && state.currentPath) {
      const saved = await saveCurrent({ silent: true });
      if (!saved) throw new Error('当前文件保存失败，已取消切换');
    }

    const nextConfig = await api.switchRoot(path);
    setConfig(nextConfig);
    clearEditor();
    stateRef.current = { ...stateRef.current, currentPath: null, content: '', dirty: false };
    setTree(null);
    setTreeLoading(true);
    setActiveDir('');
    setExpanded(new Set());
    setSearchQuery('');
    setSearchResults(null);

    try {
      const next = await api.getTree();
      setTree(next);
      setExpanded(new Set((next.children ?? []).filter((node) => node.type === 'dir').map((node) => node.path)));
      const files = collectFiles(next);
      const preferred = files.find((file) => /^(欢迎使用|readme)\.md$/i.test(file.name));
      const target = preferred ?? files[0];
      if (target) await openFile(target.path);
      showToast('已切换笔记空间');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载新目录失败', 'error');
    } finally {
      setTreeLoading(false);
    }
  };

  const handleExportHtml = async () => {
    const state = stateRef.current;
    if (!state.currentPath) return;
    try {
      const documentHtml = await buildExportDocument(
        titleFromPath(state.currentPath),
        state.currentPath,
        state.content,
      );
      downloadTextFile(`${titleFromPath(state.currentPath)}.html`, documentHtml, 'text/html;charset=utf-8');
      showToast('已导出 HTML 文件');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', 'error');
    }
  };

  const handleExportPdf = () => {
    const state = stateRef.current;
    if (!state.currentPath) return;
    const previousTitle = document.title;
    document.title = titleFromPath(state.currentPath);
    setPrinting(true);
    window.setTimeout(() => {
      try {
        window.print();
      } finally {
        window.setTimeout(() => {
          setPrinting(false);
          document.title = previousTitle;
        }, 200);
      }
    }, 200);
  };

  const handleEditorScroll = (ratio: number) => {
    if (settings.syncScroll) previewRef.current?.setScrollRatio(ratio);
  };

  const handlePreviewScroll = (ratio: number) => {
    if (settings.syncScroll) editorRef.current?.setScrollRatio(ratio);
  };

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX: event.clientX, startPct: splitPct, width: rect.width };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const percent = drag.startPct + ((event.clientX - drag.startX) / drag.width) * 100;
    setSplitPct(Math.min(75, Math.max(25, percent)));
  };

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 指针捕获可能已自动释放
    }
  };

  const previewInput = useMemo(() => ({ content, path: currentPath }), [content, currentPath]);
  const debouncedPreview = useDebouncedValue(previewInput, 120);
  const statsContent = useDebouncedValue(content, 200);
  const stats = useMemo(
    () => ({
      words: countWords(statsContent),
      lines: countLines(statsContent),
    }),
    [statsContent],
  );

  const workspaceStyle =
    viewMode === 'split' ? { gridTemplateColumns: `${splitPct}% 10px minmax(0, 1fr)` } : undefined;

  const workspaceSelection = contextMenu?.kind === 'workspace' ? contextMenu.selection : '';

  const workspaceMenuItems: ContextMenuAction[] = [
    {
      label: '新建文件',
      icon: <FilePlusIcon size={15} />,
      onSelect: () => openNewFileDialog(),
    },
    {
      label: '新建文件夹',
      icon: <FolderPlusIcon size={15} />,
      onSelect: () => openNewFolderDialog(),
    },
    {
      label: '保存',
      icon: <SaveIcon size={15} />,
      shortcut: 'Ctrl+S',
      disabled: !currentPath || !dirty || saving,
      separatorBefore: true,
      onSelect: () => void saveCurrent(),
    },
    {
      label: '复制选中内容',
      icon: <CopyIcon size={15} />,
      shortcut: 'Ctrl+C',
      disabled: !workspaceSelection,
      separatorBefore: true,
      onSelect: () => void copySelection(workspaceSelection),
    },
    {
      label: '刷新目录',
      icon: <RefreshIcon size={15} />,
      separatorBefore: true,
      onSelect: () => void refreshTree({ notify: true }),
    },
  ];

  const sidebarMenuItems: ContextMenuAction[] = (() => {
    if (contextMenu?.kind !== 'sidebar') return [];
    const target = contextMenu;
    const items: ContextMenuAction[] = [
      {
        label: '新建文件',
        icon: <FilePlusIcon size={15} />,
        onSelect: () => openNewFileDialog(target.dir),
      },
      {
        label: '新建文件夹',
        icon: <FolderPlusIcon size={15} />,
        onSelect: () => openNewFolderDialog(target.dir),
      },
    ];

    if (target.node) {
      const node = target.node;
      items.push(
        {
          label: '重命名',
          icon: <PencilIcon size={15} />,
          separatorBefore: true,
          onSelect: () => openRenameDialog(node),
        },
        {
          label: '删除',
          icon: <TrashIcon size={15} />,
          danger: true,
          onSelect: () => openDeleteDialog(node),
        },
      );
    }

    items.push({
      label: '刷新目录',
      icon: <RefreshIcon size={15} />,
      separatorBefore: true,
      onSelect: () => void refreshTree({ notify: true }),
    });

    return items;
  })();

  return (
    <div className="app">
      <Toolbar
        currentPath={currentPath}
        dirty={dirty}
        saving={saving}
        viewMode={viewMode}
        theme={settings.theme}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onViewModeChange={setViewMode}
        onSave={() => void saveCurrent()}
        onExportHtml={() => void handleExportHtml()}
        onExportPdf={handleExportPdf}
        onCycleTheme={cycleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="app-body">
        {sidebarOpen && (
          <Sidebar
            tree={tree}
            loading={treeLoading}
            currentPath={currentPath}
            activeDir={activeDir}
            expanded={expanded}
            searchQuery={searchQuery}
            searchResults={searchResults}
            searchLoading={searchLoading}
            onToggleDir={toggleDir}
            onOpenFile={(path) => void openFile(path)}
            onNewFile={openNewFileDialog}
            onNewFolder={openNewFolderDialog}
            onRefresh={() => void refreshTree({ notify: true })}
            onRename={openRenameDialog}
            onDelete={openDeleteDialog}
            onSearchQueryChange={setSearchQuery}
            onClearSearch={() => setSearchQuery('')}
            onOpenSearchHit={(path) => void openFile(path)}
            onListContextMenu={openSidebarContextMenu}
          />
        )}

        <main
          className="workspace-wrap"
          ref={workspaceRef}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ kind: 'workspace', x: event.clientX, y: event.clientY, selection: getSelectedText() });
          }}
        >
          {currentPath ? (
            <div
              className={`workspace view-${viewMode} ${dragging ? 'is-dragging' : ''}`}
              style={workspaceStyle}
            >
              <section className="editor-pane">
                <Editor
                  ref={editorRef}
                  value={content}
                  onChange={setContent}
                  onScrollRatio={handleEditorScroll}
                />
              </section>
              <div
                className="split-handle"
                title="拖动调整分栏宽度，双击恢复居中"
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onDoubleClick={() => setSplitPct(50)}
              >
                <span className="split-handle-grip" />
              </div>
              <Preview
                ref={previewRef}
                content={printing ? content : debouncedPreview.content}
                basePath={printing ? currentPath : debouncedPreview.path}
                kind={
                  isMarkdownPath(printing ? currentPath ?? '' : debouncedPreview.path ?? '')
                    ? 'markdown'
                    : 'text'
                }
                findQuery={findOpen ? findQuery : ''}
                findIndex={findIndex}
                onFindCount={setPreviewFindCount}
                onOpenFile={(path, anchor) => void openFile(path, anchor)}
                onScrollRatio={handlePreviewScroll}
              />
            </div>
          ) : (
            <EmptyState onNewFile={openNewFileDialog} />
          )}
          {loadingFile && (
            <div className="workspace-loading">
              <span className="spinner" />
              正在打开…
            </div>
          )}
          {findOpen && (
            <FindBar
              query={findQuery}
              total={findTotal}
              activeIndex={findActiveIndex}
              onChange={handleFindQueryChange}
              onPrev={() => stepFind(-1)}
              onNext={() => stepFind(1)}
              onClose={closeFind}
            />
          )}
        </main>
      </div>

      <StatusBar
        wordCount={stats.words}
        lineCount={stats.lines}
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        autosave={settings.autosave}
      />

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          root={config?.root ?? ''}
          recentRoots={config?.recent ?? []}
          envOverride={config?.envOverride ?? false}
          onChange={(patch) => setSettings((previous) => ({ ...previous, ...patch }))}
          onReset={() => setSettings(DEFAULT_SETTINGS)}
          onSwitchRoot={handleSwitchRoot}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {dialog && <Dialog config={dialog} onClose={() => setDialog(null)} />}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.kind === 'workspace' ? workspaceMenuItems : sidebarMenuItems}
          onClose={closeContextMenu}
        />
      )}

      {dropping && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-hint">
            <strong>松开以打开文件</strong>
            <span>支持 Markdown 与常见文本文件</span>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
