const axios = require('axios');

const GITHUB_API = 'https://api.github.com';
// Re-enrich if cached data is older than this
const CACHE_TTL_DAYS = 7;

function makeClient() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'founder-tracker/1.0',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return axios.create({ baseURL: GITHUB_API, timeout: 12000, headers });
}

function usernameFrom(githubUrl) {
  return githubUrl.replace(/\/$/, '').split('/').pop();
}

/**
 * Look up cached GitHub enrichment from the DB.
 * Returns the cached fields or null if stale/absent.
 */
function loadFromDb(db, githubUrl) {
  const row = db.prepare(`
    SELECT github_stars, github_repos, github_followers, github_bio, location
    FROM   leads
    WHERE  github_url = ?
      AND  github_enriched_at IS NOT NULL
      AND  github_enriched_at > datetime('now', '-${CACHE_TTL_DAYS} days')
    LIMIT  1
  `).get(githubUrl);
  return row ?? null;
}

/**
 * Fetch live data from GitHub Users API.
 * Returns null on any error (rate-limit, 404, network) so the caller can skip.
 */
async function fetchFromApi(client, username) {
  try {
    const { data } = await client.get(`/users/${username}`);
    return {
      github_repos:     data.public_repos     ?? 0,
      github_followers: data.followers         ?? 0,
      github_bio:       data.bio               ?? null,
      // Stars require iterating repos; we compute here only followers for signal #8.
      // A separate repos call is made only when GITHUB_TOKEN is available (quota).
      github_stars:     0,   // will be updated by star fetch below
      location:         data.location          ?? null,
      company:          data.company            ?? null,
      public_gists:     data.public_gists       ?? 0,
    };
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 403) {
      console.warn(`[github-enricher] rate-limited for user ${username}`);
    } else if (status === 404) {
      console.warn(`[github-enricher] 404 for user ${username}`);
    } else {
      console.warn(`[github-enricher] API error for ${username}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Fetch total star count across all public repos.
 * Skips the call when unauthenticated to conserve rate-limit quota.
 */
async function fetchStars(client, username) {
  if (!process.env.GITHUB_TOKEN) return 0;
  try {
    const { data } = await client.get(`/users/${username}/repos`, {
      params: { per_page: 100, sort: 'updated' },
    });
    return data.reduce((sum, r) => sum + (r.stargazers_count ?? 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Enrich a single lead with GitHub data.
 *
 * @param {object} lead
 * @param {import('axios').AxiosInstance} client  - shared across leads
 * @param {Map<string,object>} inMemoryCache       - keyed on github username
 * @param {import('better-sqlite3').Database} db
 * @returns {object} enriched lead (may be unchanged if no github_url)
 */
async function enrichFromGitHub(lead, client, inMemoryCache, db) {
  if (!lead.github_url) return lead;

  const username = usernameFrom(lead.github_url);

  // 1. In-memory cache (same run, same username seen on multiple leads)
  if (inMemoryCache.has(username)) {
    const cached = inMemoryCache.get(username);
    return mergeGitHub(lead, cached);
  }

  // 2. DB cache (previous run within TTL)
  const dbCached = loadFromDb(db, lead.github_url);
  if (dbCached) {
    inMemoryCache.set(username, dbCached);
    return mergeGitHub(lead, dbCached);
  }

  // 3. Live API fetch
  const apiData = await fetchFromApi(client, username);
  if (!apiData) return lead;   // skip gracefully on any error

  apiData.github_stars = await fetchStars(client, username);

  const enrichment = {
    github_repos:        apiData.github_repos,
    github_followers:    apiData.github_followers,
    github_bio:          apiData.github_bio,
    github_stars:        apiData.github_stars,
    github_enriched_at:  new Date().toISOString(),
    // Only fill location if the lead doesn't already have one
    location:            lead.location || apiData.location,
  };

  inMemoryCache.set(username, enrichment);
  return mergeGitHub(lead, enrichment);
}

function mergeGitHub(lead, data) {
  return {
    ...lead,
    github_repos:       data.github_repos       ?? lead.github_repos,
    github_followers:   data.github_followers    ?? lead.github_followers ?? 0,
    github_bio:         data.github_bio          ?? lead.github_bio       ?? null,
    github_stars:       data.github_stars        ?? lead.github_stars     ?? 0,
    github_enriched_at: data.github_enriched_at  ?? lead.github_enriched_at ?? null,
    location:           data.location            ?? lead.location,
  };
}

module.exports = { enrichFromGitHub, makeClient };
