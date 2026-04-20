const { getTopLeads, getRecentRuns } = require('../db/leads');

/**
 * Build and print a weekly digest of top-scored leads.
 */
async function buildDigest(db) {
  const leads = getTopLeads(db, 10);
  const runs = getRecentRuns(db, 7);

  const totalFound = runs.reduce((s, r) => s + r.leads_found, 0);
  const totalPassed = runs.reduce((s, r) => s + r.leads_passed_filter, 0);

  console.log('\n========== WEEKLY FOUNDER DIGEST ==========');
  console.log(`Runs last 7 days: ${runs.length}`);
  console.log(`Leads scraped: ${totalFound}  |  Passed filter: ${totalPassed}\n`);

  if (leads.length === 0) {
    console.log('No leads yet.');
    return;
  }

  leads.forEach((l, i) => {
    console.log(`#${i + 1} ${l.name} (llm_score: ${l.llm_score}, raw: ${l.raw_score})`);
    console.log(`    Location: ${l.location ?? '—'}  |  University: ${l.university ?? '—'}`);
    console.log(`    GitHub: ${l.github_url ?? '—'}  |  ★ ${l.github_stars}  repos: ${l.github_repos}`);
    if (l.memo) console.log(`    Memo: ${l.memo}`);
    console.log();
  });

  console.log('===========================================\n');
}

module.exports = { buildDigest };

if (require.main === module) {
  require('dotenv').config();
  const { initDb } = require('../../db/init');
  const db = initDb();
  buildDigest(db).then(() => process.exit(0));
}
