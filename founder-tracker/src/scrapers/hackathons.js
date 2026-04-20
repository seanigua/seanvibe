const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrape public hackathon participant lists (Devpost, Major League Hacking, etc.)
 * targeting DACH-region events.
 */
async function scrapeHackathons(eventUrls = []) {
  const delay = parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
  const leads = [];

  for (const url of eventUrls) {
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);
    // TODO: parse participant names, github links, project descriptions
    await new Promise(r => setTimeout(r, delay));
  }

  return leads;
}

module.exports = { scrapeHackathons };
