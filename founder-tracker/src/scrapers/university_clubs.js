const axios = require('axios');

const DELAY = () => parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);

const CLUB_PAGES = [
  { url: 'https://tum-ai.com/people',    club: 'TUM.ai',               location: 'Munich, Germany',     university: 'TU Munich' },
  { url: 'https://cdtm.de/people',       club: 'CDTM',                 location: 'Munich, Germany',     university: 'TU Munich' },
  { url: 'https://ec.ethz.ch/people',    club: 'ETH Entrepreneur Club', location: 'Zurich, Switzerland', university: 'ETH Zurich' },
  { url: 'https://mainexist.de/team',    club: 'Main Exist',           location: 'Frankfurt, Germany',  university: null },
];

// Matches any href="…linkedin.com/in/slug…" in the raw HTML.
// The slug must be at least 3 chars and can contain letters, digits, hyphens.
const LI_RE = /href=["']([^"']*linkedin\.com\/in\/([a-z0-9][a-z0-9-]{2,})[^"']*?)["']/gi;

const http = axios.create({
  timeout: 20000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; founder-tracker/1.0; +https://github.com)' },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Regex-scan raw HTML for linkedin.com/in/ URLs.
 * Derives a best-effort name from the slug (used only when no real name found).
 */
function extractLeadsFromHtml(html, source) {
  const leads = [];
  const seen = new Set();
  let m;

  LI_RE.lastIndex = 0;
  while ((m = LI_RE.exec(html)) !== null) {
    const rawHref = m[1];
    const slug    = m[2].toLowerCase();

    // Normalise: strip query string, fragment, trailing slash
    const cleanUrl = `https://www.linkedin.com/in/${slug}`;
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    // Best-effort name: turn slug into title-case words
    const name = slug
      .replace(/-\d+$/, '')           // strip trailing numeric ID
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    leads.push({
      name,
      linkedin_url:    cleanUrl,
      github_url:      null,
      university:      source.university ?? null,
      club:            source.club,
      hackathon:       null,
      location:        source.location,
      raw_bio:         null,
      thesis_keywords: [],
    });
  }

  return leads;
}

async function scrapeClubPage(source) {
  console.log(`[clubs] fetching ${source.url}`);
  let html;
  try {
    const { data } = await http.get(source.url);
    html = typeof data === 'string' ? data : JSON.stringify(data);
  } catch (err) {
    const status = err.response?.status;
    console.warn(`[clubs] failed to fetch ${source.url}: ${status ? `HTTP ${status}` : err.message}`);
    return [];
  }

  console.log(`[clubs] fetched ${html.length} bytes from ${source.url}`);
  const leads = extractLeadsFromHtml(html, source);
  console.log(`[clubs] ${source.club}: ${leads.length} LinkedIn URLs found`);
  return leads;
}

async function scrape() {
  const leads = [];

  for (const source of CLUB_PAGES) {
    try {
      const found = await scrapeClubPage(source);
      leads.push(...found);
    } catch (err) {
      console.warn(`[clubs] unhandled error for ${source.club}: ${err.message}`);
    }
    await sleep(DELAY());
  }

  console.log(`[clubs] total leads: ${leads.length}`);
  return leads;
}

module.exports = { scrape, CLUB_PAGES };

// ── standalone test runner ────────────────────────────────────────────────
// Usage: node src/scrapers/university_clubs.js
if (require.main === module) {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  scrape()
    .then(leads => {
      console.log('\n=== Results ===');
      leads.forEach((l, i) => console.log(`${i + 1}. ${l.name} | ${l.club} | ${l.linkedin_url}`));
      console.log(`\nTotal: ${leads.length}`);
    })
    .catch(err => console.error('Fatal:', err.message))
    .finally(() => process.exit(0));
}
