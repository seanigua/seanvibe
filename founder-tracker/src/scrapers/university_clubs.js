const axios = require('axios');
const cheerio = require('cheerio');

const DELAY = () => parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);

// Each entry maps a club page URL to a human-readable club name.
const CLUB_PAGES = [
  { url: 'https://tum-ai.com/people',      club: 'TUM.ai',         location: 'Munich, Germany' },
  { url: 'https://cdtm.de/people',         club: 'CDTM',           location: 'Munich, Germany' },
  { url: 'https://ec.ethz.ch/people',      club: 'ETH Entrepreneur Club', location: 'Zurich, Switzerland' },
  { url: 'https://mainexist.de/team',      club: 'Main Exist',     location: 'Frankfurt, Germany' },
];

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; founder-tracker/1.0)' },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Given a loaded cheerio doc, extract all LinkedIn profile URLs and attempt to
 * resolve the person's name from adjacent DOM text.
 *
 * Strategy (in priority order):
 *  1. Closest ancestor <li> or <article> / [class*="member|person|team|card"] —
 *     look for a heading or .name/.title child.
 *  2. Immediately preceding sibling text node or span.
 *  3. aria-label / title attribute on the <a> itself.
 *  4. Fall back to LinkedIn username slug.
 */
function extractLeadsFromPage($, source) {
  const leads = [];
  const seen = new Set();

  $('a[href*="linkedin.com/in/"]').each((_, anchor) => {
    const href = $(anchor).attr('href') || '';
    // Normalise: strip trailing slash, query params
    const cleanUrl = href.split('?')[0].replace(/\/$/, '');
    if (!cleanUrl.includes('/in/')) return;
    if (seen.has(cleanUrl)) return;
    seen.add(cleanUrl);

    let name = null;

    // 1. Walk up to a semantic container and look for a name element inside it
    const container = $(anchor).closest(
      'li, article, [class*="member"], [class*="person"], [class*="team"], [class*="card"], [class*="people"], section'
    );
    if (container.length) {
      name = container
        .find('h1, h2, h3, h4, h5, .name, [class*="name"], [class*="title"], strong')
        .not('a')
        .first()
        .text()
        .trim() || null;
    }

    // 2. Text of the anchor itself (sometimes the name is the link text)
    if (!name) {
      const linkText = $(anchor).text().trim();
      if (linkText && !linkText.toLowerCase().includes('linkedin')) name = linkText;
    }

    // 3. aria-label or title on the anchor
    if (!name) {
      name = $(anchor).attr('aria-label') || $(anchor).attr('title') || null;
      if (name && name.toLowerCase().includes('linkedin')) name = null;
    }

    // 4. Derive a best-guess name from the LinkedIn slug
    if (!name) {
      const slug = cleanUrl.split('/in/')[1] || '';
      name = slug.replace(/-\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    if (!name) return;

    leads.push({
      name,
      linkedin_url: cleanUrl,
      github_url: null,
      university: source.club.includes('ETH') ? 'ETH Zurich'
        : source.club.includes('TUM') || source.club.includes('CDTM') ? 'TU Munich'
        : null,
      club: source.club,
      hackathon: null,
      location: source.location,
      raw_bio: null,
      thesis_keywords: [],
    });
  });

  return leads;
}

async function scrapeClubPage(source) {
  let html;
  try {
    const { data } = await http.get(source.url);
    html = data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429) console.warn(`[clubs] 429 on ${source.url} — skipping`);
    else console.warn(`[clubs] failed to fetch ${source.url}: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const leads = extractLeadsFromPage($, source);
  console.log(`[clubs] ${source.club}: ${leads.length} leads from ${source.url}`);
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
