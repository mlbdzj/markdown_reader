import type { Settings } from '../types';

export const FONT_STACKS: Record<Settings['fontFamily'], string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  sans: '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  serif: 'Georgia, "Songti SC", SimSun, "Noto Serif SC", serif',
  mono: '"Cascadia Code", Consolas, "SFMono-Regular", Menlo, monospace',
};

export const FONT_LABELS: Record<Settings['fontFamily'], string> = {
  system: '系统默认',
  sans: '无衬线',
  serif: '衬线 / 宋体',
  mono: '等宽',
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 16,
  lineHeight: 1.8,
  fontFamily: 'system',
  contentWidth: 720,
  autosave: true,
  syncScroll: true,
};

const STORAGE_KEY = 'md_reader.settings.v1';

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function sanitize(input: Partial<Settings>): Settings {
  const theme = input.theme === 'light' || input.theme === 'dark' || input.theme === 'system' ? input.theme : DEFAULT_SETTINGS.theme;
  const fontFamily =
    input.fontFamily === 'system' || input.fontFamily === 'sans' || input.fontFamily === 'serif' || input.fontFamily === 'mono'
      ? input.fontFamily
      : DEFAULT_SETTINGS.fontFamily;
  return {
    theme,
    fontFamily,
    fontSize: clamp(input.fontSize, 13, 24, DEFAULT_SETTINGS.fontSize),
    lineHeight: clamp(input.lineHeight, 1.4, 2.2, DEFAULT_SETTINGS.lineHeight),
    contentWidth: clamp(input.contentWidth, 560, 1280, DEFAULT_SETTINGS.contentWidth),
    autosave: typeof input.autosave === 'boolean' ? input.autosave : DEFAULT_SETTINGS.autosave,
    syncScroll: typeof input.syncScroll === 'boolean' ? input.syncScroll : DEFAULT_SETTINGS.syncScroll,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 忽略存储失败（例如隐私模式）
  }
}
