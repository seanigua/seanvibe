/**
 * SQLite helpers for the leads and runs tables.
 */

/**
 * Prepare a row object for SQLite insertion, normalising types that differ
 * between the in-memory Lead shape and the DB column types.
 */
function toRow(lead) {
  return {
    name:               lead.name                ?? null,
    linkedin_url:       lead.linkedin_url        ?? null,
    github_url:         lead.github_url          ?? null,
    university:         lead.university          ?? null,
    club:               lead.club                ?? null,
    hackathon:          lead.hackathon           ?? null,
    location:           lead.location            ?? null,
    raw_bio:            lead.raw_bio             ?? null,
    // thesis_keywords may arrive as string[] from scrapers — serialise to JSON
    thesis_keywords: Array.isArray(lead.thesis_keywords)
      ? JSON.stringify(lead.thesis_keywords)
      : (lead.thesis_keywords ?? null),
    github_stars:       lead.github_stars        ?? 0,
    github_repos:       lead.github_repos        ?? 0,
    github_followers:   lead.github_followers    ?? 0,
    github_bio:         lead.github_bio          ?? null,
    github_enriched_at: lead.github_enriched_at  ?? null,
    linkedin_headline:  lead.linkedin_headline   ?? null,
    linkedin_summary:   lead.linkedin_summary    ?? null,
    raw_score:          lead.raw_score           ?? 0,
    llm_score:          lead.llm_score           ?? 0,
    memo:               lead.memo                ?? null,
  };
}

function upsertLead(db, lead) {
  const row = toRow(lead);
  return db.prepare(`
    INSERT INTO leads
      (name, linkedin_url, github_url, university, club, hackathon, location,
       raw_bio, thesis_keywords,
       github_stars, github_repos, github_followers, github_bio, github_enriched_at,
       linkedin_headline, linkedin_summary,
       raw_score, llm_score, memo, seen_at, last_updated)
    VALUES
      (@name, @linkedin_url, @github_url, @university, @club, @hackathon, @location,
       @raw_bio, @thesis_keywords,
       @github_stars, @github_repos, @github_followers, @github_bio, @github_enriched_at,
       @linkedin_headline, @linkedin_summary,
       @raw_score, @llm_score, @memo,
       datetime('now'), datetime('now'))
    ON CONFLICT(linkedin_url) DO UPDATE SET
      github_stars       = excluded.github_stars,
      github_repos       = excluded.github_repos,
      github_followers   = excluded.github_followers,
      github_bio         = excluded.github_bio,
      github_enriched_at = excluded.github_enriched_at,
      linkedin_headline  = excluded.linkedin_headline,
      linkedin_summary   = excluded.linkedin_summary,
      raw_score          = excluded.raw_score,
      llm_score          = excluded.llm_score,
      memo               = excluded.memo,
      last_updated       = datetime('now')
  `).run(row);
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
