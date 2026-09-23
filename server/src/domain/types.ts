/**
 * 领域模型。
 *
 * 这一层是前后端共享的「契约」在服务端的落地：字段名与 docs/API.md 完全一致。
 * 数据库行（snake_case）→ 领域对象（camelCase）的映射统一放在 db/mappers.ts。
 */

export type DiscussionStatus = 'draft' | 'ready' | 'live' | 'paused' | 'ended';
export type Phase = 'opening' | 'exploration' | 'conflict' | 'convergence' | 'closing' | 'done';
export type PanelistRole = 'host' | 'expert';
export type PanelistStatus = 'idle' | 'ready' | 'speaking' | 'thinking';
export type Intent =
  | 'open'
  | 'question'
  | 'bridge'
  | 'claim'
  | 'rebuttal'
  | 'supplement'
  | 'agree'
  | 'summary';
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

/** 首页列表项：聚合了足够的预览信息，避免 N+1 请求。 */
export interface DiscussionSummary extends Discussion {
  panelistCount: number;
  entryCount: number;
  consensusCount: number;
  divergenceCount: number;
  preview: string | null;
  palette: string[];
}

export interface PresetTopic {
  id: string;
  topic: string;
  background: string | null;
  expertCount: number;
  tags: string[];
  suggestedPanel: SuggestedPanelist[];
}

export interface SuggestedPanelist {
  name: string;
  title: string;
  stance: string;
  bio: string;
}

// ---------------------------------------------------------------- 事件流

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

// ---------------------------------------------------------------- LLM 契约
//
// 这些类型是「模型必须产出什么」的精确约定。它们只服务于引擎层，
// 不会直接序列化给前端 —— 前端拿到的是已经被引擎落库、清洗过的领域对象。

/** 生成阵容时要求模型返回的结构。 */
export interface PanelDraft {
  host: PanelistDraft;
  experts: PanelistDraft[];
}

export interface PanelistDraft {
  name: string;
  title: string;
  org?: string;
  stance: string;
  bio: string;
}

/** 一轮讨论中，模型对「谁想说话、想以什么姿态说」的判断。 */
export interface SpeakDecision {
  /** 专家在本轮是否主动要求发言 */
  wantsToSpeak: boolean;
  /** 发言意图：抢答 claim / 反驳 rebuttal / 补充 supplement / 附和 agree */
  intent: Exclude<Intent, 'open' | 'question' | 'bridge' | 'summary'>;
  /** 抢答优先级，越大越靠前 */
  urgency: number;
  /** 对外可见的「当前关注点」，一句话，非隐藏推理 */
  focus: string;
}

/** 共识 / 分歧提炼结果。 */
export interface SynthesisResult {
  consensus: SynthesisItem[];
  divergence: SynthesisItem[];
}

export interface SynthesisItem {
  statement: string;
  supporterNames: string[];
  tension?: string;
}
