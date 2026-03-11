-- ============================================================================
-- backlog-mcp D1 initial schema
-- ADR-0089: Storage abstraction layer (filesystem + Cloudflare D1)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'task',
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  epic_id       TEXT,
  parent_id     TEXT,
  blocked_reason TEXT,  -- JSON array serialised as a string
  evidence      TEXT,   -- JSON array serialised as a string
  "references"  TEXT,   -- JSON array serialised as a string
  due_date      TEXT,
  content_type  TEXT,
  path          TEXT,
  body          TEXT,   -- markdown body / description field
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_epic       ON tasks(epic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent     ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);

-- ----------------------------------------------------------------------------
-- tasks_fts — FTS5 virtual table (kept in sync via batch ops in D1Adapter)
-- ----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  id    UNINDEXED,
  title,
  body,
  content='tasks',
  content_rowid='rowid'
);

-- ----------------------------------------------------------------------------
-- operations — audit log (written via D1OperationLog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  tool        TEXT NOT NULL,
  actor       TEXT,         -- JSON-serialised Actor object
  resource_id TEXT,
  task_id     TEXT,
  params      TEXT,         -- JSON-serialised params
  result      TEXT          -- JSON-serialised result
);

CREATE INDEX IF NOT EXISTS idx_operations_task_id ON operations(task_id);
CREATE INDEX IF NOT EXISTS idx_operations_ts      ON operations(ts DESC);
