const axios = require('axios');
const cheerio = require('cheerio');

const DELAY = () => parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
const DACH_TERMS = ['germany', 'austria', 'switzerland', 'deutschland', 'österreich', 'schweiz',
  'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'vienna', 'wien', 'zürich', 'zurich',
  'stuttgart', 'cologne', 'köln', 'graz', 'basel', 'lausanne'];
const MLH_EVENTS_URL = 'https://mlh.io/events';

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; founder-tracker/1.0)' },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isDACH(text = '') {
  return DACH_TERMS.some(t => text.toLowerCase().includes(t));
}

function extractGitHubUrls(html) {
  const $ = cheerio.load(html);
  const urls = new Set();

  $('a[href*="github.com/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    // Accept https://github.com/<user> or https://github.com/<user>/<repo>
    const match = href.match(/https?:\/\/github\.com\/([\w.-]+(?:\/[\w.-]+)?)/);
    if (!match) return;
    const [, path] = match;
    const parts = path.split('/');
    // Exclude org-level or known non-person paths
    if (['orgs', 'teams', 'sponsors', 'features'].includes(parts[0])) return;
    // Normalise to profile URL
    urls.add(`https://github.com/${parts[0]}`);
  });

  return [...urls];
}

async function scrapeEventPage(eventUrl) {
  const leads = [];
  let html;

  try {
    const { data } = await http.get(eventUrl);
    html = data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429) console.warn(`[mlh] 429 on ${eventUrl} — skipping`);
    else console.warn(`[mlh] skip event ${eventUrl}: ${err.message}`);
    return leads;
  }

  const $ = cheerio.load(html);
  const githubUrls = extractGitHubUrls(html);

  // Try to infer location from page title or meta tags
  const pageLocation = $('meta[property="og:description"]').attr('content')
    || $('.event-location, .location, [class*="location"]').first().text().trim()
    || '';

  for (const githubUrl of githubUrls) {
    const username = githubUrl.replace('https://github.com/', '');
    leads.push({
      name: username,            // GitHub username; enricher will resolve real name
      linkedin_url: null,
      github_url: githubUrl,
      university: null,
      club: null,
      hackathon: eventUrl,       // enricher can resolve proper event name later
      location: pageLocation || null,
      raw_bio: null,
      thesis_keywords: [],
    });
  }

  return leads;
}

async function scrapeEventList() {
  let html;
  try {
    const { data } = await http.get(MLH_EVENTS_URL);
    html = data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429) console.warn('[mlh] 429 on events list — aborting');
    else console.warn(`[mlh] failed to fetch events list: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const dachEvents = [];

  // MLH renders event cards; look for location text within each card
  $('[class*="event"], article, .card').each((_, card) => {
    const locationText = $(card)
      .find('[class*="location"], [class*="city"], address, .event-location')
      .first()
      .text()
      .trim();

    if (!isDACH(locationText)) return;

    // Prefer a direct link to the event; fall back to MLH's own event page
    let eventUrl = $(card).find('a[href*="//"]').not('[href*="mlh.io"]').first().attr('href')
      || $(card).find('a').first().attr('href');

    if (!eventUrl) return;
    if (eventUrl.startsWith('/')) eventUrl = `https://mlh.io${eventUrl}`;

    dachEvents.push({ url: eventUrl, location: locationText });
  });

  return dachEvents;
}

async function scrape() {
  const leads = [];

  let events;
  try {
    events = await scrapeEventList();
  } catch (err) {
    console.warn(`[mlh] unhandled error listing events: ${err.message}`);
    return leads;
  }

  console.log(`[mlh] found ${events.length} DACH events`);

  for (const event of events) {
    await sleep(DELAY());
    try {
      const found = await scrapeEventPage(event.url);
      // Back-fill the known location if event page didn't have it
      found.forEach(l => { if (!l.location) l.location = event.location; });
      leads.push(...found);
    } catch (err) {
      console.warn(`[mlh] unhandled error on ${event.url}: ${err.message}`);
    }
  }

  console.log(`[mlh] total leads: ${leads.length}`);
  return leads;
}

module.exports = { scrape };
