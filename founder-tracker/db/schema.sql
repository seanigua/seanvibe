CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  linkedin_url     TEXT,
  github_url       TEXT,
  university       TEXT,
  club             TEXT,
  hackathon        TEXT,
  location         TEXT,
  thesis_keywords  TEXT,
  github_stars     INTEGER DEFAULT 0,
  github_repos     INTEGER DEFAULT 0,
  raw_score        INTEGER DEFAULT 0,
  llm_score        INTEGER DEFAULT 0,
  memo             TEXT,
  seen_at          DATETIME NOT NULL DEFAULT (datetime('now')),
  last_updated     DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  run_id        TEXT PRIMARY KEY,
  started_at    DATETIME NOT NULL DEFAULT (datetime('now')),
  source        TEXT NOT NULL,
  leads_found   INTEGER DEFAULT 0,
  leads_passed_filter INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leads_raw_score ON leads(raw_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_llm_score ON leads(llm_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_seen_at ON leads(seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
