import type {
  CreateDiscussionInput,
  Discussion,
  DiscussionDetail,
  DiscussionSummary,
  HealthInfo,
  ListResponse,
  Panelist,
  PanelistPatch,
  PanelResponse,
  PresetTopic,
  TranscriptEntry,
} from './types';

/**
 * REST 客户端。
 *
 * 只走同源 `/api/*`（开发期由 Vite 代理到后端），因此这里没有任何密钥、
 * 也没有可配置的 base URL —— 大模型 Key 永远留在后端进程的环境变量里。
 */

const BASE = '/api';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('NETWORK_ERROR', '无法连接到后端服务，请确认服务已启动', 0);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
    );
  }

  return data as T;
}

export const api = {
  health: () => request<HealthInfo>('/health'),

  listPresets: () => request<ListResponse<PresetTopic>>('/preset-topics').then((r) => r.items),

  listDiscussions: (status: 'live' | 'ready' | 'ended' | 'all' = 'all') =>
    request<ListResponse<DiscussionSummary>>(`/discussions?status=${status}&limit=60`).then((r) => r.items),

  createDiscussion: (input: CreateDiscussionInput) =>
    request<Discussion>('/discussions', { method: 'POST', body: JSON.stringify(input) }),

  getDiscussion: (id: string) => request<DiscussionDetail>(`/discussions/${encodeURIComponent(id)}`),

  transcriptSince: (id: string, since: number) =>
    request<{ items: TranscriptEntry[]; lastSeq: number }>(
      `/discussions/${encodeURIComponent(id)}/transcript?since=${since}`,
    ),

  generatePanel: (id: string) =>
    request<PanelResponse>(`/discussions/${encodeURIComponent(id)}/panel`, { method: 'POST', body: '{}' }),

  updatePanelist: (id: string, panelistId: string, patch: PanelistPatch) =>
    request<Panelist>(`/discussions/${encodeURIComponent(id)}/panel/${encodeURIComponent(panelistId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  start: (id: string) =>
    request<{ id: string; status: string }>(`/discussions/${encodeURIComponent(id)}/start`, { method: 'POST' }),

  pause: (id: string) =>
    request<{ id: string; status: string }>(`/discussions/${encodeURIComponent(id)}/pause`, { method: 'POST' }),

  resume: (id: string) =>
    request<{ id: string; status: string }>(`/discussions/${encodeURIComponent(id)}/resume`, { method: 'POST' }),

  stop: (id: string) =>
    request<{ id: string; status: string; summary: string | null }>(`/discussions/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    }),

  remove: (id: string) => request<void>(`/discussions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  streamUrl: (id: string, since = 0) =>
    `${BASE}/discussions/${encodeURIComponent(id)}/stream?since=${since}`,
};
