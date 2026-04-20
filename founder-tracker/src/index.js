require('dotenv').config();
const cron = require('node-cron');
const { initDb }   = require('../db/init');
const { upsertLead, insertRun } = require('./db/leads');
const { dedup }      = require('./filters/dedup');
const { scoreLeads } = require('./filters/score');
const { enrichLeads }  = require('./enrichers/enrich');
const { evaluateLead } = require('./llm/haiku');

const db = initDb();

// ── scrapers registry ──────────────────────────────────────────────────────

const SCRAPERS = [
  { name: 'devpost',          load: () => require('./scrapers/devpost') },
  { name: 'mlh',              load: () => require('./scrapers/mlh') },
  { name: 'university_clubs', load: () => require('./scrapers/university_clubs') },
  { name: 'github_search',    load: () => require('./scrapers/github_search') },
];

// ── pipeline ───────────────────────────────────────────────────────────────

async function runPipeline() {
  const pipelineStart = Date.now();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`\n${'─'.repeat(58)}`);
  console.log(`[pipeline] starting run ${runId}`);
  console.log(`${'─'.repeat(58)}`);

  // 1. Scrape all sources ───────────────────────────────────────────────────
  const allRaw = [];
  const perSourceCounts = {};

  for (const scraper of SCRAPERS) {
    process.stdout.write(`[scrape]  ${scraper.name.padEnd(18)}`);
    try {
      const leads = await scraper.load().scrape();
      allRaw.push(...leads);
      perSourceCounts[scraper.name] = leads.length;
      console.log(`${leads.length} leads`);
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
      perSourceCounts[scraper.name] = 0;
    }
  }

  console.log(`[scrape]  ${'total'.padEnd(18)}${allRaw.length} leads`);

  if (!allRaw.length) {
    console.log('[pipeline] no leads scraped — exiting.');
    return;
  }

  // 2. Dedup against DB ─────────────────────────────────────────────────────
  const deduped = dedup(db, allRaw);
  const dropped = allRaw.length - deduped.length;
  console.log(`[dedup]   ${deduped.length} new  (${dropped} already in DB)`);

  if (!deduped.length) {
    console.log('[pipeline] all leads already seen — exiting.');
    return;
  }

  // 3. Score and filter ─────────────────────────────────────────────────────
  const scored = scoreLeads(deduped);
  console.log(`[score]   ${scored.length} passed filter  (${deduped.length - scored.length} below raw_score threshold)`);

  if (!scored.length) {
    console.log('[pipeline] no leads above threshold — exiting.');
    return;
  }

  // 4. Enrich (GitHub + LinkedIn) ───────────────────────────────────────────
  console.log(`[enrich]  enriching ${scored.length} leads...`);
  const enriched = await enrichLeads(scored, db);

  // 5. LLM scoring ──────────────────────────────────────────────────────────
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasApiKey) {
    console.log('[llm]     ANTHROPIC_API_KEY not set — skipping LLM scoring');
  }

  let persisted = 0;
  let llmErrors = 0;

  for (const lead of enriched) {
    let finalLead = lead;

    if (hasApiKey) {
      try {
        const { llm_score, memo } = await evaluateLead(lead);
        finalLead = { ...lead, llm_score, memo };
        console.log(`[llm]     ${lead.name.slice(0, 22).padEnd(22)} llm=${String(llm_score).padStart(3)}  raw=${lead.raw_score}`);
      } catch (err) {
        llmErrors++;
        console.warn(`[llm]     ${lead.name}: error — ${err.message}`);
        // Persist with whatever data we have; llm_score stays 0
      }
    }

    try {
      upsertLead(db, finalLead);
      persisted++;
    } catch (err) {
      console.warn(`[persist] ${lead.name}: ${err.message}`);
    }
  }

  // 6. Record run per source ─────────────────────────────────────────────────
  for (const [source, leadsFound] of Object.entries(perSourceCounts)) {
    try {
      insertRun(db, {
        run_id:              `${runId}_${source}`,
        source,
        leads_found:         leadsFound,
        leads_passed_filter: scored.filter(l => {
          // approximate per-source attribution
          const h = (l.hackathon ?? '').toLowerCase();
          const c = (l.club      ?? '').toLowerCase();
          if (source === 'devpost')          return h.includes('hackatum') || h.includes('cispa');
          if (source === 'mlh')              return h.includes('mlh');
          if (source === 'university_clubs') return !!l.club && !h.length;
          if (source === 'github_search')    return !!l.github_url && !l.hackathon && !l.club;
          return false;
        }).length,
      });
    } catch { /* non-fatal */ }
  }

  const elapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  console.log(`${'─'.repeat(58)}`);
  console.log(`[pipeline] done in ${elapsed}s`);
  console.log(`           persisted ${persisted}  llm errors ${llmErrors}`);
  console.log(`${'─'.repeat(58)}\n`);
}

// ── entry point ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--scrape')) {
  runPipeline()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[pipeline] fatal:', err.message);
      process.exit(1);
    });
} else {
  // Scheduled mode: weekly digest every Monday at 08:00 Berlin time
  cron.schedule('0 8 * * 1', async () => {
    const { buildDigest } = require('./digest/weekly');
    await buildDigest(db);
  }, { timezone: 'Europe/Berlin' });

  console.log('Founder tracker running.');
  console.log('  Weekly digest : Mondays 08:00 Europe/Berlin');
  console.log('  Run pipeline  : node src/index.js --scrape');
}
