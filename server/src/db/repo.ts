import type { Db } from './index';
import { getDb } from './index';
import {
  type DiscussionRow,
  type InsightRow,
  type PanelistRow,
  type PresetRow,
  type TranscriptRow,
  parseJsonArray,
  toDiscussion,
  toInsight,
  toPanelist,
  toPreset,
  toTranscript,
} from './mappers';
import type {
  Discussion,
  DiscussionDetail,
  DiscussionSummary,
  Insight,
  InsightKind,
  Intent,
  Panelist,
  PanelistRole,
  PanelistStatus,
  Phase,
  PresetTopic,
  SynthesisResult,
  TranscriptEntry,
  DiscussionEvent,
  DiscussionEventType,
  DiscussionStatus,
} from '../domain/types';
import { newDiscussionId, newInsightId, newPanelistId, newTranscriptId } from '../util/ids';

/**
 * 数据访问层。
 *
 * 所有写操作都收敛在这里，并且都保证「业务写入」与「事件流写入」在同一事务里，
 * 这样 SSE 回放才不会出现「有发言但没事件」的裂缝。
 */

export interface NewDiscussionInput {
  topic: string;
  background: string | null;
  expertCount: number;
  maxTurns: number;
}

export interface PanelistInsert {
  role: PanelistRole;
  name: string;
  title: string;
  org: string | null;
  stance: string;
  bio: string;
  color: string;
  orderIndex: number;
}

export interface PanelistPatch {
  name?: string;
  title?: string;
  org?: string | null;
  stance?: string;
  bio?: string;
  color?: string;
}

export interface AppendTranscriptInput {
  panelistId: string;
  round: number;
  phase: Phase;
  intent: Intent;
  content: string;
}

const LIVE_ORDER = `CASE d.status
    WHEN 'live' THEN 0 WHEN 'paused' THEN 1 WHEN 'ready' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
  d.created_at DESC`;

export class Repo {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------ 讨论

