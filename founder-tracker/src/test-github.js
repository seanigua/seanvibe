/**
 * Standalone GitHub API diagnostic.
 * Run: node src/test-github.js
 *
 * Checks:
 *  1. .env loading and GITHUB_TOKEN presence
 *  2. Raw authenticated GET /user (token validity)
 *  3. GET /rate_limit (remaining quota)
 *  4. One repo search query with full URL + raw response
 *  5. User profile fetch for one result (DACH filter demo)
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

// ── 1. env check ──────────────────────────────────────────────────────────────

const token = process.env.GITHUB_TOKEN ?? '';
if (!token) {
  console.error('❌  GITHUB_TOKEN is not set in .env — add it and re-run');
  console.error('    Expected location: founder-tracker/.env');
  console.error('    Expected format:   GITHUB_TOKEN=ghp_...');
  process.exit(1);
}

const masked = token.slice(0, 7) + '...' + token.slice(-4);
console.log(`✅  GITHUB_TOKEN loaded from .env  (${masked})`);

// ── client ────────────────────────────────────────────────────────────────────

const BASE = 'https://api.github.com';
const client = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'founder-tracker/1.0',
  },
});

// Pretty-print a subset of an axios response
function logResponse(label, res) {
  console.log(`\n── ${label} ─────────────────────────────────────`);
  console.log(`   status : ${res.status} ${res.statusText}`);
  console.log(`   url    : ${res.config?.url ?? '(unknown)'}`);
  const rl = res.headers['x-ratelimit-remaining'];
  const rlr = res.headers['x-ratelimit-reset'];
  if (rl !== undefined) {
    const resetAt = rlr ? new Date(parseInt(rlr, 10) * 1000).toISOString() : '?';
    console.log(`   rate   : ${rl} remaining, resets ${resetAt}`);
  }
}

function logError(label, err) {
  console.error(`\n── ${label} (ERROR) ──────────────────────────────`);
  if (err.response) {
    console.error(`   status  : ${err.response.status} ${err.response.statusText}`);
    console.error(`   url     : ${err.response.config?.url}`);
    console.error(`   message : ${JSON.stringify(err.response.data)}`);
  } else {
    console.error(`   ${err.message}`);
  }
}

// ── 2. token validity — GET /user ─────────────────────────────────────────────

async function checkToken() {
  const url = `${BASE}/user`;
  console.log(`\n[step 2] GET ${url}`);
  try {
    const res = await client.get('/user');
    logResponse('GET /user', res);
    const u = res.data;
    console.log(`   authed as : ${u.login} (${u.name ?? 'no name'}) — ${u.type}`);
    return true;
  } catch (err) {
    logError('GET /user', err);
    if (err.response?.status === 401) {
      console.error('   → Token is invalid or expired. Generate a new one at https://github.com/settings/tokens');
    }
    return false;
  }
}

// ── 3. rate limit ─────────────────────────────────────────────────────────────

async function checkRateLimit() {
  const url = `${BASE}/rate_limit`;
  console.log(`\n[step 3] GET ${url}`);
  try {
    const res = await client.get('/rate_limit');
    logResponse('GET /rate_limit', res);
    const { resources } = res.data;
    for (const [name, r] of Object.entries(resources)) {
      const pct = ((r.remaining / (r.limit || 1)) * 100).toFixed(0);
      const resetAt = new Date(r.reset * 1000).toISOString();
      console.log(`   ${name.padEnd(16)} : ${r.remaining}/${r.limit}  (${pct}%)  reset ${resetAt}`);
    }
  } catch (err) {
    logError('GET /rate_limit', err);
  }
}

// ── 4. repo search ────────────────────────────────────────────────────────────

const TEST_QUERY = 'vertical AI startup language:python';

async function testSearch() {
  const url = `${BASE}/search/repositories`;
  const params = { q: TEST_QUERY, sort: 'updated', order: 'desc', per_page: 5, page: 1 };
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
  console.log(`\n[step 4] GET ${fullUrl}`);

  try {
    const res = await client.get('/search/repositories', { params });
    logResponse('search/repositories', res);
    const items = res.data.items ?? [];
    console.log(`   total_count : ${res.data.total_count}`);
    console.log(`   returned    : ${items.length} repos`);
    console.log('\n   Repos:');
    items.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.full_name.padEnd(45)} ★${r.stargazers_count}  owner: ${r.owner.login} (${r.owner.type})`);
    });
    return items;
  } catch (err) {
    logError('search/repositories', err);
    return [];
  }
}

// ── 5. user profile fetch ─────────────────────────────────────────────────────

const DACH_TERMS = ['germany', 'austria', 'switzerland', 'berlin', 'munich', 'münchen',
  'hamburg', 'frankfurt', 'vienna', 'wien', 'zurich', 'zürich'];

async function testUserFetch(repos) {
  const personalRepos = repos.filter(r => r.owner?.type === 'User');
  if (!personalRepos.length) {
    console.log('\n[step 5] no personal-repo owners to test user fetch');
    return;
  }

  const repo = personalRepos[0];
  const login = repo.owner.login;
  const url = `${BASE}/users/${login}`;
  console.log(`\n[step 5] GET ${url}`);
  try {
    const res = await client.get(`/users/${login}`);
    logResponse(`users/${login}`, res);
    const u = res.data;
    const loc = u.location ?? '(no location)';
    const isDACH = DACH_TERMS.some(t => loc.toLowerCase().includes(t));
    console.log(`   login    : ${u.login}`);
    console.log(`   name     : ${u.name ?? '(none)'}`);
    console.log(`   location : ${loc}  → DACH? ${isDACH ? '✅ YES' : '❌ no'}`);
    console.log(`   bio      : ${(u.bio ?? '(none)').slice(0, 80)}`);
    console.log(`   stars    : (not on /users — comes from repo enumeration)`);
    console.log(`   repos    : ${u.public_repos}`);
    console.log(`   followers: ${u.followers}`);
  } catch (err) {
    logError(`users/${login}`, err);
  }
}

// ── run all steps ─────────────────────────────────────────────────────────────

(async () => {
  console.log('════════════════════════════════════════════════════');
  console.log(' GitHub API Diagnostic — founder-tracker');
  console.log('════════════════════════════════════════════════════');

  const tokenOk = await checkToken();
  if (!tokenOk) {
    console.error('\nAborting — fix token first.');
    process.exit(1);
  }

  await checkRateLimit();
  const repos = await testSearch();
  await testUserFetch(repos);

  console.log('\n════════════════════════════════════════════════════');
  console.log(' Diagnostic complete');
  console.log('════════════════════════════════════════════════════\n');
  process.exit(0);
})();
