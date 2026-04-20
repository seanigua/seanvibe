const { chromium } = require('playwright');

/**
 * Scrape LinkedIn profiles for DACH founders.
 * Requires authenticated session cookies set via LINKEDIN_COOKIES env var.
 */
async function scrapeLinkedIn(query, options = {}) {
  const delay = parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
  const browser = await chromium.launch({ headless: true });
  const leads = [];

  try {
    const page = await browser.newPage();
    // TODO: load session cookies, navigate search, parse profiles
    // Each result should produce: { name, linkedin_url, location, university, ... }
    await page.waitForTimeout(delay);
  } finally {
    await browser.close();
  }

  return leads;
}

module.exports = { scrapeLinkedIn };
