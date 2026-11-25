export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  mtime?: number;
  children?: TreeNode[];
}

export interface FilePayload {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export interface AppConfig {
  root: string;
  recent: string[];
  envOverride: boolean;
}

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchHit {
  path: string;
  name: string;
  mtime: number;
  matches: SearchMatch[];
}

export type ViewMode = 'split' | 'editor' | 'preview';
export type ThemeMode = 'light' | 'dark' | 'system';
export type FontFamilyKey = 'system' | 'sans' | 'serif' | 'mono';

export interface Settings {
  theme: ThemeMode;
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamilyKey;
  contentWidth: number;
  autosave: boolean;
  syncScroll: boolean;
}
