require('dotenv').config();
const { enrichFromGitHub, makeClient } = require('./github');

// ---------------------------------------------------------------------------
// Signal #8 re-evaluation after real GitHub data arrives
// ---------------------------------------------------------------------------

const GITHUB_STARS_THRESHOLD    = 5;
const GITHUB_FOLLOWERS_THRESHOLD = 10;

/**
 * Re-evaluate the `recent_github_activity` signal now that we have real data.
 * Returns an updated copy of the lead with corrected `signals` and `raw_score`.
 */
function rescoreSignal8(lead) {
  const active =
    (lead.github_stars    ?? 0) >= GITHUB_STARS_THRESHOLD ||
    (lead.github_followers ?? 0) >= GITHUB_FOLLOWERS_THRESHOLD
      ? 1 : 0;

  // If signals map is absent (lead came straight from scraper, not scoreLeads),
  // we can only patch raw_score if we know the old value.
  if (!lead.signals) {
    return { ...lead, signals: { recent_github_activity: active } };
  }

  const oldSignal = lead.signals.recent_github_activity ?? 0;
  if (oldSignal === active) return lead;  // unchanged

  const newSignals   = { ...lead.signals, recent_github_activity: active };
  const newRawScore  = (lead.raw_score ?? 0) - oldSignal + active;

  return { ...lead, signals: newSignals, raw_score: newRawScore };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Enrich a batch of ScoredLeads with GitHub data (LinkedIn skipped — anti-bot).
 *
 * @param {object[]} leads   - ScoredLead[] (raw_score >= 4)
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<object[]>} EnrichedLead[]
 */
async function enrichLeads(leads, db) {
  if (!leads.length) return [];

  const githubClient = makeClient();
  const githubCache  = new Map();
  const enriched     = [];

  for (const lead of leads) {
    let l = { ...lead };

    if (l.github_url) {
      try {
        l = await enrichFromGitHub(l, githubClient, githubCache, db);
      } catch (err) {
        console.warn(`[enrich] GitHub enrichment failed for ${l.name}: ${err.message}`);
      }
      l = rescoreSignal8(l);
    }

    // LinkedIn enrichment skipped — blocked by anti-bot. URL is preserved.
    enriched.push(l);
  }

  console.log(`[enrich] done — ${enriched.length} leads enriched`);
  return enriched;
}

module.exports = { enrichLeads, rescoreSignal8 };
