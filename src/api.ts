import type { AppConfig, FilePayload, SearchHit, TreeNode } from './types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, '无法连接本地服务，请重新启动桌面应用');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `请求失败（${res.status}）`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export function getTree(): Promise<TreeNode> {
  return request<TreeNode>('/api/tree');
}

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/config');
}

export function switchRoot(path: string): Promise<AppConfig> {
  return request<AppConfig>('/api/root', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export function readFile(path: string): Promise<FilePayload> {
  return request<FilePayload>(`/api/file?path=${encodeURIComponent(path)}`);
}

export function saveFile(path: string, content: string): Promise<{ path: string; mtime: number; size: number }> {
  return request(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export function createFile(path: string, content = ''): Promise<{ path: string }> {
  return request('/api/file', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}

export function createFolder(path: string): Promise<{ path: string }> {
  return request('/api/folder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export function renameNode(from: string, to: string): Promise<{ from: string; to: string }> {
  return request('/api/rename', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
}

export function deleteNode(path: string, recursive = false): Promise<{ path: string }> {
  return request(`/api/node?path=${encodeURIComponent(path)}&recursive=${recursive}`, {
    method: 'DELETE',
  });
}

export function search(query: string): Promise<{ query: string; results: SearchHit[] }> {
  return request(`/api/search?q=${encodeURIComponent(query)}`);
}
