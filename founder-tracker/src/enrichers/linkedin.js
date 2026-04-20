/**
 * LinkedIn enrichment via public profile scraping.
 * Use sparingly — respect rate limits and ToS.
 */
const axios = require('axios');
const cheerio = require('cheerio');

async function enrichFromLinkedIn(lead) {
  if (!lead.linkedin_url) return lead;

  const delay = parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
  await new Promise(r => setTimeout(r, delay));

  // TODO: fetch public LinkedIn profile, extract education, current role, location
  // Returns enriched lead with university, location filled in where missing

  return lead;
}

module.exports = { enrichFromLinkedIn };
