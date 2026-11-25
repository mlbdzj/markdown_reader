import type { ReactNode } from 'react';
import type { TreeNode } from '../types';
import { isMarkdownPath } from '../lib/fileTypes';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileCodeIcon,
  FileTextIcon,
  FolderIcon,
  PencilIcon,
  TrashIcon,
} from './Icons';

interface FileTreeProps {
  nodes: TreeNode[];
  currentPath: string | null;
  activeDir: string;
  expanded: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  depth?: number;
}

export function FileTree({
  nodes,
  currentPath,
  activeDir,
  expanded,
  onToggleDir,
  onOpenFile,
  onRename,
  onDelete,
  depth = 0,
}: FileTreeProps) {
  function renderNodes(list: TreeNode[], level: number): ReactNode {
    return list.map((node) => {
      const pad = { paddingLeft: 10 + level * 14 };

      if (node.type === 'dir') {
        const open = expanded.has(node.path);
        return (
          <div key={node.path}>
            <div
              className={`tree-row is-dir ${activeDir === node.path ? 'is-active-dir' : ''}`}
              style={pad}
              title={node.path}
              data-path={node.path}
              data-kind="dir"
              onClick={() => onToggleDir(node.path)}
              onDoubleClick={() => onToggleDir(node.path)}
            >
              <span className="tree-chevron">
                {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
              </span>
              <span className="tree-icon">
                <FolderIcon size={15} />
              </span>
              <span className="tree-label">{node.name}</span>
              <span className="tree-actions">
                <button
                  type="button"
                  className="mini-btn"
                  title="重命名文件夹"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRename(node);
                  }}
                >
                  <PencilIcon size={13} />
                </button>
                <button
                  type="button"
                  className="mini-btn danger"
                  title="删除文件夹"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(node);
                  }}
                >
                  <TrashIcon size={13} />
                </button>
              </span>
            </div>
            {open &&
              (node.children && node.children.length > 0 ? (
                renderNodes(node.children, level + 1)
              ) : (
                <div className="tree-empty" style={{ paddingLeft: 30 + level * 14 }}>
                  空文件夹
                </div>
              ))}
          </div>
        );
      }

      const markdown = isMarkdownPath(node.path);

      return (
        <div
          key={node.path}
          className={`tree-row ${markdown ? '' : 'is-text'} ${currentPath === node.path ? 'is-active' : ''}`}
          style={pad}
          title={node.path}
          data-path={node.path}
          data-kind="file"
          onClick={() => onOpenFile(node.path)}
        >
          <span className="tree-chevron" />
          <span className="tree-icon">
            {markdown ? <FileTextIcon size={15} /> : <FileCodeIcon size={15} />}
          </span>
          <span className="tree-label">{node.name}</span>
          <span className="tree-actions">
            <button
              type="button"
              className="mini-btn"
              title="重命名文件"
              onClick={(event) => {
                event.stopPropagation();
                onRename(node);
              }}
            >
              <PencilIcon size={13} />
            </button>
            <button
              type="button"
              className="mini-btn danger"
              title="删除文件"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(node);
              }}
            >
              <TrashIcon size={13} />
            </button>
          </span>
        </div>
      );
    });
  }

  return <div className="tree">{renderNodes(nodes, depth)}</div>;
}
