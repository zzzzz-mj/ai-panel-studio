-- ============================================================
-- AI Panel Studio · SQLite schema
-- 所有时间字段为 Unix 毫秒（INTEGER）；结构化字段以 JSON 文本存储。
-- 幂等：全部使用 IF NOT EXISTS，可重复执行。
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- 讨论（聚合根） ----------
CREATE TABLE IF NOT EXISTS discussion (
  id            TEXT PRIMARY KEY,
  topic         TEXT    NOT NULL,
  background    TEXT,
  expert_count  INTEGER NOT NULL DEFAULT 4,
  status        TEXT    NOT NULL DEFAULT 'draft',   -- draft | ready | live | paused | ended
  phase         TEXT    NOT NULL DEFAULT 'opening', -- opening | exploration | conflict | convergence | closing | done
  round_no      INTEGER NOT NULL DEFAULT 0,
  max_turns     INTEGER NOT NULL DEFAULT 24,
  summary       TEXT,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  ended_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_discussion_status ON discussion (status, created_at DESC);

-- ---------- 嘉宾（1 主持人 + N 专家） ----------
CREATE TABLE IF NOT EXISTS panelist (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT    NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
  role          TEXT    NOT NULL,                     -- host | expert
  name          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  org           TEXT,
  stance        TEXT    NOT NULL,
  bio           TEXT    NOT NULL DEFAULT '',
  color         TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'idle',      -- idle | ready | speaking | thinking
  focus         TEXT,
  order_index   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_panelist_discussion ON panelist (discussion_id, order_index);

-- ---------- 发言记录 ----------
CREATE TABLE IF NOT EXISTS transcript_entry (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT    NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
  panelist_id   TEXT    NOT NULL REFERENCES panelist (id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  round_no      INTEGER NOT NULL DEFAULT 0,
  phase         TEXT    NOT NULL,
  intent        TEXT    NOT NULL,                     -- open|question|claim|rebuttal|supplement|agree|summary
  content       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_seq ON transcript_entry (discussion_id, seq);

-- ---------- 共识 / 分歧 ----------
CREATE TABLE IF NOT EXISTS insight (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT    NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL,                     -- consensus | divergence
  statement     TEXT    NOT NULL,
  supporter_ids TEXT    NOT NULL DEFAULT '[]',        -- JSON 数组：panelist id
  tension       TEXT,
  status        TEXT    NOT NULL DEFAULT 'emerging',  -- emerging | stable
  round_no      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insight_discussion ON insight (discussion_id, kind);

-- ---------- 事件流（SSE 回放） ----------
CREATE TABLE IF NOT EXISTS discussion_event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id TEXT    NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  type          TEXT    NOT NULL,
  payload       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_seq ON discussion_event (discussion_id, seq);

-- ---------- 预置议题库（样例数据） ----------
CREATE TABLE IF NOT EXISTS preset_topic (
  id              TEXT PRIMARY KEY,
  topic           TEXT    NOT NULL,
  background      TEXT,
  expert_count    INTEGER NOT NULL DEFAULT 4,
  tags            TEXT    NOT NULL DEFAULT '[]',      -- JSON 数组
  suggested_panel TEXT    NOT NULL DEFAULT '[]',      -- JSON 数组：{name,title,stance,bio}
  sort_order      INTEGER NOT NULL DEFAULT 0
);
