import { useEffect, useRef, useState } from 'react';
import type { ThemeMode, ViewMode } from '../types';
import { basename } from '../lib/text';
import {
  ChevronDownIcon,
  CodeIcon,
  ColumnsIcon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  MoonIcon,
  MonitorIcon,
  PanelLeftIcon,
  PrinterIcon,
  SaveIcon,
  SettingsIcon,
  SunIcon,
  TypeIcon,
} from './Icons';

interface ToolbarProps {
  currentPath: string | null;
  dirty: boolean;
  saving: boolean;
  viewMode: ViewMode;
  theme: ThemeMode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSave: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onCycleTheme: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({
  currentPath,
  dirty,
  saving,
  viewMode,
  theme,
  sidebarOpen,
  onToggleSidebar,
  onViewModeChange,
  onSave,
  onExportHtml,
  onExportPdf,
  onCycleTheme,
  onOpenSettings,
}: ToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [exportOpen]);

  const themeIcon =
    theme === 'dark' ? <MoonIcon /> : theme === 'light' ? <SunIcon /> : <MonitorIcon />;

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <button
          type="button"
          className={`icon-btn ${sidebarOpen ? 'is-on' : ''}`}
          title={`${sidebarOpen ? '收起' : '展开'}侧栏（Ctrl+B）`}
          onClick={onToggleSidebar}
        >
          <PanelLeftIcon />
        </button>
        <div className="brand">
          <span className="brand-name">md_reader</span>
        </div>
        <span className="toolbar-divider" />
        <div className="file-path" title={currentPath ?? '未打开文件'}>
          {currentPath ? (
            <>
              <FileTextIcon size={14} className="file-path-icon" />
              <span className="file-name">{basename(currentPath)}</span>
              {dirty && <span className="dirty-dot" title="有未保存的修改" />}
            </>
          ) : (
            <span className="muted">未打开文件</span>
          )}
        </div>
      </div>

      <div className="toolbar-center">
        <div className="segmented view-seg" role="group" aria-label="视图模式">
          <button
            type="button"
            className={viewMode === 'editor' ? 'active' : ''}
            title="仅编辑（Ctrl+E 切换）"
            onClick={() => onViewModeChange('editor')}
          >
            <TypeIcon size={15} />
            <span>编辑</span>
          </button>
          <button
            type="button"
            className={viewMode === 'split' ? 'active' : ''}
            title="左右分栏"
            onClick={() => onViewModeChange('split')}
          >
            <ColumnsIcon size={15} />
            <span>分栏</span>
          </button>
          <button
            type="button"
            className={viewMode === 'preview' ? 'active' : ''}
            title="仅预览"
            onClick={() => onViewModeChange('preview')}
          >
            <EyeIcon size={15} />
            <span>预览</span>
          </button>
        </div>
      </div>

      <div className="toolbar-right">
        <button
          type="button"
          className="btn primary"
          onClick={onSave}
          disabled={!currentPath || saving || !dirty}
          title="保存（Ctrl+S）"
        >
          <SaveIcon size={15} />
          {saving ? '保存中…' : '保存'}
        </button>

        <div className="dropdown" ref={exportRef}>
          <button
            type="button"
            className="btn"
            disabled={!currentPath}
            onClick={() => setExportOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
          >
            <DownloadIcon size={15} />
            导出
            <ChevronDownIcon size={14} className="chev" />
          </button>
          {exportOpen && (
            <div className="dropdown-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); onExportHtml(); }}>
                <CodeIcon size={15} />
                <span>导出为 HTML</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); onExportPdf(); }}>
                <PrinterIcon size={15} />
                <span>导出为 PDF（打印）</span>
              </button>
            </div>
          )}
        </div>

        <button type="button" className="icon-btn" title={`主题：${theme === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}，点击切换`} onClick={onCycleTheme}>
          {themeIcon}
        </button>
        <button type="button" className="icon-btn" title="阅读与编辑设置" onClick={onOpenSettings}>
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
