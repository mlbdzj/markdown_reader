import { useState } from 'react';
import type { FontFamilyKey, Settings, ThemeMode } from '../types';
import { FONT_LABELS } from '../lib/settings';
import { AlertIcon, XIcon } from './Icons';

interface SettingsPanelProps {
  settings: Settings;
  root: string;
  recentRoots: string[];
  envOverride: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onSwitchRoot: (path: string) => Promise<void>;
  onClose: () => void;
}

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const FONTS = Object.keys(FONT_LABELS) as FontFamilyKey[];

function folderName(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? fullPath;
}

export function SettingsPanel({
  settings,
  root,
  recentRoots,
  envOverride,
  onChange,
  onReset,
  onSwitchRoot,
  onClose,
}: SettingsPanelProps) {
  const [rootInput, setRootInput] = useState('');
  const [switching, setSwitching] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  async function submitRoot(value?: string) {
    const target = (value ?? rootInput).trim();
    if (!target || switching) return;
    setSwitching(true);
    setRootError(null);
    try {
      await onSwitchRoot(target);
      setRootInput('');
    } catch (err) {
      setRootError(err instanceof Error ? err.message : '切换目录失败');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="settings-layer">
      <div className="settings-backdrop" onClick={onClose} />
      <aside className="settings-panel" role="dialog" aria-label="阅读与编辑设置">
        <div className="settings-head">
          <h2>阅读与编辑设置</h2>
          <button type="button" className="icon-btn" title="关闭" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        <div className="settings-body">
          <section className="setting-group">
            <h3>
              笔记空间 <span className="setting-value">当前目录</span>
            </h3>
            <p className="root-path" title={root}>
              {root || '加载中…'}
            </p>
            <div className="root-switch-row">
              <input
                className="text-input"
                value={rootInput}
                placeholder="输入文件夹绝对路径，例如 D:\notes"
                spellCheck={false}
                disabled={switching}
                onChange={(event) => setRootInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitRoot();
                  }
                }}
              />
              <button
                type="button"
                className="btn primary"
                disabled={switching || !rootInput.trim()}
                onClick={() => void submitRoot()}
              >
                {switching ? '切换中…' : '切换'}
              </button>
            </div>
            <p className="setting-desc">目录不存在时会自动创建；切换后当前文件会先保存。</p>
            {recentRoots.length > 0 && (
              <div className="root-recent">
                <span className="root-recent-label">最近：</span>
                {recentRoots.map((recent) => (
                  <button
                    key={recent}
                    type="button"
                    className="root-chip"
                    title={recent}
                    disabled={switching}
                    onClick={() => {
                      setRootInput(recent);
                      void submitRoot(recent);
                    }}
                  >
                    {folderName(recent)}
                  </button>
                ))}
              </div>
            )}
            {envOverride && (
              <p className="setting-desc">启动时设置了 MD_ROOT 环境变量，重启后仍会优先使用该目录。</p>
            )}
            {rootError && (
              <p className="dialog-error">
                <AlertIcon size={14} /> {rootError}
              </p>
            )}
          </section>

          <section className="setting-group">
            <h3>主题</h3>
            <div className="theme-options">
              {THEMES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`theme-option ${settings.theme === value ? 'active' : ''}`}
                  onClick={() => onChange({ theme: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="setting-group">
            <h3>
              正文字号 <span className="setting-value">{settings.fontSize}px</span>
            </h3>
            <input
              type="range"
              min={13}
              max={24}
              step={1}
              value={settings.fontSize}
              onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
            />
          </section>

          <section className="setting-group">
            <h3>
              行高 <span className="setting-value">{settings.lineHeight.toFixed(1)}</span>
            </h3>
            <input
              type="range"
              min={1.4}
              max={2.2}
              step={0.1}
              value={settings.lineHeight}
              onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}
            />
          </section>

          <section className="setting-group">
            <h3>正文字体</h3>
            <select
              className="select-input"
              value={settings.fontFamily}
              onChange={(event) => onChange({ fontFamily: event.target.value as FontFamilyKey })}
            >
              {FONTS.map((font) => (
                <option key={font} value={font}>
                  {FONT_LABELS[font]}
                </option>
              ))}
            </select>
          </section>

          <section className="setting-group">
            <h3>
              阅读宽度 <span className="setting-value">{settings.contentWidth}px</span>
            </h3>
            <input
              type="range"
              min={560}
              max={1280}
              step={20}
              value={settings.contentWidth}
              onChange={(event) => onChange({ contentWidth: Number(event.target.value) })}
            />
          </section>

          <section className="setting-group">
            <div className="switch-row">
              <div>
                <h3>自动保存</h3>
                <p className="setting-desc">停止输入约 1 秒后自动写入文件</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.autosave}
                  onChange={(event) => onChange({ autosave: event.target.checked })}
                />
                <span className="switch-track" />
              </label>
            </div>
          </section>

          <section className="setting-group">
            <div className="switch-row">
              <div>
                <h3>滚动同步</h3>
                <p className="setting-desc">编辑区与预览区滚动位置联动</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.syncScroll}
                  onChange={(event) => onChange({ syncScroll: event.target.checked })}
                />
                <span className="switch-track" />
              </label>
            </div>
          </section>

          <button
            type="button"
            className="btn ghost reset-btn"
            onClick={() => {
              if (window.confirm('恢复默认设置？')) onReset();
            }}
          >
            恢复默认设置
          </button>
        </div>
      </aside>
    </div>
  );
}
