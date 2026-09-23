import type {
  Discussion,
  Insight,
  InsightKind,
  InsightStatus,
  Intent,
  Panelist,
  PanelistRole,
  PanelistStatus,
  Phase,
  PresetTopic,
  TranscriptEntry,
  DiscussionStatus,
  SuggestedPanelist,
} from '../domain/types';

/**
 * 数据库行 → 领域对象。
 *
 * 之所以把映射单独放一层：DB 用 snake_case + 扁平结构，领域模型用 camelCase
 * 且把 JSON 文本还原成数组。集中在这里，schema 演进时只有这一处需要改。
 */

export interface DiscussionRow {
  id: string;
  topic: string;
  background: string | null;
  expert_count: number;
  status: string;
  phase: string;
  round_no: number;
  max_turns: number;
  summary: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export interface PanelistRow {
  id: string;
  discussion_id: string;
  role: string;
  name: string;
  title: string;
  org: string | null;
  stance: string;
  bio: string;
  color: string;
  status: string;
  focus: string | null;
  order_index: number;
}

export interface TranscriptRow {
  id: string;
  discussion_id: string;
  panelist_id: string;
  seq: number;
  round_no: number;
  phase: string;
  intent: string;
  content: string;
  created_at: number;
}

export interface InsightRow {
  id: string;
  discussion_id: string;
  kind: string;
  statement: string;
  supporter_ids: string;
  tension: string | null;
  status: string;
  round_no: number;
  created_at: number;
  updated_at: number;
}

export interface PresetRow {
  id: string;
  topic: string;
  background: string | null;
  expert_count: number;
  tags: string;
  suggested_panel: string;
}

/** 容错解析：历史数据里出现脏 JSON 时返回兜底值，而不是让整个列表接口 500。 */
export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function toDiscussion(row: DiscussionRow): Discussion {
  return {
    id: row.id,
    topic: row.topic,
    background: row.background,
    expertCount: row.expert_count,
    status: row.status as DiscussionStatus,
    phase: row.phase as Phase,
    round: row.round_no,
    maxTurns: row.max_turns,
    summary: row.summary,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function toPanelist(row: PanelistRow): Panelist {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    role: row.role as PanelistRole,
    name: row.name,
    title: row.title,
    org: row.org,
    stance: row.stance,
    bio: row.bio,
    color: row.color,
    status: row.status as PanelistStatus,
    focus: row.focus,
    orderIndex: row.order_index,
  };
}

export function toTranscript(row: TranscriptRow): TranscriptEntry {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    panelistId: row.panelist_id,
    seq: row.seq,
    round: row.round_no,
    phase: row.phase as Phase,
    intent: row.intent as Intent,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function toInsight(row: InsightRow): Insight {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    kind: row.kind as InsightKind,
    statement: row.statement,
    supporterIds: parseJsonArray<string>(row.supporter_ids),
    tension: row.tension,
    status: row.status as InsightStatus,
    round: row.round_no,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPreset(row: PresetRow): PresetTopic {
  return {
    id: row.id,
    topic: row.topic,
    background: row.background,
    expertCount: row.expert_count,
    tags: parseJsonArray<string>(row.tags),
    suggestedPanel: parseJsonArray<SuggestedPanelist>(row.suggested_panel),
  };
}
