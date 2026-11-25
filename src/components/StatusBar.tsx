import { formatClock } from '../lib/text';

interface StatusBarProps {
  wordCount: number;
  lineCount: number;
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  autosave: boolean;
}

export function StatusBar({ wordCount, lineCount, dirty, saving, savedAt, autosave }: StatusBarProps) {
  let saveLabel = '就绪';
  if (saving) saveLabel = '保存中…';
  else if (dirty) saveLabel = autosave ? '自动保存中…' : '未保存';
  else if (savedAt) saveLabel = `已保存 ${formatClock(savedAt)}`;

  return (
    <footer className="statusbar">
      <span className="status-item">{wordCount} 字</span>
      <span className="status-item">{lineCount} 行</span>
      <span className="statusbar-spacer" />
      <span className={`save-state ${dirty ? 'is-dirty' : ''} ${saving ? 'is-saving' : ''}`}>{saveLabel}</span>
    </footer>
  );
}
