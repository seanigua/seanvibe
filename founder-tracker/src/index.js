require('dotenv').config();
const cron = require('node-cron');
const { initDb }   = require('../db/init');
const { upsertLead, insertRun } = require('./db/leads');
const { dedup }      = require('./filters/dedup');
const { scoreLeads } = require('./filters/score');
const { enrichLeads }  = require('./enrichers/enrich');
const { evaluateLead } = require('./llm/haiku');
const { generateHeatmaps } = require('./digest/heatmap');

// ── entry point ────────────────────────────────────────────────────────────
// argv parsing happens FIRST so startup diagnostics fire before any DB/cron work.

const args = process.argv.slice(2);
const SCRAPE_MODE = args.includes('--scrape');

console.log(`[startup] argv: ${JSON.stringify(process.argv)}`);
console.log(`[startup] --scrape flag: ${SCRAPE_MODE ? 'YES' : 'no'}`);

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
  console.log(`[1/6 scrape] running ${SCRAPERS.length} scrapers...`);
  const allRaw = [];
  const perSourceCounts = {};

  for (const scraper of SCRAPERS) {
    const t0 = Date.now();
    console.log(`[1/6 scrape] → ${scraper.name} starting`);
    try {
      const leads = await scraper.load().scrape();
      allRaw.push(...leads);
      perSourceCounts[scraper.name] = leads.length;
      console.log(`[1/6 scrape] ← ${scraper.name} done: ${leads.length} leads in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.log(`[1/6 scrape] ← ${scraper.name} ERROR: ${err.message}`);
      perSourceCounts[scraper.name] = 0;
    }
  }
  console.log(`[1/6 scrape] total raw leads: ${allRaw.length}`);

  if (!allRaw.length) {
    console.log('[pipeline] no leads scraped — exiting.');
    return;
  }

  // 2. Dedup against DB ─────────────────────────────────────────────────────
  const deduped = dedup(db, allRaw);
  const dropped = allRaw.length - deduped.length;
  console.log(`[2/6 dedup]  ${deduped.length} new, ${dropped} already in DB`);

  if (!deduped.length) {
    console.log('[pipeline] all leads already seen — exiting.');
    return;
  }

  // 3. Score and filter ─────────────────────────────────────────────────────
  const scored = scoreLeads(deduped);
  console.log(`[3/6 score]  ${scored.length} passed raw_score>=4 filter (${deduped.length - scored.length} dropped)`);

  if (!scored.length) {
    console.log('[pipeline] no leads above threshold — exiting.');
    return;
  }

  // 4. Enrich (GitHub + LinkedIn) ───────────────────────────────────────────
  console.log(`[4/6 enrich] enriching ${scored.length} leads with GitHub + LinkedIn...`);
  const enriched = await enrichLeads(scored, db);
  console.log(`[4/6 enrich] done (${enriched.length} enriched leads)`);

  // 5. LLM scoring ──────────────────────────────────────────────────────────
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasApiKey) {
    console.log('[5/6 llm]    ANTHROPIC_API_KEY not set — skipping LLM scoring');
  } else {
    console.log(`[5/6 llm]    scoring ${enriched.length} leads with Claude Haiku...`);
  }

  let persisted = 0;
  let llmErrors = 0;

  for (const lead of enriched) {
    let finalLead = lead;

    if (hasApiKey) {
      try {
        const { llm_score, memo } = await evaluateLead(lead);
        finalLead = { ...lead, llm_score, memo };
        console.log(`[5/6 llm]    ${lead.name.slice(0, 22).padEnd(22)} llm=${String(llm_score).padStart(3)}  raw=${lead.raw_score}`);
      } catch (err) {
        llmErrors++;
        console.warn(`[5/6 llm]    ${lead.name}: error — ${err.message}`);
      }
    }

    try {
      upsertLead(db, finalLead);
      persisted++;
    } catch (err) {
      console.warn(`[persist] ${lead.name}: ${err.message}`);
    }
  }
  console.log(`[5/6 llm]    persisted ${persisted} leads, ${llmErrors} llm errors`);

  // Record run per source (non-fatal) ───────────────────────────────────────
  for (const [source, leadsFound] of Object.entries(perSourceCounts)) {
    try {
      insertRun(db, {
        run_id:              `${runId}_${source}`,
        source,
        leads_found:         leadsFound,
        leads_passed_filter: scored.filter(l => {
          const h = (l.hackathon ?? '').toLowerCase();
          if (source === 'devpost')          return h.includes('hackatum') || h.includes('cispa');
          if (source === 'mlh')              return h.includes('mlh');
          if (source === 'university_clubs') return !!l.club && !h.length;
          if (source === 'github_search')    return !!l.github_url && !l.hackathon && !l.club;
          return false;
        }).length,
      });
    } catch { /* non-fatal */ }
  }

  // 6. Generate heatmaps ────────────────────────────────────────────────────
  console.log(`[6/6 heatmap] generating HTML heatmaps...`);
  try {
    generateHeatmaps(db);
    console.log(`[6/6 heatmap] done — see data/heatmaps/index.html`);
  } catch (err) {
    console.warn(`[6/6 heatmap] ERROR: ${err.message}`);
  }

  const elapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  console.log(`${'─'.repeat(58)}`);
  console.log(`[pipeline] done in ${elapsed}s`);
  console.log(`${'─'.repeat(58)}\n`);
}

// ── dispatch ───────────────────────────────────────────────────────────────

if (SCRAPE_MODE) {
  console.log('[startup] running pipeline immediately (--scrape)');
  runPipeline()
    .then(() => {
      console.log('[startup] pipeline finished — exiting');
      process.exit(0);
    })
    .catch(err => {
      console.error('[pipeline] fatal:', err.stack || err.message);
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
