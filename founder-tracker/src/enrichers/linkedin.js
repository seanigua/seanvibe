// LinkedIn public-profile enrichment via Playwright (unauthenticated).
//
// LinkedIn blocks unauthenticated scrapers aggressively. Strategy:
//  1. Navigate to the public profile URL
//  2. Immediately detect authwall / captcha by inspecting the final URL and title
//  3. If blocked: log, close page, return lead unchanged — no retry
//  4. If accessible: extract headline + about via Open Graph tags (server-rendered,
//     layout-stable) with DOM selector fallbacks
//
// Minimum delay between requests: max(SCRAPE_DELAY_MS, 4000 ms)

const MIN_LI_DELAY_MS = 4000;

function liDelay() {
  return Math.max(parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10), MIN_LI_DELAY_MS);
}

const BLOCK_URL_PATTERNS = [
  'authwall', 'checkpoint', '/login', '/signup', '/uas/login',
  'session_redirect', 'joinNow',
];

const BLOCK_TITLE_PATTERNS = [
  'sign in', 'log in', 'join linkedin', 'linkedin login',
];

function isBlocked(url, title) {
  const u = url.toLowerCase();
  const t = (title ?? '').toLowerCase();
  return BLOCK_URL_PATTERNS.some(p => u.includes(p))
    || BLOCK_TITLE_PATTERNS.some(p => t.includes(p));
}

/**
 * Extract headline and summary from an accessible LinkedIn profile page.
 *
 * Priority order:
 *  1. Open Graph meta tags (og:title → "Name | Headline", og:description → summary)
 *  2. DOM selectors for the public view (class names change; kept as fallback)
 */
async function extractProfile(page) {
  let headline = null;
  let summary = null;

  // --- Open Graph (most reliable for unauthenticated views) ---
  try {
    headline = await page.$eval(
      'meta[property="og:title"]',
      el => el.getAttribute('content'),
    );
    // og:title is "First Last | Job Title at Company | LinkedIn"
    // Strip the trailing " | LinkedIn" and leading "Name | " parts
    if (headline) {
      const parts = headline.split(' | ');
      // Remove last segment if it's "LinkedIn"
      if (parts[parts.length - 1].trim().toLowerCase() === 'linkedin') parts.pop();
      // Remove first segment (name) if there are at least 2 parts left
      if (parts.length > 1) parts.shift();
      headline = parts.join(' | ').trim() || null;
    }
  } catch { /* og:title absent */ }

  try {
    summary = await page.$eval(
      'meta[property="og:description"]',
      el => el.getAttribute('content'),
    );
  } catch { /* og:description absent */ }

  // --- DOM fallbacks ---
  if (!headline) {
    for (const sel of [
      '.text-heading-xlarge',
      'h1',
      '[data-generated-suggestion-target] h1',
    ]) {
      try {
        headline = await page.$eval(sel, el => el.innerText?.trim());
        if (headline) break;
      } catch { /* selector absent */ }
    }
  }

  if (!summary) {
    for (const sel of [
      '.inline-show-more-text',
      '#about ~ * .inline-show-more-text',
      '[data-section="summary"] p',
      '.pv-about-section p',
    ]) {
      try {
        summary = await page.$eval(sel, el => el.innerText?.trim());
        if (summary) break;
      } catch { /* selector absent */ }
    }
  }

  return {
    linkedin_headline: headline ?? null,
    linkedin_summary:  summary ? summary.slice(0, 400) : null,
  };
}

/**
 * Enrich a single lead with LinkedIn public profile data.
 *
 * @param {object} lead
 * @param {import('playwright').Browser} browser  - shared, caller-managed
 * @returns {Promise<object>} enriched lead (unchanged on block or error)
 */
async function enrichFromLinkedIn(lead, browser) {
  if (!lead.linkedin_url) return lead;

  const page = await browser.newPage();

  try {
    // Randomise user-agent within a realistic Chrome range
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,de;q=0.8' });

    let response;
    try {
      response = await page.goto(lead.linkedin_url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
    } catch (err) {
      console.warn(`[linkedin-enricher] navigation failed for ${lead.linkedin_url}: ${err.message}`);
      return lead;
    }

    const finalUrl = page.url();
    const title    = await page.title().catch(() => '');
    const status   = response?.status() ?? 0;

    if (status === 999 || isBlocked(finalUrl, title)) {
      console.warn(`[linkedin-enricher] blocked (${status}) on ${lead.linkedin_url} → ${finalUrl}`);
      return lead;
    }

    const profile = await extractProfile(page);
    console.log(`[linkedin-enricher] ok: ${lead.name} → headline: "${profile.linkedin_headline ?? '(none)'}"`);

    return { ...lead, ...profile };
  } catch (err) {
    console.warn(`[linkedin-enricher] unexpected error for ${lead.linkedin_url}: ${err.message}`);
    return lead;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { enrichFromLinkedIn, liDelay };
