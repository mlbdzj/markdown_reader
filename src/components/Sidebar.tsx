import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { SearchHit, TreeNode } from '../types';
import { isMarkdownPath } from '../lib/fileTypes';
import { FileTree } from './FileTree';
import {
  FileCodeIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderPlusIcon,
  RefreshIcon,
  SearchIcon,
  XIcon,
} from './Icons';

interface SidebarProps {
  tree: TreeNode | null;
  loading: boolean;
  currentPath: string | null;
  activeDir: string;
  expanded: ReadonlySet<string>;
  searchQuery: string;
  searchResults: SearchHit[] | null;
  searchLoading: boolean;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onSearchQueryChange: (query: string) => void;
  onClearSearch: () => void;
  onOpenSearchHit: (path: string) => void;
  onListContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}

function highlight(text: string, query: string): ReactNode {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function Sidebar({
  tree,
  loading,
  currentPath,
  activeDir,
  expanded,
  searchQuery,
  searchResults,
  searchLoading,
  onToggleDir,
  onOpenFile,
  onNewFile,
  onNewFolder,
  onRefresh,
  onRename,
  onDelete,
  onSearchQueryChange,
  onClearSearch,
  onOpenSearchHit,
  onListContextMenu,
}: SidebarProps) {
  const query = searchQuery.trim();
  const searching = query.length > 0;

  return (
    <aside className="sidebar" onContextMenu={onListContextMenu}>
      <div className="sidebar-head">
        <span className="sidebar-title">文件</span>
        <div className="sidebar-actions">
          <button type="button" className="icon-btn sm" title="新建文件" onClick={onNewFile}>
            <FilePlusIcon size={16} />
          </button>
          <button type="button" className="icon-btn sm" title="新建文件夹" onClick={onNewFolder}>
            <FolderPlusIcon size={16} />
          </button>
          <button type="button" className="icon-btn sm" title="刷新目录" onClick={onRefresh}>
            <RefreshIcon size={16} />
          </button>
        </div>
      </div>

      <div className="search-box">
        <SearchIcon size={15} className="search-icon" />
        <input
          id="global-search"
          type="text"
          className="search-input"
          placeholder="搜索全文…（Ctrl+K）"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          spellCheck={false}
        />
        {searchQuery && (
          <button type="button" className="search-clear" title="清除搜索" onClick={onClearSearch}>
            <XIcon size={14} />
          </button>
        )}
      </div>

      <div className="sidebar-list">
        {searching ? (
          <div className="search-results">
            {searchLoading && <div className="sidebar-hint">搜索中…</div>}
            {!searchLoading && searchResults && searchResults.length === 0 && (
              <div className="sidebar-hint">没有找到「{query}」相关的内容</div>
            )}
            {searchResults?.map((hit) => (
              <div
                key={hit.path}
                className="search-hit"
                role="button"
                tabIndex={0}
                title={hit.path}
                data-path={hit.path}
                data-kind="file"
                onClick={() => onOpenSearchHit(hit.path)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onOpenSearchHit(hit.path);
                }}
              >
                <div className="hit-name">
                  {isMarkdownPath(hit.path) ? <FileTextIcon size={13} /> : <FileCodeIcon size={13} />}
                  <span>{hit.name}</span>
                </div>
                <div className="hit-path">{hit.path}</div>
                {hit.matches.slice(0, 4).map((match) => (
                  <div className="hit-line" key={`${hit.path}-${match.line}`}>
                    <span className="hit-lineno">{match.line}</span>
                    <span className="hit-text">{highlight(match.text, query)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : loading && !tree ? (
          <div className="sidebar-hint">加载中…</div>
        ) : !tree || (tree.children?.length ?? 0) === 0 ? (
          <div className="sidebar-empty">
            <p>还没有 Markdown 文件</p>
            <button type="button" className="btn primary sm-btn" onClick={onNewFile}>
              <FilePlusIcon size={15} /> 新建第一篇笔记
            </button>
          </div>
        ) : (
          <FileTree
            nodes={tree.children ?? []}
            currentPath={currentPath}
            activeDir={activeDir}
            expanded={expanded}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
            onRename={onRename}
            onDelete={onDelete}
          />
        )}
      </div>

      <div className="sidebar-foot" title={tree?.name ?? ''}>
        <span className="foot-name">{tree?.name ?? '—'}</span>
      </div>
    </aside>
  );
}
