/**
 * SQLite helpers for the leads and runs tables.
 */

function upsertLead(db, lead) {
  const stmt = db.prepare(`
    INSERT INTO leads
      (name, linkedin_url, github_url, university, club, hackathon, location,
       thesis_keywords, github_stars, github_repos, raw_score, llm_score, memo, seen_at, last_updated)
    VALUES
      (@name, @linkedin_url, @github_url, @university, @club, @hackathon, @location,
       @thesis_keywords, @github_stars, @github_repos, @raw_score, @llm_score, @memo,
       datetime('now'), datetime('now'))
    ON CONFLICT(linkedin_url) DO UPDATE SET
      github_stars   = excluded.github_stars,
      github_repos   = excluded.github_repos,
      raw_score      = excluded.raw_score,
      llm_score      = excluded.llm_score,
      memo           = excluded.memo,
      last_updated   = datetime('now')
  `);
  return stmt.run(lead);
}

function getTopLeads(db, limit = 20) {
  return db.prepare(`
    SELECT * FROM leads
    ORDER BY llm_score DESC, raw_score DESC
    LIMIT ?
  `).all(limit);
}

function insertRun(db, run) {
  return db.prepare(`
    INSERT INTO runs (run_id, started_at, source, leads_found, leads_passed_filter)
    VALUES (@run_id, datetime('now'), @source, @leads_found, @leads_passed_filter)
  `).run(run);
}

function getRecentRuns(db, limit = 10) {
  return db.prepare(`
    SELECT * FROM runs ORDER BY started_at DESC LIMIT ?
  `).all(limit);
}

module.exports = { upsertLead, getTopLeads, insertRun, getRecentRuns };