  createDiscussion(input: NewDiscussionInput): Discussion {
    const id = newDiscussionId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO discussion
           (id, topic, background, expert_count, status, phase, round_no, max_turns, summary, created_at)
         VALUES (?, ?, ?, ?, 'draft', 'opening', 0, ?, NULL, ?)`,
      )
      .run(id, input.topic, input.background, input.expertCount, input.maxTurns, now);
    return this.requireDiscussion(id);
  }

  getDiscussion(id: string): Discussion | null {
    const raw = this.db.prepare('SELECT * FROM discussion WHERE id = ?').get(id);
    return raw ? toDiscussion(raw as DiscussionRow) : null;
  }

  private requireDiscussion(id: string): Discussion {
    const found = this.getDiscussion(id);
    if (!found) throw new Error(`discussion not found: ${id}`);
    return found;
  }

  updateDiscussion(
    id: string,
    patch: Partial<{
      status: DiscussionStatus;
      phase: Phase;
      round: number;
      summary: string | null;
      startedAt: number | null;
      endedAt: number | null;
    }>,
  ): Discussion | null {
    const columns: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      status: 'status',
      phase: 'phase',
      round: 'round_no',
      summary: 'summary',
      startedAt: 'started_at',
      endedAt: 'ended_at',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in patch) {
        columns.push(`${column} = ?`);
        values.push((patch as Record<string, unknown>)[key]);
      }
    }
    if (columns.length === 0) return this.getDiscussion(id);
    values.push(id);
    this.db.prepare(`UPDATE discussion SET ${columns.join(', ')} WHERE id = ?`).run(...values);
    return this.getDiscussion(id);
  }

  deleteDiscussion(id: string): boolean {
    const info = this.db.prepare('DELETE FROM discussion WHERE id = ?').run(id);
    return info.changes > 0;
  }

  countDiscussions(): number {
    const raw = this.db.prepare('SELECT COUNT(*) AS n FROM discussion').get() as { n: number };
    return raw.n;
  }

  listSummaries(opts: { status?: DiscussionStatus | 'all'; limit: number }): DiscussionSummary[] {
    const filter = opts.status && opts.status !== 'all' ? opts.status : null;
    const rows = this.db
      .prepare(
        `SELECT d.*,
           (SELECT COUNT(*) FROM panelist p WHERE p.discussion_id = d.id) AS panelist_count,
           (SELECT COUNT(*) FROM transcript_entry t WHERE t.discussion_id = d.id) AS entry_count,
           (SELECT COUNT(*) FROM insight i WHERE i.discussion_id = d.id AND i.kind = 'consensus') AS consensus_count,
           (SELECT COUNT(*) FROM insight i WHERE i.discussion_id = d.id AND i.kind = 'divergence') AS divergence_count,
           (SELECT t.content FROM transcript_entry t WHERE t.discussion_id = d.id ORDER BY t.seq DESC LIMIT 1) AS preview
         FROM discussion d
         WHERE (@status IS NULL OR d.status = @status)
         ORDER BY ${LIVE_ORDER}
         LIMIT @limit`,
      )
      .all({ status: filter, limit: opts.limit }) as Array<
      DiscussionRow & {
        panelist_count: number;
        entry_count: number;
        consensus_count: number;
        divergence_count: number;
        preview: string | null;
      }
    >;

    if (rows.length === 0) return [];

    // 一次性取回所有讨论的配色，避免 N+1
    const palettes = this.colorsFor(rows.map((r) => r.id));
    return rows.map((row) => ({
      ...toDiscussion(row),
      panelistCount: row.panelist_count,
      entryCount: row.entry_count,
      consensusCount: row.consensus_count,
      divergenceCount: row.divergence_count,
      preview: row.preview,
      palette: palettes.get(row.id) ?? [],
    }));
  }

  private colorsFor(discussionIds: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (discussionIds.length === 0) return result;
    const placeholders = discussionIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT discussion_id, color FROM panelist
         WHERE discussion_id IN (${placeholders})
         ORDER BY discussion_id, order_index`,
      )
      .all(...discussionIds) as Array<{ discussion_id: string; color: string }>;
    for (const row of rows) {
      const bucket = result.get(row.discussion_id) ?? [];
      bucket.push(row.color);
      result.set(row.discussion_id, bucket);
    }
    return result;
  }

  getDetail(id: string): DiscussionDetail | null {
    const discussion = this.getDiscussion(id);
    if (!discussion) return null;
    return {
      ...discussion,
      panelists: this.getPanelists(id),
      transcript: this.getTranscript(id),
      insights: this.getInsights(id),
      lastSeq: this.lastSeq(id),
    };
  }

  // ------------------------------------------------------------ 嘉宾

  replacePanelists(discussionId: string, inserts: PanelistInsert[]): Panelist[] {
    const now = Date.now();
    const run = this.db.transaction((items: PanelistInsert[]) => {
      this.db.prepare('DELETE FROM panelist WHERE discussion_id = ?').run(discussionId);
      const stmt = this.db.prepare(
        `INSERT INTO panelist
           (id, discussion_id, role, name, title, org, stance, bio, color, status, focus, order_index, created_at)
         VALUES (@id, @discussionId, @role, @name, @title, @org, @stance, @bio, @color, 'idle', NULL, @orderIndex, @createdAt)`,
      );
      for (const item of items) {
        stmt.run({
          id: newPanelistId(),
          discussionId,
          role: item.role,
          name: item.name,
          title: item.title,
          org: item.org,
          stance: item.stance,
          bio: item.bio,
          color: item.color,
          orderIndex: item.orderIndex,
          createdAt: now,
        });
      }
    });
    run(inserts);
    return this.getPanelists(discussionId);
  }

  getPanelists(discussionId: string): Panelist[] {
    const rows = this.db
      .prepare('SELECT * FROM panelist WHERE discussion_id = ? ORDER BY order_index')
      .all(discussionId) as PanelistRow[];
    return rows.map(toPanelist);
  }

  getPanelist(id: string): Panelist | null {
    const raw = this.db.prepare('SELECT * FROM panelist WHERE id = ?').get(id);
    return raw ? toPanelist(raw as PanelistRow) : null;
  }

  updatePanelist(id: string, patch: PanelistPatch): Panelist | null {
    const columns: string[] = [];
    const values: unknown[] = [];
    const map: Record<keyof PanelistPatch, string> = {
      name: 'name',
      title: 'title',
      org: 'org',
      stance: 'stance',
      bio: 'bio',
      color: 'color',
    };
    for (const [key, column] of Object.entries(map) as Array<[keyof PanelistPatch, string]>) {
      const value = patch[key];
      if (value !== undefined) {
        columns.push(`${column} = ?`);
        values.push(value);
      }
    }
    if (columns.length === 0) return this.getPanelist(id);
    values.push(id);
    this.db.prepare(`UPDATE panelist SET ${columns.join(', ')} WHERE id = ?`).run(...values);
    return this.getPanelist(id);
  }

  /** 更新嘉宾的运行时状态（状态灯 + 公开关注点），不产生事件，由引擎负责发事件。 */
  setPanelistRuntime(id: string, status: PanelistStatus, focus: string | null): Panelist | null {
    this.db.prepare('UPDATE panelist SET status = ?, focus = ? WHERE id = ?').run(status, focus, id);
    return this.getPanelist(id);
  }

  // ------------------------------------------------------------ 发言

  /**
   * 追加一条发言。
   * 发言与对应事件共享同一个 seq —— 这让 SSE 的 `since` 游标可以同时覆盖两者。
   */
  appendTranscript(
    discussionId: string,
    input: AppendTranscriptInput,
  ): { entry: TranscriptEntry; event: DiscussionEvent } {
    const now = Date.now();
    const id = newTranscriptId();
    const run = this.db.transaction(() => {
      const seq = this.nextSeq(discussionId);
      this.db
        .prepare(
          `INSERT INTO transcript_entry
             (id, discussion_id, panelist_id, seq, round_no, phase, intent, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, discussionId, input.panelistId, seq, input.round, input.phase, input.intent, input.content, now);
      this.db
        .prepare(
          `INSERT INTO discussion_event (discussion_id, seq, type, payload, created_at)
           VALUES (?, ?, 'transcript.append', ?, ?)`,
        )
        .run(discussionId, seq, JSON.stringify({ entryId: id }), now);
      return seq;
    });
    const seq = run();
    const entry = this.getTranscript(discussionId).find((e) => e.id === id);
    if (!entry) throw new Error('transcript insert failed');
    return {
      entry,
      event: { seq, type: 'transcript.append', discussionId, ts: now, payload: { entry } },
    };
  }

  getTranscript(discussionId: string, since = 0): TranscriptEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM transcript_entry WHERE discussion_id = ? AND seq > ? ORDER BY seq')
      .all(discussionId, since) as TranscriptRow[];
    return rows.map(toTranscript);
  }

  // ------------------------------------------------------------ 共识 / 分歧

  getInsights(discussionId: string): Insight[] {
    const rows = this.db
      .prepare('SELECT * FROM insight WHERE discussion_id = ? ORDER BY kind, round_no, created_at')
      .all(discussionId) as InsightRow[];
    return rows.map(toInsight);
  }

  /**
   * 把一次提炼结果「对账」进数据库。
   *
   * 模型被要求每轮返回**完整的**共识 / 分歧清单，因此这里按归一化后的 statement 做匹配：
   * - 命中已有条目 → 更新支持者、张力与状态（emerging → stable）
   * - 未命中 → 新增
   * - 本轮未出现的旧条目 → 保留，但状态置为 stable（不再处于「正在形成」）
   */
  reconcileInsights(
    discussionId: string,
    round: number,
    synthesis: SynthesisResult,
  ): Array<{ insight: Insight; isNew: boolean }> {
    const now = Date.now();
    const panelists = this.getPanelists(discussionId);
    const byName = new Map(panelists.map((p) => [normalizeKey(p.name), p.id]));
    const existing = this.getInsights(discussionId);
    const touched = new Set<string>();
    const changes: Array<{ insight: Insight; isNew: boolean }> = [];

    const upsertKind = (kind: InsightKind, items: SynthesisResult['consensus']): void => {
      for (const item of items) {
        const statement = item.statement.trim();
        if (!statement) continue;
        const supporterIds = item.supporterNames
          .map((name) => byName.get(normalizeKey(name)))
          .filter((id): id is string => Boolean(id));
        const match = existing.find(
          (candidate) => candidate.kind === kind && normalizeKey(candidate.statement) === normalizeKey(statement),
        );

        if (match) {
          touched.add(match.id);
          const merged = Array.from(new Set([...match.supporterIds, ...supporterIds]));
          const nextStatus = merged.length >= 2 ? 'stable' : 'emerging';
          this.db
            .prepare(
              'UPDATE insight SET statement = ?, supporter_ids = ?, tension = ?, status = ?, updated_at = ? WHERE id = ?',
            )
            .run(statement, JSON.stringify(merged), item.tension ?? null, nextStatus, now, match.id);
          const updated = this.getInsight(match.id);
          if (updated) changes.push({ insight: updated, isNew: false });
        } else {
          const id = newInsightId();
          const status = supporterIds.length >= 2 ? 'stable' : 'emerging';
          this.db
            .prepare(
              `INSERT INTO insight
                 (id, discussion_id, kind, statement, supporter_ids, tension, status, round_no, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              discussionId,
              kind,
              statement,
              JSON.stringify(supporterIds),
              item.tension ?? null,
              status,
              round,
              now,
              now,
            );
          const created = this.getInsight(id);
          if (created) changes.push({ insight: created, isNew: true });
        }
      }
    };

    upsertKind('consensus', synthesis.consensus);
    upsertKind('divergence', synthesis.divergence);

    // 本轮没再被提到的旧条目：不再标记为「正在形成」
    for (const insight of existing) {
      if (!touched.has(insight.id) && insight.status === 'emerging') {
        this.db.prepare('UPDATE insight SET status = ?, updated_at = ? WHERE id = ?').run('stable', now, insight.id);
      }
    }

    return changes;
  }

  private getInsight(id: string): Insight | null {
    const raw = this.db.prepare('SELECT * FROM insight WHERE id = ?').get(id);
    return raw ? toInsight(raw as InsightRow) : null;
  }

  // ------------------------------------------------------------ 事件流

  private nextSeq(discussionId: string): number {
    const raw = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM discussion_event WHERE discussion_id = ?')
      .get(discussionId) as { seq: number };
    return raw.seq + 1;
  }

  lastSeq(discussionId: string): number {
    const raw = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM discussion_event WHERE discussion_id = ?')
      .get(discussionId) as { seq: number };
    return raw.seq;
  }

  appendEvent(discussionId: string, type: DiscussionEventType, payload: unknown): DiscussionEvent {
    const now = Date.now();
    const run = this.db.transaction(() => {
      const seq = this.nextSeq(discussionId);
      this.db
        .prepare(
          `INSERT INTO discussion_event (discussion_id, seq, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(discussionId, seq, type, JSON.stringify(payload ?? {}), now);
      return seq;
    });
    const seq = run();
    return { seq, type, discussionId, ts: now, payload };
  }

  /** 回放：把历史事件还原成完整事件对象（transcript.append 需要回填整条 entry）。 */
  getEvents(discussionId: string, since = 0): DiscussionEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM discussion_event WHERE discussion_id = ? AND seq > ? ORDER BY seq')
      .all(discussionId, since) as Array<{
      seq: number;
      type: string;
      payload: string;
      created_at: number;
    }>;

    const transcriptById = new Map(this.getTranscript(discussionId).map((e) => [e.id, e]));

    return rows.map((row) => {
      const payload = safeParse(row.payload);
      let hydrated: unknown = payload;
      if (row.type === 'transcript.append') {
        const entryId = (payload as { entryId?: string } | null)?.entryId;
        const entry = entryId ? transcriptById.get(entryId) : undefined;
        if (entry) hydrated = { entry };
      }
      return {
        seq: row.seq,
        type: row.type as DiscussionEventType,
        discussionId,
        ts: row.created_at,
        payload: hydrated,
      };
    });
  }

  // ------------------------------------------------------------ 预置议题

  listPresets(): PresetTopic[] {
    const rows = this.db.prepare('SELECT * FROM preset_topic ORDER BY sort_order, id').all() as PresetRow[];
    return rows.map(toPreset);
  }

  insertPresets(items: Array<PresetTopic & { sortOrder: number }>): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO preset_topic
         (id, topic, background, expert_count, tags, suggested_panel, sort_order)
       VALUES (@id, @topic, @background, @expertCount, @tags, @suggestedPanel, @sortOrder)`,
    );
    const run = this.db.transaction((list: typeof items) => {
      for (const item of list) {
        stmt.run({
          id: item.id,
          topic: item.topic,
          background: item.background,
          expertCount: item.expertCount,
          tags: JSON.stringify(item.tags),
          suggestedPanel: JSON.stringify(item.suggestedPanel),
          sortOrder: item.sortOrder,
        });
      }
    });
    run(items);
  }

  clearPresets(): void {
    this.db.prepare('DELETE FROM preset_topic').run();
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 归一化：用于 statement / 姓名的宽松匹配（去空白、去标点、统一大小写）。 */
export function normalizeKey(input: string): string {
  return input
    .replace(/[\s，。！？、；：""''（）《》,.!?;:()[\]<>"'-]/g, '')
    .toLowerCase();
}

export { parseJsonArray };

// ------------------------------------------------------------ 单例

let repo: Repo | null = null;

export function getRepo(): Repo {
  if (!repo) repo = new Repo(getDb());
  return repo;
}

export function setRepo(next: Repo | null): void {
  repo = next;
}
