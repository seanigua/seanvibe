const axios = require('axios');

const DELAY = () => parseInt(process.env.SCRAPE_DELAY_MS ?? 1500, 10);
const GITHUB_API = 'https://api.github.com';

const DACH_LOCATIONS = [
  'Germany', 'Austria', 'Switzerland',
  'Deutschland', 'Österreich', 'Schweiz',
];
const DACH_CITIES = [
  'Berlin', 'Munich', 'München', 'Hamburg', 'Frankfurt', 'Stuttgart',
  'Cologne', 'Köln', 'Düsseldorf', 'Leipzig',
  'Vienna', 'Wien', 'Graz', 'Linz', 'Salzburg',
  'Zurich', 'Zürich', 'Basel', 'Bern', 'Lausanne', 'Geneva', 'Genf',
];
const ALL_DACH = [...DACH_LOCATIONS, ...DACH_CITIES];

// Each query targets a product vertical relevant to DACH VC scouting.
// Language filters are split into separate queries so GitHub's OR
// operator isn't needed (avoids pagination edge-cases with complex q strings).
const REPO_QUERIES = [
  'vertical AI startup language:python',
  'vertical AI startup language:typescript',
  '"B2B SaaS" germany language:python',
  '"B2B SaaS" germany language:typescript',
  'compliance fintech language:python stars:>2',
  '"deep tech" startup language:python stars:>2',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[github] GITHUB_TOKEN not set — using unauthenticated (10 req/min search limit)');
  } else {
    console.log('[github] GITHUB_TOKEN present — using authenticated client (5000 req/hr)');
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'founder-tracker/1.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return axios.create({ baseURL: GITHUB_API, timeout: 15000, headers });
}

function isDACH(location = '') {
  const loc = location.toLowerCase();
  return ALL_DACH.some(t => loc.includes(t.toLowerCase()));
}

async function searchRepos(client, query, page = 1, perPage = 30) {
  console.log(`[github] search: "${query}" (page ${page})`);
  try {
    const { data } = await client.get('/search/repositories', {
      params: { q: query, sort: 'updated', order: 'desc', per_page: perPage, page },
    });
    console.log(`[github] → ${data.total_count} total results, ${data.items.length} returned`);
    return data.items ?? [];
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 403) {
      const retryAfter = parseInt(err.response?.headers?.['retry-after'] ?? '60', 10);
      console.warn(`[github] rate-limited (${status}) — retry-after ${retryAfter}s, stopping queries`);
      return null;
    }
    if (status === 422) {
      console.warn(`[github] invalid query "${query}": ${err.response?.data?.message}`);
      return [];
    }
    console.warn(`[github] search error for "${query}": ${err.message}`);
    return [];
  }
}

async function fetchUserProfile(client, username) {
  const { data } = await client.get(`/users/${username}`);
  return data;
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

  if (!isDACH(user.location ?? '')) {
    console.log(`[github] skip ${ownerLogin} — location not DACH: "${user.location ?? '(none)'}"`);
    return null;
  }

  const keywords = [...(repo.topics ?? [])];
  if (repo.language) keywords.push(repo.language.toLowerCase());

  const lead = {
    name:             user.name || user.login,
    linkedin_url:     null,
    github_url:       user.html_url,
    university:       null,
    club:             null,
    hackathon:        null,
    location:         user.location,
    raw_bio:          user.bio || repo.description || null,
    thesis_keywords:  [...new Set(keywords)],
  };

  console.log(`[github] DACH founder: ${lead.name} (${lead.location}) — ${repo.full_name}`);
  return lead;
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
      if (lead) leads.push(lead);
    }

    await sleep(DELAY());
  }

  console.log(`[github] total DACH leads found: ${leads.length}`);
  return leads;
}

module.exports = { scrape };

// ── standalone test runner ────────────────────────────────────────────────
// Usage: node src/scrapers/github_search.js
if (require.main === module) {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  scrape()
    .then(leads => {
      console.log('\n=== Results ===');
      leads.forEach((l, i) => console.log(`${i + 1}. ${l.name} | ${l.location} | ${l.github_url}`));
      console.log(`\nTotal: ${leads.length}`);
    })
    .catch(err => console.error('Fatal:', err.message))
    .finally(() => process.exit(0));
}
