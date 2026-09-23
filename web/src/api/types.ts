/**
 * 前端侧的 API 契约。
 *
 * 与 docs/API.md、server/src/domain/types.ts 保持逐字段一致 ——
 * 这份文件是「前后端契约」在前端的落地，不引入任何服务端实现细节。
 */

export type DiscussionStatus = 'draft' | 'ready' | 'live' | 'paused' | 'ended';

export type Phase = 'opening' | 'exploration' | 'conflict' | 'convergence' | 'closing' | 'done';

export type PanelistRole = 'host' | 'expert';

export type PanelistStatus = 'idle' | 'ready' | 'speaking' | 'thinking';

export type Intent = 'open' | 'question' | 'bridge' | 'claim' | 'rebuttal' | 'supplement' | 'agree' | 'summary';

export type InsightKind = 'consensus' | 'divergence';

export type InsightStatus = 'emerging' | 'stable';

export interface Discussion {
  id: string;
  topic: string;
  background: string | null;
  expertCount: number;
  status: DiscussionStatus;
  phase: Phase;
  round: number;
  maxTurns: number;
  summary: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface Panelist {
  id: string;
  discussionId: string;
  role: PanelistRole;
  name: string;
  title: string;
  org: string | null;
  stance: string;
  bio: string;
  color: string;
  status: PanelistStatus;
  focus: string | null;
  orderIndex: number;
}

export interface TranscriptEntry {
  id: string;
  discussionId: string;
  panelistId: string;
  seq: number;
  round: number;
  phase: Phase;
  intent: Intent;
  content: string;
  createdAt: number;
}

export interface Insight {
  id: string;
  discussionId: string;
  kind: InsightKind;
  statement: string;
  supporterIds: string[];
  tension: string | null;
  status: InsightStatus;
  round: number;
  createdAt: number;
  updatedAt: number;
}

export interface DiscussionDetail extends Discussion {
  panelists: Panelist[];
  transcript: TranscriptEntry[];
  insights: Insight[];
  lastSeq: number;
}

export interface DiscussionSummary extends Discussion {
  panelistCount: number;
  entryCount: number;
  consensusCount: number;
  divergenceCount: number;
  preview: string | null;
  palette: string[];
}

export interface SuggestedPanelist {
  name: string;
  title: string;
  stance: string;
  bio: string;
}

export interface PresetTopic {
  id: string;
  topic: string;
  background: string | null;
  expertCount: number;
  tags: string[];
  suggestedPanel: SuggestedPanelist[];
}

export interface HealthInfo {
  status: string;
  llm: { provider: string; model: string; mock: boolean };
  now: number;
}

/* ------------------------------------------------------------ 事件流 */

export type DiscussionEventType =
  | 'snapshot'
  | 'discussion.status'
  | 'panelist.status'
  | 'transcript.append'
  | 'insight.upsert'
  | 'summary.final'
  | 'error'
  | 'heartbeat';

export interface DiscussionEvent<T = unknown> {
  seq: number;
  type: DiscussionEventType;
  discussionId: string;
  ts: number;
  payload: T;
}

export interface DiscussionStatusPayload {
  status: DiscussionStatus;
  phase: Phase;
  round: number;
}

export interface PanelistStatusPayload {
  panelistId: string;
  status: PanelistStatus;
  focus: string | null;
}

export interface TranscriptAppendPayload {
  entry: TranscriptEntry;
}

export interface InsightUpsertPayload {
  insight: Insight;
  isNew: boolean;
}

export interface SummaryFinalPayload {
  summary: string;
}

/* ------------------------------------------------------------ 请求体 */

export interface CreateDiscussionInput {
  topic: string;
  background?: string | null;
  expertCount: number;
}

export interface PanelistPatch {
  name?: string;
  title?: string;
  org?: string | null;
  stance?: string;
  bio?: string;
  color?: string;
}

export interface PanelResponse {
  discussionId: string;
  status: DiscussionStatus;
  panelists: Panelist[];
}

export interface ListResponse<T> {
  items: T[];
}
