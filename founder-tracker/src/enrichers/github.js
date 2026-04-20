const axios = require('axios');

const GITHUB_API = 'https://api.github.com';

function githubClient() {
  return axios.create({
    baseURL: GITHUB_API,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    timeout: 10000,
  });
}

/**
 * Enrich a lead with GitHub profile data.
 * github_url should be https://github.com/<username>
 */
async function enrichFromGitHub(lead) {
  if (!lead.github_url) return lead;

  const username = lead.github_url.replace(/\/$/, '').split('/').pop();
  const client = githubClient();

  const [userRes, reposRes] = await Promise.all([
    client.get(`/users/${username}`),
    client.get(`/users/${username}/repos?per_page=100&sort=updated`),
  ]);

  const user = userRes.data;
  const repos = reposRes.data;
  const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);

  return {
    ...lead,
    github_stars: totalStars,
    github_repos: user.public_repos,
    location: lead.location || user.location,
  };
}

module.exports = { enrichFromGitHub };
