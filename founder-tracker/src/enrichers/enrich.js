require('dotenv').config();
const { chromium } = require('playwright');
const { enrichFromGitHub, makeClient } = require('./github');
const { enrichFromLinkedIn, liDelay }   = require('./linkedin');

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Enrich a batch of ScoredLeads with GitHub and LinkedIn data.
 *
 * Processing order per lead:
 *   1. GitHub API enrichment (cached in-memory + DB)
 *   2. Signal #8 re-score with real star/follower counts
 *   3. LinkedIn Playwright enrichment (min 4 s between requests)
 *
 * Never throws — individual failures are logged and the lead is kept as-is.
 *
 * @param {object[]} leads   - ScoredLead[] (raw_score >= 4)
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<object[]>} EnrichedLead[]
 */
async function enrichLeads(leads, db) {
  if (!leads.length) return [];

  const githubClient    = makeClient();
  const githubCache     = new Map();   // username → enrichment fields

  const needsLinkedIn = leads.some(l => l.linkedin_url);
  let browser = null;

  try {
    if (needsLinkedIn) {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      console.log('[enrich] Playwright browser launched for LinkedIn enrichment');
    }

    const enriched = [];

    for (const lead of leads) {
      let l = { ...lead };

      // --- GitHub ---
      if (l.github_url) {
        try {
          l = await enrichFromGitHub(l, githubClient, githubCache, db);
        } catch (err) {
          console.warn(`[enrich] GitHub enrichment failed for ${l.name}: ${err.message}`);
        }
        // Always re-score signal #8 after GitHub attempt (even if it failed,
        // re-scoring against zeros is safe and idempotent)
        l = rescoreSignal8(l);
      }

      // --- LinkedIn ---
      if (l.linkedin_url && browser) {
        try {
          l = await enrichFromLinkedIn(l, browser);
        } catch (err) {
          console.warn(`[enrich] LinkedIn enrichment failed for ${l.name}: ${err.message}`);
        }
        // Enforce min 4 s between LinkedIn requests regardless of outcome
        await sleep(liDelay());
      }

      enriched.push(l);
    }

    console.log(`[enrich] done — ${enriched.length} leads enriched`);
    return enriched;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      console.log('[enrich] Playwright browser closed');
    }
  }
}

module.exports = { enrichLeads, rescoreSignal8 };
