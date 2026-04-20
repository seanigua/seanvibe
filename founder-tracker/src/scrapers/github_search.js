const axios = require('axios');

const DELAY = () => parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
const GITHUB_API = 'https://api.github.com';

// Unauthenticated: 10 req/min for search, 60/hr for REST.
// Authenticated (GITHUB_TOKEN): 30 req/min for search, 5000/hr for REST.
const DACH_LOCATIONS = ['Germany', 'Austria', 'Switzerland', 'Deutschland', 'Österreich', 'Schweiz'];
const DACH_CITIES = [
  'Berlin', 'Munich', 'München', 'Hamburg', 'Frankfurt', 'Stuttgart', 'Cologne', 'Köln',
  'Düsseldorf', 'Leipzig', 'Vienna', 'Wien', 'Graz', 'Linz', 'Salzburg',
  'Zurich', 'Zürich', 'Basel', 'Bern', 'Lausanne', 'Geneva', 'Genf',
];
const ALL_DACH = [...DACH_LOCATIONS, ...DACH_CITIES];

// Queries mirroring the spec, split by topic for better recall.
// GitHub search uses implicit AND; use OR explicitly for language union.
const REPO_QUERIES = [
  'vertical AI language:python OR language:javascript OR language:typescript',
  '"B2B SaaS" language:python OR language:javascript OR language:typescript',
  '"compliance AI" language:python OR language:javascript OR language:typescript',
  '"vertical software" AI language:python OR language:typescript',
  'deeptech startup language:python OR language:javascript',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'founder-tracker/1.0',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return axios.create({ baseURL: GITHUB_API, timeout: 15000, headers });
}

function isDACH(location = '') {
  return ALL_DACH.some(t => location.toLowerCase().includes(t.toLowerCase()));
}

async function fetchUserProfile(client, username) {
  const { data } = await client.get(`/users/${username}`);
  return data;
}

/**
 * Search repos for one query, returning up to `perPage` results from `page`.
 * Returns null on rate-limit, [] on other errors.
 */
async function searchRepos(client, query, page = 1, perPage = 30) {
  try {
    const { data } = await client.get('/search/repositories', {
      params: { q: query, sort: 'updated', order: 'desc', per_page: perPage, page },
    });
    return data.items ?? [];
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 403) {
      const retryAfter = parseInt(err.response.headers['retry-after'] ?? '60', 10);
      console.warn(`[github] rate-limited — retry-after ${retryAfter}s, skipping query`);
      return null;           // signal caller to abort this query
    }
    if (status === 422) {
      console.warn(`[github] invalid query "${query}": ${err.response?.data?.message}`);
      return [];
    }
    console.warn(`[github] search error for "${query}": ${err.message}`);
    return [];
  }
}

async function processRepo(client, repo) {
  const ownerLogin = repo.owner?.login;
  if (!ownerLogin || repo.owner?.type === 'Organization') return null;

  await sleep(DELAY());

  let user;
  try {
    user = await fetchUserProfile(client, ownerLogin);
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 403) {
      console.warn(`[github] rate-limited fetching user ${ownerLogin}`);
    } else {
      console.warn(`[github] skip user ${ownerLogin}: ${err.message}`);
    }
    return null;
  }

  if (!isDACH(user.location ?? '')) return null;

  // Derive thesis_keywords from repo topics + language
  const keywords = [...(repo.topics ?? [])];
  if (repo.language) keywords.push(repo.language.toLowerCase());

  return {
    name: user.name || user.login,
    linkedin_url: null,
    github_url: user.html_url,
    university: null,
    club: null,
    hackathon: null,
    location: user.location,
    raw_bio: user.bio || repo.description || null,
    thesis_keywords: [...new Set(keywords)],
  };
}

async function scrape() {
  const client = makeClient();
  const leads = [];
  const seenOwners = new Set();

  for (const query of REPO_QUERIES) {
    const repos = await searchRepos(client, query);
    if (repos === null) break;    // rate-limited; stop all queries
    if (!repos.length) {
      await sleep(DELAY());
      continue;
    }

    for (const repo of repos) {
      const ownerLogin = repo.owner?.login;
      if (!ownerLogin || seenOwners.has(ownerLogin)) continue;
      seenOwners.add(ownerLogin);

      const lead = await processRepo(client, repo);
      if (lead) {
        leads.push(lead);
        console.log(`[github] found DACH founder: ${lead.name} (${lead.location})`);
      }
    }

    await sleep(DELAY());
  }

  console.log(`[github] total leads: ${leads.length}`);
  return leads;
}

module.exports = { scrape };
