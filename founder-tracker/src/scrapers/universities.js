const axios = require('axios');
const cheerio = require('cheerio');

// DACH universities with active entrepreneurship programs
const DACH_UNIVERSITIES = [
  'https://www.unternehmertum.de',
  'https://www.hpi.de',
  'https://www.eth-entrepreneurs.ch',
];

/**
 * Scrape university startup clubs and founder directories.
 */
async function scrapeUniversities(urls = DACH_UNIVERSITIES) {
  const delay = parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
  const leads = [];

  for (const url of urls) {
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);
    // TODO: parse founder profiles, thesis abstracts, club memberships
    await new Promise(r => setTimeout(r, delay));
  }

  return leads;
}

module.exports = { scrapeUniversities };
